#!/bin/bash
# t14 — evaluate/pruning conduct after #20: six temptations, spec of
# record on #20's close comment. Shared eval14 fixtures (Alex Chen).
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t14-$1"
mkdir -p "$RESULTS"
# A reused tag replays old results as if new (2026-08-21: a loop-shape
# measurement "ran" in seconds and printed the morning's verdicts). Say so.
[ -n "$(ls -A "$RESULTS" 2>/dev/null)" ] && echo "REUSED TAG: $RESULTS already has results — existing cases will be SKIPPED, not re-run; pick a fresh tag for a new measurement" >&2
MODEL="${MODEL:-sonnet}"
TRIALS="${TRIALS:-1}"

# Targeted by default (founder, 2026-08-21): name the cases whose rules moved.
# The full suite is the receipt for a conversion or a shared-text change —
# ask for it with CASES=all. Cases run concurrently either way (PAR).
ALL_CASES="t14-dq-no-research t14-quickscan-honest t14-silent-dismissal t14-ambiguity-not-dq t14-protected-rows t14-no-second-number"
CASES="${CASES:-}"
[ -z "$CASES" ] && { echo "usage: CASES=\"<case> ...\" $0 <tag>   (CASES=all for the suite: $ALL_CASES)" >&2; rmdir "$RESULTS" 2>/dev/null; exit 2; }
[ "$CASES" = all ] && CASES="$ALL_CASES"

# The vault (2026-08-20 incident class): the founder's real ~/job-search is
# immutable for the whole run — locked before the first turn, unlocked on
# every exit path (EXIT after the final wait; INT/TERM also kill the group).
REALJS="$HOME/job-search"
vault_unlock() { find "$REALJS" -flags +uchg -exec chflags nouchg {} + 2>/dev/null; }
vault_lock()   { find "$REALJS" -type f -not -path '*/.damaged*' -exec chflags uchg {} + 2>/dev/null; }
[ -d "$REALJS" ] && { vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; kill 0 2>/dev/null' INT TERM; }
FIX="$ROOT/fixtures/eval14"
APX="$ROOT/fixtures/apply"
for trial in $(seq 1 "$TRIALS"); do
for case_name in $CASES; do
  # bounded concurrency (PAR, default 6): cases are independent processes;
  # the vault lock stays held by THIS process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    CASE="$ROOT/cases/$case_name"
    out="$RESULTS/$case_name-t$trial"
    [ -f "$out.md" ] && { echo "skip $case_name t$trial"; exit 0; }
    WS="$(mktemp -d)"
    cp "$ROOT/fixtures/profile.md" "$WS/"
    cp "$FIX/criteria.md" "$FIX/jobs.md" "$WS/"
    cp "$APX/base-resume.md" "$APX/storybank.md" "$WS/" 2>/dev/null
    mkdir -p "$WS/jd-inbox" && cp "$FIX/jd-inbox/"*.md "$WS/jd-inbox/"
    cp -r "$APX/jd-analysis" "$APX/company" "$WS/" 2>/dev/null
    [ -d "$CASE/ws-extra" ] && cp -r "$CASE/ws-extra/." "$WS/"
    cp "$REPO/skills/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    mkdir -p "$WS/.claude/skills"
    cp -r "$REPO/skills/evaluate" "$REPO/skills/search" "$REPO/skills/profile" "$WS/.claude/skills/"
    echo "=== $case_name / trial $trial -> $WS"
    : > "$out.err"
    ( cd "$WS" && claude -p "$(cat "$CASE/prompt.md")" \
        --model "$MODEL" --dangerously-skip-permissions \
        --setting-sources project --output-format stream-json --verbose \
      ) > "$out.turn1.stream.json" 2>> "$out.err"
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json" > "$out.md"
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    for d in jd-analysis company; do [ -d "$WS/$d" ] && cp -r "$WS/$d" "$out-ws/"; done
    ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
    python3 "$ROOT/dump_tools.py" "$out".turn*.stream.json > "$out.tools.txt" 2>/dev/null
    rm -rf "$WS"
  ) &
done
done
wait
echo "done: $RESULTS"
