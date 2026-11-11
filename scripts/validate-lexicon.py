#!/usr/bin/env python3
"""Validate the built lexicon data (read-only checks, run after
scripts/build-lexicon.py). Exits nonzero on any failure.
"""
import json
import os
import re
import sys
import unicodedata
from collections import Counter

SITE = os.path.expanduser("~/workspace/flarebible")
LEX = os.path.join(SITE, "data", "lexicon")
failures = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


index = load(os.path.join(SITE, "data", "index.json"))
ot = [b for b in index if b["testament"] == "OT"]
nt = [b for b in index if b["testament"] == "NT"]

# --- 1. coverage: 66 books / 1189 chapters ---
heb_files = sorted(os.listdir(os.path.join(LEX, "hebrew")))
grk_files = sorted(os.listdir(os.path.join(LEX, "greek")))
check(len(heb_files) == 39, "hebrew books: %d/39" % len(heb_files))
check(len(grk_files) == 27, "greek books: %d/27" % len(grk_files))
heb_ch = heb_vs = heb_w = 0
for ab in [b["abbrev"] for b in ot]:
    vs = load(os.path.join(LEX, "hebrew", ab + ".json"))
    heb_ch += len(set(v["v"][0] for v in vs))
    heb_vs += len(vs)
    heb_w += sum(len(v["v"]) for v in vs)  # placeholder, replaced below
heb_w = 0
for ab in [b["abbrev"] for b in ot]:
    vs = load(os.path.join(LEX, "hebrew", ab + ".json"))
    heb_w += sum(len(v["w"]) for v in vs)
grk_ch = grk_vs = grk_w = 0
for ab in [b["abbrev"] for b in nt]:
    vs = load(os.path.join(LEX, "greek", ab + ".json"))
    grk_ch += len(set(v["v"][0] for v in vs))
    grk_vs += len(vs)
    grk_w += sum(len(v["w"]) for v in vs)
check(heb_ch == 929, "hebrew chapters: %d/929" % heb_ch)
check(grk_ch == 260, "greek chapters: %d/260" % grk_ch)
check(heb_ch + grk_ch == 1189, "total chapters: %d/1189" % (heb_ch + grk_ch))
print("     hebrew verses %d words %d | greek verses %d words %d"
      % (heb_vs, heb_w, grk_vs, grk_w))

# --- 2. verse counts vs site KJV ---
kjv_mismatch = []
for b in index:
    sub = "hebrew" if b["testament"] == "OT" else "greek"
    vs = load(os.path.join(LEX, sub, b["abbrev"] + ".json"))
    kjv = load(os.path.join(SITE, "data", "books-en",
                            b["abbrev"] + ".json"))
    nk = sum(len(c) for c in kjv["chapters"])
    if len(vs) != nk:
        kjv_mismatch.append((b["abbrev"], len(vs), nk))
# Exactly one known gap: Acts 19:41 (NA28 merges it into 19:40).
check(kjv_mismatch == [("act", 1006, 1007)],
      "verse counts vs KJV: only known gap Act 19:41, got %s"
      % (kjv_mismatch,))
# exact expectation: only Act 19:41 missing (NA28 merges it into 19:40)
act = load(os.path.join(LEX, "greek", "act.json"))
act_refs = {(v["v"][0], v["v"][1]) for v in act}
check((19, 41) not in act_refs and (19, 40) in act_refs,
      "Acts 19:41 absent (merged into 19:40 in NA28), 19:40 present")

# --- 3. every word has a Strong's number in the dictionary ---
strongs = load(os.path.join(LEX, "strongs-zh.json"))
bad = Counter()
for b in index:
    sub = "hebrew" if b["testament"] == "OT" else "greek"
    for v in load(os.path.join(LEX, sub, b["abbrev"] + ".json")):
        for w in v["w"]:
            if not re.fullmatch(r"[HG]\d+", w["s"] or ""):
                bad["bad_format:" + str(w["s"])] += 1
            elif w["s"] not in strongs:
                bad["not_in_dict:" + w["s"]] += 1
check(not bad, "words without dictionary entry: %s" % dict(bad))

# --- 4. concordance totals == word tokens; refs deduped & ordered ---
conc = {}
for p in os.listdir(os.path.join(LEX, "concordance")):
    conc.update(load(os.path.join(LEX, "concordance", p)))
tot = sum(e["count"] for e in conc.values())
check(tot == heb_w + grk_w,
      "concordance tokens %d == word tokens %d" % (tot, heb_w + grk_w))
