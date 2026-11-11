#!/usr/bin/env python3
"""Finish the LZZ cleanup:
1. Strip stray HTML tags (e.g. </font>) left in the digitised text.
2. Patch the remaining corrupted verses by CONTENT-matching against FHL
   (verse numbers differ between the two LZZ editions in some chapters,
   so match by shared characters, not by number).
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict

import opencc

SRC_DIR = '/home/hatch/workspace/flarebible/data'
INDEX = json.load(open(os.path.join(SRC_DIR, 'index.json'), encoding='utf-8'))
BOOK_BY_ABBREV = {b['abbrev']: b for b in INDEX}
T2S = opencc.OpenCC('t2s')
S2T = opencc.OpenCC('s2t')

HTML_RE = re.compile(r'<[^>]+>')
FHL = 'https://bible.fhl.net/new/read.php'
VERSE_RE = re.compile(r'<b>(\d+):(\d+)</b>.*?<td[^>]*>([^<]+)</td>', re.S)


def strip_html():
    n = 0
    for fn in os.listdir(os.path.join(SRC_DIR, 'books-lzz')):
        path = os.path.join(SRC_DIR, 'books-lzz', fn)
        d = json.load(open(path, encoding='utf-8'))
        changed = False
        for ci, ch in enumerate(d['chapters']):
            for vi, v in enumerate(ch):
                if HTML_RE.search(v):
                    d['chapters'][ci][vi] = HTML_RE.sub('', v)
                    n += 1
                    changed = True
        if changed:
            json.dump(d, open(path, 'w', encoding='utf-8'),
                      ensure_ascii=False, separators=(',', ':'))
    print(f'stripped HTML from {n} verses')


def clean_chars(s):
    return re.sub(r'[\ufffd\s，。；：、「」『』（）〈〉《》、,.!?;:"\'()\[\]-]', '', s)


def overlap(a, b):
    sa, sb = set(clean_chars(a)), set(clean_chars(b))
    if not sa:
        return 0.0
    return len(sa & sb) / len(sa)


def fetch_chapter(abbrev, chapter):
    book = BOOK_BY_ABBREV[abbrev]
    trad_name = S2T.convert(book['name'])
    n_verses = len(json.load(
        open(os.path.join(SRC_DIR, 'books-lzz', abbrev + '.json'),
             encoding='utf-8'))['chapters'][chapter - 1])
    qs = urllib.parse.urlencode({
        'VERSION': 'lcc', 'TABFLAG': '1', 'chineses': trad_name,
        'chap': chapter, 'sec': f'1-{n_verses + 5}', 'm': '',
    })
    req = urllib.request.Request(FHL + '?' + qs,
                                 headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=40) as r:
        html = r.read().decode('utf-8', errors='replace')
    return {int(v): t.strip()
            for ch, v, t in VERSE_RE.findall(html)}


def main():
    strip_html()
    # remaining corrupted verses
    remaining = []
    for fn in sorted(os.listdir(os.path.join(SRC_DIR, 'books-lzz'))):
        d = json.load(open(os.path.join(SRC_DIR, 'books-lzz', fn),
                           encoding='utf-8'))
        for ci, ch in enumerate(d['chapters']):
            for vi, v in enumerate(ch):
                if '\ufffd' in v:
                    remaining.append((d['abbrev'], ci + 1, vi + 1, v))
    print(f'remaining corrupted verses: {len(remaining)}')
    groups = defaultdict(list)
    for abbrev, ch, v, text in remaining:
        groups[(abbrev, ch)].append((v, text))
    patched, failed = 0, []
    for (abbrev, chapter), items in sorted(groups.items()):
        try:
            fhl = fetch_chapter(abbrev, chapter)
        except Exception as e:
            print(f'{abbrev} {chapter}: fetch failed: {e}')
            failed.extend((abbrev, chapter, v) for v, _ in items)
            continue
        path = os.path.join(SRC_DIR, 'books-lzz', abbrev + '.json')
        data = json.load(open(path, encoding='utf-8'))
        for v, old in items:
            best_v, best_ov = None, 0.0
            for fv, ftxt in fhl.items():
                ov = overlap(old, T2S.convert(ftxt))
                if ov > best_ov:
                    best_v, best_ov = fv, ov
            if best_v is not None and best_ov >= 0.5:
                fixed = T2S.convert(fhl[best_v])
                data['chapters'][chapter - 1][v - 1] = fixed
                patched += 1
                print(f'{abbrev} {chapter}:{v} (FHL {best_v}, ov {best_ov:.2f}): '
                      f'{fixed[:50]}')
            else:
                failed.append((abbrev, chapter, v))
                print(f'{abbrev} {chapter}:{v}: no good match '
                      f'(best ov {best_ov:.2f})')
        json.dump(data, open(path, 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
        time.sleep(0.6)
    print(f'\npatched: {patched}, still failed: {len(failed)}')
    if failed:
        print('failed:', failed)


if __name__ == '__main__':
    main()
