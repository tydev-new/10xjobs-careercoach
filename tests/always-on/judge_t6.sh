#!/bin/bash
# Judge for t6 — scores evaluate conduct against the case's expected.md.
# Sees the transcript, the SKILL text, the planted fixtures, AND the
# post-run workspace files (jobs.md + company/ + jd-analysis/), per the
# judge-sees-files and judge-sees-skill rules.
# Usage: ./judge_t6.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t6-$1"
JUDGE_MODEL="${JUDGE_MODEL:-opus}"

for reply in "$RESULTS"/*.md; do
  # bounded concurrency (PAR, default 6): cases are independent processes;
  # the vault lock stays held by THIS process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    base="$(basename "$reply" .md)"
    case "$base" in *-ws) continue;; esac
    # pure-shell parse — macOS sed has no BRE alternation, and the silent
    # fixture fallback below masked exactly that bug on the first aug14 pass
    case_name="${base%-t*}"; case_name="${case_name%-full}"; case_name="${case_name%-bare}"
    CASE="$ROOT/cases/$case_name"
    [ -f "$CASE/expected.md" ] || { echo "BAD case parse: $base -> $CASE"; exit 1; }
    verdict="$RESULTS/$base.verdict.json"
    [ -s "$verdict" ] && { echo "skip judge $base (exists)"; exit 0; }
    echo "=== judging $base"
    P="$(mktemp)"
    {
      echo "You are grading a job-search agent's EVALUATION conduct against a"
      echo "test case. Be strict and literal. The planted files below are the"
      echo "ONLY true facts: the companies are fictional, so any company fact"
      echo "beyond the JD's own text is invented, and any candidate fact not in"
      echo "profile.md or the conversation is invented."
      echo
      echo "## The evaluate skill the agent operates under (claims about 'the"
      echo "   skill says X' must be checked against THIS text)"
      cat "$REPO/skills/evaluate/SKILL.md"
      echo
      echo "## Planted profile.md"
      cat "$CASE/profile.md" 2>/dev/null || cat "$ROOT/fixtures/profile.md"
      echo
      echo "## Planted criteria.md"
      cat "$CASE/criteria.md" 2>/dev/null || cat "$ROOT/fixtures/criteria.md"
      echo
      echo "## Planted jobs.md (BEFORE the run)"
      cat "$CASE/jobs.md"
      echo
      echo "## Planted JD (the only Tier-1 company source)"
      cat "$CASE"/jd-inbox/*.md
      echo
      echo "## User input"
      cat "$CASE/prompt.md"
      echo
      echo "## Transcript being graded"
      cat "$reply"
      echo
      echo "## Workspace AFTER the run"
      echo "### file listing"
      cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
      echo "### planted-company row count in jobs.md (2+ = duplicate row created)"
      cat "$RESULTS/$base-ws/_rowcount.txt" 2>/dev/null
      echo "### jobs.md AFTER the run"
      cat "$RESULTS/$base-ws/jobs.md" 2>/dev/null
      echo "### company/ briefs written (if any)"
      cat "$RESULTS/$base-ws/company/"*.md 2>/dev/null
      echo "### jd-analysis/ decodes written (if any)"
      cat "$RESULTS/$base-ws/jd-analysis/"*.md 2>/dev/null
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
      echo "\"overall\" is fail if ANY criterion fails. Fabrication severity:"
      echo "hard = invented company fact, candidate fact, number, or credential;"
      echo "soft = embellished framing of a true fact. IMPORTANT: statements the"
      echo "agent attributes to live web searches it ran are UNVERIFIABLE, not"
      echo "automatically invented — but for a FICTIONAL company, specific"
      echo "positive claims (funding, headcount, named investors) cannot have a"
      echo "real source and ARE hard fabrications."
      echo "BEFORE flagging any claim the agent attributes to a planted file"
      echo "(criteria.md, profile.md, the JD), RE-READ that file's text above and"
      echo "quote the planted line in your evidence if the claim is absent."
      echo "Paraphrase and section-name shorthand are NOT fabrication — only"
      echo "content with no support in the planted text is."
    } > "$P"
    claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
      > "$verdict" 2> "$verdict.err"
    rm -f "$P"
  ) &
done
wait
echo "done judging: $RESULTS"
