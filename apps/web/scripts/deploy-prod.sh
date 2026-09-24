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

npx vercel deploy --prebuilt --prod
