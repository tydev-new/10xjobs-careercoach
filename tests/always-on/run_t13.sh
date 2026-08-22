#!/bin/bash
# t13 — the Draft loop's measured ceiling at its inline exit (was: through a
# tier-2 pointer, #12's accepted risk, until improvement-loop.md dissolved). One case: an unsatisfiable revision standard.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t13-$1"
mkdir -p "$RESULTS"
# A reused tag replays old results as if new (2026-08-21: a loop-shape
# measurement "ran" in seconds and printed the morning's verdicts). Say so.
[ -n "$(ls -A "$RESULTS" 2>/dev/null)" ] && echo "REUSED TAG: $RESULTS already has results — existing cases will be SKIPPED, not re-run; pick a fresh tag for a new measurement" >&2
MODEL="${MODEL:-sonnet}"
TRIALS="${TRIALS:-1}"

# The vault (2026-08-20 incident class): the founder's real ~/job-search is
# immutable for the whole run — locked before the first turn, unlocked on
# every exit path (EXIT after the final wait; INT/TERM also kill the group).
REALJS="$HOME/job-search"
vault_unlock() { find "$REALJS" -flags +uchg -exec chflags nouchg {} + 2>/dev/null; }
vault_lock()   { find "$REALJS" -type f -not -path '*/.damaged*' -exec chflags uchg {} + 2>/dev/null; }
[ -d "$REALJS" ] && { vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; kill 0 2>/dev/null' INT TERM; }
FIX="$ROOT/fixtures/apply"
for trial in $(seq 1 "$TRIALS"); do
  # trials run concurrently (PAR, default 6); the vault lock is held by
  # THIS process until the final wait.
  while [ "$(jobs -rp | wc -l)" -ge "${PAR:-6}" ]; do sleep 2; done
  (
    CASE="$ROOT/cases/t13-ceiling"
    out="$RESULTS/t13-ceiling-t$trial"
    [ -f "$out.md" ] && { echo "skip t$trial (exists)"; exit 0; }
    WS="$(mktemp -d)"
    cp "$ROOT/fixtures/profile.md" "$WS/"
    cp "$FIX"/base-resume.md "$FIX"/voice.md "$FIX"/storybank.md "$FIX"/jobs.md "$WS/"
    cp -r "$FIX/stories" "$FIX/jd-inbox" "$FIX/jd-analysis" "$FIX/company" "$WS/"
    cp -r "$CASE/ws-extra/." "$WS/"
    cp "$REPO/skills/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
    mkdir -p "$WS/.claude/skills"
    cp -r "$REPO/skills/outreach" "$REPO/skills/profile" "$REPO/skills/positioning" "$WS/.claude/skills/"
    echo "=== t13-ceiling / trial $trial -> $WS"
    : > "$out.err"
    ( cd "$WS" && claude -p "$(cat "$CASE/prompt.md")" \
        --model "$MODEL" --dangerously-skip-permissions \
        --setting-sources project --output-format stream-json --verbose \
      ) > "$out.turn1.stream.json" 2>> "$out.err"
    python3 "$ROOT/extract_text.py" "$out.turn1.stream.json" > "$out.md"
    mkdir -p "$out-ws"
    cp "$WS"/*.md "$out-ws/" 2>/dev/null
    cp -r "$WS/contacts" "$out-ws/" 2>/dev/null
    python3 "$REPO/skills/outreach/scripts/check_messages.py" --workspace "$WS" \
      --contacts "$WS/contacts/nimbus.md" > "$out-ws/_messages_check.txt" 2>&1
    python3 "$ROOT/dump_tools.py" "$out".turn*.stream.json > "$out.tools.txt" 2>/dev/null
    rm -rf "$WS"
  ) &
done
wait
echo "done: $RESULTS"
