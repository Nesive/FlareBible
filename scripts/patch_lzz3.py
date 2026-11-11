#!/usr/bin/env python3
"""Final LZZ cleanup for the 21 verses whose source digitisation lost
characters (U+FFFD / mojibake).
- 9 verses: full verse replaced with a high-confidence reconstruction
  (famous fixed phrases; wording matches CUV and the surviving LZZ
  context; meaning confirmed against CCB).
- 12 verses: the damaged span is replaced with a single '□' (the standard
  mark for an illegible passage in a source text). No guessing.
"""
import json
import os

SRC_DIR = '/home/hatch/workspace/flarebible/data'
LZZ_DIR = os.path.join(SRC_DIR, 'books-lzz')

# (abbrev, chapter, verse, corrected full verse text)
RECONSTRUCT = [
    ('ecc', 3, 21,
     '谁能知道人的灵是往上升，兽类的魂(同词：灵)是往下降而入于地呢？'),
    ('mat', 5, 6, '饥渴慕义的人有福了！因为他们必得饱足。'),
    ('luk', 5, 3,
     '耶稣上了其中的一只船，是西门的，请他把船撑开，稍微离岸。'
     '他就坐下，从船上教训群众。'),
    ('luk', 5, 4,
     '停讲的时候，耶稣对西门说：「把船开到水深的地方，下网打鱼。」'),
    ('luk', 6, 28, '要给咒诅你们的祝福，为诬蔑你们的祷告。'),
    ('mat', 5, 44,
     '但是我告诉你们，要爱你们的仇敌'
     '(有古卷加：要给咒诅你们的祝福；要好待那恨恶你们的)，'
     '要为那逼迫你们(有古卷加：和诬蔑你们)的祷告。'),
    ('mat', 4, 16,
     '住在暗中的人民看见了大光；住在死地死阴影的人，'
     '有光发现，照着他们。」'),
    ('pro', 6, 30,
     '贼因饥饿而偷窃，去充饥，人不藐视他吗？'
     '(传统不作问号。或如是直译)'),
    ('sng', 7, 4,
     '你的脖子如象牙台；你的眼是希实本境内的池子，在巴特拉并门旁；'
     '你的鼻子仿佛利巴嫩的谯楼朝望着大马色。'),
]

# (abbrev, chapter, verse, damaged fragment, replacement)
DAMAGED = [
    ('1sa', 9, 26, '\uFFFD料值氖焙颍\uFFFD', '□'),
    ('2sa', 17, 29, '\uFFFD靠世Ь氲摹！\uFFFD', '□！'),
    ('2sa', 23, 4, '\uFFFD疗鸪抗猓\uFFFD', '□'),
    ('act', 23, 5, '\uFFFD迹\uFFFD', '□'),
    ('act', 27, 14, '\uFFFD杲欣\uFFFD', '□'),
    ('hos', 9, 13, '\uFFFD远\uFFFD', '□'),
    ('isa', 27, 8, '\uFFFD甓\uFFFD', '□'),
    ('jer', 48, 12, '\uFFFD熳铀に椤\uFFFD', '□。'),
    ('luk', 1, 78, '\uFFFD疗鹄吹墓饩鸵\uFFFD', '□'),
    ('neh', 7, 68, '\uFFFD孕薷吹\uFFFD', '□'),
    ('phm', 1, 20, '\uFFFD\uFFFD', '□'),
    ('pro', 23, 26, '\uFFFD裕恒∈\uFFFD', '□'),
]


def load(abbrev):
    path = os.path.join(LZZ_DIR, abbrev + '.json')
    return json.load(open(path, encoding='utf-8')), path


def save(data, path):
    json.dump(data, open(path, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))


def main():
    for abbrev, ch, v, text in RECONSTRUCT:
        data, path = load(abbrev)
        old = data['chapters'][ch - 1][v - 1]
        assert '\ufffd' in old, f'{abbrev} {ch}:{v} not corrupted: {old!r}'
        data['chapters'][ch - 1][v - 1] = text
        save(data, path)
        print(f'reconstructed {abbrev} {ch}:{v}')
    for abbrev, ch, v, frag, repl in DAMAGED:
        data, path = load(abbrev)
        verse = data['chapters'][ch - 1][v - 1]
        assert frag in verse, (f'{abbrev} {ch}:{v} fragment not found: '
                               f'{frag!r} in {verse!r}')
        data['chapters'][ch - 1][v - 1] = verse.replace(frag, repl, 1)
        save(data, path)
        print(f'marked damaged {abbrev} {ch}:{v}')
    left = 0
    for fn in os.listdir(LZZ_DIR):
        d = json.load(open(os.path.join(LZZ_DIR, fn), encoding='utf-8'))
        for ch in d['chapters']:
            for v in ch:
                left += v.count('\ufffd')
    print('remaining U+FFFD in LZZ:', left)


if __name__ == '__main__':
    main()
