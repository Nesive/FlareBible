#!/usr/bin/env python3
"""Convert a scrollmapper/bible_databases JSON file into FlareBible
data/books-<code>/ JSON files.

Input format (scrollmapper):
  {"books": [{"name": "Genesis", "chapters": [{"chapter": 1,
     "verses": [{"verse": 1, "text": "..."}, ...]}, ...]}, ...]}
Usage:
  python3 scripts/convert_scrollmapper.py <input.json> <out_code> <names_json>

names_json maps the JSON book "name" (English) to the version-language
name, e.g. {"Genesis": "創世記", ...}. Books not in the map (e.g.
Apocrypha) are skipped. Output matches the existing site format.
"""
import json
import os
import re
import sys

# English book name (as in scrollmapper JSON) -> site abbrev
EN_TO_SITE = {
    'Genesis': 'gen', 'Exodus': 'ex', 'Leviticus': 'lv', 'Numbers': 'nm',
    'Deuteronomy': 'dt', 'Joshua': 'jos', 'Judges': 'jdg', 'Ruth': 'rut',
    'I Samuel': '1sa', 'II Samuel': '2sa', 'I Kings': '1ki', 'II Kings': '2ki',
    'I Chronicles': '1ch', 'II Chronicles': '2ch', 'Ezra': 'ezr',
    'Nehemiah': 'neh', 'Esther': 'est', 'Job': 'job', 'Psalms': 'psa',
    'Proverbs': 'pro', 'Ecclesiastes': 'ecc', 'Song of Solomon': 'sng',
    'Isaiah': 'isa', 'Jeremiah': 'jer', 'Lamentations': 'lam',
    'Ezekiel': 'ezk', 'Daniel': 'dan', 'Hosea': 'hos', 'Joel': 'jol',
    'Amos': 'amo', 'Obadiah': 'oba', 'Jonah': 'jon', 'Micah': 'mic',
    'Nahum': 'nam', 'Habakkuk': 'hab', 'Zephaniah': 'zep', 'Haggai': 'hag',
    'Zechariah': 'zec', 'Malachi': 'mal', 'Matthew': 'mat', 'Mark': 'mrk',
    'Luke': 'luk', 'John': 'jhn', 'Acts': 'act', 'Romans': 'rom',
    'I Corinthians': '1co', 'II Corinthians': '2co', 'Galatians': 'gal',
    'Ephesians': 'eph', 'Philippians': 'php', 'Colossians': 'col',
    'I Thessalonians': '1th', 'II Thessalonians': '2th', 'I Timothy': '1ti',
    'II Timothy': '2ti', 'Titus': 'tit', 'Philemon': 'phm',
    'Hebrews': 'heb', 'James': 'jas', 'I Peter': '1pe', 'II Peter': '2pe',
    'I John': '1jn', 'II John': '2jn', 'III John': '3jn', 'Jude': 'jud',
    'Revelation of John': 'rev', 'Revelation': 'rev',
}
OT = set(list(EN_TO_SITE)[:39])


def clean(text):
    t = re.sub(r'<[^>]+>', '', text)  # strip any HTML tags
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def main():
    if len(sys.argv) < 4:
        print('usage: convert_scrollmapper.py <input.json> <out_code> <names_json>')
        sys.exit(2)
    src, code, names_path = sys.argv[1], sys.argv[2], sys.argv[3]
    names = json.load(open(names_path))
    data = json.load(open(src))
    ref_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'books')
    ref_counts = {}
    for f in os.listdir(ref_dir):
        if f.endswith('.json'):
            d = json.load(open(os.path.join(ref_dir, f)))
            ref_counts[d['abbrev']] = len(d['chapters'])
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', f'books-{code}')
    os.makedirs(outdir, exist_ok=True)
    total = 0
    done = []
    problems = []
    skipped = []
    for book in data['books']:
        en_name = book['name']
        if en_name not in EN_TO_SITE:
            skipped.append(en_name)
            continue
        abbrev = EN_TO_SITE[en_name]
        name = names.get(en_name)
        if not name:
            problems.append(f'{en_name}: no {code} name in names file')
            continue
        testament = 'OT' if en_name in OT else 'NT'
        chapters = []
        for ch in sorted(book['chapters'], key=lambda c: c['chapter']):
            verses = []
            for v in sorted(ch['verses'], key=lambda v: v['verse']):
                verses.append(clean(v['text']))
            chapters.append(verses)
        ref = ref_counts.get(abbrev)
        if ref is not None and len(chapters) != ref:
            problems.append(f'{abbrev}: {len(chapters)} chapters, expected {ref}')
        empty = sum(1 for ch in chapters for v in ch if not v)
        if empty:
            problems.append(f'{abbrev}: {empty} empty verses')
        total += sum(len(c) for c in chapters)
        done.append((abbrev, name, len(chapters), sum(len(c) for c in chapters)))
        out = {'abbrev': abbrev, 'name': name, 'testament': testament,
               'chapters': chapters}
        with open(os.path.join(outdir, abbrev + '.json'), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'code={code} books={len(done)} total_verses={total}')
    for abbrev, name, nch, nv in done:
        print(f'  {abbrev}: {name} ch={nch} v={nv}')
    if skipped:
        print('SKIPPED (not in 66-book Protestant canon):', skipped)
    if problems:
        print('PROBLEMS:')
        for p in problems:
            print('  !', p)
    missing = set(EN_TO_SITE.values()) - {b[0] for b in done}
    if missing:
        print('MISSING BOOKS:', sorted(missing))


if __name__ == '__main__':
    main()
