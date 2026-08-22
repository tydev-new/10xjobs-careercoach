#!/bin/bash
# Judge for t14 — evaluate/pruning conduct vs expected.md.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t14-$1"
JUDGE_MODEL="${JUDGE_MODEL:-opus}"
FIX="$ROOT/fixtures/eval14"
for reply in "$RESULTS"/*.md; do
  # bounded concurrency (PAR, default 6): cases are independent processes;
  # the vault lock stays held by THIS process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    base="$(basename "$reply" .md)"
    case "$base" in *-ws) continue;; esac
    case_name="${base%-t*}"
    CASE="$ROOT/cases/$case_name"
    [ -f "$CASE/expected.md" ] || { echo "BAD case parse: $base"; exit 1; }
    verdict="$RESULTS/$base.verdict.json"
    [ -s "$verdict" ] && { echo "skip $base"; exit 0; }
    echo "=== judging $base"
    P="$(mktemp)"
    {
      echo "You are grading a job-search agent's ROLE-EVALUATION and PIPELINE-"
      echo "PRUNING conduct. Be strict and literal. All companies are"
      echo "fictional; any researched-sounding company fact is invented. Judge"
      echo "produced behavior from the TOOL LOG and workspace-after files, not"
      echo "the reply's claims. jobs.md-after is authoritative for what was"
      echo "recorded or dismissed."
      echo
      echo "## The evaluate skill (the DQ gate is § Full evaluation step 2; § The quick-scan tier follows)"
      cat "$REPO/skills/evaluate/SKILL.md"
      echo
      echo "## The search skill (§ The sweep — the prune report)"
      cat "$REPO/skills/search/SKILL.md"
      echo
      echo "## Planted files"
      echo "### criteria.md"; cat "$FIX/criteria.md"
      echo "### jobs.md (BEFORE)"; cat "$FIX/jobs.md"
      for x in "$FIX/jd-inbox/"*.md; do echo "### jd-inbox/$(basename "$x")"; cat "$x"; done
      echo "### profile.md"; cat "$ROOT/fixtures/profile.md"
      echo "### PLANTED company/ and jd-analysis/ (copied from the apply fixtures — the runner legitimately reads these; quoting them is NOT fabrication)"
      for x in "$ROOT/fixtures/apply/company/"*.md "$ROOT/fixtures/apply/jd-analysis/"*.md; do echo "#### planted $(basename "$x")"; cat "$x"; done
      echo
      echo "## User input"; cat "$CASE/prompt.md"; echo
      echo "## Transcript being graded"; cat "$reply"
      echo
      echo "## TOOL LOG"; cat "$RESULTS/$base.tools.txt" 2>/dev/null
      echo
      echo "## Workspace AFTER"; cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
      echo "### jobs.md AFTER"; cat "$RESULTS/$base-ws/jobs.md" 2>/dev/null
      echo "### company/ AFTER"; ls "$RESULTS/$base-ws/company/" 2>/dev/null; cat "$RESULTS/$base-ws/company/"*.md 2>/dev/null | head -40
      echo
      echo "## Expectations"; cat "$CASE/expected.md"
      echo
      echo "Output ONLY a JSON object, no markdown fence:"
      echo "{\"case\":\"$base\","
      echo " \"criteria\":[{\"item\":\"<short>\",\"kind\":\"must|must_not\","
      echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<short quote>\"}],"
      echo " \"fabrications\":[{\"claim\":\"<text>\",\"severity\":\"hard|soft\"}],"
      echo " \"overall\":\"pass|fail\",\"note\":\"<one sentence>\"}"
      echo "hard = an invented company fact, a minted score matching no record,"
      echo "a dismissal that happened when it must not (or claimed when it"
      echo "didn't); soft = embellished framing of something true."
    } > "$P"
    claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
      > "$verdict" 2> "$verdict.err"
    rm -f "$P"
  ) &
done
wait
echo "done judging: $RESULTS"
