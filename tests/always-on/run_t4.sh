#!/bin/bash
# t4 attribution experiment — separates model / guardrails / skill.
#
#   bare        model alone
#   guardrails  + workspace CLAUDE.md
#   full        + the profile skill (project-local)
#
# ALL conditions use --setting-sources project, which excludes
# ~/.claude/skills — otherwise the user's globally-installed skills
# (including the old interview-coach) leak into every condition. That
# leak confounded the first Phase A run; do not remove this flag.
#
# Two turns: "get me set up" with a résumé in the folder, then the
# complexity reveal. Usage: ./run_t4.sh <run-tag>
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
CASE="$ROOT/cases/t4-intake"
RESULTS="$ROOT/results/t4-$1"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS"
maybe_dry_run runner "$RESULTS" && exit 0
CONDS="${CONDS:-bare guardrails full}"
TRIALS="${TRIALS:-1}"

# The vault (2026-08-20 incident class): the founder's real ~/job-search is
# immutable for the whole run, same as run_t13/t19/t21.
vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; kill 0 2>/dev/null' INT TERM

# design-honest-ceilings.md § 6 "The case": keep acceptEdits, and let the
# skill's own scripts run so a close-time check CAN run (§ 5 "The
# environment": acceptEdits alone blocks Bash in -p mode). The spec names
# "Bash(python3 .claude/skills/*)"; profile's scripts are node since the JS
# switch (check_files.mjs), so the same relative pattern is given for node.
# PROBED 2026-09-28 (Haiku, sandbox HOME, -p, acceptEdits): both RELATIVE
# forms run; the ABSOLUTE form (node /var/.../.claude/skills/...) is
# DENIED (permission_denials). Not widened, per the spec.
ALLOW_SCRIPTS=(--allowedTools "Bash(python3 .claude/skills/*)" "Bash(node .claude/skills/*)")

for trial in $(seq 1 "$TRIALS"); do
for cond in $CONDS; do
  out="$RESULTS/$cond-t$trial"
  [ -f "$out.md" ] && { echo "skip $cond trial $trial (exists)"; continue; }
  WS="$(mktemp -d)"
  cp "$CASE/resume.md" "$WS/"
  case "$cond" in
    guardrails|full)
      cp "$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md" ;;
  esac
  if [ "$cond" = "full" ]; then
    mkdir -p "$WS/.claude/skills"
    # coach ships in every real workspace (design-honest-ceilings.md § 3/§ 6)
    cp -r "$RUNNER_SKILLS_DIR/profile" "$RUNNER_SKILLS_DIR/coach" "$WS/.claude/skills/"
  fi
  echo "=== t4 / $cond / trial $trial -> $WS"
  sandbox_home_setup   # one FAKEHOME per trial — turn 2's --continue needs the SAME one turn 1 used
  ( cd "$WS" && HOME="$FAKEHOME" USER=candidate LOGNAME=candidate CLAUDE_CODE_OAUTH_TOKEN="$HTOK" claude -p "$(cat "$CASE/turn1.md")" \
      --model "$MODEL" --permission-mode acceptEdits "${ALLOW_SCRIPTS[@]}" \
      --setting-sources project "${CLAUDE_KILL_GUARD_ARGS[@]}" --output-format stream-json --verbose \
    ) > "$out.turn1.stream.json" 2> "$out.err"
  ( cd "$WS" && HOME="$FAKEHOME" USER=candidate LOGNAME=candidate CLAUDE_CODE_OAUTH_TOKEN="$HTOK" claude -p --continue "$(cat "$CASE/turn2.md")" \
      --model "$MODEL" --permission-mode acceptEdits "${ALLOW_SCRIPTS[@]}" \
      --setting-sources project "${CLAUDE_KILL_GUARD_ARGS[@]}" --output-format stream-json --verbose \
    ) > "$out.turn2.stream.json" 2>> "$out.err"
  sandbox_home_cleanup
  {
    echo "===== TURN 1 ====="
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json"
    echo; echo "===== TURN 2 ====="
    python3 "$ROOT/extract_text.py" "$out.turn2.stream.json"
  } > "$out.md"
  mkdir -p "$out-ws"
  cp "$WS"/*.md "$out-ws/" 2>/dev/null
  # record which skills actually fired, if any
  grep -ho '"skill": *"[^"]*"' "$out".turn*.stream.json 2>/dev/null \
    | sort -u > "$out.skills.txt"
  record_served_models "$out"
  rm -rf "$WS"
done
done
echo "done: $RESULTS"
