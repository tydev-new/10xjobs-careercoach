#!/bin/bash
# Phase A replay — 3 cases x {baseline, treatment}, Sonnet as model-under-test.
#
# baseline  = planted workspace only (stock model behavior)
# treatment = planted workspace + the always-on CLAUDE.md template
#
# Each run executes headless in a throwaway workspace so the CLAUDE.md under
# test is the ONLY always-on layer. Replies and post-run workspace snapshots
# land in results/ (gitignored); judge_replay.sh scores them afterwards.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
TEMPLATE="$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md"
RESULTS="$ROOT/results/run-$1"   # $1 = a run tag, e.g. a date
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS"
maybe_dry_run runner "$RESULTS" && exit 0

# --setting-sources project excludes ~/.claude/skills. Without it the
# user's globally-installed skills (notably the old interview-coach) leak
# into every condition — that confounded the 2026-08-13 run. Do not remove.
CONDS="${CONDS:-baseline treatment}"

for case_dir in "$ROOT"/cases/*/; do
  case_name="$(basename "$case_dir")"
  [ -f "$case_dir/prompt.md" ] || continue   # multi-turn cases (t4) have their own runner
  for cond in $CONDS; do
    out="$RESULTS/$case_name-$cond"
    [ -f "$out.md" ] && { echo "skip $case_name-$cond (exists)"; continue; }
    WS="$(mktemp -d)"
    cp "$ROOT/fixtures/profile.md" "$ROOT/fixtures/criteria.md" "$WS/"
    [ "$cond" = "treatment" ] && cp "$TEMPLATE" "$WS/CLAUDE.md"
    echo "=== $case_name / $cond -> $WS"
    # stream-json: capture EVERY assistant text block — `-p` alone prints only
    # the final block, silently dropping prose emitted between tool calls
    ( cd "$WS" && claude -p "$(cat "$case_dir/prompt.md")" \
        --model "$MODEL" --permission-mode acceptEdits \
        --setting-sources project \
        --output-format stream-json --verbose \
      ) > "$out.stream.json" 2> "$out.err"
    python3 "$ROOT/extract_text.py" "$out.stream.json" > "$out.md"
    # snapshot the workspace: did it write/change files? (hand-them-the-thing)
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    record_served_models "$out"
    rm -rf "$WS"
  done
done
echo "done: $RESULTS"
