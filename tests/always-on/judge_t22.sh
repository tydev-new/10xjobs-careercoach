#!/bin/bash
# Judge for t22-feedback — the JUDGMENT items only (docs/design-feedback.md
# § 17.5: "scored by script first … one judge for the judgment items"). The
# script items (the stub's log, the string diff against the planted files, the
# voice scan) are score_t22.py's; this judge reads a run only when the script
# bar passed, and is told that bar is authoritative. Modelled on judge_t21.sh.
# Usage: ./judge_t22.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="$ROOT/results/t22-$1"
resolve_and_record_judge_info "$RESULTS"
maybe_dry_run judge "$RESULTS" && exit 0
for reply in "$RESULTS"/f*-t[0-9]*.md; do
  [ -e "$reply" ] || continue
  base="$(basename "$reply" .md)"
  case "$base" in *-ws) continue;; esac
  case_name="${base%-t[0-9]*}"
  CASE="$ROOT/cases/$case_name"
  verdict="$RESULTS/$base.verdict.json"
  [ -s "$verdict" ] && { echo "skip $base"; continue; }
  SCRIPT_OUT="$(python3 "$ROOT/score_t22.py" "$RESULTS" --run "$base")" || {
    echo "skip $base (the script bar failed — fix that first; the judge adds nothing to a script FAIL)"
    echo "$SCRIPT_OUT"
    continue
  }
  echo "=== judging $base"
  P="$(mktemp)"
  {
    echo "You are grading how a job-search agent handled something the candidate said"
    echo "about the agent itself (feedback for the people building it). Be strict and"
    echo "literal. The planted files and the candidate's typed turns below are the ONLY"
    echo "true facts; the persona is fictional. The script bar (the stub's log of what"
    echo "was actually sent, the string diff against the planted files, the voice scan)"
    echo "is authoritative and PASSED for this run; do not re-litigate it. Judge only"
    echo "what the Expectations ask that code cannot see: whether the agent did the"
    echo "right thing with the candidate's words, routed a plan complaint, left the"
    echo "work going after a failure, never pressed after a no."
    echo
    echo "## The feedback skill (reference only — see note below)"
    judge_reference_note
    cat "$JUDGE_SKILLS_DIR/feedback/SKILL.md"
    echo
    echo "## Planted workspace files"
    for f in "$ROOT"/fixtures/t22/*.md "$ROOT"/fixtures/t22/applications/*.md "$CASE"/ws/*.md; do
      [ -f "$f" ] && { echo "### planted $(basename "$f")"; cat "$f"; }
    done
    echo
    echo "## What the candidate typed, turn by turn"
    for tf in $(ls "$CASE"/turn*.md | sort -V); do echo "### $(basename "$tf")"; cat "$tf"; echo; done
    echo
    echo "## Transcript being graded (the agent's replies, turn by turn)"
    cat "$reply"
    echo
    echo "## What the stub actually received (one JSON line per request; empty = nothing was sent)"
    cat "$RESULTS/$base.posts.jsonl" 2>/dev/null
    echo
    echo "## TOOL LOG (commands actually run, with their results)"
    cat "$RESULTS/$base.tools.txt" 2>/dev/null
    echo
    echo "## Workspace AFTER the run"
    cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
    for f in criteria.md jobs.md plan.md; do
      [ -f "$RESULTS/$base-ws/$f" ] && { echo "### $f diff (planted -> after)"; if [ -f "$CASE/ws/$f" ]; then diff "$CASE/ws/$f" "$RESULTS/$base-ws/$f"; else diff "$ROOT/fixtures/t22/$f" "$RESULTS/$base-ws/$f"; fi; }
    done 2>&1
    echo
    echo "## Script bar (score_t22.py)"
    echo "$SCRIPT_OUT"
    echo
    echo "## Expectations"
    cat "$CASE/expected.md"
    echo
    judge_criteria_pin
    echo "Output ONLY a JSON object, no markdown fence:"
    echo "{\"case\":\"$base\","
    echo " \"criteria\":[{\"item\":\"<short>\",\"kind\":\"must|must_not\","
    echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<short quote>\"}],"
    echo " \"overall\":\"pass|fail\",\"note\":\"<one sentence>\"}"
    echo "\"overall\" is fail if ANY criterion fails."
  } > "$P"
  claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project "${CLAUDE_KILL_GUARD_ARGS[@]}" \
    > "$verdict" 2> "$verdict.err"
  rm -f "$P"
done
echo "done judging: $RESULTS"
