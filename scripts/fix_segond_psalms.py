#!/usr/bin/env python3
"""Normalize Segond 1910 Psalms versification.

The eBible Segond USFM numbers Psalm superscriptions as verse 1 in 62
Psalms (e.g. Ps 3:1 = "Psaume de David. A l'occasion de sa fuite..."),
shifting every following verse by one relative to the standard numbering
(KJV/CUV). In a few Psalms the superscription is instead prepended to
verse 1 (e.g. Ps 23:1 = "Cantique de David. L'Eternel est mon berger..."),
so those Psalms already match the standard count.

This script merges a superscription-only verse 1 into verse 2 (prepended,
so the superscription text is kept) and removes it, but ONLY when:
  1. the Psalm has exactly one more verse than the KJV reference, and
  2. verse 1 starts with a known French superscription keyword.
Psalms that already match the KJV count (e.g. Ps 23) are left untouched.
Run after convert_usfm.py; it rewrites data/books-segond1910/psa.json.
"""
import json
import os
import sys

SUPERSCRIPTION_PREFIXES = (
    'Psaume', 'Cantique', 'Au chef', 'Hymne', 'Prière', 'Instruction',
    'Mictam', 'Michtam', 'Maschil', 'Sur ', 'Élégie', 'Méditation',
    'Pour ', 'Épître', 'Shiggaïon', 'De David', "D'Asaph", 'Des fils',
    'De Salomon', 'De Moïse', "D'Éthan", "D'Héman", 'Aïjeleth',
    'Jonath', 'Muth', 'Alamoth', 'Scheminith', 'Néhiloth', 'Machalath',
    'Guittith', 'Shoshannim', 'Lys', 'Colombe', 'Complainte',
)
# Second (or later) part of a two-part superscription: the occasion note.
OCCASION_PREFIXES = (
    'Lorsque', "Lorsqu'", 'Lorsqu’', 'A l’occasion', "A l'occasion",
    'Quand ',
)

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')


def main():
    seg = json.load(open(os.path.join(BASE, 'books-segond1910', 'psa.json')))
    kjv = json.load(open(os.path.join(BASE, 'books-en', 'psa.json')))
    merged = []
    skipped = []
    for i, (sc, kc) in enumerate(zip(seg['chapters'], kjv['chapters'])):
        psnum = i + 1
        extra = len(sc) - len(kc)
        if extra > 0:
            # The first `extra` verses must all be superscription parts:
            # verse 1 a superscription, any following ones occasion notes.
            head = sc[:extra]
            ok = head[0].startswith(SUPERSCRIPTION_PREFIXES) and all(
                v.startswith(SUPERSCRIPTION_PREFIXES + OCCASION_PREFIXES)
                for v in head[1:])
            if ok:
                # Merge all superscription parts into the first real verse.
                merged_text = ' '.join(head) + ' ' + sc[extra]
                sc[extra] = merged_text
                del sc[:extra]
                merged.append(psnum)
            else:
                skipped.append((psnum, head[0][:60]))
        elif extra < 0:
            skipped.append((psnum, f'count {len(sc)} vs kjv {len(kc)}'))
    with open(os.path.join(BASE, 'books-segond1910', 'psa.json'), 'w',
              encoding='utf-8') as f:
        json.dump(seg, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(len(c) for c in seg['chapters'])
    print(f'merged superscriptions in {len(merged)} psalms: {merged}')
    print(f'skipped (needs review): {skipped}')
    print(f'psalms total now {total} (kjv {sum(len(c) for c in kjv["chapters"])})')


if __name__ == '__main__':
    main()
