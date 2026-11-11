# Lexicon data — sources and licenses

The FlareBible site code is MIT. **The data in this directory keeps its own
licenses** — it is NOT MIT. This file lists every source that went into
`data/lexicon/`, what was taken from it, and the license that applies.

## Sources

### 1. Open Scriptures Hebrew Bible (OSHB / morphhb) — Hebrew word data
- Repo: https://github.com/openscriptures/morphhb
- Commit used: `3d15126fb1ef74867fc1434be1942e837932691f`
- Taken: `wlc/` (Westminster Leningrad Codex XML) converted by the upstream
  script `morphhbXML-to-JSON.py` with `--stripPointing --removeLemmaTypes
  --prefixLemmasWithH --remapVerses --splitByBook`.
- License: **the WLC text is public domain**; the lemma and morphology data
  are **CC BY 4.0**. Attribution: the Open Scriptures Hebrew Bible Project.
  (Repo `LICENSE.md` / `README.md` at the commit above.)

### 2. STEPBible-Data (TAGNT + TBESG) — Greek word data and extended numbers
- Repo: https://github.com/STEPBible/STEPBible-Data
- Commit used: `5de0a47f35f0fc13dfe1430d104e5db8a4285f9c`
- Taken:
  - `Translators Amalgamated OT+NT/TAGNT Mat-Jhn …txt` and
    `TAGNT Act-Rev …txt` (Translators' Amalgamated Greek NT, with Strong's
    numbers and morphology). Per-verse edition filter: NA28 rows preferred;
    TR/Byz rows only where a verse has no NA28 row (16 verses).
  - `Lexicons/TBESG …txt` (Translators' Brief lexicon of Extended Strong's
    for Greek): **only the short gloss column** (e.g. G6063 οἶδα — "to know")
    was used for the 78 extended Greek numbers (G6000+). The long
    definition text was NOT copied.
- License: **CC BY 4.0** (repo README: "STEPBible Data Repository CC BY
  4.0"; data created by www.STEPBible.org based on work at Tyndale House
  Cambridge). The TBESG brief glosses are based on Abbott-Smith's *Manual
  Greek Lexicon* (1922, public domain).

### 3. Open Scriptures Strong's dictionaries — Hebrew + Greek dictionary
- Repo: https://github.com/openscriptures/strongs
- Commit used: `0acd2f251c2d35ff8db2dece4e0593979d3ac223`
- Taken: `hebrew/StrongHebrewG.xml` (8,674 entries) and
  `greek/StrongsGreekDictionaryXML_1.4/strongsgreek.xml` (5,624 entries):
  lemma, transliteration, part of speech, English gloss.
- License: the underlying Strong's Concordance (1890) is **public domain**.
  The Open Scriptures XML edition is distributed as **CC BY-SA** (project's
  stated terms); note that **no LICENSE file is present in the repo at the
  commit above**, so this is recorded as the project's stated license, not
  verified from a license file in the checkout.

### 4. UBS dictionaries (Chinese) — Chinese glosses and definitions
- Repo: https://github.com/ubsicap/ubs-open-license
- Commit used: `a15a96cfaa4ca18a6c0339016645ba1e534db3c8`
- Taken: `dictionaries/hebrew/JSON/UBSHebrewDic-v0.9.4-zh-hans.JSON`
  (7,943 entries) and `dictionaries/greek/JSON/UBSGreekNTDic-v1.0-zh-hans.JSON`
  (5,507 entries): first Chinese gloss / definition per Strong's number,
  matched directly on Strong's codes. Only the first sense is captured.
- License: **CC BY-SA 4.0** (LICENSE.md in each dictionary directory).
  © United Bible Societies.

## Derived / project-written data (no third-party text copied)

- **Extended Hebrew numbers H9002–H9009** (prefix-only words such as לָהּ,
  בָכֶם, which have no classic Strong's number): the numbering scheme
  follows STEPBible's TBESH (H9002 conjunctive vav, H9003 preposition ב,
  H9004 כ, H9005 ל, H9006 מ, H9007 ש, H9008 interrogative, H9009 ה). The
  TBESH file's header states its definitions are based on Abridged BDB by
  Online Bible and that permission should be gained before applying them —
  **no TBESH definition text was copied**. The short glosses for H9002–H9009
  in `strongs-zh.json` were written for this project.
- **Extended Greek numbers G6000+** (78 codes, e.g. G6063 οἶδα): dictionary
  entries come from TBESG (see §2). Chinese glosses for 75 of the 78 come
  from the UBS Greek dictionary matched by lemma; 3 codes have no Chinese
  gloss and fall back to the English gloss.
- **Concordance shards** (`concordance/`): computed from the word files in
  this build; verse references only, no dictionary text.

## What was NOT used

- **FHL** (浸宣 / 信望愛): the FTP pack was never attempted; no FHL online
  API was called and no FHL data is in this build. UBS + English fallback
  is the approved scope.
- **NA28 / UBS5 full text**: not fetched, not included (copyrighted).
- **morphgnt / sblgnt**: not used as a source (no Strong's column).
- **TBESH / TFLSJ / BDB / Thayer / LSJ long definitions**: not copied.
  Only the TBESH numbering scheme (H9002–H9009) and the TBESG short
  glosses were used, as described above.

## Summary table

| Data | Source | License |
| --- | --- | --- |
| Hebrew words (WLC text) | morphhb | Public domain |
| Hebrew lemma + morphology | morphhb | CC BY 4.0 |
| Greek words (TAGNT) | STEPBible-Data | CC BY 4.0 |
| Extended Greek glosses (TBESG short gloss) | STEPBible-Data | CC BY 4.0 |
| Strong's Hebrew/Greek dictionary (English) | openscriptures/strongs | Public domain text; XML edition CC BY-SA (project-stated) |
| Chinese glosses/definitions | UBS dictionaries | CC BY-SA 4.0 |
| H9002–H9009 glosses | Written for this project | MIT (same as site code) |
| Concordance (refs only) | Computed in this build | MIT (same as site code) |

## Rebuilding

Run `python3 scripts/build-lexicon.py` from the site root
(`~/workspace/flarebible/`). Sources live in
`~/workspace/flarebible-research/sources-lexicon/` (pruned to the files the
build reads; `.git` kept so the commits above can be verified and the
pruned files restored with `git checkout`). A re-run from the pruned
sources was verified to produce byte-identical output (all 223 files).
See `~/workspace/flarebible-research/lexicon-build-REPORT.md`.
