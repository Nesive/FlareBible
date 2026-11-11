#!/usr/bin/env python3
"""Convert an eBible USFM zip into FlareBible data/books-<code>/ JSON files.

Usage:
  python3 scripts/convert_usfm.py <usfm_zip_or_dir> <out_code> [book_name_overrides_json]

The output matches the existing format:
  {"abbrev": "gen", "name": "<book name in the version's language>",
   "testament": "OT", "chapters": [[verse, ...], [...]]}
One file per book, named by the site abbrev from data/index.json.

USFM markers handled:
  - \\v N ... verse text (may span continuation lines)
  - \\w word|strong="H1234"\\w* -> word
  - \\add ...\\add*, \\nd, \\wj, \\it, \\bd, \\sc, \\em -> keep inner text
  - \\f ...\\f*, \\x ...\\x*, \\fe ...\\fe* -> drop entirely (footnotes/cross-refs)
  - \\p, \\q, \\m, \\s, \\r, \\b, \\li, \\c, \\mt, \\h, \\toc* -> structural, stripped
"""
import json
import os
import re
import sys
import zipfile

# USFM book code -> site abbrev (from data/index.json, canonical order)
USFM_TO_SITE = {
    'GEN': 'gen', 'EXO': 'ex', 'LEV': 'lv', 'NUM': 'nm', 'DEU': 'dt',
    'JOS': 'jos', 'JDG': 'jdg', 'RUT': 'rut', '1SA': '1sa', '2SA': '2sa',
    '1KI': '1ki', '2KI': '2ki', '1CH': '1ch', '2CH': '2ch', 'EZR': 'ezr',
    'NEH': 'neh', 'EST': 'est', 'JOB': 'job', 'PSA': 'psa', 'PRO': 'pro',
    'ECC': 'ecc', 'SNG': 'sng', 'ISA': 'isa', 'JER': 'jer', 'LAM': 'lam',
    'EZK': 'ezk', 'DAN': 'dan', 'HOS': 'hos', 'JOL': 'jol', 'AMO': 'amo',
    'OBA': 'oba', 'JON': 'jon', 'MIC': 'mic', 'NAM': 'nam', 'HAB': 'hab',
    'ZEP': 'zep', 'HAG': 'hag', 'ZEC': 'zec', 'MAL': 'mal', 'MAT': 'mat',
    'MRK': 'mrk', 'LUK': 'luk', 'JHN': 'jhn', 'ACT': 'act', 'ROM': 'rom',
    '1CO': '1co', '2CO': '2co', 'GAL': 'gal', 'EPH': 'eph', 'PHP': 'php',
    'COL': 'col', '1TH': '1th', '2TH': '2th', '1TI': '1ti', '2TI': '2ti',
    'TIT': 'tit', 'PHM': 'phm', 'HEB': 'heb', 'JAS': 'jas', '1PE': '1pe',
    '2PE': '2pe', '1JN': '1jn', '2JN': '2jn', '3JN': '3jn', 'JUD': 'jud',
    'REV': 'rev',
}
OT_CODES = set(list(USFM_TO_SITE)[:39])

# USFM markers that are pure structure (paragraph/poetry/section/list/break).
# Only these are stripped at the start of a continuation line; every other
# marker (\w, \add, \nd, \f, \x, \qs, ...) is content and must be left for
# clean_verse_text to handle.
STRUCTURAL_MARKERS = {
    'p', 'm', 'po', 'pr', 'cls', 'pmo', 'pm', 'pmc', 'pmr', 'pi', 'mi', 'nb',
    'pc', 'ph', 'q', 'qr', 'qc', 'qs', 'qa', 'qm', 'qd', 'lh', 'lf', 'li',
    'lim', 's', 'sr', 'r', 'd', 'sp', 'b', 'mt', 'ms', 'mr', 'sd', 'tr',
    'th', 'tc', 'tcr', 'tc1', 'tc2', 'tc3', 'th1', 'th2', 'th3',
}

