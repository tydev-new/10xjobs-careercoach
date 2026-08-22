#!/bin/bash
# t15 — checker head-to-head (#11 design gate): the py checker vs an
# independent checker-subagent on the LANGUAGE tier. Four planted cases:
# verbatim violations / paraphrased violations / format-drifted rule
# file / clean (false-alarm probe). PY runs 3x to prove stability is
# free; AGENT runs TRIALS (default 3) because model runs are noise.
# Deterministic scoring: score_t15.py vs each case's truth.json.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t15-$1"
mkdir -p "$RESULTS"
MODEL="${MODEL:-sonnet}"
TRIALS="${TRIALS:-3}"
FIX="${FIXDIR:-$ROOT/fixtures/t15}"
for case_name in $(ls "$FIX/cases"); do
  CASE="$FIX/cases/$case_name"
  WS="$(mktemp -d)"
  cp "$FIX/base/"*.md "$WS/"
  # per-case overrides + extra rule sources (drift variants, pitch.md)
  for f in "$CASE"/*.md; do [ -f "$f" ] && cp "$f" "$WS/"; done
  # NO_VOICE marker: this case ships no voice.md (missing-source conduct)
  [ -f "$CASE/NO_VOICE" ] && rm -f "$WS/voice.md"
  mkdir -p "$WS/applications"
  cp "$CASE/applications/"*.md "$WS/applications/"
  echo "=== $case_name -> $WS"
  # --- PY condition: only where the resume/letter pair exists (the v1
  # head-to-head shape). Post-#29 the parser is deleted, so this measures
  # the structure floor only; t15b cases are AGENT-only by design.
  if [ -z "${SKIP_PY:-}" ] && [ -f "$WS/applications/resume.md" ] && [ -f "$WS/applications/letter.md" ]; then
  for n in 1 2 3; do
    out="$RESULTS/$case_name.py.$n.txt"
    [ -s "$out" ] && continue
    python3 "$REPO/skills/apply/scripts/check_materials.py" \
      --workspace "$WS" \
      --resume "$WS/applications/resume.md" \
      --letter "$WS/applications/letter.md" > "$out" 2>&1
  done
  fi
  # --- AGENT condition: TRIALS runs, materials inlined (no tools needed)
  P="$(mktemp)"
  {
    # the PRODUCTION contract since #29 graduation (checker-instructions.md
    # stays beside the fixtures as the t15-v1 archive artifact)
    cat "$REPO/skills/profile/references/language-check.md"
    for src in voice.md base-resume.md pitch.md; do
      [ -f "$WS/$src" ] || continue
      echo; echo "## Rule source: $src"; cat "$WS/$src"
    done
    for doc in "$WS/applications/"*.md; do
      name="$(basename "$doc" .md)"
      echo; echo "## Document under check: \"$name\""; cat "$doc"
    done
  } > "$P"
  for n in $(seq 1 "$TRIALS"); do
    out="$RESULTS/$case_name.agent.$n.json"
    [ -s "$out" ] && { echo "skip agent $n"; continue; }
    claude -p "$(cat "$P")" --model "$MODEL" --setting-sources project \
      > "$out" 2> "$out.err"
  done
  rm -f "$P"; rm -rf "$WS"
done
echo "done: $RESULTS — score with: python3 score_t15.py $1"
