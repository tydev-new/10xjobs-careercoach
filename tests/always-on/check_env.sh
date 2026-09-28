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

# 8. No real browser in a harness run (owner ruling 2026-09-26): lib_env.sh
#    points RENDER_RESUME_CHROME at a per-trial staged copy, and that copy
#    exists and is executable — a runner without this wired in would let
#    render_resume.mjs's toPdf() reach for a REAL headless Chrome again.
if [ -x "$ROOT/fixtures/fake-chrome" ]; then
  say ok "fixtures/fake-chrome present and executable"
else
  say FAIL "fixtures/fake-chrome is missing or not executable"; fail=1
fi
# 8b. Hidden stand-in (arm-A t10 fix round, 2026-09-27): an agent under test
#     read RENDER_RESUME_CHROME, then `cat` the file BY PATH — the repo
#     fixture's own docstring says "harness-owned stand-in for headless
#     Chrome", so it told the "candidate" it was in a sandbox. Fix: the var
#     must point at a PER-TRIAL COPY staged inside a sandbox HOME (never the
#     documented repo fixture directly), with every comment/docstring
#     stripped from that copy — checked for real, by actually sourcing
#     lib_env.sh and calling sandbox_home_setup, not by a static grep (a
#     grep for the var's own name would pass even if it were wired straight
#     back to the documented fixture).
REPO="$(cd "$ROOT/../.." && pwd)"
chrome_probe="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; sandbox_home_setup
echo \"FAKEHOME=\$FAKEHOME\"
echo \"RENDER_RESUME_CHROME=\$RENDER_RESUME_CHROME\"
echo '---COPY---'
cat \"\$RENDER_RESUME_CHROME\"")"
chrome_fakehome="$(printf '%s\n' "$chrome_probe" | sed -n 's/^FAKEHOME=//p')"
chrome_var="$(printf '%s\n' "$chrome_probe" | sed -n 's/^RENDER_RESUME_CHROME=//p')"
chrome_copy="$(printf '%s\n' "$chrome_probe" | sed -n '/^---COPY---$/,$p' | tail -n +2)"
inside_sandbox=0
if [ -n "$chrome_fakehome" ] && [ -n "$chrome_var" ]; then
  case "$chrome_var" in "$chrome_fakehome"/*) inside_sandbox=1 ;; esac
fi
if [ "$inside_sandbox" = 1 ] && [ -x "$chrome_var" ]; then
  say ok "RENDER_RESUME_CHROME points inside the sandbox HOME (a staged copy, not the repo fixture)"
else
  say FAIL "RENDER_RESUME_CHROME is not an executable path inside the sandbox HOME (FAKEHOME=${chrome_fakehome:-<empty>}, got: ${chrome_var:-<empty>})"; fail=1
fi
if printf '%s' "$chrome_copy" | grep -qiE '\b(harness|stand-in|fake|test)\b'; then
  say FAIL "the staged copy still contains a disclosure word (harness/stand-in/fake/test)"; fail=1
else
  say ok "the staged copy carries no 'harness'/'stand-in'/'fake'/'test' word (no exceptions)"
fi
[ -n "$chrome_fakehome" ] && rm -rf "$chrome_fakehome" 2>/dev/null

# 9. HOME sandbox for every runner (fix round 4): a re-test found an agent
#    under test running/reading the owner's DEPLOYED ~/.claude/skills via
#    the real (or a too-broadly-copied) HOME. lib_env.sh must define the
#    shared, minimal sandbox_home_setup/cleanup, and every run_*.sh that
#    grants tool access (--dangerously-skip-permissions or
#    --permission-mode) must call it.
if grep -q 'sandbox_home_setup()' "$ROOT/lib_env.sh" && grep -q 'sandbox_home_cleanup()' "$ROOT/lib_env.sh"; then
  say ok "lib_env.sh defines the shared sandbox_home_setup/cleanup"
else
  say FAIL "lib_env.sh is missing sandbox_home_setup/cleanup"; fail=1
fi
unsandboxed=""
for f in "$ROOT"/run_*.sh; do
  if grep -qE -- '--dangerously-skip-permissions|--permission-mode' "$f" && ! grep -q 'sandbox_home_setup' "$f"; then
    unsandboxed="$unsandboxed $(basename "$f")"
  fi
done
if [ -z "$unsandboxed" ]; then
  say ok "every runner granting tool access calls sandbox_home_setup"
else
  say FAIL "grant tool access with no HOME sandbox:$unsandboxed"; fail=1
fi
# RESIDUAL, stated plainly (2026-09-27 live probe, one Haiku call): HOME
# sandboxing stops ~-relative reaches and the owner's skills from being
# copied in — it does NOT stop an ABSOLUTE-PATH read. Unix permissions are
# per OWNING USER, not per $HOME, and the owner's ruling is that harness
# runs use the owner's own account (no separate OS user). vault_lock
# already makes ~/job-search's files immutable, so a WRITE through an
# absolute path still fails at the OS level — a READ does not. Closing
# that needs real process isolation (a separate OS user or a cloud
# sandbox); not checkable here, so it is only ever stated, never scored.
say warn "residual (owner-accepted): an absolute-path READ of the owner's real home still succeeds under HOME sandboxing — only OS-level user isolation closes it"

echo
[ "$fail" = 0 ] && echo "PREFLIGHT CLEAN" || echo "PREFLIGHT FAILED — fix before trusting results"
exit $fail
