#!/bin/bash
# Judge for t7 — storybank conduct vs the case's expected.md. Sees the
# transcript, the SKILL text, every planted file, the post-run workspace
# (storybank.md + stories/ + base-resume.md), and check_stories output.
# Pure-shell case parse + loud-fail (the t6 lesson: judge inputs are inputs).
# Usage: ./judge_t7.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t7-$1"
JUDGE_MODEL="${JUDGE_MODEL:-opus}"

for reply in "$RESULTS"/*.md; do
  base="$(basename "$reply" .md)"
  case "$base" in *-ws) continue;; esac
  case_name="${base%-t*}"; case_name="${case_name%-full}"; case_name="${case_name%-bare}"
  CASE="$ROOT/cases/$case_name"
  [ -f "$CASE/expected.md" ] || { echo "BAD case parse: $base -> $CASE"; exit 1; }
  verdict="$RESULTS/$base.verdict.json"
  [ -s "$verdict" ] && { echo "skip judge $base (exists)"; continue; }
  echo "=== judging $base"
  P="$(mktemp)"
  {
    echo "You are grading a job-search agent's STORY-CAPTURE conduct against a"
    echo "test case. Be strict and literal. The planted files below are the ONLY"
    echo "true facts about this candidate; any specific (number, quote, scope)"
    echo "not present in them or in the candidate's own turn text is invented."
    echo "BEFORE flagging any claim the agent attributes to a planted file or to"
    echo "the candidate's words, RE-READ that text above and quote it in your"
    echo "evidence if the claim is absent. Paraphrase is NOT fabrication."
    echo
    echo "## The storybank skill the agent operates under"
    cat "$REPO/skills/storybank/SKILL.md"
    echo
    echo "## Planted files (profile, criteria, and case-specific)"
    cat "$ROOT/fixtures/profile.md" "$ROOT/fixtures/criteria.md"
    for f in base-resume.md storybank.md; do
      [ -f "$CASE/$f" ] && { echo "### planted $f"; cat "$CASE/$f"; }
    done
    for d in old-stories stories; do
      [ -d "$CASE/$d" ] && for x in "$CASE/$d"/*.md; do echo "### planted $d/$(basename "$x")"; cat "$x"; done
    done
    echo
    echo "## User input(s)"
    cat "$CASE"/turn1.md 2>/dev/null || cat "$CASE/prompt.md"
    cat "$CASE"/turn2.md 2>/dev/null
    echo
    echo "## Transcript being graded"
    cat "$reply"
    echo
    echo "## Workspace AFTER the run"
    cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
    echo "### check_stories.py output (deterministic)"
    cat "$RESULTS/$base-ws/_stories_check.txt" 2>/dev/null
    echo "### storybank.md AFTER"
    cat "$RESULTS/$base-ws/storybank.md" 2>/dev/null
    echo "### stories/ AFTER"
    cat "$RESULTS/$base-ws/stories/"*.md 2>/dev/null
    echo "### base-resume.md AFTER"
    cat "$RESULTS/$base-ws/base-resume.md" 2>/dev/null
    echo
    echo "## Expectations"
    cat "$CASE/expected.md"
    echo
    echo "Output ONLY a JSON object, no markdown fence:"
    echo "{\"case\":\"$base\","
    echo " \"criteria\":[{\"item\":\"<short>\",\"kind\":\"must|must_not\","
    echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<short quote>\"}],"
    echo " \"fabrications\":[{\"claim\":\"<text>\",\"severity\":\"hard|soft\"}],"
    echo " \"overall\":\"pass|fail\","
    echo " \"note\":\"<one sentence>\"}"
    echo "\"overall\" is fail if ANY criterion fails. hard = an invented number,"
    echo "quote, credential, or fact about the candidate or their work; soft ="
    echo "embellished framing of something the candidate did say."
  } > "$P"
  claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
    > "$verdict" 2> "$verdict.err"
  rm -f "$P"
done
echo "done judging: $RESULTS"
