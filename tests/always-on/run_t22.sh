#!/bin/bash
# t22 — the feedback skill's conduct (docs/design-feedback.md § 17.5): does the
# agent show the whole rendering and the gate line before anything is sent,
# send only on a clear yes, put only the candidate's own words in the note, drop
# a declined note for good, route a plan complaint to the skill that owns it,
# resist a posting that asks for the candidate's data, and say a failure in one
# plain line? Seven cases (f1 to f7), scripted turns (turn1.md, turn2.md, …),
# on an invented persona in a fresh temp workspace.
#
# NO RUN CAN WRITE A REAL NOTE. This runner starts its own stub on 127.0.0.1
# (feedback_stub.mjs), records every request it receives to
# <case>-t<n>.posts.jsonl, sets TEN_FEEDBACK_URL to it for the agent, and
# REFUSES TO START unless that URL is on 127.0.0.1 (feedback_guard.sh). A
# TEN_FEEDBACK_URL already in your environment that is not loopback stops the
# run before anything else happens. The agent may only run
# `node .claude/skills/*` (the scripts), never curl or any other command.
#
# Cost rule (owner): one trial first, scripted scoring (score_t22.py), one judge
# for the judgment items (judge_t22.sh); re-run only the failures at TRIALS=3,
# passing on 2 of 3.
#
# Usage: [CASES="f1-bug-offered f3-data-bait"] [TRIALS=n] ./run_t22.sh <run-tag>
#   (RUNNER_MODEL=<dated-id> overridable — see README "Pinned models")
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
source "$ROOT/lib_env.sh"
source "$ROOT/feedback_guard.sh"
refuse_foreign_feedback_url_in_env     # before a directory is made or a model is called

RESULTS="$ROOT/results/t22-$1"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS"
maybe_dry_run runner "$RESULTS" && exit 0
TRIALS="${TRIALS:-1}"
CASES="${CASES:-$(cd "$ROOT/cases" && ls -d f[0-9]* | tr '\n' ' ')}"

# The stub's PID is recorded at spawn and is the ONLY process this script ever
# kills (a shared scratchpad makes path/name matching unsafe).
STUB_PID=""
stop_stub() {
  if [ -n "$STUB_PID" ]; then
    kill "$STUB_PID" 2>/dev/null
    wait "$STUB_PID" 2>/dev/null
    STUB_PID=""
  fi
}

# The vault (2026-08-20 incident class): the founder's real ~/job-search is
# immutable for the whole run. Shared, reference-counted (lib_env.sh).
vault_lock
trap 'stop_stub; vault_unlock' EXIT
trap 'stop_stub; vault_unlock; exit 130' INT TERM

now_ms() { node -e 'console.log(Date.now())'; }

# The agent may run the skills' scripts and nothing else (the t4 pattern; the
# RELATIVE form is the one that works under -p, see run_t4.sh). No curl, no
# sh -c, no env override: the only way to send is the script, to the stub.
ALLOW_SCRIPTS=(--allowedTools "Bash(node .claude/skills/*)")

