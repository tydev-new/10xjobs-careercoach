#!/bin/bash
# t21 — plain-report honesty (docs/design-plain-replies.md § 4): does the
# rewrite into everyday words ("the automatic checks", "the wording
# check", "nothing failed, nothing flagged") survive contact with a
# planted WARN and a stale plan.md claiming clean? One case. Plants
# applications/, plan.md, criteria.md, jobs.md and base-resume.md
# (apply's SKILL.md § Prerequisites: base-resume.md is required, hard
# stop if absent — an unplanted one derails the reply into "set up your
# base résumé first" instead of the honesty question this case exists to
# bait, measured on the ablation arm); installs profile, apply, evaluate
# and coach (evaluate for the track-by-name reply, coach for the closing
# discipline — both always-on-adjacent here).
#
# Usage: ./run_t21.sh <run-tag>   (TRIALS=n RUNNER_MODEL=<dated-id> overridable — see README Pinned models)
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
RESULTS="$ROOT/results/t21-$1"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS"
maybe_dry_run runner "$RESULTS" && exit 0
[ -n "$(ls -A "$RESULTS" 2>/dev/null)" ] && echo "REUSED TAG: $RESULTS already has results — existing cases will be SKIPPED, not re-run; pick a fresh tag for a new measurement" >&2
TRIALS="${TRIALS:-1}"

# The vault (2026-08-20 incident class): the founder's real ~/job-search is
# immutable for the whole run.
# Vault lock/unlock: shared, reference-counted (lib_env.sh) -- see its
# comment for the race this fixes (a sibling run_*.sh unlocking early).
vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; kill 0 2>/dev/null' INT TERM

CASE="$ROOT/cases/t21-plain-report"
for trial in $(seq 1 "$TRIALS"); do
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    out="$RESULTS/t21-plain-report-t$trial"
    [ -f "$out.md" ] && { echo "skip t21-plain-report t$trial (exists)"; exit 0; }
    WS="$(mktemp -d)"
    cp "$CASE/plan.md" "$CASE/criteria.md" "$CASE/jobs.md" "$CASE/base-resume.md" "$WS/"
    mkdir -p "$WS/applications"
    cp "$CASE/applications/"*.md "$WS/applications/"
    cp "$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    mkdir -p "$WS/.claude/skills"
    cp -r "$RUNNER_SKILLS_DIR/profile" "$RUNNER_SKILLS_DIR/apply" \
          "$RUNNER_SKILLS_DIR/evaluate" "$RUNNER_SKILLS_DIR/coach" \
          "$WS/.claude/skills/"
    echo "=== t21-plain-report / trial $trial -> $WS"
    sandbox_home_setup
    : > "$out.err"
    ( cd "$WS" && HOME="$FAKEHOME" USER=candidate LOGNAME=candidate CLAUDE_CODE_OAUTH_TOKEN="$HTOK" claude -p "$(cat "$CASE/prompt.md")" \
        --model "$MODEL" --dangerously-skip-permissions \
        --setting-sources project "${CLAUDE_KILL_GUARD_ARGS[@]}" --output-format stream-json --verbose \
      ) > "$out.turn1.stream.json" 2>> "$out.err"
    sandbox_home_cleanup
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json" > "$out.md"
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    [ -d "$WS/applications" ] && cp -r "$WS/applications" "$out-ws/"
    ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
    # Deterministic layer, the same way run_t10.sh:101 does — the check
    # against whatever the agent left behind, not the planted files, so a
    # fix-in-place shows up as gone and an untouched WARN shows up as still
    # there.
    R="$(ls "$WS"/applications/*-resume.md 2>/dev/null | head -1)"
    L="$(ls "$WS"/applications/*cover-letter*.md 2>/dev/null | head -1)"
    if [ -n "$R" ] || [ -n "$L" ]; then
      python3 "$RUNNER_SKILLS_DIR/apply/scripts/check_materials.py" --workspace "$WS" \
        ${R:+--resume "$R"} ${L:+--letter "$L"} \
        > "$out-ws/_materials_check.txt" 2>&1
    else
      echo "NO APPLICATION MATERIALS FOUND" > "$out-ws/_materials_check.txt"
    fi
    python3 "$ROOT/dump_tools.py" --results "$out".turn*.stream.json > "$out.tools.txt" 2>/dev/null
    record_served_models "$out"
    rm -rf "$WS"
  ) &
done
wait
echo "done: $RESULTS"
