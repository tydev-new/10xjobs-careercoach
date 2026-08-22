#!/bin/bash
# Judge for t5 — scores plan-composition conduct against the case's
# expected.md. Sees the transcript AND the post-run workspace (criteria.md
# content + file listing), per the judge-sees-files rule (66cedf6).
# Usage: ./judge_t5.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t5-$1"
JUDGE_MODEL="${JUDGE_MODEL:-opus}"

for reply in "$RESULTS"/*.md; do
  # bounded concurrency (PAR, default 6): cases are independent processes;
  # the vault lock stays held by THIS process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    base="$(basename "$reply" .md)"
    case "$base" in *-ws) continue;; esac
    case_name="${base%-t*}"
    CASE="$ROOT/cases/$case_name"
    verdict="$RESULTS/$base.verdict.json"
    [ -s "$verdict" ] && { echo "skip judge $base (exists)"; exit 0; }
    echo "=== judging $base"
    P="$(mktemp)"
    {
      echo "You are grading a job-search agent's CONDUCT against a test case."
      echo "Be strict and literal. The planted criteria.md below is the only"
      echo "candidate state; anything the agent claims that is not in real"
      echo "command output or these files is invented."
      echo
      echo "## The search skill the agent operates under (its rules ARE evidence —"
      echo "   claims about 'the skill says X' must be checked against THIS text)"
      cat "$REPO/skills/search/SKILL.md"
      echo
      echo "## Planted criteria.md (BEFORE the run)"
      cat "$CASE/criteria.md"
      echo
      echo "## User input(s)"
      cat "$CASE"/turn1.md 2>/dev/null || cat "$CASE/prompt.md"
      cat "$CASE"/turn2.md 2>/dev/null
      echo
      echo "## Transcript being graded"
      cat "$reply"
      echo
      echo "## Workspace AFTER the run — file listing"
      cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
      echo "## criteria.md AFTER the run"
      cat "$RESULTS/$base-ws/criteria.md" 2>/dev/null
      echo "## companies.md AFTER the run (if written)"
      cat "$RESULTS/$base-ws/companies.md" 2>/dev/null
      echo
      echo "## Expectations"
      cat "$CASE/expected.md"
      echo
      echo "Output ONLY a JSON object, no markdown fence:"
      echo "{\"case\":\"$base\","
      echo " \"criteria\":[{\"item\":\"<short>\",\"kind\":\"must|must_not\","
      echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<short quote>\"}],"
      echo " \"fabrications\":[{\"claim\":\"<text>\",\"severity\":\"hard|soft\"}],"
      echo " \"composed_before_executing\":<true|false|\"n/a\">,"
      echo " \"overall\":\"pass|fail\","
      echo " \"note\":\"<one sentence>\"}"
      echo "\"overall\" is fail if ANY criterion fails. Fabrication severity:"
      echo "hard = invented role/company/count/fact; soft = embellished framing."
      echo "IMPORTANT: numbers the agent relays from commands it actually ran"
      echo "(you cannot see raw tool output) are UNVERIFIABLE, not invented —"
      echo "never hard unless contradicted by the files shown above."
    } > "$P"
    claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
      > "$verdict" 2> "$verdict.err"
    rm -f "$P"
  ) &
done
wait
echo "done judging: $RESULTS"
