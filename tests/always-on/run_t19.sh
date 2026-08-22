#!/bin/bash
# t19 — multi-turn intake conduct via the simulated-candidate DRIVER
# (#19's core): a persona agent (Jordan Reyes) alternates turns with the
# runner in an EMPTY workspace (new candidate; profile's intake is the
# surface under test). The driver is reusable for any conversational
# conduct case: swap the persona + shipped skills.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t19-$1"
mkdir -p "$RESULTS"
# ── The vault (2026-08-20, third absolute-path breakout): the founder's real
# ~/job-search is made IMMUTABLE for the duration of the run. A sandboxed
# agent that constructs the real path (unix file ownership leaks the
# username; unscrubable) gets a write ERROR instead of clobbering a file.
# The trap guarantees unlock on any exit; unlock-first heals a prior crash.
REALJS="$(eval echo ~)/job-search"
vault_unlock() { find "$REALJS" -flags +uchg -exec chflags nouchg {} + 2>/dev/null; }
vault_lock()   { find "$REALJS" -type f -not -path '*/.damaged*' -exec chflags uchg {} + 2>/dev/null; }
trap vault_unlock EXIT INT TERM
vault_unlock; vault_lock
MODEL="${MODEL:-sonnet}"
SIM_MODEL="${SIM_MODEL:-sonnet}"
TRIALS="${TRIALS:-1}"
MAX_TURNS="${MAX_TURNS:-8}"
for trial in $(seq 1 "$TRIALS"); do
for case_name in ${CASES:-t19-intake t19-folder-repo}; do
  CASE="$ROOT/cases/$case_name"
  # per-case persona when present; the shared one otherwise (the driver's
  # point: swap the persona OR the workspace, reuse everything else)
  PERSONA="$CASE/persona.md"; [ -f "$PERSONA" ] || PERSONA="$ROOT/fixtures/t19/persona.md"
  CASE_TURNS="$MAX_TURNS"
  [ -f "$CASE/turns.txt" ] && CASE_TURNS="$(cat "$CASE/turns.txt")"
  out="$RESULTS/$case_name-t$trial"
  [ -f "$out.md" ] && { echo "skip $case_name t$trial"; continue; }
  WS="$(mktemp -d)"          # empty unless the case seeds it
  SIMD="$(mktemp -d)"        # bare dir for the simulator (no skills load)
  # HOME sandbox — earned 2026-08-18, first folder-hazard run: BOTH trial
  # agents ran mkdir/ls/grep/git against the REAL ~/job-search and created
  # candidate dirs in the REAL home (~/job-search-jordan). A conversational
  # runner with skip-permissions WILL reach ~; give it a fake one. Only the
  # CLI's own config is linked through.
  # NOT symlinks: a failed auth inside the fake home wrote EMPTY tokens back
  # through the link into the real Keychain entry and logged the founder's CLI
  # out (2026-08-18). Copy the config in; the fake home must be a dead end for
  # writes, which is the entire point of a sandbox.
  FAKEHOME="$(mktemp -d)"
  cp -R "$HOME/.claude" "$FAKEHOME/.claude" 2>/dev/null
  [ -f "$HOME/.claude.json" ] && cp "$HOME/.claude.json" "$FAKEHOME/.claude.json"
  rm -rf "$FAKEHOME/.claude/projects" "$FAKEHOME/.claude/todos" 2>/dev/null
  # ws-seed/ plants what the session OPENS INTO (e.g. a code repo — the
  # folder-hazard branch); dotfiles included, so .git can be planted
  [ -d "$CASE/ws-seed" ] && cp -R "$CASE/ws-seed/." "$WS/"
  # git cannot TRACK a nested .git dir, so fixtures store it as _git and
  # the seed step restores the real name (found 2026-08-18: the planted
  # .git/HEAD silently vanished from the commit, weakening the repo bait
  # on any fresh clone)
  [ -d "$WS/_git" ] && mv "$WS/_git" "$WS/.git"
  mkdir -p "$WS/.claude/skills"
  # per-case skill list (one name per line); the intake pair otherwise
  CASE_SKILLS="profile storybank"
  [ -f "$CASE/skills.txt" ] && CASE_SKILLS="$(cat "$CASE/skills.txt" | tr '\n' ' ')"
  for sk in $CASE_SKILLS; do cp -r "$REPO/skills/$sk" "$WS/.claude/skills/"; done
  echo "=== $case_name / trial $trial -> $WS"
  # Tripwire (2026-08-20: a trial overwrote the founder's REAL ~/job-search
  # through an absolute path): fingerprint the real workspace; any change
  # during the trial aborts the whole run loudly.
  FP_BEFORE="$(find "$(eval echo ~)/job-search" -type f -not -path '*/.damaged*' -exec stat -f '%N %z %m' {} + 2>/dev/null | sort | shasum | cut -d' ' -f1)"
  : > "$out.err"; : > "$out.transcript.md"
  CAND_MSG="hey — a friend said you could help me figure out my job search. I need to get out of my current gig."
  [ -f "$CASE/opener.txt" ] && CAND_MSG="$(cat "$CASE/opener.txt")"
  for turn in $(seq 1 "$CASE_TURNS"); do
    printf '\n## Candidate (turn %s)\n%s\n' "$turn" "$CAND_MSG" >> "$out.transcript.md"
    cont=""; [ "$turn" -gt 1 ] && cont="--continue"
    # sandbox auth: keychain-held logins are invisible under a fake HOME
    # (2026-08-20). The founder's setup-token lands in ~/.claude/harness-token
    # (chmod 600); export it to the sandboxed CLI only.
    HTOK=""; [ -f "$HOME/.claude/harness-token" ] && HTOK="$(cat "$HOME/.claude/harness-token")"
    # Identity scrub (2026-08-20 incident): HOME=FAKEHOME contained `~`, but
    # the agent WROTE to the literal /Users/<user>/job-search — it can rebuild
    # the real path from USER/LOGNAME. Scrub them. Defense 2 of 2; the
    # fingerprint tripwire below is defense 1.
    ( cd "$WS" && HOME="$FAKEHOME" USER=candidate LOGNAME=candidate CLAUDE_CODE_OAUTH_TOKEN="$HTOK" claude -p $cont "$CAND_MSG" \
        --model "$MODEL" --dangerously-skip-permissions \
        --setting-sources project --output-format stream-json --verbose \
      ) > "$out.turn$turn.stream.json" 2>> "$out.err"
    AGENT_REPLY="$(python3 "$ROOT/extract_text.py" "$out.turn$turn.stream.json")"
    printf '\n## Agent (turn %s)\n%s\n' "$turn" "$AGENT_REPLY" >> "$out.transcript.md"
    FP_NOW="$(find "$(eval echo ~)/job-search" -type f -not -path '*/.damaged*' -exec stat -f '%N %z %m' {} + 2>/dev/null | sort | shasum | cut -d' ' -f1)"
    if [ "$FP_NOW" != "$FP_BEFORE" ]; then
      echo "TRIPWIRE: real ~/job-search CHANGED during $case_name t$trial turn $turn — ABORTING ALL RUNS" | tee -a "$out.err"
      exit 90
    fi
    [ "$turn" -eq "$CASE_TURNS" ] && break
    # simulator: persona + transcript so far -> next candidate message
    SIMP="$(mktemp)"
    { cat "$PERSONA"; echo; echo "=== CONVERSATION SO FAR ==="; cat "$out.transcript.md"
      echo; echo "This will be the candidate's message number $((turn + 1)) of about $CASE_TURNS."
      echo "Check the BEHAVIOR SCRIPT: which beats are still undelivered? If a"
      echo "beat is due at or before message $((turn + 1)) and has not happened"
      echo "yet, deliver it NOW. Never repeat a previous message. Output ONLY"
      echo "the candidate's message."
    } > "$SIMP"
    CAND_MSG="$( cd "$SIMD" && claude -p "$(cat "$SIMP")" --model "$SIM_MODEL" \
        --setting-sources project 2>> "$out.err" )"
    rm -f "$SIMP"
    [ -z "$CAND_MSG" ] && { echo "sim returned empty at turn $turn" >> "$out.err"; break; }
  done
  cp "$out.transcript.md" "$out.md"
  mkdir -p "$out-ws"
  cp "$WS"/*.md "$out-ws/" 2>/dev/null
  for d in stories; do [ -d "$WS/$d" ] && cp -r "$WS/$d" "$out-ws/"; done
  ls -RA "$WS" | grep -v '.claude/skills' > "$out-ws/_listing.txt" 2>/dev/null
  # a trial that legitimately settles ~/job-search writes into the FAKE home
  # (2026-08-20): snapshot it too, or the judge sees an empty workspace and
  # honest closes read as lies
  if [ -d "$FAKEHOME/job-search" ]; then
    mkdir -p "$out-fakehome-ws"
    cp -R "$FAKEHOME/job-search/." "$out-fakehome-ws/" 2>/dev/null
  fi
  # what the agent did in its (fake) home is part of the record
  ls -RA "$FAKEHOME" 2>/dev/null | grep -v '^\.' | head -50 > "$out-ws/_fakehome.txt"
  python3 "$ROOT/dump_tools.py" "$out".turn*.stream.json > "$out.tools.txt" 2>/dev/null
  rm -rf "$WS" "$SIMD" "$FAKEHOME"
done
done
echo "done: $RESULTS"
