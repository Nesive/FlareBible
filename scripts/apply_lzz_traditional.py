#!/usr/bin/env python3
"""Replace the still-damaged LZZ verses with the Traditional Chinese text
of the same translation (呂振中譯本, FHL lcc).

Background: the simplified-Chinese LZZ digitisation lost characters in a
few verses (U+FFFD / mojibake). Most were repaired by cross-checking the
FHL Traditional text and converting it to Simplified; a handful could not
be verified that way. For those, the user directed that the Traditional
Chinese text be used as-is rather than guessing or leaving a □ mark.

Input: scripts/lzz-traditional-fallback.json
  {"1sa": {"9": {"26": "…traditional text…"}}, ...}
  (abbrev -> chapter -> verse -> Traditional Chinese verse text)

Behaviour: for each listed verse, replace the whole verse text with the
Traditional text, but only if the current verse still contains a damage
marker (U+FFFD or □). Verses already repaired are left untouched.
Prints how many verses were replaced and how many U+FFFD remain.
"""
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, 'data')
LZZ_DIR = os.path.join(DATA, 'books-lzz')
FALLBACK = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        'lzz-traditional-fallback.json')


def main():
    fb = json.load(open(FALLBACK, encoding='utf-8'))
    replaced, skipped, missing = 0, 0, []
    for abbrev, chapters in fb.items():
        path = os.path.join(LZZ_DIR, abbrev + '.json')
        data = json.load(open(path, encoding='utf-8'))
        dirty = False
        for ch, verses in chapters.items():
            for v, text in verses.items():
                cur = data['chapters'][int(ch) - 1][int(v) - 1]
                if '\ufffd' in cur or '□' in cur:
                    data['chapters'][int(ch) - 1][int(v) - 1] = text
                    dirty = True
                    replaced += 1
                    print(f'replaced {abbrev} {ch}:{v} with Traditional text')
                else:
                    skipped += 1
        if dirty:
            json.dump(data, open(path, 'w', encoding='utf-8'),
                      ensure_ascii=False, separators=(',', ':'))
    left = 0
    for fn in os.listdir(LZZ_DIR):
        d = json.load(open(os.path.join(LZZ_DIR, fn), encoding='utf-8'))
        for ch in d['chapters']:
            for v in ch:
                left += v.count('\ufffd')
    print(f'replaced: {replaced}, already clean: {skipped}, '
          f'U+FFFD remaining in LZZ: {left}')


if __name__ == '__main__':
    main()
