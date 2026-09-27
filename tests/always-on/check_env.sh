#!/bin/bash
# Preflight for any eval run in this directory. Verifies the test
# environment is clean, i.e. that a condition's behaviour comes from what
# the condition provides and nothing else.
#
# Run this BEFORE trusting any result. The 2026-08-13 Phase A run was
# invalidated by exactly what this checks for.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
fail=0
say() { printf '  %-6s %s\n' "$1" "$2"; }

echo "== eval environment preflight =="

# 1. No user-level CLAUDE.md — it would load into EVERY condition,
#    including bare, and silently become part of the baseline.
if [ -f "$HOME/.claude/CLAUDE.md" ]; then
  say FAIL "~/.claude/CLAUDE.md exists — leaks into every condition"; fail=1
else
  say ok "no user-level CLAUDE.md"
fi

# 2. Skills must come only from the workspace. --setting-sources project
#    excludes ~/.claude/skills; confirm no coaching skill survives it.
WS="$(mktemp -d)"
seen=$(cd "$WS" && claude -p "List every skill available to you, comma-separated names only. If none, say NONE." \
        --model sonnet --setting-sources project "${CLAUDE_KILL_GUARD_ARGS[@]}" 2>/dev/null | tr 'A-Z' 'a-z')
rm -rf "$WS"
leaked=""
for s in profile coach search apply prep practice storybank evaluate outreach negotiate positioning pipeline-board interview-coach; do
  case "$seen" in *"$s"*) leaked="$leaked $s";; esac
done
if [ -n "$leaked" ]; then
  say FAIL "coaching skills visible without being provided:$leaked"; fail=1
else
  say ok "no coaching skills leak into a bare workspace"
fi

# 3. Every runner must pass --setting-sources project.
for f in "$ROOT"/run_replay.sh "$ROOT"/run_t4.sh; do
  if grep -q -- "--setting-sources project" "$f"; then
    say ok "$(basename "$f") isolates settings"
  else
    say FAIL "$(basename "$f") is MISSING --setting-sources project"; fail=1
  fi
done

# 4. Warn about anything project-scoped that could apply to a real run.
if [ -f "$HOME/.claude/plugins/installed_plugins.json" ]; then
  if grep -q '10xjobs' "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null; then
    say warn "a 10xjobs plugin is installed (project-scoped — harmless for temp-dir runs,"
    say ""   "     but a real session inside its projectPath gets THAT version, not the repo's)"
  fi
fi

# 5. Process-safety guard (2026-09-26 Chrome incident): guard-bin's
#    pkill/killall/kill shims exist, are executable, and lib_env.sh puts
#    them first on PATH — before any runner can start an agent that might
#    reach for a name-based kill.
if [ -x "$ROOT/guard-bin/pkill" ] && [ -x "$ROOT/guard-bin/killall" ] && [ -x "$ROOT/guard-bin/kill" ]; then
  say ok "guard-bin/{pkill,killall,kill} present and executable"
else
  say FAIL "guard-bin is missing an executable shim (pkill/killall/kill)"; fail=1
fi
if grep -q 'guard-bin' "$ROOT/lib_env.sh"; then
  say ok "lib_env.sh puts guard-bin first on PATH"
else
  say FAIL "lib_env.sh does not reference guard-bin — the kill guards are not wired in"; fail=1
fi

# 6. Clean environment: lib_env.sh must scrub every ambient CLAUDE* var
#    (a desktop session's own vars — not just CLAUDE_CODE_* — were found
#    to change the agent's tools; review widened the pattern 2026-09-27
#    after CLAUDE_EFFORT/CLAUDE_PID/CLAUDECODE etc. were also found set).
if grep -qF '^CLAUDE[A-Za-z0-9_]*' "$ROOT/lib_env.sh" && grep -q 'unset "\$_v"' "$ROOT/lib_env.sh"; then
  say ok "lib_env.sh scrubs every ambient CLAUDE* var"
else
  say FAIL "lib_env.sh does not scrub every ambient CLAUDE* var"; fail=1
fi

# 7. Vault lock must be the ONE shared, reference-counted copy in
#    lib_env.sh — not a private copy per run_*.sh (the sibling-unlock race
#    this fixed).
if grep -q 'vault_lock()' "$ROOT/lib_env.sh" && grep -q 'vault_unlock()' "$ROOT/lib_env.sh"; then
  say ok "lib_env.sh defines the shared vault_lock/vault_unlock"
else
  say FAIL "lib_env.sh is missing the shared vault_lock/vault_unlock"; fail=1
fi
stray=""
for f in "$ROOT"/run_*.sh; do
  grep -q 'vault_lock()\|vault_unlock()' "$f" 2>/dev/null && stray="$stray $(basename "$f")"
done
if [ -z "$stray" ]; then
  say ok "no run_*.sh still defines its own private vault_lock/vault_unlock"
else
  say FAIL "still define their own vault_lock/vault_unlock (the race this fixed):$stray"; fail=1
fi

echo
[ "$fail" = 0 ] && echo "PREFLIGHT CLEAN" || echo "PREFLIGHT FAILED — fix before trusting results"
exit $fail
