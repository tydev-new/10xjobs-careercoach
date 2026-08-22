#!/bin/bash
# t8 — coach conduct: serve-don't-gate under an explicit skip, honesty
# thresholds at n=3, stage sensing from files, and the deleted router
# table's falsifier (description-only routing). Cases from issue #22's
# gate. ALL skills ship — coach is the daily driver and the routing probe
# needs every description present.
#
# Environment contract (README): --setting-sources project, fresh mktemp,
# full permissions (rule 4 — update_job.py must be runnable for the
# recording obligations to be expressible).
# Usage: ./run_t8.sh <run-tag>   (TRIALS=n MODEL=sonnet overridable)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t8-$1"
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
ALL_CASES="t8-no-nag-no-gate t8-honesty-thresholds t8-stage-sensing t8-routing"
CASES="${CASES:-}"
[ -z "$CASES" ] && { echo "usage: CASES=\"<case> ...\" $0 <tag>   (CASES=all for the suite: $ALL_CASES)" >&2; rmdir "$RESULTS" 2>/dev/null; exit 2; }
[ "$CASES" = all ] && CASES="$ALL_CASES"
CONDS="${CONDS:-full}"

for trial in $(seq 1 "$TRIALS"); do
for cond in $CONDS; do
for case_name in $CASES; do
  # bounded concurrency (PAR, default 6); the vault lock is held by THIS
  # process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    CASE="$ROOT/cases/$case_name"
    out="$RESULTS/$case_name-$cond-t$trial"
    [ -f "$out.md" ] && { echo "skip $case_name/$cond t$trial (exists)"; exit 0; }
    WS="$(mktemp -d)"
    cp "$ROOT/fixtures/profile.md" "$WS/"
    cp "${CASE}/criteria.md" "$WS/" 2>/dev/null || cp "$ROOT/fixtures/criteria.md" "$WS/"
    for f in jobs.md plan.md knowledge.md storybank.md pitch.md base-resume.md; do
      [ -f "$CASE/$f" ] && cp "$CASE/$f" "$WS/"
    done
    for d in jd-analysis courses stories; do
      [ -d "$CASE/$d" ] && cp -r "$CASE/$d" "$WS/"
    done
    cp "$REPO/skills/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    if [ "$cond" = "full" ]; then
      mkdir -p "$WS/.claude/skills"
      cp -r "$REPO"/skills/* "$WS/.claude/skills/"
    fi
    echo "=== $case_name / $cond / trial $trial -> $WS"
    ( cd "$WS" && claude -p "$(cat "$CASE/prompt.md")" \
        --model "$MODEL" --dangerously-skip-permissions \
        --setting-sources project --output-format stream-json --verbose \
      ) > "$out.turn1.stream.json" 2> "$out.err"
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json" > "$out.md"
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    for d in courses stories; do
      [ -d "$WS/$d" ] && cp -r "$WS/$d" "$out-ws/"
    done
    ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
    wc -l "$WS/plan.md" 2>/dev/null | awk '{print "plan.md lines:", $1}' > "$out-ws/_plan_lines.txt"
    grep -ho '"skill": *"[^"]*"' "$out.turn1.stream.json" 2>/dev/null | sort -u > "$out.skills.txt"
    rm -rf "$WS"
  ) &
done
done
done
wait
echo "done: $RESULTS"
