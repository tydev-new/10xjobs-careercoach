#!/bin/bash
# B1 named-case runner: runs, then judges, exactly the 14-case minimal set
# named in b1-cases.txt (docs/evals/b1-case-audit.md § Summary, "Recommended
# minimal fair set"). One suite at a time — a usage-limit or crash mid-run
# must not lose the suites that already finished, and re-running the same
# tag must resume rather than redo (both properties come from the
# underlying run_<suite>.sh / judge_<suite>.sh scripts' own skip-if-exists
# logic; this wrapper adds nothing that would break it).
#
# Usage:
#   ./run_b1.sh <tag> <arm>          arm = baseline | lean
#
# Env:
#   JUDGE_MODEL   REQUIRED — a dated model id. Refused before anything else
#                 runs (even DRY_RUN), same rule as every judge_*.sh.
#   TRIALS        default 3.
#   DRY_RUN=1     print the resolved suites/cases/trials/dirs and exit
#                 before any `claude` call (propagated to every runner and
#                 judge invoked).
#   PAR           forwarded to each runner/judge (bounded concurrency
#                 within ONE suite; suites themselves never run concurrently).
#
# lean sets RUNNER_SKILLS_DIR to tests/always-on/arms/lean/skills — the
# JUDGE always grades against the frozen, unablated snapshot each runner
# takes of the real skills/ tree (lib_env.sh), never against the lean tree.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"

TAG="${1:-}"
ARM="${2:-}"
if [ -z "$TAG" ] || [ -z "$ARM" ]; then
  echo "usage: $0 <tag> <arm>   (arm = baseline|lean)" >&2
  exit 2
fi

case "$ARM" in
  baseline) RUNNER_SKILLS_DIR="$REPO/skills" ;;
  lean)     RUNNER_SKILLS_DIR="$ROOT/arms/lean/skills" ;;
  *) echo "arm must be 'baseline' or 'lean', got '$ARM'" >&2; exit 2 ;;
esac
[ -d "$RUNNER_SKILLS_DIR" ] || { echo "RUNNER_SKILLS_DIR does not exist: $RUNNER_SKILLS_DIR" >&2; exit 2; }
export RUNNER_SKILLS_DIR

# JUDGE_MODEL is required to even START — the wrapper runs the runner AND
# the judge per suite, so a run that got 6 suites in before discovering the
# judge can't proceed is a wasted run. Reuses lib_env.sh's own judge-model
# gate (same rejection rule every judge_*.sh uses: bare alias / undated id
# both refused unless JUDGE_MODEL_UNDATED_OK=1).
_lib_env_require_judge_model
export JUDGE_MODEL JUDGE_MODEL_UNDATED_OK

TRIALS="${TRIALS:-3}"
export TRIALS

CASES_FILE="$ROOT/b1-cases.txt"
[ -f "$CASES_FILE" ] || { echo "missing $CASES_FILE" >&2; exit 2; }

# Never mix baseline and lean results under one tag — the arm rides in the
# tag every run_<suite>.sh / judge_<suite>.sh sees.
FULL_TAG="${TAG}-${ARM}"
mkdir -p "$ROOT/results"
LOG="$ROOT/results/b1-$FULL_TAG.log"
# Append, never truncate: a resumed run (same tag, second invocation after a
# suite failed or a usage limit hit) must not erase the first invocation's
# log — that log is the only record of which suites already succeeded.
touch "$LOG"
log() { printf '%s\n' "$*" | tee -a "$LOG"; }

log "== B1 run (new invocation; log is append-only — see earlier records above for prior invocations of this tag) =="
log "tag=$FULL_TAG (requested tag=$TAG arm=$ARM)"
log "trials=$TRIALS dry_run=${DRY_RUN:-0} par=${PAR:-6}"
log "runner_skills_dir=$RUNNER_SKILLS_DIR"
log "judge_model=$JUDGE_MODEL (undated_ok=$JUDGE_MODEL_UNDATED_OK)"
log "cases_file=$CASES_FILE"
log "log=$LOG"

# Group the named cases by suite, preserving b1-cases.txt's own order —
# portable (no associative arrays: some hosts here still run bash 3.2).
SUITE_LIST=""
while read -r suite case_name; do
  [ -z "${suite:-}" ] && continue
  case "$suite" in \#*) continue ;; esac
  case " $SUITE_LIST " in
    *" $suite "*) : ;;
    *) SUITE_LIST="$SUITE_LIST $suite" ;;
  esac
