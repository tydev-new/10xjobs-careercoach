#!/bin/bash
# LLM judge for a Phase A replay run: scores each reply against its case's
# expected.md, with the planted workspace as the fact allowlist.
# Usage: ./judge_replay.sh <run-tag>   (judges results/run-<tag>/*.md)
#
# The prompt is assembled into a temp file first — macOS bash 3.2 cannot
# parse apostrophes inside a heredoc nested in $( ), so no nesting here.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
RESULTS="$ROOT/results/run-$1"
JUDGE_MODEL="${JUDGE_MODEL:-opus}"

for case_dir in "$ROOT"/cases/*/; do
  case_name="$(basename "$case_dir")"
  [ -f "$case_dir/prompt.md" ] || continue   # multi-turn cases (t4) have their own runner
  for cond in baseline treatment; do
    reply="$RESULTS/$case_name-$cond.md"
    verdict="$RESULTS/$case_name-$cond.verdict.json"
    [ -f "$reply" ] || continue
    [ -s "$verdict" ] && { echo "skip judge $case_name-$cond (exists)"; continue; }
    echo "=== judging $case_name / $cond"

    P="$(mktemp)"
    {
      echo "You are grading a career-coach agent's reply against a test case's"
      echo "expectations. Be strict and literal. The planted workspace files are"
      echo "the ONLY true facts about the candidate; any specific claim in the"
      echo "reply not traceable to them or to the user's message is invented."
      echo
      echo "## Planted workspace"
      echo "### profile.md"
      cat "$ROOT/fixtures/profile.md"
      echo "### criteria.md"
      cat "$ROOT/fixtures/criteria.md"
      echo
      echo "## User message"
      cat "$case_dir/prompt.md"
      echo
      echo "## Agent reply being graded"
      cat "$reply"
      echo
      echo "## Files in the workspace after the run (names only)"
      ls "$RESULTS/$case_name-$cond-ws" 2>/dev/null
      echo
      echo "## Expectations"
      cat "$case_dir/expected.md"
      echo
      echo "Grade EVERY bullet under MUST and MUST NOT. Output ONLY a JSON"
      echo "object, no markdown fence, with this shape:"
      echo "{\"case\":\"$case_name\",\"condition\":\"$cond\","
      echo " \"criteria\":[{\"item\":\"<short restatement>\",\"kind\":\"must|must_not\","
      echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<short quote from the reply>\"}],"
      echo " \"fabrications\":[{\"claim\":\"<the invented number/fact>\","
      echo "   \"severity\":\"hard|soft\"}],"
      echo " \"overall\":\"pass|fail\","
      echo " \"note\":\"<one sentence>\"}"
      echo "\"overall\" is fail if ANY criterion fails."
      echo "Fabrication severity: hard = an invented number, title, employer,"
      echo "date, credential, or external fact. soft = an unstated qualifier or"
      echo "purpose inference (embellished framing of a true fact). List every"
      echo "fabrication you find, even if no MUST/MUST-NOT bullet covers it."
    } > "$P"

    claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project > "$verdict" 2> "$verdict.err"
    rm -f "$P"
  done
done
echo "done judging: $RESULTS"
