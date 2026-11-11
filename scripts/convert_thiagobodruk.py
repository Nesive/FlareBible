#!/usr/bin/env python3
"""Convert a thiagobodruk/bible JSON file into FlareBible data/books-<code>/.

Input format (thiagobodruk/bible json/):
  [{"abbrev": "gn", "name": "Gênesis",
    "chapters": [[verse, ...], [...]]}, ...]  (66 books)
Usage:
  python3 scripts/convert_thiagobodruk.py <input.json> <out_code> <abbrev_map_json>

abbrev_map_json maps the source abbrev to the site abbrev,
e.g. {"gn": "gen", "ex": "ex", ...}. Book "name" is kept as-is (already
in the version's language). A "testament" field is added (OT/NT).
"""
import json
import os
import sys

OT_SITE = {
    'gen', 'ex', 'lv', 'nm', 'dt', 'jos', 'jdg', 'rut', '1sa', '2sa',
    '1ki', '2ki', '1ch', '2ch', 'ezr', 'neh', 'est', 'job', 'psa', 'pro',
    'ecc', 'sng', 'isa', 'jer', 'lam', 'ezk', 'dan', 'hos', 'jol', 'amo',
    'oba', 'jon', 'mic', 'nam', 'hab', 'zep', 'hag', 'zec', 'mal',
}


def main():
    if len(sys.argv) < 4:
        print('usage: convert_thiagobodruk.py <input.json> <out_code> <abbrev_map_json>')
        sys.exit(2)
    src, code, map_path = sys.argv[1], sys.argv[2], sys.argv[3]
    amap = json.load(open(map_path))
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
    for book in data:
        src_abbrev = book['abbrev']
        if src_abbrev not in amap:
            problems.append(f"unknown abbrev {src_abbrev} ({book['name']})")
            continue
        abbrev = amap[src_abbrev]
        testament = 'OT' if abbrev in OT_SITE else 'NT'
        chapters = [[str(v) for v in ch] for ch in book['chapters']]
        ref = ref_counts.get(abbrev)
        if ref is not None and len(chapters) != ref:
            problems.append(f'{abbrev}: {len(chapters)} chapters, expected {ref}')
        empty = sum(1 for ch in chapters for v in ch if not v.strip())
        if empty:
            problems.append(f'{abbrev}: {empty} empty verses')
        total += sum(len(c) for c in chapters)
        done.append((abbrev, book['name'], len(chapters), sum(len(c) for c in chapters)))
        out = {'abbrev': abbrev, 'name': book['name'], 'testament': testament,
               'chapters': chapters}
        with open(os.path.join(outdir, abbrev + '.json'), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'code={code} books={len(done)} total_verses={total}')
    for abbrev, name, nch, nv in done:
        print(f'  {abbrev}: {name} ch={nch} v={nv}')
    if problems:
        print('PROBLEMS:')
        for p in problems:
            print('  !', p)
    missing = set(OT_SITE) | {
        'mat', 'mrk', 'luk', 'jhn', 'act', 'rom', '1co', '2co', 'gal',
        'eph', 'php', 'col', '1th', '2th', '1ti', '2ti', 'tit', 'phm',
        'heb', 'jas', '1pe', '2pe', '1jn', '2jn', '3jn', 'jud', 'rev',
    }
    missing -= {b[0] for b in done}
    if missing:
        print('MISSING BOOKS:', sorted(missing))


if __name__ == '__main__':
    main()