done < "$CASES_FILE"
SUITE_LIST="$(printf '%s' "$SUITE_LIST" | xargs)"
[ -n "$SUITE_LIST" ] || { log "FATAL: no suites resolved from $CASES_FILE"; exit 2; }

cases_for_suite() { awk -v s="$1" '$1==s && $2!="" {print $2}' "$CASES_FILE"; }

log "suites: $SUITE_LIST"
for suite in $SUITE_LIST; do
  cases="$(cases_for_suite "$suite" | tr '\n' ' ')"
  cases="$(printf '%s' "$cases" | xargs)"
  # conds=full is announced here even though most run_<suite>.sh scripts'
  # own DRY_RUN output exits before ever reading $CONDS — this line is the
  # only place a dry run PROVES t4 (whose own default is "bare guardrails
  # full", 3 conditions) actually resolves to exactly one condition under
  # B1, and that no operator-exported CONDS leaks through to any suite.
  log "  suite $suite: cases=[$cases] conds=full results_dir=$ROOT/results/$suite-$FULL_TAG"
done

FAILED=""

log "-- runners (one suite at a time) --"
for suite in $SUITE_LIST; do
  cases="$(cases_for_suite "$suite" | tr '\n' ' ')"
  cases="$(printf '%s' "$cases" | xargs)"
  RUNNER="$ROOT/run_$suite.sh"
  if [ ! -f "$RUNNER" ]; then
    log "runner $suite: MISSING $RUNNER — skipping suite, continuing"
    FAILED="$FAILED $suite(missing-runner)"
    continue
  fi
  log "=== runner $suite ($cases) ==="
  # CONDS=full is set EXPLICITLY here, never left to each runner's own
  # default and never inherited from an operator's exported CONDS. Two
  # reasons: run_t4.sh alone defaults to "bare guardrails full" (3
  # conditions — silently tripling every t4 run under B1, which only wants
  # the "full" condition scored); and an operator's shell may have CONDS
  # exported from an earlier, unrelated invocation (e.g. CONDS=all for a
  # manual t6 probe) — an inherited value here would apply to EVERY suite
  # in this loop, not just the one it was meant for. `CONDS=full` as a
  # literal command-prefix assignment overrides any inherited exported
  # value for this one `bash "$RUNNER"` call, regardless of what the
  # calling shell exports.
  #
  # Never `if pipeline | tee; then` — with `tee` last in the pipe, `if`
  # would see TEE's exit status (near-always 0), silently masking a real
  # runner failure. PIPESTATUS[0] is the runner's own exit code.
  CASES="$cases" TRIALS="$TRIALS" CONDS=full DRY_RUN="${DRY_RUN:-}" PAR="${PAR:-}" \
    RUNNER_SKILLS_DIR="$RUNNER_SKILLS_DIR" RUNNER_MODEL="${RUNNER_MODEL:-}" \
    RUNNER_MODEL_UNDATED_OK="${RUNNER_MODEL_UNDATED_OK:-}" \
    bash "$RUNNER" "$FULL_TAG" 2>&1 | tee -a "$LOG"
  rc="${PIPESTATUS[0]}"
  if [ "$rc" -eq 0 ]; then
    log "runner $suite: OK"
  else
    log "runner $suite: FAILED (exit $rc) — continuing to next suite (results already on disk for earlier suites are untouched; re-run the same tag to resume this one)"
    FAILED="$FAILED $suite(run)"
  fi
done

log "-- judges (one suite at a time) --"
for suite in $SUITE_LIST; do
  JUDGE="$ROOT/judge_$suite.sh"
  if [ ! -f "$JUDGE" ]; then
    log "judge $suite: MISSING $JUDGE — skipping suite, continuing"
    FAILED="$FAILED $suite(missing-judge)"
    continue
  fi
  log "=== judge $suite ==="
  JUDGE_MODEL="$JUDGE_MODEL" JUDGE_MODEL_UNDATED_OK="$JUDGE_MODEL_UNDATED_OK" \
    DRY_RUN="${DRY_RUN:-}" PAR="${PAR:-}" \
    bash "$JUDGE" "$FULL_TAG" 2>&1 | tee -a "$LOG"
  rc="${PIPESTATUS[0]}"
  if [ "$rc" -eq 0 ]; then
    log "judge $suite: OK"
  else
    log "judge $suite: FAILED (exit $rc) — continuing to next suite (re-run the same tag to resume this one)"
    FAILED="$FAILED $suite(judge)"
  fi
done

log "== done: tag=$FULL_TAG results=$ROOT/results log=$LOG =="
if [ -n "$FAILED" ]; then
  log "FAILED suites:$FAILED"
  exit 1
fi
exit 0
