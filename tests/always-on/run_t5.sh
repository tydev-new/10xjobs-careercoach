#!/bin/bash
# t5 — does the agent COMPOSE the search (skill owns destination, model owns
# path)? Two cases: attended (no standing plan -> must propose before
# executing, write the plan only after the yes) and scheduled (standing plan
# present -> execute verbatim, never research or ask).
#
# Fresh-session isolation per the environment contract (README):
# --setting-sources project + only the search skill, project-local.
# Usage: ./run_t5.sh <run-tag>     (TRIALS=n, MODEL=sonnet overridable)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t5-$1"
mkdir -p "$RESULTS"
# A reused tag replays old results as if new (2026-08-21: a loop-shape
# measurement "ran" in seconds and printed the morning's verdicts). Say so.
[ -n "$(ls -A "$RESULTS" 2>/dev/null)" ] && echo "REUSED TAG: $RESULTS already has results — existing cases will be SKIPPED, not re-run; pick a fresh tag for a new measurement" >&2
MODEL="${MODEL:-sonnet}"
TRIALS="${TRIALS:-1}"

# Targeted by default (founder, 2026-08-21): name the cases whose rules moved.
# The full suite is the receipt for a conversion or a shared-text change —
# ask for it with CASES=all. Cases run concurrently either way (PAR).
ALL_CASES="t5-plan-attended t5-plan-scheduled"
CASES="${CASES:-}"
[ -z "$CASES" ] && { echo "usage: CASES=\"<case> ...\" $0 <tag>   (CASES=all for the suite: $ALL_CASES)" >&2; rmdir "$RESULTS" 2>/dev/null; exit 2; }
[ "$CASES" = all ] && CASES="$ALL_CASES"

# The vault (2026-08-20 incident class): the founder's real ~/job-search is
# immutable for the whole run — locked before the first turn, unlocked on
# every exit path.
REALJS="$HOME/job-search"
vault_unlock() { find "$REALJS" -flags +uchg -exec chflags nouchg {} + 2>/dev/null; }
vault_lock()   { find "$REALJS" -type f -not -path '*/.damaged*' -exec chflags uchg {} + 2>/dev/null; }
[ -d "$REALJS" ] && { vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; kill 0 2>/dev/null' INT TERM; }

run_turn() { # ws prompt-file out-stream
  ( cd "$1" && claude -p "$(cat "$2")" \
      --model "$MODEL" --dangerously-skip-permissions \
      --setting-sources project --output-format stream-json --verbose \
    ) > "$3" 2>> "$3.err"
}

for trial in $(seq 1 "$TRIALS"); do
for case_name in $CASES; do
  # bounded concurrency (PAR, default 6): cases are independent processes;
  # the vault lock stays held by THIS process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    CASE="$ROOT/cases/$case_name"
    out="$RESULTS/$case_name-t$trial"
    [ -f "$out.md" ] && { echo "skip $case_name t$trial (exists)"; exit 0; }
    WS="$(mktemp -d)"
    cp "$CASE/criteria.md" "$CASE/profile.md" "$WS/"
    cp "$REPO/skills/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    mkdir -p "$WS/.claude/skills"
    cp -r "$REPO/skills/search" "$WS/.claude/skills/"
    echo "=== $case_name / trial $trial -> $WS"
    : > "$out.err"
    if [ -f "$CASE/turn1.md" ]; then
      run_turn "$WS" "$CASE/turn1.md" "$out.turn1.stream.json"
      ( cd "$WS" && claude -p --continue "$(cat "$CASE/turn2.md")" \
          --model "$MODEL" --dangerously-skip-permissions \
          --setting-sources project --output-format stream-json --verbose \
        ) > "$out.turn2.stream.json" 2>> "$out.err"
      {
        echo "===== TURN 1 (any new roles?) ====="
        python3 "$ROOT/extract_text.py" "$out.turn1.stream.json"
        echo; echo "===== TURN 2 (yes, run it) ====="
        python3 "$ROOT/extract_text.py" "$out.turn2.stream.json"
      } > "$out.md"
    else
      run_turn "$WS" "$CASE/prompt.md" "$out.turn1.stream.json"
      python3 "$ROOT/extract_text.py" "$out.turn1.stream.json" > "$out.md"
    fi
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    ls "$WS" > "$out-ws/_listing.txt"
    # what the turn-1 workspace looked like matters for "executed before yes":
    # jobs.db existing at ALL means a sweep ran at some point in the session.
    rm -rf "$WS"
  ) &
done
done
wait
echo "done: $RESULTS"
