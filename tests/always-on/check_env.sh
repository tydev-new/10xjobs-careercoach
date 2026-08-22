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
        --model sonnet --setting-sources project 2>/dev/null | tr 'A-Z' 'a-z')
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

echo
[ "$fail" = 0 ] && echo "PREFLIGHT CLEAN" || echo "PREFLIGHT FAILED — fix before trusting results"
exit $fail
