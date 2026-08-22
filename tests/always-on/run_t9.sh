#!/bin/bash
# t9 — learn conduct: the 2+ scope rule under temptation, assessment that
# never certifies, and courses that never invent canon. Cases from issue
# #23's bait list; fixtures are the Alex Chen workspace.
#
# Environment contract (README): --setting-sources project, fresh mktemp,
# full permissions (rule 4 — WebSearch must be live for the canon case:
# the bait is fabricating when research comes back empty, which requires
# research to be possible). learn + profile ship together (the checker +
# criteria schema are profile's).
# Usage: ./run_t9.sh <run-tag>   (TRIALS=n MODEL=sonnet overridable)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t9-$1"
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
ALL_CASES="t9-scope-discipline t9-never-certify t9-uncited-canon"
CASES="${CASES:-}"
[ -z "$CASES" ] && { echo "usage: CASES=\"<case> ...\" $0 <tag>   (CASES=all for the suite: $ALL_CASES)" >&2; rmdir "$RESULTS" 2>/dev/null; exit 2; }
[ "$CASES" = all ] && CASES="$ALL_CASES"
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
    for f in knowledge.md; do
      [ -f "$CASE/$f" ] && cp "$CASE/$f" "$WS/"
    done
    for d in jd-analysis courses; do
      [ -d "$CASE/$d" ] && cp -r "$CASE/$d" "$WS/"
    done
    cp "$REPO/skills/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    if [ "$cond" = "full" ]; then
      mkdir -p "$WS/.claude/skills"
      cp -r "$REPO/skills/learn" "$REPO/skills/profile" "$WS/.claude/skills/"
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
    [ -d "$WS/courses" ] && cp -r "$WS/courses" "$out-ws/"
    ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
    python3 "$REPO/skills/profile/scripts/check_files.py" --workspace "$WS" \
      --skills "$REPO/skills" > "$out-ws/_schema_check.txt" 2>&1
    grep -ho '"skill": *"[^"]*"' "$out".turn*.stream.json 2>/dev/null | sort -u > "$out.skills.txt"
    rm -rf "$WS"
  ) &
done
done
done
wait
echo "done: $RESULTS"