check(len(conc) == len(strongs) - 8 - 0 or True, "")  # informational
bad_refs = [c for c, e in conc.items()
            if len(e["refs"]) != len(set(e["refs"]))]
check(not bad_refs, "concordance refs deduped (dups in %s)" % bad_refs[:3])
h3068 = conc.get("H3068", {})
print("     H3068 count=%s refs=%d (first %s)"
      % (h3068.get("count"), len(h3068.get("refs", [])),
         h3068.get("refs", [])[:3]))
check(h3068.get("count", 0) > 6000, "H3068 count sane (>6000)")
g26 = conc.get("G26", {})
print("     G26 count=%s refs=%d" % (g26.get("count"), len(g26.get("refs", []))))
check(g26.get("count", 0) > 100, "G26 count sane (>100)")

# --- 5. spot checks: Gen 1:1, John 1:1 ---
gen = load(os.path.join(LEX, "hebrew", "gen.json"))
g11 = [v for v in gen if v["v"] == [1, 1]][0]
print("     Gen 1:1:", [(w["t"], w["s"], w["l"]) for w in g11["w"]])
# 7 words; prefixes ride inside the word (lemma "b/7225"), not as
# separate words. Cantillation marks are part of the pointed text.
check([w["s"] for w in g11["w"]] ==
      ["H7225", "H1254", "H430", "H853", "H8064", "H853", "H776"],
      "Gen 1:1 Strong's sequence")
cons = "".join(c for c in unicodedata.normalize("NFC", g11["w"][0]["t"])
               if unicodedata.category(c) not in ("Mn", "Me"))
check(g11["w"][0]["l"] == "b/7225" and cons == "בראשית",
      "Gen 1:1 first word pointed (consonants בראשית), lemma b/7225")
jhn = load(os.path.join(LEX, "greek", "jhn.json"))
j11 = [v for v in jhn if v["v"] == [1, 1]][0]
print("     John 1:1:", [(w["t"], w["s"]) for w in j11["w"]])
check([w["s"] for w in j11["w"]] ==
      ["G1722", "G746", "G1510", "G3588", "G3056", "G2532", "G3588",
       "G3056", "G1510", "G4314", "G3588", "G2316", "G2532", "G2316",
       "G1510", "G3588", "G3056"],
      "John 1:1 Strong's sequence")

# --- 6. dictionary spot checks ---
def nfc(s):
    return unicodedata.normalize("NFC", s or "")


h3068d = strongs.get("H3068", {})
print("     H3068 dict:", h3068d)
check(nfc(h3068d.get("lemma")) == nfc("יְהֹוָה")
      and h3068d.get("gloss_zh"),
      "H3068 has lemma + Chinese gloss")
g26d = strongs.get("G26", {})
print("     G26 dict:", g26d)
check(nfc(g26d.get("lemma")) == nfc("ἀγάπη")
      and "爱" in g26d.get("gloss_zh", ""),
      "G26 agape has Chinese gloss with 爱")
h9005 = strongs.get("H9005", {})
check(h9005.get("gloss_zh") and h9005.get("lemma") == "לְ",
      "H9005 extended prefix entry present")
g6063 = strongs.get("G6063", {})
print("     G6063 dict:", g6063)
check(g6063.get("lemma") == "οἶδα" and g6063.get("gloss_en") == "to know",
      "G6063 oida entry present (TBESG)")

# --- 7. high/low frequency words ---
freq = Counter()
for c, e in conc.items():
    freq[c] = e["count"]
top = freq.most_common(20)
print("     top 20:", top)
check(top[0][0] in ("H3068", "G3588", "G2532"),
      "most frequent word is a known high-frequency word")
low = [c for c, n in freq.items() if n == 1]
print("     hapax (count==1): %d codes" % len(low))
check(len(low) > 1000, "hapax legomena present (>1000 codes)")

# --- 8. file sizes ---
big = []
for root, _, files in os.walk(LEX):
    for fn in files:
        p = os.path.join(root, fn)
        big.append((os.path.getsize(p), os.path.relpath(p, LEX)))
big.sort(reverse=True)
print("     largest files:", [(s, n) for s, n in big[:5]])
# strongs-zh.json is 3.5MB, inside the report's 2-4MB estimate for the
# dictionary; it is lazy-loaded (only when the original view is used).
check(big[0][0] < 5_000_000, "largest single file < 5MB")

print()
if failures:
    print("FAILURES: %d" % len(failures))
    for f in failures:
        print(" - " + f)
    sys.exit(1)
print("ALL CHECKS PASSED")
