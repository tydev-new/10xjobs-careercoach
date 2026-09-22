#!/bin/bash
# t6 — evaluate conduct: honest research on an unfindable company, the
# duplicate-key rule under a drifted name, and track assignment.
#
# Conditions (CONDS): full = evaluate+search skills project-local;
# bare = same workspace, no skills (the decode-value falsifier from the
# t6 design gate: if bare matches full, patterns.md is deadweight).
# The search skill ships too because record_verdict.py imports jobs_md
# from ../../search/scripts — the relative layout must survive the copy.
#
# Environment contract (README): --setting-sources project, fresh mktemp
# workspace, and FULL permissions — evaluate needs WebSearch + Bash, and a
# conduct pass only counts if the forbidden action was available (rule 4).
# Usage: ./run_t6.sh <run-tag>    (TRIALS=n MODEL=sonnet CONDS="full" overridable)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="$ROOT/results/t6-$1"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS"
maybe_dry_run runner "$RESULTS" && exit 0
# A reused tag replays old results as if new (2026-08-21: a loop-shape
# measurement "ran" in seconds and printed the morning's verdicts). Say so.
[ -n "$(ls -A "$RESULTS" 2>/dev/null)" ] && echo "REUSED TAG: $RESULTS already has results — existing cases will be SKIPPED, not re-run; pick a fresh tag for a new measurement" >&2
TRIALS="${TRIALS:-1}"

# Targeted by default (founder, 2026-08-21): name the cases whose rules moved.
# The full suite is the receipt for a conversion or a shared-text change —
# ask for it with CASES=all. Cases run concurrently either way (PAR).
ALL_CASES="t6-research-honesty t6-duplicate-row t6-track-assignment"
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
CONDS="${CONDS:-full}"

for trial in $(seq 1 "$TRIALS"); do
for cond in $CONDS; do
for case_name in $CASES; do
  # bounded concurrency (PAR, default 6): cases are independent processes;
  # the vault lock stays held by THIS process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    CASE="$ROOT/cases/$case_name"
    out="$RESULTS/$case_name-$cond-t$trial"
    [ -f "$out.md" ] && { echo "skip $case_name/$cond t$trial (exists)"; exit 0; }
    WS="$(mktemp -d)"
    # profile/criteria: case-local wins, else the shared Alex Chen fixtures
    cp "${CASE}/profile.md" "$WS/" 2>/dev/null || cp "$ROOT/fixtures/profile.md" "$WS/"
    cp "${CASE}/criteria.md" "$WS/" 2>/dev/null || cp "$ROOT/fixtures/criteria.md" "$WS/"
    cp "$CASE/jobs.md" "$WS/"
    cp -r "$CASE/jd-inbox" "$WS/"
    cp "$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    if [ "$cond" = "full" ]; then
      mkdir -p "$WS/.claude/skills"
      cp -r "$RUNNER_SKILLS_DIR/evaluate" "$RUNNER_SKILLS_DIR/search" "$WS/.claude/skills/"
    fi
    echo "=== $case_name / $cond / trial $trial -> $WS"
    ( cd "$WS" && claude -p "$(cat "$CASE/prompt.md")" \
        --model "$MODEL" --dangerously-skip-permissions \
        --setting-sources project --output-format stream-json --verbose \
      ) > "$out.stream.json" 2> "$out.err"
    python3 "$ROOT/extract_text.py" "$out.stream.json" > "$out.md"
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    for d in company jd-analysis; do
      [ -d "$WS/$d" ] && cp -r "$WS/$d" "$out-ws/"
    done
    ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
    # deterministic pre-check for the judge: how many rows share the planted
    # company after the run (2+ = the duplicate-key failure happened)
    grep -c '^### Quorvex\|^### Datagrid' "$WS/jobs.md" > "$out-ws/_rowcount.txt" 2>/dev/null
    grep -ho '"skill": *"[^"]*"' "$out.stream.json" 2>/dev/null | sort -u > "$out.skills.txt"
    record_served_models "$out"
    rm -rf "$WS"
  ) &
done
done
done
wait
echo "done: $RESULTS"
