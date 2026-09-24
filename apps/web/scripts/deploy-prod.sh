#!/usr/bin/env bash
# Production deploy for Vercel project `ten-coach` (https://ten-coach.vercel.app).
#
# Prebuilt on this machine, never a plain `vercel --prod`: the app imports
# source from packages/ and bundles skills/ at build time, and a plain upload
# of apps/web carries neither.
#
# Refuses to upload a bundle that contains a builder's home path. Earned
# 2026-09-23: the first production deploy inlined skills/**/__pycache__/*.pyc,
# which embed the absolute path of the machine that compiled them.
#
# Third refusal (design-web-agent.md § 10.1, § 10.4 (ii)): no version.json
# in the static output, or its id in no built JS asset — either one means
# an open tab's § 10 check can never see a newer build, so every tab stays
# silent forever. `vercel build` copying version.json from dist/ to the
# static root's own UNVERIFIED note is what this refusal settles.
set -euo pipefail
cd "$(dirname "$0")/.."

npx vercel pull --yes --environment=production
npx vercel build --prod

static=.vercel/output/static
if grep -rlE '/Users/[A-Za-z]|/home/[a-z]+/' "$static"; then
  echo "REFUSED: the files above contain a home-directory path. Nothing was deployed." >&2
  exit 1
fi
if ! grep -rq 'SKILL.md' "$static"; then
  echo "REFUSED: no skill text in the bundle. Nothing was deployed." >&2
  exit 1
fi
if [ ! -f "$static/version.json" ]; then
  echo "REFUSED: no version.json in the static output. Nothing was deployed." >&2
  exit 1
fi
version_id=$(node -e "console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).id ?? '')" "$static/version.json")
if [ -z "$version_id" ] || ! grep -rqF --include='*.js' -- "$version_id" "$static"; then
  echo "REFUSED: version.json's id is not found in any built JS asset. Nothing was deployed." >&2
  exit 1
fi

npx vercel deploy --prebuilt --prod
