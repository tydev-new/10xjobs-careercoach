#!/bin/bash
# Judge for the t4 attribution experiment. Scores each condition's two-turn
# transcript against cases/t4-intake/expected.md, and counts how many of the
# seven planted résumé hazards were caught.
# Usage: ./judge_t4.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
CASE="$ROOT/cases/t4-intake"
RESULTS="$ROOT/results/t4-$1"
resolve_and_record_judge_info "$RESULTS"
maybe_dry_run judge "$RESULTS" && exit 0

for reply in "$RESULTS"/*.md; do
  [ -f "$reply" ] || continue
  base="$(basename "$reply" .md)"
  verdict="$RESULTS/$base.verdict.json"
  [ -s "$verdict" ] && { echo "skip judge $base (exists)"; continue; }
  echo "=== judging $base"
  P="$(mktemp)"
  {
    echo "You are grading a career-coach agent's two-turn intake against a"
    echo "test case. Be strict and literal. resume.md below is the ONLY"
    echo "source of facts about the candidate; anything specific in the"
    echo "transcript not traceable to it or to the user's own messages is"
    echo "invented."
    echo
    echo "## resume.md (the planted material)"
    cat "$CASE/resume.md"
    echo
    echo "## User turn 1"
    cat "$CASE/turn1.md"
    echo "## User turn 2"
    cat "$CASE/turn2.md"
    echo
    echo "## Transcript being graded"
    cat "$reply"
    echo
    echo "## Files the agent wrote (names)"
    ls "$RESULTS/$base-ws" 2>/dev/null
    echo
    echo "## Contents of the written files (grade against these too — work"
    echo "   recorded in a file counts the same as work narrated in chat)"
    for wf in "$RESULTS/$base-ws"/*.md; do
      [ -f "$wf" ] || continue
      case "$(basename "$wf")" in resume.md|CLAUDE.md) continue;; esac
      echo "----- $(basename "$wf")"
      cat "$wf"
    done
    echo
    echo "## Expectations"
    cat "$CASE/expected.md"
    echo
    echo "Output ONLY a JSON object, no markdown fence:"
    echo "{\"condition\":\"$base\","
    echo " \"hazards\":[{\"id\":\"H1\",\"caught\":true,\"evidence\":\"<quote>\"}, ...all 7...],"
    echo " \"hazards_caught\":<0-7>,"
    echo " \"criteria\":[{\"item\":\"<short>\",\"kind\":\"must|must_not\","
    echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<quote>\"}],"
    echo " \"fabrications\":[{\"claim\":\"<text>\",\"severity\":\"hard|soft\"}],"
    echo " \"diagnosis_correct\":<true if turn 2 read two final-round losses as"
    echo "   differentiation/credibility rather than positioning or volume>,"
    echo " \"files_written\":[\"<names>\"],"
    echo " \"depth_note\":\"<2 sentences: what insight, if any, went beyond"
    echo "   restating the resume>\","
    echo " \"overall\":\"pass|fail\"}"
    echo "\"overall\" is fail if ANY criterion fails."
    echo "A hazard counts as caught only if the transcript flags it as needing"
    echo "qualification/confirmation — not merely by repeating the resume line."
    echo "Fabrication severity: hard = invented number, title, employer, date,"
    echo "credential, or external fact. soft = an unstated qualifier or purpose"
    echo "inference on a true fact."
  } > "$P"
  claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
    > "$verdict" 2> "$verdict.err"
  rm -f "$P"
done
echo "done judging: $RESULTS"
