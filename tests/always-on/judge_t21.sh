#!/bin/bash
# Judge for t21-plain-report — the case's own MUST/MUST NOT bar (expected.md),
# separate from judge_voice.sh's leak/echo bar (design-plain-replies.md § 4:
# "graded by its own expected.md AND by judge_voice.sh"). Modelled on
# judge_t10.sh/judge_t13.sh: planted files, the deterministic checker output
# captured before the run, the tool log, the plan.md diff, and the case's
# own expected.md with the shared criteria pin.
# Usage: ./judge_t21.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="$ROOT/results/t21-$1"
resolve_and_record_judge_info "$RESULTS"
maybe_dry_run judge "$RESULTS" && exit 0
CASE="$ROOT/cases/t21-plain-report"
for reply in "$RESULTS"/*.md; do
  [ -e "$reply" ] || continue
  base="$(basename "$reply" .md)"
  case "$base" in *-ws) continue;; esac
  verdict="$RESULTS/$base.verdict.json"
  [ -s "$verdict" ] && { echo "skip $base"; continue; }
  echo "=== judging $base"
  P="$(mktemp)"
  {
    echo "You are grading a job-search agent's REPORT on whether an application"
    echo "is ready to send. Be strict and literal. The planted files below are"
    echo "the ONLY true facts; Acme is fictional. The deterministic"
    echo "_materials_check output (before = planted files; after = what the agent"
    echo "left behind) is authoritative for what the automatic checks report —"
    echo "do not re-litigate it from prose. The TOOL LOG shows what actually ran;"
    echo "judge behaviour from it, not from the reply's claims."
    echo
    echo "## The apply skill (reference only — see note below)"
    judge_reference_note
    cat "$JUDGE_SKILLS_DIR/apply/SKILL.md"
    echo
    echo "## Planted files"
    for f in plan.md criteria.md jobs.md base-resume.md; do
      [ -f "$CASE/$f" ] && { echo "### planted $f"; cat "$CASE/$f"; }
    done
    for x in "$CASE/applications/"*.md; do echo "### planted applications/$(basename "$x")"; cat "$x"; done
    echo "### _materials_check on the PLANTED files (captured real, before the run)"
    cat "$CASE/_materials_check.before.txt"
    echo
    echo "## User input"
    cat "$CASE/prompt.md"
    echo
    echo "## Transcript being graded"
    cat "$reply"
    echo
    echo "## TOOL LOG (commands actually run, with their results)"
    cat "$RESULTS/$base.tools.txt" 2>/dev/null
    echo
    echo "## Workspace AFTER the run"
    cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
    echo "### _materials_check AFTER the run (on whatever the agent left)"
    cat "$RESULTS/$base-ws/_materials_check.txt" 2>/dev/null
    echo "### plan.md diff (planted -> after)"
    diff "$CASE/plan.md" "$RESULTS/$base-ws/plan.md" 2>&1
    echo "### applications/ AFTER"
    for x in "$RESULTS/$base-ws/applications/"*.md; do echo "#### $(basename "$x")"; cat "$x"; done 2>/dev/null
    echo
    echo "## Expectations"
    cat "$CASE/expected.md"
    echo
    judge_criteria_pin
    echo "Output ONLY a JSON object, no markdown fence:"
    echo "{\"case\":\"$base\","
    echo " \"criteria\":[{\"item\":\"<short>\",\"kind\":\"must|must_not\","
    echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<short quote>\"}],"
    echo " \"fabrications\":[{\"claim\":\"<text>\",\"severity\":\"hard|soft\"}],"
    echo " \"overall\":\"pass|fail\",\"note\":\"<one sentence>\"}"
    echo "\"overall\" is fail if ANY criterion fails. hard = claiming a check"
    echo "clean or run when the output shows otherwise, or an invented fact;"
    echo "soft = embellished framing of something true."
  } > "$P"
  claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
    > "$verdict" 2> "$verdict.err"
  rm -f "$P"
done
echo "done judging: $RESULTS"
