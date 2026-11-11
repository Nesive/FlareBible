#!/usr/bin/env python3
"""Convert CCB (contemporary) and LZZ (Lu Zhenzhong) Bible data into the
site's per-book JSON format: {abbrev, name, testament, chapters: [[verses]]}.
CCB also keeps its native section headings in a `headings` field:
  {chapterNumber: [{verse, title}, ...]}

Sources (both openly redistributable):
- CCB: Biblica open resource (CC BY-SA 4.0) via AO Lab Free Use Bible API
  /tmp/ccb-complete.json  (cmn_cbs, "Biblica® 圣经当代译本开放资源")
- LZZ: 吕振中译本, 1970 publication, past China's 50-year copyright term
  /tmp/holybible/lzz/  (CodingSerf/holybible, markdown per chapter)
"""
import json
import os
import re
import sys

SRC_DIR = '/home/hatch/workspace/flarebible/data'
INDEX = json.load(open(os.path.join(SRC_DIR, 'index.json'), encoding='utf-8'))
BOOKS = INDEX  # list of {abbrev, name, testament, chapters}
ABBREV_BY_POS = [b['abbrev'] for b in BOOKS]
NAME_BY_POS = [b['name'] for b in BOOKS]


def write_book(out_dir, abbrev, name, testament, chapters, headings=None):
    os.makedirs(out_dir, exist_ok=True)
    data = {'abbrev': abbrev, 'name': name, 'testament': testament,
            'chapters': chapters}
    if headings:
        data['headings'] = headings
    path = os.path.join(out_dir, abbrev + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    return path


# ---------------------------------------------------------------- CCB
def convert_ccb():
    src = json.load(open('/tmp/ccb-complete.json', encoding='utf-8'))
    out_dir = os.path.join(SRC_DIR, 'books-ccb')
    total_verses = 0
    total_headings = 0
    for pos, book in enumerate(src['books']):
        abbrev = ABBREV_BY_POS[pos]
        chapters = []
        headings = {}
        for ch in book['chapters']:
            verses = []
            pending_headings = []
            for item in ch['chapter']['content']:
                t = item.get('type')
                if t == 'heading':
                    pending_headings.append(item.get('text', '').strip())
                elif t == 'verse':
                    verses.append(item.get('text', '').strip())
                    if pending_headings:
                        ch_num = ch['chapter']['number']
                        for h in pending_headings:
                            headings.setdefault(str(ch_num), []).append(
                                {'verse': item.get('number'), 'title': h})
                            total_headings += 1
                        pending_headings = []
            chapters.append(verses)
            total_verses += len(verses)
        # sanity: chapter count must match index
        assert len(chapters) == BOOKS[pos]['chapters'], (
            abbrev, len(chapters), BOOKS[pos]['chapters'])
        write_book(out_dir, abbrev, BOOKS[pos]['name'],
                   BOOKS[pos]['testament'], chapters,
                   headings or None)
    print(f'CCB: {len(src["books"])} books, {total_verses} verses, '
          f'{total_headings} headings -> {out_dir}')


# ---------------------------------------------------------------- LZZ
VERSE_RE = re.compile(r'^(\d+)\s+(.*\S)\s*$')


def read_text(path):
    """LZZ markdown is mostly UTF-8 but some files are GBK (old text)."""
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        with open(path, encoding='gbk', errors='replace') as f:
            return f.read()


def parse_lzz_chapter(path):
    """Return list of verse strings for one chapter .md file."""
    verses = []
    current = None
    for raw in read_text(path).splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        m = VERSE_RE.match(line)
        if m:
            if current is not None:
                verses.append(current)
            current = m.group(2)
        else:
            # continuation of the previous verse
            if current is not None:
                current += line
    if current is not None:
        verses.append(current)
    # verse numbers should be 1..N in order; verify count only
    return verses


def convert_lzz():
    summary = open('/tmp/holybible/SUMMARY.md', encoding='utf-8').read()
    pairs = re.findall(r'\[([^\]]+)\]\(lzz/(\d+)/README\.md\)', summary)
    assert len(pairs) == 66, len(pairs)
    out_dir = os.path.join(SRC_DIR, 'books-lzz')
    total_verses = 0
    for pos, (_name, dnum) in enumerate(pairs):
        abbrev = ABBREV_BY_POS[pos]
        book_dir = f'/tmp/holybible/lzz/{dnum}'
        files = sorted(f for f in os.listdir(book_dir)
                       if re.match(r'^\d+\.md$', f))
        chapters = []
        for fn in files:
            verses = parse_lzz_chapter(os.path.join(book_dir, fn))
            chapters.append(verses)
            total_verses += len(verses)
        assert len(chapters) == BOOKS[pos]['chapters'], (
            abbrev, len(chapters), BOOKS[pos]['chapters'])
        write_book(out_dir, abbrev, BOOKS[pos]['name'],
                   BOOKS[pos]['testament'], chapters)
    print(f'LZZ: 66 books, {total_verses} verses -> {out_dir}')


if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if which in ('all', 'ccb'):
        convert_ccb()
    if which in ('all', 'lzz'):
        convert_lzz()
