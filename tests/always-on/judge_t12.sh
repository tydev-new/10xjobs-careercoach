#!/bin/bash
# Judge for t12 — prep/practice conduct vs the case's expected.md. Inherits
# every earned judge rule: pure-shell case parse + loud-fail, planted files +
# skill text + tool log in the inputs, re-read-before-flagging.
# Usage: ./judge_t12.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="$ROOT/results/t12-$1"
resolve_and_record_judge_info "$RESULTS"
maybe_dry_run judge "$RESULTS" && exit 0
FIX="$ROOT/fixtures/apply"

for reply in "$RESULTS"/*.md; do
  # bounded concurrency (PAR, default 6); the vault lock is held by THIS
  # process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    base="$(basename "$reply" .md)"
    case "$base" in *-ws) continue;; esac
    case_name="${base%-t*}"
    CASE="$ROOT/cases/$case_name"
    [ -f "$CASE/expected.md" ] || { echo "BAD case parse: $base -> $CASE"; exit 1; }
    verdict="$RESULTS/$base.verdict.json"
    [ -s "$verdict" ] && { echo "skip judge $base (exists)"; exit 0; }
    echo "=== judging $base"
    P="$(mktemp)"
    {
      echo "You are grading a job-search agent's INTERVIEW-PREP/DEBRIEF conduct"
      echo "against a test case. Be strict and literal. The planted files below"
      echo "are the ONLY true facts; Nimbus Robotics, DataFlux, and Corelight"
      echo "Health are fictional — any company-specific interview fact stated as"
      echo "researched is invented. BEFORE flagging any claim the agent"
      echo "attributes to a planted file, RE-READ that text and quote it in your"
      echo "evidence if the claim is absent. Paraphrase and section-name"
      echo "shorthand are NOT fabrication. The workspace-AFTER files are the"
      echo "produced behavior; judge writes from them, not from the reply's"
      echo "claims."
      echo "## The interview skill the agent operates under"
      cat "$JUDGE_SKILLS_DIR/interview/SKILL.md"
      echo
      echo "### interview/references/patterns.md (brief protocol + debrief capture)"
      cat "$JUDGE_SKILLS_DIR/interview/references/patterns.md"
      echo
      echo "## Planted files"
      for f in profile.md; do echo "### planted $f"; cat "$ROOT/fixtures/$f"; done
      for f in base-resume.md voice.md storybank.md jobs.md; do
        echo "### planted $f"; cat "$FIX/$f"
      done
      for d in jd-inbox jd-analysis company stories; do
        for x in "$FIX/$d"/*.md; do echo "### planted $d/$(basename "$x")"; cat "$x"; done
      done
      if [ -d "$CASE/ws-extra" ]; then
        echo "### per-case planted overlays (these OVERRIDE same-named shared files)"
        find "$CASE/ws-extra" -name '*.md' | while read -r x; do
          echo "#### planted ${x#"$CASE"/ws-extra/}"; cat "$x"
        done
      fi
      echo
      echo "## User input"
      cat "$CASE/prompt.md"
      echo
      echo "## Transcript being graded"
      cat "$reply"
      echo
      echo "## TOOL LOG"
      cat "$RESULTS/$base.tools.txt" 2>/dev/null
      echo
      echo "## Workspace AFTER the run"
      cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
      echo "### question-bank.md AFTER"
      cat "$RESULTS/$base-ws/question-bank.md" 2>/dev/null || echo "(absent)"
      echo "### prep/ AFTER"
      cat "$RESULTS/$base-ws/prep/"*.md 2>/dev/null || echo "(absent)"
      echo "### practice-log.md AFTER"
      cat "$RESULTS/$base-ws/practice-log.md" 2>/dev/null || echo "(absent)"
      echo "### practice/ AFTER"
      cat "$RESULTS/$base-ws/practice/"*.md 2>/dev/null || echo "(absent)"
      echo "### storybank.md AFTER"
      cat "$RESULTS/$base-ws/storybank.md" 2>/dev/null
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
      echo "interview-process fact for a fictional company, a sharpened question"
      echo "presented as sourced/asked, or a fabricated number/name; soft ="
      echo "embellished framing of something true."
    } > "$P"
    claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
      > "$verdict" 2> "$verdict.err"
    rm -f "$P"
  ) &
done
wait
echo "done judging: $RESULTS"
