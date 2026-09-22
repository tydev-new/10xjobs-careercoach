#!/bin/bash
# t7 — storybank conduct: capture honesty on a vague answer, the document-
# is-a-source rule under a live correction, and drafts never posing as
# confirmed evidence. Cases mirror the 2026-08-14 acceptance run (the
# "most left" -> "about half" source correction is case 2's bait).
#
# Environment contract (README): --setting-sources project, fresh mktemp,
# full permissions (rule 4 — Bash must be live for check_stories/persistence).
# storybank + profile ship together (capture PROPOSES base-resume.md
# changes — 2026-08-19, was "writes" — whose schema profile owns).
# Usage: ./run_t7.sh <run-tag>   (TRIALS=n RUNNER_MODEL=<dated-id> CONDS="full" overridable — bare aliases like `sonnet` are rejected; see README Pinned models)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="$ROOT/results/t7-$1"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS"
maybe_dry_run runner "$RESULTS" && exit 0
TRIALS="${TRIALS:-1}"
CONDS="${CONDS:-full}"

run_turn() { # ws prompt-file out-stream err-file continue?
  local cont=""
  [ "${5:-}" = "continue" ] && cont="--continue"
  ( cd "$1" && claude -p $cont "$(cat "$2")" \
      --model "$MODEL" --dangerously-skip-permissions \
      --setting-sources project --output-format stream-json --verbose \
    ) > "$3" 2>> "$4"
}

for trial in $(seq 1 "$TRIALS"); do
for cond in $CONDS; do
for case_name in ${CASES:-t7-capture-honesty t7-mining-correction t7-draft-not-confirmed}; do
  CASE="$ROOT/cases/$case_name"
  out="$RESULTS/$case_name-$cond-t$trial"
  [ -f "$out.md" ] && { echo "skip $case_name/$cond t$trial (exists)"; continue; }
  WS="$(mktemp -d)"
  cp "$ROOT/fixtures/profile.md" "$ROOT/fixtures/criteria.md" "$WS/"
  for f in base-resume.md storybank.md; do
    [ -f "$CASE/$f" ] && cp "$CASE/$f" "$WS/"
  done
  for d in old-stories stories; do
    [ -d "$CASE/$d" ] && cp -r "$CASE/$d" "$WS/"
  done
  cp "$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
  if [ "$cond" = "full" ]; then
    mkdir -p "$WS/.claude/skills"
    cp -r "$RUNNER_SKILLS_DIR/storybank" "$RUNNER_SKILLS_DIR/profile" "$WS/.claude/skills/"
  fi
  echo "=== $case_name / $cond / trial $trial -> $WS"
  : > "$out.err"
  if [ -f "$CASE/turn1.md" ]; then
    run_turn "$WS" "$CASE/turn1.md" "$out.turn1.stream.json" "$out.err"
    run_turn "$WS" "$CASE/turn2.md" "$out.turn2.stream.json" "$out.err" continue
    {
      echo "===== TURN 1 ====="
      python3 "$ROOT/extract_text.py" "$out.turn1.stream.json"
      echo; echo "===== TURN 2 ====="
      python3 "$ROOT/extract_text.py" "$out.turn2.stream.json"
    } > "$out.md"
  else
    run_turn "$WS" "$CASE/prompt.md" "$out.turn1.stream.json" "$out.err"
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json" > "$out.md"
  fi
  mkdir -p "$out-ws"
  cp "$WS"/*.md "$out-ws/" 2>/dev/null
  [ -d "$WS/stories" ] && cp -r "$WS/stories" "$out-ws/"
  ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
  # deterministic post-check the judge reads verbatim
  python3 "$RUNNER_SKILLS_DIR/storybank/scripts/check_stories.py" --workspace "$WS" \
    > "$out-ws/_stories_check.txt" 2>&1
  grep -ho '"skill": *"[^"]*"' "$out".turn*.stream.json 2>/dev/null | sort -u > "$out.skills.txt"
  record_served_models "$out"
  rm -rf "$WS"
done
done
done
echo "done: $RESULTS"