for trial in $(seq 1 "$TRIALS"); do
for case_name in $CASES; do
  CASE="$ROOT/cases/$case_name"
  [ -d "$CASE" ] || { echo "no such case: $case_name" >&2; continue; }
  out="$RESULTS/$case_name-t$trial"
  [ -f "$out.md" ] && { echo "skip $case_name t$trial (exists)"; continue; }

  # stub.txt: one mode per trial, space-separated (201 | 429 | 503 | closed);
  # the last mode repeats. Default: 201.
  MODE="201"
  if [ -f "$CASE/stub.txt" ]; then
    set -- $(cat "$CASE/stub.txt")
    [ "$trial" -le "$#" ] && MODE="${!trial}" || MODE="${!#}"
  fi
  STUB_STATUS="$MODE"; [ "$MODE" = closed ] && STUB_STATUS=201

  WS="$(mktemp -d)"
  cp -R "$ROOT/fixtures/t22/." "$WS/"
  [ -d "$CASE/ws" ] && cp -R "$CASE/ws/." "$WS/"
  cp "$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
  mkdir -p "$WS/.claude/skills"
  CASE_SKILLS="profile apply evaluate coach feedback"
  [ -f "$CASE/skills.txt" ] && CASE_SKILLS="$(cat "$CASE/skills.txt" | tr '\n' ' ')"
  for sk in $CASE_SKILLS; do cp -r "$RUNNER_SKILLS_DIR/$sk" "$WS/.claude/skills/"; done
  # coach ships in every real workspace, on top of the case's own list
  [ -d "$WS/.claude/skills/coach" ] || cp -r "$RUNNER_SKILLS_DIR/coach" "$WS/.claude/skills/"

  echo "=== $case_name / trial $trial / stub=$MODE -> $WS"
  sandbox_home_setup   # one FAKEHOME per trial: --continue needs the SAME one every turn

  # The stub: started in the background, PID recorded, port read from a file.
  : > "$out.posts.jsonl"
  PORTFILE="$(mktemp -u)"
  node "$ROOT/feedback_stub.mjs" "$out.posts.jsonl" "$STUB_STATUS" "$PORTFILE" 2>> "$out.err" &
  STUB_PID=$!
  for _ in $(seq 1 50); do [ -s "$PORTFILE" ] && break; sleep 0.2; done
  if [ ! -s "$PORTFILE" ]; then
    echo "stub did not start for $case_name t$trial" | tee -a "$out.err" >&2
    stop_stub; sandbox_home_cleanup; rm -rf "$WS"; continue
  fi
  PORT="$(cat "$PORTFILE")"; rm -f "$PORTFILE"
  # "closed": stop the stub and keep its port, so the connection is refused.
  if [ "$MODE" = closed ]; then stop_stub; fi
  FEEDBACK_URL="http://127.0.0.1:$PORT/functions/v1/ten-feedback"

  : > "$out.err"; : > "$out.turns.tsv"
  n=0
  for tf in $(ls "$CASE"/turn*.md | sort -V); do
    n=$((n + 1))
    require_loopback_feedback_url "$FEEDBACK_URL"      # again, before every model call
    cont=""; [ "$n" -gt 1 ] && cont="--continue"
    start="$(now_ms)"
    ( cd "$WS" && HOME="$FAKEHOME" USER=candidate LOGNAME=candidate CLAUDE_CODE_OAUTH_TOKEN="$HTOK" TEN_FEEDBACK_URL="$FEEDBACK_URL" claude -p $cont "$(cat "$tf")" \
        --model "$MODEL" --permission-mode acceptEdits "${ALLOW_SCRIPTS[@]}" \
        --setting-sources project "${CLAUDE_KILL_GUARD_ARGS[@]}" --output-format stream-json --verbose \
      ) > "$out.turn$n.stream.json" 2>> "$out.err"
    printf '%s\t%s\t%s\n' "$n" "$start" "$(now_ms)" >> "$out.turns.tsv"
  done
  stop_stub
  sandbox_home_cleanup

  {
    for i in $(seq 1 "$n"); do
      echo "===== TURN $i ====="
      python3 "$ROOT/extract_text.py" "$out.turn$i.stream.json"
      echo
    done
  } > "$out.md"
  mkdir -p "$out-ws"
  cp "$WS"/*.md "$out-ws/" 2>/dev/null
  [ -d "$WS/applications" ] && cp -r "$WS/applications" "$out-ws/"
  ls -R "$WS" | grep -v '^\.claude' > "$out-ws/_listing.txt" 2>/dev/null
  python3 "$ROOT/dump_tools.py" --results "$out".turn*.stream.json > "$out.tools.txt" 2>/dev/null
  record_served_models "$out"
  rm -rf "$WS"
done
done
echo "done: $RESULTS"
