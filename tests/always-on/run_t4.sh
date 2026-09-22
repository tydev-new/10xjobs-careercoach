#!/bin/bash
# t4 attribution experiment — separates model / guardrails / skill.
#
#   bare        model alone
#   guardrails  + workspace CLAUDE.md
#   full        + the profile skill (project-local)
#
# ALL conditions use --setting-sources project, which excludes
# ~/.claude/skills — otherwise the user's globally-installed skills
# (including the old interview-coach) leak into every condition. That
# leak confounded the first Phase A run; do not remove this flag.
#
# Two turns: "get me set up" with a résumé in the folder, then the
# complexity reveal. Usage: ./run_t4.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
CASE="$ROOT/cases/t4-intake"
RESULTS="$ROOT/results/t4-$1"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS"
maybe_dry_run runner "$RESULTS" && exit 0
CONDS="${CONDS:-bare guardrails full}"
TRIALS="${TRIALS:-1}"

for trial in $(seq 1 "$TRIALS"); do
for cond in $CONDS; do
  out="$RESULTS/$cond-t$trial"
  [ -f "$out.md" ] && { echo "skip $cond trial $trial (exists)"; continue; }
  WS="$(mktemp -d)"
  cp "$CASE/resume.md" "$WS/"
  case "$cond" in
    guardrails|full)
      cp "$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md" ;;
  esac
  if [ "$cond" = "full" ]; then
    mkdir -p "$WS/.claude/skills"
    cp -r "$RUNNER_SKILLS_DIR/profile" "$WS/.claude/skills/"
  fi
  echo "=== t4 / $cond / trial $trial -> $WS"
  ( cd "$WS" && claude -p "$(cat "$CASE/turn1.md")" \
      --model "$MODEL" --permission-mode acceptEdits \
      --setting-sources project --output-format stream-json --verbose \
    ) > "$out.turn1.stream.json" 2> "$out.err"
  ( cd "$WS" && claude -p --continue "$(cat "$CASE/turn2.md")" \
      --model "$MODEL" --permission-mode acceptEdits \
      --setting-sources project --output-format stream-json --verbose \
    ) > "$out.turn2.stream.json" 2>> "$out.err"
  {
    echo "===== TURN 1 ====="
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json"
    echo; echo "===== TURN 2 ====="
    python3 "$ROOT/extract_text.py" "$out.turn2.stream.json"
  } > "$out.md"
  mkdir -p "$out-ws"
  cp "$WS"/*.md "$out-ws/" 2>/dev/null
  # record which skills actually fired, if any
  grep -ho '"skill": *"[^"]*"' "$out".turn*.stream.json 2>/dev/null \
    | sort -u > "$out.skills.txt"
  record_served_models "$out"
  rm -rf "$WS"
done
done
echo "done: $RESULTS"
