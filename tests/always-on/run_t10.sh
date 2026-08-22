#!/bin/bash
# t10 — apply conduct after the #25 restructure (the P2.11 derivation eval):
# do the compressed patterns/moment-rules still PRODUCE the behavior the
# deleted prose spelled out? Baits from the candidate-caught incidents:
# storybank-default (Medtronic bullet), verbatim bullets under "make it
# strong", panel source-inputs + one-round. Fixtures: the Alex Chen apply
# workspace (fictional Nimbus Robotics).
#
# Environment contract (README): --setting-sources project, fresh mktemp,
# full permissions (rule 4 — file writes and subagent spawns must be
# possible for the baits to be real). apply + profile ship together
# (the résumé audit and reader craft are profile's).
# Usage: ./run_t10.sh <run-tag>   (TRIALS=n MODEL=sonnet overridable)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t10-$1"
mkdir -p "$RESULTS"
# A reused tag replays old results as if new (2026-08-21: a loop-shape
# measurement "ran" in seconds and printed the morning's verdicts). Say so.
[ -n "$(ls -A "$RESULTS" 2>/dev/null)" ] && echo "REUSED TAG: $RESULTS already has results — existing cases will be SKIPPED, not re-run; pick a fresh tag for a new measurement" >&2
MODEL="${MODEL:-sonnet}"
TRIALS="${TRIALS:-1}"

# The vault (2026-08-20 incident class): the founder's real ~/job-search is
# immutable for the whole run — locked before the first turn, unlocked on
# every exit path (EXIT after the final wait; INT/TERM also kill the group).
REALJS="$HOME/job-search"
vault_unlock() { find "$REALJS" -flags +uchg -exec chflags nouchg {} + 2>/dev/null; }
vault_lock()   { find "$REALJS" -type f -not -path '*/.damaged*' -exec chflags uchg {} + 2>/dev/null; }
[ -d "$REALJS" ] && { vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; kill 0 2>/dev/null' INT TERM; }

# Targeted by default (founder, 2026-08-21): name the cases whose rules moved.
# The full suite is the receipt for a conversion or a shared-text change —
# ask for it with CASES=all. Cases run concurrently either way (PAR).
ALL_CASES="t10-storybank-default t10-verbatim-panel t10-coverage-classify t10-over-budget"
CASES="${CASES:-}"
[ -z "$CASES" ] && { echo "usage: CASES=\"<case> ...\" $0 <tag>   (CASES=all for the suite: $ALL_CASES)" >&2; rmdir "$RESULTS" 2>/dev/null; exit 2; }
[ "$CASES" = all ] && CASES="$ALL_CASES"
FIX="$ROOT/fixtures/apply"

run_turn() { # ws prompt-file out-stream err-file continue?
  local cont=""
  [ "${5:-}" = "continue" ] && cont="--continue"
  ( cd "$1" && claude -p $cont "$(cat "$2")" \
      --model "$MODEL" --dangerously-skip-permissions \
      --setting-sources project --output-format stream-json --verbose \
    ) > "$3" 2>> "$4"
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
    cp "$ROOT/fixtures/profile.md" "$WS/"
    cp "$FIX"/base-resume.md "$FIX"/voice.md "$FIX"/storybank.md "$FIX"/jobs.md "$WS/"
    cp -r "$FIX/stories" "$FIX/jd-inbox" "$FIX/jd-analysis" "$FIX/company" "$WS/"
    # case-local overrides: a longer base for the budget bait, an engineered
    # jd-analysis for the coverage bait (the t15 pattern)
    [ -f "$CASE/base-resume.md" ] && cp "$CASE/base-resume.md" "$WS/"
    [ -d "$CASE/jd-analysis" ] && cp "$CASE/jd-analysis/"*.md "$WS/jd-analysis/"
    cp "$REPO/skills/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    mkdir -p "$WS/.claude/skills"
    cp -r "$REPO/skills/apply" "$REPO/skills/profile" "$WS/.claude/skills/"
    echo "=== $case_name / trial $trial -> $WS"
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
    for d in applications contacts stories; do
      [ -d "$WS/$d" ] && cp -r "$WS/$d" "$out-ws/"
    done
    ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
    # Deterministic layer: the checker with the planted base — authoritative
    # for the verbatim-bullets bait.
    R="$(ls "$WS"/applications/*-resume.md 2>/dev/null | head -1)"
    L="$(ls "$WS"/applications/*cover-letter*.md 2>/dev/null | head -1)"
    if [ -n "$R" ]; then
      python3 "$REPO/skills/apply/scripts/check_materials.py" --workspace "$WS" \
        --resume "$R" ${L:+--letter "$L"} --base "$WS/base-resume.md" \
        > "$out-ws/_materials_check.txt" 2>&1
    else
      echo "NO TAILORED RESUME WRITTEN" > "$out-ws/_materials_check.txt"
    fi
    python3 "$ROOT/dump_tools.py" "$out".turn*.stream.json > "$out.tools.txt" 2>/dev/null
    grep -ho '"skill": *"[^"]*"' "$out".turn*.stream.json 2>/dev/null | sort -u > "$out.skills.txt"
    rm -rf "$WS"
  ) &
done
done
wait
echo "done: $RESULTS"
