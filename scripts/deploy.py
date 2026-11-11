#!/usr/bin/env python3
"""Deploy FlareBible to Cloudflare Pages (project bible-nesive).

Runs on the server. Stages only the site files (index.html, app.js,
style.css, icons, data/) into a clean directory — the repo's scripts/,
shot/, README and LICENSE are NOT served — then runs wrangler pages deploy.
The Pages API token is read from the server vault in-process only and is
never printed.

Usage (on the server):
  python3 scripts/deploy.py
"""
import json
import os
import shutil
import subprocess
import sys

SITE = '/home/ubuntu/projects/bible-site'
VAULT = '/home/ubuntu/projects/admin/data/vault_tokens.json'
TOKEN_KEY = 'v1793028582'
ACCOUNT_ID = '731e58802d8b11d8619deb77e958d214'
PROJECT = 'bible-nesive'
STAGE = '/tmp/flarebible-deploy-stage'

SITE_FILES = ['index.html', 'app.js', 'style.css', 'favicon.svg',
              'favicon.png', 'apple-touch-icon.png', 'icon-180.png', 'data']


def main():
    shutil.rmtree(STAGE, ignore_errors=True)
    os.makedirs(STAGE)
    for item in SITE_FILES:
        src = os.path.join(SITE, item)
        dst = os.path.join(STAGE, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    token = json.load(open(VAULT))[TOKEN_KEY]
    env = dict(os.environ)
    env['CLOUDFLARE_API_TOKEN'] = token
    env['CLOUDFLARE_ACCOUNT_ID'] = ACCOUNT_ID
    r = subprocess.run(
        ['npx', '--yes', 'wrangler', 'pages', 'deploy', STAGE,
         '--project-name', PROJECT, '--commit-dirty=true'],
        capture_output=True, text=True, env=env, timeout=600)
    print('STDOUT:', r.stdout[-2500:])
    print('STDERR:', r.stderr[-1500:])
    print('RC:', r.returncode)
    shutil.rmtree(STAGE, ignore_errors=True)
    sys.exit(r.returncode)


if __name__ == '__main__':
    main()
