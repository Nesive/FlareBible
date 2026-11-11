#!/usr/bin/env python3
"""Patch the corrupted LZZ verses (U+FFFD / mojibake) by cross-checking
against the信望爱 (FHL) LZZ text, which is the same translation digitised
cleanly. FHL serves Traditional Chinese; convert to Simplified with opencc.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request

import opencc

SRC_DIR = '/home/hatch/workspace/flarebible/data'
INDEX = json.load(open(os.path.join(SRC_DIR, 'index.json'), encoding='utf-8'))
BOOK_BY_ABBREV = {b['abbrev']: b for b in INDEX}

T2S = opencc.OpenCC('t2s')
S2T = opencc.OpenCC('s2t')

AFFECTED = json.load(open('/tmp/lzz-affected.json', encoding='utf-8'))

# group by (abbrev, chapter)
from collections import defaultdict
groups = defaultdict(list)
for abbrev, ch, v, text in AFFECTED:
    groups[(abbrev, ch)].append(v)

FHL = 'https://bible.fhl.net/new/read.php'
VERSE_RE = re.compile(r'<b>(\d+):(\d+)</b>.*?<td[^>]*>([^<]+)</td>', re.S)


def fetch_chapter(abbrev, chapter):
    book = BOOK_BY_ABBREV[abbrev]
    trad_name = S2T.convert(book['name'])
    n_verses = len(json.load(
        open(os.path.join(SRC_DIR, 'books-lzz', abbrev + '.json'),
             encoding='utf-8'))['chapters'][chapter - 1])
    qs = urllib.parse.urlencode({
        'VERSION': 'lcc', 'TABFLAG': '1', 'chineses': trad_name,
        'chap': chapter, 'sec': f'1-{n_verses}', 'm': '',
    })
    req = urllib.request.Request(FHL + '?' + qs,
                                 headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=40) as r:
        html = r.read().decode('utf-8', errors='replace')
    verses = {}
    for ch, v, txt in VERSE_RE.findall(html):
        verses[int(v)] = txt.strip()
    return verses


def main():
    patched = 0
    failed = []
    for (abbrev, chapter), verse_nums in sorted(groups.items()):
        try:
            fhl = fetch_chapter(abbrev, chapter)
        except Exception as e:
            print(f'{abbrev} {chapter}: fetch failed: {e}')
            failed.extend((abbrev, chapter, v) for v in verse_nums)
            continue
        path = os.path.join(SRC_DIR, 'books-lzz', abbrev + '.json')
        data = json.load(open(path, encoding='utf-8'))
        for v in verse_nums:
            if v not in fhl:
                print(f'{abbrev} {chapter}:{v}: not in FHL response')
                failed.append((abbrev, chapter, v))
                continue
            fixed = T2S.convert(fhl[v])
            old = data['chapters'][chapter - 1][v - 1]
            # sanity: the fixed text should share most non-corrupted chars
            data['chapters'][chapter - 1][v - 1] = fixed
            patched += 1
            print(f'{abbrev} {chapter}:{v}: {old[:28]}... -> {fixed[:40]}')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        time.sleep(0.6)
    print(f'\npatched: {patched}, failed: {len(failed)}')
    if failed:
        print('failed:', failed)


if __name__ == '__main__':
    main()
