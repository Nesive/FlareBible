#!/usr/bin/env python3
"""Monthly translation update check for FlareBible.

Re-downloads the two updatable translations from their open sources,
re-converts them, re-applies the LZZ repair pipeline, and reports whether
anything changed. CUV and KJV are fixed public-domain texts and are never
re-downloaded; ESV is fetched live from the Crossway API at read time.

Sources:
- CCB (当代译本, CC BY-SA 4.0): AO Lab Free Use Bible API, no key needed
  https://bible.helloao.org/api/cmn_cbs/complete.simple.json
- LZZ (吕振中, 1970, public domain): GitHub CodingSerf/holybible (lzz/)

Usage:
  python3 update_translations.py            # check + update data/ in place
  python3 update_translations.py --dry-run  # check only, do not touch data/

Exit code 0 always, unless a download or conversion fails. Prints
CHANGED <book,...> or UNCHANGED. The caller (cron) redeploys only on CHANGED.
A snapshot of the previous data is kept under /tmp/flarebible-update-backup-*
for rollback.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, 'data')
SCRIPTS = os.path.join(REPO, 'scripts')
TMP = '/tmp/flarebible-update'
CCB_URL = 'https://bible.helloao.org/api/cmn_cbs/complete.simple.json'
LZZ_REPO = 'https://github.com/CodingSerf/holybible.git'
DRY_RUN = '--dry-run' in sys.argv


def log(msg):
    print(f'[update] {msg}', flush=True)


def sha1_file(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def snapshot(d):
    out = {}
    for fn in sorted(os.listdir(d)):
        if fn.endswith('.json'):
            out[fn] = sha1_file(os.path.join(d, fn))
    return out


def download(url, dest, timeout=300):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)
    log(f'downloaded {url} -> {dest} ({os.path.getsize(dest)} bytes)')


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        print(r.stdout[-2000:])
        print(r.stderr[-2000:], file=sys.stderr)
        raise SystemExit(f'command failed ({r.returncode}): {" ".join(cmd)}')
    return r.stdout


def main():
    os.makedirs(TMP, exist_ok=True)
    backup_dir = f'/tmp/flarebible-update-backup-{time.strftime("%Y%m%d-%H%M%S")}'
    os.makedirs(backup_dir)
    for sub in ('books-ccb', 'books-lzz'):
        shutil.copytree(os.path.join(DATA, sub), os.path.join(backup_dir, sub))
    log(f'snapshot saved to {backup_dir}')

    # 1. fresh sources
    download(CCB_URL, '/tmp/ccb-complete.json')
    holy = os.path.join(TMP, 'holybible')
    if os.path.isdir(os.path.join(holy, '.git')):
        run(['git', '-C', holy, 'pull', '--ff-only'])
    else:
        shutil.rmtree(holy, ignore_errors=True)
        run(['git', 'clone', '--depth', '1', LZZ_REPO, holy])
    shutil.copytree(holy, '/tmp/holybible', dirs_exist_ok=True)
    log('LZZ source ready')

    # 2. convert (writes into data/, on top of the snapshot)
    out = run([sys.executable, os.path.join(SCRIPTS, 'convert_translations.py'), 'all'])
    print(out, end='')

    # 3. LZZ repair pipeline: detect damaged verses in the fresh conversion,
    #    then FHL cross-check, HTML cleanup, reconstruction, Traditional fallback.
    lzz_dir = os.path.join(DATA, 'books-lzz')
    affected = []
    for fn in sorted(os.listdir(lzz_dir)):
        d = json.load(open(os.path.join(lzz_dir, fn), encoding='utf-8'))
        for ci, ch in enumerate(d['chapters']):
            for vi, v in enumerate(ch):
                if '\ufffd' in v or '<' in v and '>' in v:
                    affected.append([d['abbrev'], ci + 1, vi + 1, v])
    json.dump(affected, open('/tmp/lzz-affected.json', 'w', encoding='utf-8'),
              ensure_ascii=False)
    log(f'damaged LZZ verses in fresh conversion: {len(affected)}')
    if affected:
        out = run([sys.executable, os.path.join(SCRIPTS, 'patch_lzz.py')])
        print(out, end='')
    out = run([sys.executable, os.path.join(SCRIPTS, 'patch_lzz2.py')])
    print(out, end='')
    out = run([sys.executable, os.path.join(SCRIPTS, 'patch_lzz3.py')])
    print(out, end='')
    trad = os.path.join(SCRIPTS, 'lzz-traditional-fallback.json')
    if os.path.exists(trad):
        out = run([sys.executable, os.path.join(SCRIPTS, 'apply_lzz_traditional.py')])
        print(out, end='')
    else:
        log('WARNING: lzz-traditional-fallback.json missing, damaged LZZ verses stay marked □')

    # 4. integrity checks
    for sub, expect_verses in (('books-ccb', None), ('books-lzz', None)):
        d = os.path.join(DATA, sub)
        files = sorted(f for f in os.listdir(d) if f.endswith('.json'))
        assert len(files) == 66, f'{sub}: {len(files)} books, expected 66'
        total_ch, total_v, bad = 0, 0, 0
        for fn in files:
            data = json.load(open(os.path.join(d, fn), encoding='utf-8'))
            total_ch += len(data['chapters'])
            for ch in data['chapters']:
                total_v += len(ch)
                for v in ch:
                    bad += v.count('\ufffd')
        assert total_ch == 1189, f'{sub}: {total_ch} chapters, expected 1189'
        log(f'{sub}: 66 books, 1189 chapters, {total_v} verses, U+FFFD left: {bad}')
        assert bad == 0, f'{sub}: {bad} corrupted verses remain'

    # 5. compare with snapshot
    changed = []
    for sub in ('books-ccb', 'books-lzz'):
        before = snapshot(os.path.join(backup_dir, sub))
        after = snapshot(os.path.join(DATA, sub))
        for fn in sorted(set(before) | set(after)):
            if before.get(fn) != after.get(fn):
                changed.append(f'{sub}/{fn}')
    if DRY_RUN:
        # restore the snapshot; the caller only wanted the answer
        for sub in ('books-ccb', 'books-lzz'):
            shutil.rmtree(os.path.join(DATA, sub))
            shutil.copytree(os.path.join(backup_dir, sub), os.path.join(DATA, sub))
        log('dry run: data/ restored')
    if changed:
        print('CHANGED ' + ','.join(changed))
    else:
        print('UNCHANGED')
    log(f'backup kept at {backup_dir}')


if __name__ == '__main__':
    main()
