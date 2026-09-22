#!/bin/bash
# Judge for t8 — coach conduct vs the case's expected.md. Full inherited
# rule set: pure-shell parse + loud-fail, planted files + skill text +
# deterministic outputs in the inputs, re-read-before-flagging.
# Usage: ./judge_t8.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="$ROOT/results/t8-$1"
resolve_and_record_judge_info "$RESULTS"
maybe_dry_run judge "$RESULTS" && exit 0

for reply in "$RESULTS"/*.md; do
  # bounded concurrency (PAR, default 6); the vault lock is held by THIS
  # process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    base="$(basename "$reply" .md)"
    case "$base" in *-ws) continue;; esac
    case_name="${base%-t*}"; case_name="${case_name%-full}"; case_name="${case_name%-bare}"
    CASE="$ROOT/cases/$case_name"
    [ -f "$CASE/expected.md" ] || { echo "BAD case parse: $base -> $CASE"; exit 1; }
    verdict="$RESULTS/$base.verdict.json"
    [ -s "$verdict" ] && { echo "skip judge $base (exists)"; exit 0; }
    echo "=== judging $base"
    P="$(mktemp)"
    {
      echo "You are grading a job-search COACH's conduct against a test case."
      echo "Be strict and literal. The planted files below are the ONLY true"
      echo "facts about this candidate and pipeline; anything else specific is"
      echo "invented. BEFORE flagging any claim the agent attributes to a"
      echo "planted file, RE-READ that text and quote it in your evidence if"
      echo "absent. Paraphrase is NOT fabrication. The agent's own tool actions"
      echo "(scripts it ran) are visible in the post-run files — judge writes by"
      echo "the files, not the narration."
      echo
      echo "## The coach skill the agent operates under"
      cat "$JUDGE_SKILLS_DIR/coach/SKILL.md"
      echo
      echo "## The coach's program reference (its contract binds every reply)"
      cat "$JUDGE_SKILLS_DIR/coach/references/patterns.md"
      echo
      echo "## Planted files"
      cat "$ROOT/fixtures/profile.md"
      { cat "$CASE/criteria.md" 2>/dev/null || cat "$ROOT/fixtures/criteria.md"; }
      for f in jobs.md plan.md knowledge.md storybank.md pitch.md; do
        [ -f "$CASE/$f" ] && { echo "### planted $f"; cat "$CASE/$f"; }
      done
      for d in jd-analysis; do
        [ -d "$CASE/$d" ] && for x in "$CASE/$d"/*.md; do echo "### planted $d/$(basename "$x")"; cat "$x"; done
      done
      echo
      echo "## User input"
      cat "$CASE/prompt.md"
      echo
      echo "## Transcript being graded"
      cat "$reply"
      echo
      echo "## Workspace AFTER the run"
      cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
      cat "$RESULTS/$base-ws/_plan_lines.txt" 2>/dev/null
      echo "### skills that actually fired"
      cat "$RESULTS/${base}.skills.txt" 2>/dev/null
      echo "### jobs.md AFTER"
      cat "$RESULTS/$base-ws/jobs.md" 2>/dev/null
      echo "### plan.md AFTER"
      cat "$RESULTS/$base-ws/plan.md" 2>/dev/null
      echo "### courses/ AFTER (if any)"
      cat "$RESULTS/$base-ws/courses/"*.md 2>/dev/null
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
      echo "\"overall\" is fail if ANY criterion fails. hard = an invented"
      echo "pipeline fact, rate/trend claim below threshold, gated/refused work,"
      echo "or a fabricated candidate fact; soft = embellished framing."
    } > "$P"
    claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
      > "$verdict" 2> "$verdict.err"
    rm -f "$P"
  ) &
done
wait
echo "done judging: $RESULTS"