# Markers whose ENTIRE line is metadata/reference, not verse text.
# A line starting with one of these must be dropped wholesale: stripping
# only the marker and keeping the remainder leaks the content into the
# preceding verse (Segond: 1673 \r cross-refs + 678 \s1 headings leaked
# into verses; WEB: \sp speaker labels leaked).
# Numbered variants (s1, ms2, mt3, ...) are matched by base name.
# NOTE: \d is NOT in this set (see parse_usfm): a \d line is dropped only
# when it is an all-caps heading (Psalm 119 acrostic letters); a mixed-case
# sentence is verse content (Hab 3:19 colophon, cf. KJV) and is kept.
DROP_LINE_MARKERS = {
    'r',        # parallel passage reference
    's', 'sr',  # section heading / section reference
    'ms', 'mr', 'mt', 'sd',  # major section / section ref / major title
    'sp',       # speaker label (Song of Songs)
    'b',        # blank line (no content anyway)
    'ip', 'ipi', 'im', 'imi', 'ipq', 'ipr', 'iq', 'is', 'io', 'iot', 'ior',
    'toc', 'h', 'rem', 'sts', 'pub', 'id',
}

# Markers whose content is dropped entirely (footnotes, cross-references, etc.)
# Applied repeatedly (up to 3 passes) so nested \x inside \f is also removed.
DROP_RE = re.compile(r'\\[fx]\b.*?\\[fx]\*', re.S)
# \w word|attrs\w* -> word (also \+w nested word markers)
W_RE = re.compile(r'\\\+?w\s+([^|\\]+)\|[^\\]*?\\\+?w\*')
# Any remaining inline marker open/close: \xx, \q1, \+w, \xx* -> keep inner text
INLINE_RE = re.compile(r'\\\+?[a-zA-Z]+\d*\*?')
# A marker at line start that is structural (paragraph, quote, section, etc.)
STRUCT_RE = re.compile(r'\\[a-zA-Z]+\*?')


def clean_verse_text(raw):
    """Strip USFM markup from one verse's raw text, keep plain text."""
    t = raw
    # Drop footnotes / cross-references entirely (may span lines; repeat for nesting)
    for _ in range(3):
        t2 = DROP_RE.sub('', t)
        if t2 == t:
            break
        t = t2
    # \w word|... \w* -> word (also \+w nested)
    t = W_RE.sub(r'\1', t)
    # Any leftover \w ... \w* without attributes (also \+w)
    t = re.sub(r'\\\+?w\s+([^\\]+?)\\\+?w\*', r'\1', t)
    # Remove remaining markers (keep the text between open/close markers)
    t = INLINE_RE.sub('', t)
    # Clean up whitespace
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\s+([,.;:!?\)\]\u201d\u2019])', r'\1', t)
    t = re.sub(r'([\(\[\u201c\u2018])\s+', r'\1', t)
    t = t.strip()
    return t


def parse_usfm(text, fname):
    """Parse one USFM book file -> (book_code, name, chapters list)."""
    # Book code from \id
    m = re.search(r'\\id\s+([A-Z0-9]{3})', text)
    if not m:
        raise ValueError(f'{fname}: no \\id marker')
    code = m.group(1)
    # Book name: prefer \toc2, then \h, then \toc1
    name = None
    for pat in (r'\\toc2\s+(.+)', r'\\h\s+(.+)', r'\\toc1\s+(.+)'):
        nm = re.search(pat, text)
        if nm:
            name = nm.group(1).strip()
            break
    if not name:
        raise ValueError(f'{fname}: no book name found')
    name = re.sub(r'\\[a-zA-Z]+\*?', '', name).strip()

    chapters = []
    cur_ch = None
    cur_verse = None
    cur_text = []

    def flush_verse():
        nonlocal cur_verse, cur_text
        if cur_verse is not None and cur_ch is not None:
            txt = clean_verse_text(' '.join(cur_text))
            # Ensure chapter array is long enough
            while len(chapters) < cur_ch:
                chapters.append([])
            chapters[cur_ch - 1].append(txt)
        cur_verse = None
        cur_text = []

    for line in text.splitlines():
        line = line.rstrip('\n')
        # Chapter marker
        cm = re.match(r'\\c\s+(\d+)', line)
        if cm:
            flush_verse()
            cur_ch = int(cm.group(1))
            continue
        # Verse marker (number may carry a letter suffix, e.g. 1a, or a range 1-2)
        vm = re.match(r'\\v\s+(\d+[a-z]?(?:-\d+[a-z]?)?)\s*(.*)', line)
        if vm:
            flush_verse()
            cur_verse = vm.group(1)
            cur_text = [vm.group(2)]
            continue
        # Structural line (starts with a marker): skip, but if we're inside
        # a verse and the line has no marker at start, it's a continuation.
        if line.startswith('\\'):
            # Drop-line markers (\r, \s, \ms, \mr, \sp, ...): the whole
            # line is metadata/reference, never verse text. Drop it entire;
            # do NOT append its remainder to the current verse.
            dm = re.match(r'\\([a-zA-Z]+)\d*\*?\s*', line)
            if dm and re.sub(r'\d+$', '', dm.group(1)) in DROP_LINE_MARKERS:
                continue
            if dm and dm.group(1) == 'd':
                # Descriptive title (\d): drop only an all-caps heading
                # (Psalm 119 acrostic letters BETH/GIMEL/...); a mixed-case
                # sentence is verse content (Hab 3:19 colophon, cf. KJV)
                # and falls through to be appended to the verse.
                if re.fullmatch(r'[A-Z][A-Z ]*', clean_verse_text(line[dm.end():])):
                    continue
            # Strip ONLY known structural markers at line start (\p, \q1, \m,
            # \li, ...). Content markers (\w, \add, \nd, \f, \x,
            # \qs, ...) must stay so clean_verse_text can process them:
            # stripping \w would orphan its |strong=... attribute, and
            # stripping \x would orphan the cross-reference text.
            stripped = line
            while True:
                mm = re.match(r'\\([a-zA-Z]+)(\d*)\*?\s*', stripped)
                if mm and mm.group(1) in STRUCTURAL_MARKERS:
                    stripped = stripped[mm.end():]
                else:
                    break
            if cur_verse is not None and stripped.strip():
                cur_text.append(stripped)
            continue
        # Plain continuation line
        if cur_verse is not None and line.strip():
            cur_text.append(line)
    flush_verse()
    return code, name, chapters


