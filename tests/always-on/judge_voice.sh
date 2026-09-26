#!/bin/bash
# judge_voice.sh — grades ANY results dir for the plain-replies voice bar
# (docs/design-plain-replies.md § 4). Unlike the other judge_tNN.sh
# scripts (each one case family), this one is case-agnostic: it resolves
# each reply's case from its filename. The runners do NOT share one
# naming convention (independent review, H1) — run_t4.sh:29 names
# replies "$cond-t$trial" (no case name at all: t4 has exactly one case);
# run_t6.sh:53 and run_t8.sh:46 name them "$case_name-$cond-t$trial";
# run_t10.sh/run_t13.sh/run_t21.sh name them "$case_name-t$trial".
# resolve_case_name() below matches the LONGEST known case-directory name
# that is a prefix of the basename, with one named fallback for t4's
# condition-only names — never a single regex guess. A reply whose case
# can't be resolved is SKIPPED and logged, and the whole run then exits
# non-zero: grading fewer cases than asked must never look like success.
#
# Usage: ./judge_voice.sh <results-dir>
#
# Inputs (design § 4): the reply text; plan.md's lines added this turn
# (diffed against the planted copy); the scripts' own output (every
# tool_result paired with its Bash call, via dump_tools.py --results,
# plus the runner's post-run _materials_check.txt / _messages_check.txt
# where one exists); scan_voice.py's own hits; the run's skills snapshot
# (the always-on voice paragraph, so the judge knows the target).
#
# The facts to score are fixed per case in Expectations (expected.md's
# MUST list) — this judge invents no additional criteria, same law as
# judge_criteria_pin's, applied to facts instead of MUST/MUST NOT rows.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="${1:-}"
if [ -z "$RESULTS" ]; then
  echo "usage: judge_voice.sh <results-dir>" >&2
  exit 2
fi
if [ ! -d "$RESULTS" ]; then
  echo "no such results dir: $RESULTS" >&2
  exit 2
fi
resolve_and_record_judge_info "$RESULTS"
maybe_dry_run judge "$RESULTS" && exit 0

