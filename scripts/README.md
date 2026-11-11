# FlareBible data scripts

Build and maintenance scripts for the bundled translation data (`../data/`).

## Files

| Script | Purpose |
|---|---|
| `convert_translations.py` | Convert CCB + LZZ sources into per-book JSON (`data/books-ccb/`, `data/books-lzz/`). Reads `/tmp/ccb-complete.json` and `/tmp/holybible/lzz/`. |
| `patch_lzz.py` | Repair corrupted LZZ verses by cross-checking FHL Traditional text (converts to Simplified with opencc). Needs `/tmp/lzz-affected.json`. |
| `patch_lzz2.py` | Strip stray HTML tags from LZZ; fix two verses by content match. |
| `patch_lzz3.py` | Reconstruct 9 high-confidence verses; mark the 12 unrecoverable spans with □. |
| `apply_lzz_traditional.py` | Replace the still-damaged LZZ verses with the Traditional Chinese text from `lzz-traditional-fallback.json`. |
| `update_translations.py` | Monthly update: re-download CCB + LZZ, re-run the whole pipeline, report CHANGED / UNCHANGED. |

## Translation sources

- **CCB 当代译本** — Biblica open resource (CC BY-SA 4.0), via AO Lab Free Use Bible API (`cmn_cbs`): `https://bible.helloao.org/api/cmn_cbs/complete.simple.json` (no key).
- **LZZ 吕振中译本** — 1970, copyright term expired; source GitHub `CodingSerf/holybible` (`lzz/`). Cross-check via FHL `bible.fhl.net` (`VERSION=lcc`, Traditional).
- **CUV / KJV** — fixed public-domain texts, bundled as-is, never re-downloaded.
- **ESV** — not bundled; fetched live from the Crossway API at read time with the reader's own key.

## Monthly update

`update_translations.py` runs on the 1st of each month (cron). It snapshots
`data/books-ccb` + `data/books-lzz`, re-downloads, re-converts, re-patches,
verifies (66 books, 1189 chapters, zero U+FFFD), and prints `CHANGED …` or
`UNCHANGED`. The cron redeploys only when the output says CHANGED.

Manual run:

```bash
python3 scripts/update_translations.py            # check + update in place
python3 scripts/update_translations.py --dry-run  # check only, restore data/
```

Requires: `python3`, `git`, `opencc` (`pip install opencc-python-reimplemented`
or the system package) for the FHL repair step.