def main():
    if len(sys.argv) < 3:
        print('usage: convert_usfm.py <usfm_zip_or_dir> <out_code> [overrides_json]')
        sys.exit(2)
    src = sys.argv[1]
    code = sys.argv[2]
    overrides = {}
    if len(sys.argv) > 3:
        overrides = json.load(open(sys.argv[3]))

    # Reference chapter counts from CUV (data/books/)
    ref_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'books')
    ref_counts = {}
    for f in os.listdir(ref_dir):
        if f.endswith('.json'):
            d = json.load(open(os.path.join(ref_dir, f)))
            ref_counts[d['abbrev']] = len(d['chapters'])

    import shutil
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix='usfm-')
    try:
        if os.path.isfile(src) and src.endswith('.zip'):
            with zipfile.ZipFile(src) as z:
                z.extractall(tmpdir)
                srcdir = tmpdir
        else:
            srcdir = src
        _convert_dir(srcdir, code, overrides, ref_counts)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _convert_dir(srcdir, code, overrides, ref_counts):
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', f'books-{code}')
    os.makedirs(outdir, exist_ok=True)

    total = 0
    books_done = []
    problems = []
    for fname in sorted(os.listdir(srcdir)):
        if not fname.lower().endswith('.usfm'):
            continue
        path = os.path.join(srcdir, fname)
        text = open(path, encoding='utf-8-sig', errors='replace').read()
        if '\\id FRT' in text or '\\id INT' in text or '\\id' not in text:
            continue
        try:
            bcode, name, chapters = parse_usfm(text, fname)
        except ValueError as e:
            problems.append(str(e))
            continue
        if bcode not in USFM_TO_SITE:
            problems.append(f'{fname}: unknown book code {bcode}')
            continue
        abbrev = USFM_TO_SITE[bcode]
        name = overrides.get(abbrev, name)
        testament = 'OT' if bcode in OT_CODES else 'NT'
        # Validate chapter count
        ref = ref_counts.get(abbrev)
        if ref is not None and len(chapters) != ref:
            problems.append(f'{abbrev}: {len(chapters)} chapters, expected {ref}')
        # Check for empty verses
        empty = sum(1 for ch in chapters for v in ch if not v)
        if empty:
            problems.append(f'{abbrev}: {empty} empty verses')
        verses = sum(len(ch) for ch in chapters)
        total += verses
        books_done.append((abbrev, name, len(chapters), verses))
        out = {'abbrev': abbrev, 'name': name, 'testament': testament,
               'chapters': chapters}
        with open(os.path.join(outdir, abbrev + '.json'), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'code={code} books={len(books_done)} total_verses={total}')
    for abbrev, name, nch, nv in books_done:
        print(f'  {abbrev}: {name} ch={nch} v={nv}')
    if problems:
        print('PROBLEMS:')
        for p in problems:
            print('  !', p)
    missing = set(USFM_TO_SITE.values()) - {b[0] for b in books_done}
    if missing:
        print('MISSING BOOKS:', sorted(missing))


if __name__ == '__main__':
    main()
