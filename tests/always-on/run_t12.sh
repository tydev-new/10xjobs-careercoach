#!/bin/bash
# t12 — prep + practice conduct after #17 (question bank + sourcing ladder):
# does the ladder rank banked over generated (with rough-priority), does a
# vague signal stay vague, and does a debrief actually land questions in
# question-bank.md? Baits from #17's deferred done-when, the never-sharpen
# rule's temptation, and the D1 stale-route regression. Fixtures: the Alex
# Chen apply workspace (fictional Nimbus Robotics) + per-case ws-extra/.
#
# Environment contract (README): --setting-sources project, fresh mktemp,
# full permissions. prep + practice + profile + storybank ship together
# (candidate-voice and the résumé audit are profile's; use-count updates touch
# storybank.md).
# Usage: ./run_t12.sh <run-tag>   (TRIALS=n MODEL=sonnet overridable)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t12-$1"
mkdir -p "$RESULTS"
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

# Targeted by default: name the cases whose rules moved; CASES=all for the suite.
ALL_CASES="t12-ladder-rank t12-never-sharpen t12-debrief-bank"
CASES="${CASES:-}"
[ -z "$CASES" ] && { echo "usage: CASES=\"<case> ...\" $0 <tag>   (CASES=all for the suite: $ALL_CASES)" >&2; rmdir "$RESULTS" 2>/dev/null; exit 2; }
[ "$CASES" = all ] && CASES="$ALL_CASES"
FIX="$ROOT/fixtures/apply"

run_turn() { # ws prompt-file out-stream err-file
  ( cd "$1" && claude -p "$(cat "$2")" \
      --model "$MODEL" --dangerously-skip-permissions \
      --setting-sources project --output-format stream-json --verbose \
    ) > "$3" 2>> "$4"
}

for trial in $(seq 1 "$TRIALS"); do
for case_name in $CASES; do
  # bounded concurrency (PAR, default 6); the vault lock is held by THIS
  # process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    CASE="$ROOT/cases/$case_name"
    out="$RESULTS/$case_name-t$trial"
    [ -f "$out.md" ] && { echo "skip $case_name t$trial (exists)"; exit 0; }
    WS="$(mktemp -d)"
    cp "$ROOT/fixtures/profile.md" "$WS/"
    cp "$FIX"/base-resume.md "$FIX"/voice.md "$FIX"/storybank.md "$FIX"/jobs.md "$WS/"
    cp -r "$FIX/stories" "$FIX/jd-inbox" "$FIX/jd-analysis" "$FIX/company" "$WS/"
    # per-case extras OVERLAY the shared fixtures (e.g. a planted bank, a
    # company file carrying the vague signal)
    [ -d "$CASE/ws-extra" ] && cp -r "$CASE/ws-extra/." "$WS/"
    cp "$REPO/skills/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    mkdir -p "$WS/.claude/skills"
    cp -r "$REPO/skills/prep" "$REPO/skills/practice" "$REPO/skills/profile" \
          "$REPO/skills/storybank" "$WS/.claude/skills/"
    echo "=== $case_name / trial $trial -> $WS"
    : > "$out.err"
    run_turn "$WS" "$CASE/prompt.md" "$out.turn1.stream.json" "$out.err"
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json" > "$out.md"
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    for d in prep practice; do
      [ -d "$WS/$d" ] && cp -r "$WS/$d" "$out-ws/"
    done
    ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
    python3 "$ROOT/dump_tools.py" "$out".turn*.stream.json > "$out.tools.txt" 2>/dev/null
    grep -ho '"skill": *"[^"]*"' "$out".turn*.stream.json 2>/dev/null | sort -u > "$out.skills.txt"
    rm -rf "$WS"
  ) &
done
done
wait
echo "done: $RESULTS"
