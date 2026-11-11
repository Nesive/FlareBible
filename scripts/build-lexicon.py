#!/usr/bin/env python3
"""Build FlareBible original-language lexicon data (static JSON, lazy-loaded).

Sources (all downloaded files, no API at build or run time):
  - Open Scriptures Hebrew Bible (morphhb): WLC text (public domain) +
    morphology/lemmas (CC BY 4.0). Hebrew OT word data.
  - STEPBible-Data TAGNT: Greek NT word data with Strong's + morphology
    (CC BY 4.0).
  - openscriptures/strongs: Strong's Hebrew (H1-H8674) + Greek (G1-G5624)
    dictionaries, English glosses (CC BY-SA; underlying 1890/1894 text
    public domain).
  - ubsicap/ubs-open-license: UBS Dictionary of Biblical Hebrew + Dictionary
    of the Greek New Testament, incl. Chinese (CC BY-SA 4.0).

Usage:
  python3 scripts/build-lexicon.py [--sources DIR] [--out DIR]
Defaults assume the repo layout:
  sources: ~/workspace/flarebible-research/sources-lexicon/
  out:     ~/workspace/flarebible/data/lexicon/

Outputs:
  data/lexicon/hebrew/<site-abbrev>.json   39 OT books, per-verse word arrays
  data/lexicon/greek/<site-abbrev>.json    27 NT books, same shape
  data/lexicon/strongs-zh.json             H1..H8674 + G1..G5624 entries
  data/lexicon/concordance/<H|G><n>.json   per-Strong's refs {count, refs}
  data/lexicon/strongs-lemma-map.json      Strong's <-> lemma <-> UBS key

Word record shape: {"v": [chapter, verse],
                    "w": [{"t": word, "s": "H3068", "l": lemma, "m": morph}]}

Notes:
  - Hebrew versification is remapped WLC -> English (KJV/CUV) numbering by
    the upstream morphhb converter (VerseMap.xml), so verse numbers match
    the site's CUV/KJV books.
  - The upstream .py converter accepts --stripPointing but never applies it
    (stripPointingFunc is defined but never called), so Hebrew words keep
    their vowel points, as the reader UI requires (report section 2.5).
    The flag is passed anyway to match the documented invocation.
  - OSHB lemma values are Strong's numbers with prefix letters, e.g.
    "b/7225", "c/d/776", "1254 a". After --removeLemmaTypes the letter-type
    suffix (" a") is gone. We keep the raw lemma (prefix letters intact) in
    "l" and derive "s" from the first numeric component ("H7225").
  - UBS dictionaries are keyed by lemma, not by Strong's number. The mapping
    Strong's -> lemma comes from openscriptures/strongs (Hebrew: the <w>
    lemma attribute; Greek: the entry's Greek word), so UBS lookup is
    lemma -> UBS entry.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict

# ---------------------------------------------------------------------------
# Book mappings
# ---------------------------------------------------------------------------

# Upstream morphhb English book name -> site abbrev
HEBREW_BOOKS = {
    "Genesis": "gen", "Exodus": "ex", "Leviticus": "lv", "Numbers": "nm",
    "Deuteronomy": "dt", "Joshua": "jos", "Judges": "jdg", "Ruth": "rut",
    "I Samuel": "1sa", "II Samuel": "2sa", "I Kings": "1ki", "II Kings": "2ki",
    "I Chronicles": "1ch", "II Chronicles": "2ch", "Ezra": "ezr",
    "Nehemiah": "neh", "Esther": "est", "Job": "job", "Psalms": "psa",
    "Proverbs": "pro", "Ecclesiastes": "ecc", "Song of Solomon": "sng",
    "Isaiah": "isa", "Jeremiah": "jer", "Lamentations": "lam",
    "Ezekiel": "ezk", "Daniel": "dan", "Hosea": "hos", "Joel": "jol",
    "Amos": "amo", "Obadiah": "oba", "Jonah": "jon", "Micah": "mic",
    "Nahum": "nam", "Habakkuk": "hab", "Zephaniah": "zep", "Haggai": "hag",
    "Zechariah": "zec", "Malachi": "mal",
}

# Site abbrev -> English short ref used in concordance ("Gen.1.1")
REF_ABBREV = {
    "gen": "Gen", "ex": "Exod", "lv": "Lev", "nm": "Num", "dt": "Deut",
    "jos": "Josh", "jdg": "Judg", "rut": "Ruth", "1sa": "1Sam", "2sa": "2Sam",
    "1ki": "1Kgs", "2ki": "2Kgs", "1ch": "1Chr", "2ch": "2Chr", "ezr": "Ezra",
    "neh": "Neh", "est": "Esth", "job": "Job", "psa": "Ps", "pro": "Prov",
    "ecc": "Eccl", "sng": "Song", "isa": "Isa", "jer": "Jer", "lam": "Lam",
    "ezk": "Ezek", "dan": "Dan", "hos": "Hos", "jol": "Joel", "amo": "Amos",
    "oba": "Obad", "jon": "Jonah", "mic": "Mic", "nam": "Nah", "hab": "Hab",
    "zep": "Zeph", "hag": "Hag", "zec": "Zech", "mal": "Mal",
    "mat": "Matt", "mrk": "Mark", "luk": "Luke", "jhn": "John", "act": "Acts",
    "rom": "Rom", "1co": "1Cor", "2co": "2Cor", "gal": "Gal", "eph": "Eph",
    "php": "Phil", "col": "Col", "1th": "1Thess", "2th": "2Thess",
    "1ti": "1Tim", "2ti": "2Tim", "tit": "Titus", "phm": "Phlm",
    "heb": "Heb", "jas": "Jas", "1pe": "1Pet", "2pe": "2Pet", "1jn": "1John",
    "2jn": "2John", "3jn": "3John", "jud": "Jude", "rev": "Rev",
}

# TAGNT book code -> site abbrev
GREEK_BOOKS = {
    "Mat": "mat", "Mrk": "mrk", "Luk": "luk", "Jhn": "jhn",
    "Act": "act", "Rom": "rom", "1Co": "1co", "2Co": "2co",
    "Gal": "gal", "Eph": "eph", "Php": "php", "Col": "col",
    "1Th": "1th", "2Th": "2th", "1Ti": "1ti", "2Ti": "2ti",
    "Tit": "tit", "Phm": "phm", "Heb": "heb", "Jas": "jas",
    "1Pe": "1pe", "2Pe": "2pe", "1Jn": "1jn", "2Jn": "2jn",
    "3Jn": "3jn", "Jud": "jud", "Rev": "rev",
}

# STEPBible extended Strong's numbers for Hebrew prefixes that have no
# classic Strong's number (TBESH scheme, verified against TAHOT word tags,
# e.g. TAHOT Gen.1.1 "בְּ/רֵאשִׁית" -> H9003/{H7225G},
# Gen.1.5 "לָ/אוֹר" -> H9005/{H0216}). Only the FIRST prefix of a
# prefix-only word is used as its Strong's number.
# OSHB prefix letter -> extended Strong's. "c" is always conjunctive here:
# prefix-only words are never verbs, so the verbal-vav H9001 never applies.
PREFIX_EXTENDED = {
    "c": "H9002",  # וְ conjunctive vav: and, but
    "b": "H9003",  # בְּ beth: in, on, with
    "k": "H9004",  # כְּ kaph: like, as
    "l": "H9005",  # לְ lamed: to, for
    "m": "H9006",  # מִ mem: from
    "s": "H9007",  # שֶׁ shin: which, that
    "i": "H9008",  # הֲ interrogative he
    "h": "H9009",  # הַ article he: the
}

# Dictionary entries for the extended numbers above. Glosses are short
# factual meanings of the morphemes, written for this project (TBESH's
# definition text is NOT copied: its header asks that Online Bible's
# permission be gained before applying its definitions).
EXTENDED_ENTRIES = {
    "H9002": {"lemma": "וְ", "translit": "ve", "pos": "prefix",
              "gloss_en": "and, but",
              "gloss_zh": "和、但、而", "def_zh": "连接词前置词“和”，连接词、短语或句子；也可表转折“但、而”。"},
    "H9003": {"lemma": "בְּ", "translit": "be", "pos": "prefix",
              "gloss_en": "in, on, with",
              "gloss_zh": "在、以、用", "def_zh": "介词前置词“在……里、借着、以、用”。"},
    "H9004": {"lemma": "כְּ", "translit": "ke", "pos": "prefix",
              "gloss_en": "like, as",
              "gloss_zh": "如、像、照", "def_zh": "介词前置词“像、如同、按照”。"},
    "H9005": {"lemma": "לְ", "translit": "le", "pos": "prefix",
              "gloss_en": "to, for",
              "gloss_zh": "向、为、给", "def_zh": "介词前置词“向、为、给、属”。"},
    "H9006": {"lemma": "מִ", "translit": "me", "pos": "prefix",
              "gloss_en": "from",
              "gloss_zh": "从、由", "def_zh": "介词前置词“从、由、出于”。"},
    "H9007": {"lemma": "שֶׁ", "translit": "she", "pos": "prefix",
              "gloss_en": "which, that",
              "gloss_zh": "那、所", "def_zh": "关系词前置词“那、所、的”。"},
    "H9008": {"lemma": "הֲ", "translit": "ha", "pos": "prefix",
              "gloss_en": "interrogative particle",
              "gloss_zh": "吗、岂", "def_zh": "疑问前置词，置于句首表示疑问，相当于“吗、岂”。"},
    "H9009": {"lemma": "הַ", "translit": "ha", "pos": "prefix",
              "gloss_en": "the",
              "gloss_zh": "这、那", "def_zh": "定冠词前置词“这、那”。"},
}

# Part-of-speech labels for dictionary entries.
HEBREW_POS = {
    "n": "noun", "v": "verb", "a": "adjective", "r": "preposition",
    "c": "conjunction", "d": "adverb", "p": "pronoun", "t": "particle",
    "i": "interjection",
}
GREEK_POS = {
    "N": "noun", "V": "verb", "A": "adjective", "R": "pronoun",
    "C": "conjunction", "D": "adverb", "P": "preposition", "T": "article",
    "I": "interjection", "X": "particle",
}

NUM_RE = re.compile(r"(\d+)")


def strip_h_prefixes(lemma):
    """'Hb/H7225' -> 'b/7225'; 'H1254' -> '1254'; 'Hl' -> 'l'."""
    if not lemma:
        return ""
    parts = lemma.split("/")
    return "/".join(p[1:] if p.startswith("H") else p for p in parts)


def strong_from_lemma(lemma):
    """'Hb/H7225' -> 'H7225'; 'H1254' -> 'H1254'.

    Prefix-only lemmas (no numeric root, e.g. 'Hl' for לָהּ) get the
    STEPBible extended number of their first prefix ('Hl' -> 'H9005').
    Returns None only if the lemma has neither digits nor a known prefix.
    """
    if not lemma:
        return None
    m = NUM_RE.search(lemma)
    if m:
        return "H" + m.group(1)
    bare = strip_h_prefixes(lemma)
    first = bare.split("/")[0][:1]
    return PREFIX_EXTENDED.get(first)


def clean_hebrew_word(text):
    """Join morpheme segments: 'בְּ/רֵאשִׁית' -> 'בְּרֵאשִׁית'."""
    return (text or "").replace("/", "")


# ---------------------------------------------------------------------------
# Step 0: run upstream morphhb converter
# ---------------------------------------------------------------------------

def run_morphhb_converter(morphhb_dir, work_dir):
    """Run morphhbXML-to-JSON.py with the documented flags.

    Writes work_dir/json/remapped/<book>.json, one file per OT book:
    chapters -> verses -> words as [text, lemma, morph].
    """
    out_dir = os.path.join(work_dir, "json", "remapped")
    if os.path.isdir(out_dir):
        return out_dir
    cmd = [
        sys.executable, "morphhbXML-to-JSON.py",
        "--stripPointing", "--removeLemmaTypes",
        "--prefixLemmasWithH", "--remapVerses", "--splitByBook",
    ]
    print("running upstream morphhb converter ...", flush=True)
    r = subprocess.run(cmd, cwd=morphhb_dir, capture_output=True, text=True)
    # The script writes relative to its own cwd (morphhb/json/remapped).
    src = os.path.join(morphhb_dir, "json", "remapped")
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr, file=sys.stderr)
        raise SystemExit("morphhb converter failed")
    if not os.path.isdir(src):
        raise SystemExit("morphhb converter produced no output at " + src)
    os.makedirs(work_dir, exist_ok=True)
    # Move (not copy) into the work dir so a re-run is a no-op.
    os.rename(os.path.join(morphhb_dir, "json"),
              os.path.join(work_dir, "json"))
    return out_dir


# ---------------------------------------------------------------------------
# Step 1: Hebrew word files
# ---------------------------------------------------------------------------

def build_hebrew(morphhb_dir, work_dir, out_dir, stats):
    conv_dir = run_morphhb_converter(morphhb_dir, work_dir)
    heb_dir = os.path.join(out_dir, "hebrew")
    os.makedirs(heb_dir, exist_ok=True)
    total_words = 0
    missing_strong = Counter()
    for eng_name, abbrev in HEBREW_BOOKS.items():
        fname = eng_name.replace(" ", "").lower() + ".json"
        with open(os.path.join(conv_dir, fname), encoding="utf-8") as f:
            chapters = json.load(f)
        verses = []
        chapters_with_verses = 0
        for ci, chapter in enumerate(chapters):
            if not chapter:
                continue
            chapters_with_verses += 1
            for vi, words in enumerate(chapter):
                if not words:
                    continue
                wlist = []
                for word in words:
                    text, lemma, morph = word[0], word[1], word[2]
                    s = strong_from_lemma(lemma)
                    if s is None:
                        missing_strong[abbrev] += 1
                        continue
                    if not NUM_RE.search(lemma or ""):
                        stats["hebrew_extended_words"] += 1
                    wlist.append({
                        "t": clean_hebrew_word(text),
                        "s": s,
                        "l": strip_h_prefixes(lemma),
                        "m": morph or "",
                    })
                if wlist:
                    verses.append({"v": [ci + 1, vi + 1], "w": wlist})
                    total_words += len(wlist)
        with open(os.path.join(heb_dir, abbrev + ".json"), "w",
                  encoding="utf-8") as f:
            json.dump(verses, f, ensure_ascii=False, separators=(",", ":"))
        stats["hebrew_verses"] += len(verses)
        stats["hebrew_chapters"] += chapters_with_verses
    stats["hebrew_words"] = total_words
    stats["hebrew_missing_strong"] = dict(missing_strong)
    print("hebrew: %d books, %d chapters, %d verses, %d words" % (
        len(HEBREW_BOOKS), stats["hebrew_chapters"],
        stats["hebrew_verses"], total_words))
    return total_words


# ---------------------------------------------------------------------------
# Step 2: Strong's dictionaries (English base)
# ---------------------------------------------------------------------------

def parse_strongs_hebrew(path, stats):
    """StrongHebrewG.xml -> {H<n>: {lemma, translit, pos, gloss_en}}.

    Entry: <div type="entry" n="1"><w lemma="אָב" morph="n-m" xlit="ʼâb"
    ID="H1">אב</w><list><item>1) father of an individual</item>...
    <note type="explanation">...</note>
    """
    ns = {"o": "http://www.bibletechnologies.net/2003/OSIS/namespace"}
    tree = ET.parse(path)
    root = tree.getroot()
    entries = {}
    for div in root.iter("{%s}div" % ns["o"]):
        if div.get("type") != "entry":
            continue
        n = div.get("n")
        if not n:
            continue
        key = "H" + str(int(n))
        w = div.find("o:w", ns)
        if w is None:
            continue
        lemma = w.get("lemma") or ""
        xlit = w.get("xlit") or ""
        morph = w.get("morph") or ""
        pos = HEBREW_POS.get(morph.split("-")[0].lower(), "")
        senses = []
        lst = div.find("o:list", ns)
        if lst is not None:
            for item in lst.findall("o:item", ns):
                txt = re.sub(r"^\d+[a-z]?\)\s*", "",
                             "".join(item.itertext()).strip())
                if txt:
                    senses.append(txt)
        gloss = senses[0] if senses else ""
        entries[key] = {
            "lemma": lemma,
            "translit": xlit,
            "pos": pos,
            "gloss_en": gloss,
        }
    stats["strongs_hebrew_entries"] = len(entries)
    print("strongs hebrew: %d entries" % len(entries))
    return entries


def parse_strongs_greek(path, stats):
    """strongsgreek.xml -> {G<n>: {lemma, translit, pos, gloss_en}}.

    Entry: <entry strongs="00002"><greek unicode="Ἀαρών"
    translit="Aarṓn"/><pronunciation strongs="ah-ar-ohn'"/>
    <strongs_def>Aaron, the brother of Moses</strongs_def>
    <kjv_def>:--Aaron.</kjv_def>
    Greek Strong's XML carries no part of speech; pos is filled later
    from the most common TAGNT morph code for that number.
    """
    tree = ET.parse(path)
    root = tree.getroot()
    entries = {}
    for entry in root.iter("entry"):
        num = entry.get("strongs")
        if not num:
            continue
        key = "G" + str(int(num))
        greek = entry.find("greek")
        lemma = greek.get("unicode") if greek is not None else ""
        translit = greek.get("translit") if greek is not None else ""
        def_el = entry.find("strongs_def")
        gloss = (def_el.text or "").strip() if def_el is not None else ""
        entries[key] = {
            "lemma": lemma,
            "translit": translit,
            "pos": "",
            "gloss_en": gloss,
        }
    stats["strongs_greek_entries"] = len(entries)
    print("strongs greek: %d entries" % len(entries))
    return entries


# ---------------------------------------------------------------------------
# Step 3: Greek word files (STEPBible TAGNT)
# ---------------------------------------------------------------------------

# Ref forms in TAGNT:
#   Mat.1.1#01=NKO            plain (TAGNT numbering == KJV numbering)
#   2Co.13.13[13.14]#01=NKO  bracket = KJV verse (TAGNT 13.13 == KJV 13.14)
#   Jhn.7.53{8.1}#01=KO      curly = alternate versification; the primary
#                            ref (7.53) is the KJV one here.
# KJV numbering is what the site's KJV books use, so brackets win.
TAGNT_REF_RE = re.compile(
    r"^([A-Za-z0-9]+)\.(\d+)\.(\d+)(?:\[(\d+)\.(\d+)\])?"
    r"(?:\{[^}]*\})?#(\d+)=")


def _first_strong(s):
    """'G1487G' -> 'G1487'; 'G0846' -> 'G846' (strip zero-padding);
    'G4007, G1487' -> 'G4007'; '' -> ''."""
    if not s:
        return ""
    m = re.search(r"G(\d+)", s.split(",")[0])
    return "G" + str(int(m.group(1))) if m else ""


def parse_tagnt_word(row):
    """One TAGNT data row -> (book, ch, vs, pos, word) or None.

    Columns (0-based): 0 ref, 1 Greek (+translit), 3 Strong's=Morph,
    4 lemma=gloss, 5 editions, 11 Strong+Instance, 12 Alt Strongs.

    Compound words (e.g. εἴπερ) carry two Strong's numbers joined with
    " + " in column 3 ("G1487G=COND + G4007=CONJ"); the first one is
    the dictionary key (G1487, the standard tagging for εἴπερ).
    """
    ref = row[0]
    m = TAGNT_REF_RE.match(ref)
    if not m:
        return None
    book = m.group(1)
    if m.group(4):
        ch, vs = int(m.group(4)), int(m.group(5))
    else:
        ch, vs = int(m.group(2)), int(m.group(3))
    pos = int(m.group(6))
    greek = (row[1] if len(row) > 1 else "").strip()
    # "Ἐν (En)" -> "Ἐν"; "[[Καὶ (Kai)" -> "Καὶ" (bracketed pericope text)
    word = greek.split(" (")[0].lstrip("[").strip()
    strong_morph = row[3] if len(row) > 3 else ""
    strong = ""
    morph = ""
    first = strong_morph.split(" + ")[0] if strong_morph else ""
    if "=" in first:
        strong, morph = first.split("=", 1)
        strong = _first_strong(strong.strip())
        morph = morph.strip()
    if not strong:
        # Fall back to the "IsStrong+Instance" column (strip _A suffix).
        alt = row[11] if len(row) > 11 else ""
        strong = _first_strong(alt.split("_")[0].strip())
    lemma_gloss = row[4] if len(row) > 4 else ""
    lemma = lemma_gloss.split("=")[0].strip()
    editions = row[5] if len(row) > 5 else ""
    return (book, ch, vs, pos, {
        "t": word,
        "s": strong,
        "l": lemma,
        "m": morph,
        "na28": "NA28" in editions,
    })


def build_greek(stepbible_dir, out_dir, stats):
    import glob as _glob
    files = sorted(_glob.glob(os.path.join(
        stepbible_dir, "Translators Amalgamated OT+NT", "TAGNT *.txt")))
    if len(files) != 2:
        raise SystemExit("expected 2 TAGNT files, found %d" % len(files))
    # verse key -> list of word dicts (in file order)
    verses = defaultdict(list)
    n_rows = 0
    n_skipped = 0
    missing_strong = Counter()
    pos_tally = defaultdict(Counter)  # G<n> -> Counter of morph 1st letters
    for path in files:
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                row = line.rstrip("\n").split("\t")
                if not row or not row[0] or row[0].startswith("#"):
                    continue
                if row[0].startswith("Word & Type"):
                    continue
                parsed = parse_tagnt_word(row)
                if parsed is None:
                    n_skipped += 1
                    continue
                book, ch, vs, pos, w = parsed
                if book not in GREEK_BOOKS:
                    n_skipped += 1
                    continue
                if not w["s"] or not re.fullmatch(r"G\d+", w["s"]):
                    missing_strong[book] += 1
                    continue
                if not w["t"]:
                    n_skipped += 1
                    continue
                n_rows += 1
                if w["m"]:
                    pos_tally[w["s"]][w["m"][0]] += 1
                verses[(GREEK_BOOKS[book], ch, vs)].append((pos, w))
    # Per verse: prefer NA28 words; if a verse has no NA28 words at all
    # (TR-only verses such as Mat 17:21), keep the TR/Byz words so every
    # verse still has text. This yields a NA28 base text with TR fallback
    # for the 16 verses NA28 omits.
    greek_dir = os.path.join(out_dir, "greek")
    os.makedirs(greek_dir, exist_ok=True)
    total_words = 0
    total_verses = 0
    fallback_verses = []
    for abbrev in GREEK_BOOKS.values():
        book_verses = sorted(
            (k, v) for k, v in verses.items() if k[0] == abbrev)
        out = []
        for (ab, ch, vs), words in book_verses:
            words.sort(key=lambda p: p[0])
            na28 = [w for _, w in words if w["na28"]]
            chosen = na28 if na28 else [w for _, w in words]
            if not na28:
                fallback_verses.append("%s.%d.%d" % (abbrev, ch, vs))
            wlist = [{"t": w["t"], "s": w["s"], "l": w["l"], "m": w["m"]}
                     for w in chosen]
            out.append({"v": [ch, vs], "w": wlist})
            total_words += len(wlist)
        with open(os.path.join(greek_dir, abbrev + ".json"), "w",
                  encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        total_verses += len(out)
    stats["greek_words"] = total_words
    stats["greek_verses"] = total_verses
    stats["greek_rows"] = n_rows
    stats["greek_skipped_rows"] = n_skipped
    stats["greek_missing_strong"] = dict(missing_strong)
    stats["greek_fallback_verses"] = fallback_verses
    print("greek: %d books, %d verses, %d words (%d TR-fallback verses)"
          % (len(GREEK_BOOKS), total_verses, total_words,
             len(fallback_verses)))
    return pos_tally


# ---------------------------------------------------------------------------
# Step 4: UBS Chinese glosses (UBS Dictionary of Biblical Hebrew / Greek NT)
# ---------------------------------------------------------------------------

HEBREW_POINTS_RE = re.compile(r"[\u0591-\u05c7]")


def _norm_lemma(s, greek=False):
    """Normalize a lemma for comparison: strip Hebrew vowel points, or
    strip Greek diacritics (NFD + drop combining marks) and lowercase."""
    import unicodedata
    if not s:
        return ""
    if greek:
        s = "".join(c for c in unicodedata.normalize("NFD", s)
                    if unicodedata.category(c) != "Mn")
        return s.lower()
    return HEBREW_POINTS_RE.sub("", s)


def parse_ubs(path, prefix, strongs_lemmas, stats):
    """UBS dictionary JSON -> {code: {gloss_zh, def_zh, ubs_id}}.

    Entries carry StrongCodes (e.g. ["H0003", "A0004"] / ["G0026"]);
    letter suffixes (H0032a) are normalized to the base number. When
    several entries claim one code (usually a single word plus compound
    expressions containing it), prefer the entry whose lemma matches
    the Strong's dictionary lemma, then single-word entries.
    Entries with no Chinese sense keep gloss_zh/def_zh empty (the UI
    falls back to the English gloss); the English UBS file is not used.
    """
    import unicodedata  # noqa: F401  (kept for _norm_lemma parity)
    with open(path, encoding="utf-8") as f:
        entries = json.load(f)
    greek = prefix == "G"
    candidates = defaultdict(list)
    for e in entries:
        codes = [c for c in (e.get("StrongCodes") or []) if c]
        if not codes:
            continue
        # First zh-Hans sense with content.
        gloss_zh = ""
        def_zh = ""
        for bf in (e.get("BaseForms") or []):
            for lm in (bf.get("LEXMeanings") or []):
                for s in (lm.get("LEXSenses") or []):
                    if s.get("LanguageCode") != "zh-Hans":
                        continue
                    gl = s.get("Glosses") or []
                    ds = (s.get("DefinitionShort") or "").strip()
                    dl = (s.get("DefinitionLong") or "").strip()
                    if gl or ds or dl:
                        gloss_zh = (gl[0].strip() if gl else ds)
                        def_zh = ds if ds != gloss_zh else dl
                        break
                if gloss_zh or def_zh:
                    break
            if gloss_zh or def_zh:
                break
        lemma = e.get("Lemma") or ""
        for c in codes:
            if not c.startswith(prefix):
                continue
            m = re.search(r"(\d+)", c)
            if not m:
                continue
            code = prefix + str(int(m.group(1)))
            candidates[code].append({
                "gloss_zh": gloss_zh, "def_zh": def_zh,
                "ubs_id": e.get("MainId") or "",
                "lemma": lemma,
            })
    out = {}
    collisions = 0
    for code, cands in candidates.items():
        if len(cands) > 1:
            collisions += 1
        target = _norm_lemma(strongs_lemmas.get(code, ""), greek=greek)

        def score(c):
            lem = _norm_lemma(c["lemma"], greek=greek)
            s = 2 if target and lem == target else 0
            if " " not in c["lemma"].strip() and "　" not in c["lemma"]:
                s += 1
            return (s, -len(c["lemma"]))
        best = max(cands, key=score)
        out[code] = {"gloss_zh": best["gloss_zh"],
                     "def_zh": best["def_zh"],
                     "ubs_id": best["ubs_id"]}
    # Lemma map (for extended Strong's numbers, whose entries are keyed
    # by lemma rather than by number): normalized lemma -> first entry
    # with Chinese content, else first entry.
    lemma_map = {}
    for e in entries:
        lemma = _norm_lemma(e.get("Lemma") or "", greek=greek)
        if not lemma:
            continue
        gloss_zh = ""
        def_zh = ""
        for bf in (e.get("BaseForms") or []):
            for lm in (bf.get("LEXMeanings") or []):
                for s in (lm.get("LEXSenses") or []):
                    if s.get("LanguageCode") != "zh-Hans":
                        continue
                    gl = s.get("Glosses") or []
                    ds = (s.get("DefinitionShort") or "").strip()
                    dl = (s.get("DefinitionLong") or "").strip()
                    if gl or ds or dl:
                        gloss_zh = (gl[0].strip() if gl else ds)
                        def_zh = ds if ds != gloss_zh else dl
                        break
                if gloss_zh or def_zh:
                    break
            if gloss_zh or def_zh:
                break
        cur = lemma_map.get(lemma)
        if cur is None or (not cur["gloss_zh"] and not cur["def_zh"]
                           and (gloss_zh or def_zh)):
            lemma_map[lemma] = {"gloss_zh": gloss_zh, "def_zh": def_zh,
                                "ubs_id": e.get("MainId") or ""}
    stats["ubs_%s_codes" % prefix.lower()] = len(out)
    stats["ubs_%s_collisions" % prefix.lower()] = collisions
    stats["ubs_%s_no_zh" % prefix.lower()] = sum(
        1 for v in out.values() if not v["gloss_zh"] and not v["def_zh"])
    print("ubs %s: %d codes mapped (%d collisions, %d without Chinese)"
          % (prefix, len(out), collisions,
             stats["ubs_%s_no_zh" % prefix.lower()]))
    return out, lemma_map


# ---------------------------------------------------------------------------
# Step 5: strongs-zh.json, strongs-lemma-map.json, concordance shards
# ---------------------------------------------------------------------------

def parse_tbesg(path, stats):
    """STEPBible TBESG (brief lexicon of extended Strong's for Greek,
    CC BY 4.0, glosses based on the public-domain Abbott-Smith).

    Line: code, code + " =", base code, lemma, translit, POS, short
    gloss, long definition. Only the short gloss (column 7) is taken;
    the long definition text is not copied.
    Returns {code: {lemma, translit, gloss_en}}.
    """
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            row = line.rstrip("\n").split("\t")
            if not row or not re.fullmatch(r"G\d+", row[0] or ""):
                continue
            out[row[0]] = {
                "lemma": row[3] if len(row) > 3 else "",
                "translit": row[4] if len(row) > 4 else "",
                "gloss_en": row[6].strip() if len(row) > 6 else "",
            }
    stats["tbesg_entries"] = len(out)
    print("tbesg: %d entries" % len(out))
    return out


# ---------------------------------------------------------------------------
# Step 5: strongs-zh.json, strongs-lemma-map.json, concordance shards
# ---------------------------------------------------------------------------

def build_strongs_and_concordance(heb, grk, ubs_h, ubs_g, ubs_g_lemma,
                                  tbesg, pos_tally,
                                  out_dir, index_path, stats):
    # --- merge dictionary (Strong's + UBS Chinese + extended prefixes) ---
    merged = {}
    for code, e in heb.items():
        u = ubs_h.get(code, {})
        merged[code] = {
            "lemma": e["lemma"], "translit": e["translit"],
            "pos": e["pos"], "gloss_zh": u.get("gloss_zh", ""),
            "def_zh": u.get("def_zh", ""), "gloss_en": e["gloss_en"],
        }
    for code, e in grk.items():
        u = ubs_g.get(code, {})
        pos = ""
        if code in pos_tally:
            pos = GREEK_POS.get(pos_tally[code].most_common(1)[0][0], "")
        merged[code] = {
            "lemma": e["lemma"], "translit": e["translit"],
            "pos": pos, "gloss_zh": u.get("gloss_zh", ""),
            "def_zh": u.get("def_zh", ""), "gloss_en": e["gloss_en"],
        }
    for code, e in EXTENDED_ENTRIES.items():
        merged[code] = dict(e)

    # --- concordance (also collects the set of codes actually used) ---
    with open(index_path, encoding="utf-8") as f:
        index = json.load(f)
    conc = {}  # code -> {"count": n, "refs": [...], "_seen": set}
    for b in index:
        ab = b["abbrev"]
        sub = "hebrew" if b["testament"] == "OT" else "greek"
        path = os.path.join(out_dir, sub, ab + ".json")
        with open(path, encoding="utf-8") as f:
            verses = json.load(f)
        for v in verses:
            ref = "%s.%d.%d" % (REF_ABBREV[ab], v["v"][0], v["v"][1])
            for w in v["w"]:
                s = w["s"]
                ent = conc.setdefault(s, {"count": 0, "refs": [],
                                          "_seen": set()})
                ent["count"] += 1
                if ref not in ent["_seen"]:
                    ent["_seen"].add(ref)
                    ent["refs"].append(ref)
    for ent in conc.values():
        del ent["_seen"]

    # --- extended Greek numbers (STEPBible G6000+, e.g. G6063 οἶδα):
    # words Strong's never numbered. Dictionary entries come from TBESG
    # (lemma/translit/short gloss); Chinese comes from the UBS entry for
    # the same lemma when one exists, else stays empty.
    tbesg_added = 0
    tbesg_no_zh = 0
    for code in sorted(conc):
        if code in merged:
            continue
        t = tbesg.get(code)
        if not t:
            continue
        pos = ""
        if code in pos_tally:
            pos = GREEK_POS.get(pos_tally[code].most_common(1)[0][0], "")
        zh = ubs_g_lemma.get(_norm_lemma(t["lemma"], greek=True), {})
        if not zh.get("gloss_zh") and not zh.get("def_zh"):
            tbesg_no_zh += 1
        merged[code] = {
            "lemma": t["lemma"], "translit": t["translit"], "pos": pos,
            "gloss_zh": zh.get("gloss_zh", ""),
            "def_zh": zh.get("def_zh", ""), "gloss_en": t["gloss_en"],
        }
        tbesg_added += 1
    stats["tbesg_added"] = tbesg_added
    stats["tbesg_no_zh"] = tbesg_no_zh
    missing = sorted(c for c in conc if c not in merged)
    stats["concordance_missing_dict"] = missing
    if missing:
        print("WARNING: %d codes used but without dictionary entry: %s"
              % (len(missing), missing[:10]))

    with open(os.path.join(out_dir, "strongs-zh.json"), "w",
              encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, separators=(",", ":"))
    stats["strongs_total"] = len(merged)
    stats["strongs_with_zh"] = sum(
        1 for v in merged.values() if v["gloss_zh"] or v["def_zh"])
    print("strongs-zh.json: %d entries, %d with Chinese"
          % (len(merged), stats["strongs_with_zh"]))

    # --- lemma map ---
    lemma_map = {}
    for code, e in heb.items():
        lemma_map[code] = {"lemma": e["lemma"],
                           "ubs": ubs_h.get(code, {}).get("ubs_id") or None}
    for code, e in grk.items():
        lemma_map[code] = {"lemma": e["lemma"],
                           "ubs": ubs_g.get(code, {}).get("ubs_id") or None}
    for code, e in EXTENDED_ENTRIES.items():
        lemma_map[code] = {"lemma": e["lemma"], "ubs": None}
    for code in sorted(conc):
        if code in lemma_map:
            continue
        t = tbesg.get(code)
        zh = (ubs_g_lemma.get(_norm_lemma(t["lemma"], greek=True), {})
              if t else {})
        lemma_map[code] = {"lemma": t["lemma"] if t else "",
                           "ubs": zh.get("ubs_id") or None}
    with open(os.path.join(out_dir, "strongs-lemma-map.json"), "w",
              encoding="utf-8") as f:
        json.dump(lemma_map, f, ensure_ascii=False, separators=(",", ":"))

    # --- concordance shards ---
    stats["concordance_codes"] = len(conc)
    stats["concordance_total_tokens"] = sum(
        e["count"] for e in conc.values())
    # Grouped shards of 100 numbers (keeps the file count low for Pages'
    # 20,000-file deployment limit; a shard is fetched by (n // 100) * 100).
    conc_dir = os.path.join(out_dir, "concordance")
    os.makedirs(conc_dir, exist_ok=True)
    shards = defaultdict(dict)
    for code, ent in conc.items():
        prefix = code[0]
        n = int(re.search(r"(\d+)", code).group(1))
        shards["%s%04d" % (prefix, (n // 100) * 100)][code] = ent
    for name, shard in shards.items():
        with open(os.path.join(conc_dir, name + ".json"), "w",
                  encoding="utf-8") as f:
            json.dump(shard, f, ensure_ascii=False, separators=(",", ":"))
    stats["concordance_shards"] = len(shards)
    print("concordance: %d codes, %d tokens, %d shards"
          % (len(conc), stats["concordance_total_tokens"], len(shards)))
    return merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default=os.path.expanduser(
        "~/workspace/flarebible-research/sources-lexicon"))
    ap.add_argument("--out", default=os.path.expanduser(
        "~/workspace/flarebible/data/lexicon"))
    ap.add_argument("--work", default=os.path.expanduser(
        "~/workspace/flarebible-research/lexicon-work"))
    args = ap.parse_args()

    stats = Counter()
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.work, exist_ok=True)

    morphhb_dir = os.path.join(args.sources, "morphhb")
    strongs_dir = os.path.join(args.sources, "strongs")
    stepbible_dir = os.path.join(args.sources, "stepbible")
    ubs_dir = os.path.join(args.sources, "ubs", "dictionaries")

    build_hebrew(morphhb_dir, args.work, args.out, stats)
    pos_tally = build_greek(stepbible_dir, args.out, stats)
    heb = parse_strongs_hebrew(
        os.path.join(strongs_dir, "hebrew", "StrongHebrewG.xml"), stats)
    grk = parse_strongs_greek(
        os.path.join(strongs_dir, "greek",
                     "StrongsGreekDictionaryXML_1.4", "strongsgreek.xml"),
        stats)
    ubs_h, _ubs_h_lemma = parse_ubs(
        os.path.join(ubs_dir, "hebrew", "JSON",
                     "UBSHebrewDic-v0.9.4-zh-hans.JSON"),
        "H", {k: v["lemma"] for k, v in heb.items()}, stats)
    ubs_g, ubs_g_lemma = parse_ubs(
        os.path.join(ubs_dir, "greek", "JSON",
                     "UBSGreekNTDic-v1.0-zh-hans.JSON"),
        "G", {k: v["lemma"] for k, v in grk.items()}, stats)
    tbesg = parse_tbesg(
        os.path.join(stepbible_dir, "Lexicons",
                     "TBESG - Translators Brief lexicon of Extended "
                     "Strongs for Greek - STEPBible.org CC BY.txt"),
        stats)
    index_path = os.path.join(os.path.dirname(
        os.path.abspath(args.out)), "index.json")
    build_strongs_and_concordance(heb, grk, ubs_h, ubs_g, ubs_g_lemma,
                                  tbesg, pos_tally,
                                  args.out, index_path, stats)
    print(json.dumps({k: v for k, v in stats.items()}, indent=1,
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