# See the header note (H1): resolves "$base" (a reply's filename minus
# .md) to its case directory NAME by the longest known-case-dir prefix
# match, with a named fallback for run_t4.sh's condition-only names.
# Echoes the name and returns 0, or returns 1 (nothing echoed) when no
# case resolves — never guesses with one regex.
resolve_case_name() {
  local base="$1" best="" c
  for c in "$ROOT"/cases/*/; do
    c="$(basename "$c")"
    case "$base" in
      "$c"-*) [ "${#c}" -gt "${#best}" ] && best="$c" ;;
    esac
  done
  if [ -n "$best" ]; then echo "$best"; return 0; fi
  case "$base" in
    bare-t[0-9]*|guardrails-t[0-9]*|full-t[0-9]*) echo "t4-intake"; return 0 ;;
  esac
  return 1
}

for reply in "$RESULTS"/*.md; do
  [ -e "$reply" ] || continue
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    base="$(basename "$reply" .md)"
    case "$base" in *-ws) exit 0;; esac
    if ! case_name="$(resolve_case_name "$base")"; then
      echo "SKIP $base: no known case directory resolves this filename"
      : > "$RESULTS/.voice-skip-$base"
      exit 0
    fi
    CASE="$ROOT/cases/$case_name"
    if [ ! -f "$CASE/expected.md" ]; then
      echo "SKIP $base: resolved case '$case_name' has no expected.md at $CASE"
      : > "$RESULTS/.voice-skip-$base"
      exit 0
    fi
    verdict="$RESULTS/$base.voice-verdict.json"
    [ -s "$verdict" ] && { echo "skip voice-judge $base (exists)"; exit 0; }
    echo "=== voice-judging $base"

    # plan.md's lines ADDED this turn — diffed against the planted copy.
    # A case may override the shared fixture's plan.md (the t15 pattern);
    # check the case dir first.
    PLAN_AFTER="$RESULTS/$base-ws/plan.md"
    PLAN_BEFORE=""
    for cand in "$CASE/plan.md" "$ROOT/fixtures/plan.md" "$ROOT/fixtures/apply/plan.md"; do
      [ -f "$cand" ] && { PLAN_BEFORE="$cand"; break; }
    done
    PLAN_ADDED="$(mktemp)"
    if [ -f "$PLAN_AFTER" ] && [ -n "$PLAN_BEFORE" ]; then
      diff "$PLAN_BEFORE" "$PLAN_AFTER" 2>/dev/null | grep '^> ' | sed 's/^> //' > "$PLAN_ADDED"
    elif [ -f "$PLAN_AFTER" ]; then
      cp "$PLAN_AFTER" "$PLAN_ADDED"
    fi

    # scan_voice.py's own hits. --candidate: the case's own planted text
    # (its user turns, and any extra workspace files it plants) so the
    # candidate's own tokens are exempted from HARD, never invented here.
    CANDIDATE_ARGS=()
    for f in "$CASE"/prompt.md "$CASE"/turn*.md; do
      [ -f "$f" ] && CANDIDATE_ARGS+=(--candidate "$f")
    done
    [ -d "$CASE/ws-extra" ] && CANDIDATE_ARGS+=(--candidate "$CASE/ws-extra")
    SCAN_OUT="$(mktemp)"
    if [ -s "$PLAN_ADDED" ]; then
      python3 "$ROOT/scan_voice.py" --reply "$reply" --plan-added "$PLAN_ADDED" \
        "${CANDIDATE_ARGS[@]}" > "$SCAN_OUT"
    else
      python3 "$ROOT/scan_voice.py" --reply "$reply" "${CANDIDATE_ARGS[@]}" > "$SCAN_OUT"
    fi

    # the scripts' own output — every tool_result paired with its Bash
    # call. Most runners write "$out.turnN.stream.json"; run_t6.sh:70
    # writes plain "$out.stream.json" (H1) — accept both.
    STREAM_FILES=("$RESULTS/$base".turn*.stream.json)
    [ -e "${STREAM_FILES[0]}" ] || STREAM_FILES=("$RESULTS/$base.stream.json")
    TOOLS_RESULTS="$(mktemp)"
    python3 "$ROOT/dump_tools.py" --results "${STREAM_FILES[@]}" \
      > "$TOOLS_RESULTS" 2>/dev/null

    P="$(mktemp)"
    {
      echo "You are grading whether a job-search agent's reply talks to the"
      echo "candidate in plain, everyday words (docs/design-plain-replies.md)."
      echo "Be strict and literal. Score ONLY the leaks scan_voice.py already"
      echo "found below and the facts listed in Expectations — invent no"
      echo "additional leaks or facts. A HARD scanner hit is a leak by"
      echo "construction (mark it \"leak\"). A REVIEW hit needs your judgment:"
      echo "a file name used as a pointer the candidate can open is fine"
      echo "(\"ok\"); the same name used as the subject of a sentence, or in"
      echo "place of the thing's plain name, is a leak."
      echo
      echo "## The always-on voice rule (reference only — see note below)"
      judge_reference_note
      awk '/^## How you talk/{p=1;print;next} p&&/^## /{exit} p{print}' \
        "$JUDGE_SKILLS_DIR/profile/templates/workspace-CLAUDE.md"
      echo
      echo "## scan_voice.py hits (CLASS, source, match, context)"
      cat "$SCAN_OUT"
      echo
      echo "## The scripts' own output (tool calls paired with their results — authoritative for FAIL/WARN/counts)"
      cat "$TOOLS_RESULTS"
      echo
      if [ -f "$RESULTS/$base-ws/_materials_check.txt" ]; then
        echo "## Post-run _materials_check.txt"
        cat "$RESULTS/$base-ws/_materials_check.txt"
        echo
      fi
      if [ -f "$RESULTS/$base-ws/_messages_check.txt" ]; then
        echo "## Post-run _messages_check.txt"
        cat "$RESULTS/$base-ws/_messages_check.txt"
        echo
      fi
      echo "## plan.md lines added this turn"
      cat "$PLAN_ADDED"
      echo
      echo "## Transcript being graded"
      cat "$reply"
      echo
      echo "## Expectations (this case's own MUST / MUST NOT — the facts to score)"
      cat "$CASE/expected.md"
      echo
      judge_criteria_pin
      echo "(the law above is stated in terms of \"criteria\" — here it binds"
      echo "\"facts\": one entry per fact named in Expectations, no more, no"
      echo "fewer, and \"leaks\": one entry per scan_voice.py hit above, none"
      echo "invented.)"
      echo "Output ONLY a JSON object, no markdown fence:"
      echo "{\"case\":\"$base\","
      echo " \"leaks\":[{\"span\":\"<text>\",\"class\":\"HARD|REVIEW\",\"verdict\":\"leak|ok\"}],"
      echo " \"facts\":[{\"fact\":\"<short>\",\"status\":\"carried|dropped|made_false\",\"evidence\":\"<quote>\"}],"
      echo " \"verdict\":\"pass|fail\"}"
      echo "verdict is fail if any leaks[].verdict is \"leak\", or any"
      echo "facts[].status is \"made_false\" or \"dropped\". made_false means"
      echo "the reply's plain words say something the scripts' own output or"
      echo "Expectations contradicts — that blocks the same as a hard"
      echo "fabrication."
    } > "$P"
    claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
      > "$verdict" 2> "$verdict.err"
    rm -f "$P" "$PLAN_ADDED" "$SCAN_OUT" "$TOOLS_RESULTS"
  ) &
done
wait

# A run that grades fewer cases than asked must never exit 0 (H1) — any
# unresolved reply left a sentinel file behind.
if ls "$RESULTS"/.voice-skip-* >/dev/null 2>&1; then
  echo "FAIL: SKIPped replies above — this run graded fewer cases than asked:" >&2
  for f in "$RESULTS"/.voice-skip-*; do echo "  $(basename "$f" | sed 's/^\.voice-skip-//')" >&2; done
  rm -f "$RESULTS"/.voice-skip-*
  exit 1
fi
echo "done voice-judging: $RESULTS"
