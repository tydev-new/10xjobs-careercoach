#!/bin/bash
# Shared environment resolution for every run_*.sh / judge_*.sh in this
# directory. Sourced, never executed directly. The caller must already have
# set `ROOT` and `REPO` (every script does this as its first two lines).
#
# Fixes the judge-reads-live-skills hole (docs/evals/rule-inventory.md item
# 8): a judge that `cat`s "$REPO/skills/..." grades an ablation arm against
# the ABLATED text, so a removed rule also vanishes from the judge's
# standard. The fix is a frozen snapshot of the real (unablated) skills/
# tree, identified by its own content (not just the commit — a dirty
# working tree can change between two invocations at the same commit), that
# the judge reads instead of the live tree.
#
#   RUNNER_SKILLS_DIR  what gets copied into the agent-under-test's
#                       workspace. Default: $REPO/skills (today's
#                       behaviour). Set this to an ablated tree to give the
#                       RUNNER a different skill text than the judge sees.
#   JUDGE_SKILLS_DIR    what a judge reads when it quotes "the skill says
#                       X". Default: the frozen snapshot this run took at
#                       start, which — so long as nobody has set
#                       RUNNER_SKILLS_DIR to something ablated — is byte-
#                       identical to $REPO/skills at run time, i.e. today's
#                       behaviour. The snapshot is ALWAYS taken from the
#                       real $REPO/skills, never from RUNNER_SKILLS_DIR, so
#                       an ablation never also erases the judge's standard.
#                       The snapshot ITSELF is write-once (same commit +
#                       content hash -> same directory, never recopied);
#                       what's NOT write-once is the per-tag record of which
#                       models/dirs were used — see run-info.txt below.
#
#   RUNNER_MODEL  the model under test. Default: claude-sonnet-5 (Sonnet 5,
#                 the owner's stated web default; docs/evals/rule-inventory.md
#                 item 8, confirmed as what `sonnet` resolved to in the
#                 August runs). MODEL is kept as an alias for back-compat.
#                 Sonnet 5 may have no dated id, so the DEFAULT path sets
#                 RUNNER_MODEL_UNDATED_OK=1 for you (recorded as such); an
#                 explicit override to something undated needs that same
#                 escape set explicitly, or it's rejected.
#   JUDGE_MODEL   the grading model. REQUIRED — no default, and REJECTED if
#                 it's a bare alias (opus, sonnet, haiku, fable, ...) or has
#                 no dated suffix (`...-20YYMMDD`), unless
#                 JUDGE_MODEL_UNDATED_OK=1 is set explicitly (recorded).
#                 Pinning to a DATE, not just a version number, is what
#                 keeps the judge fixed for the life of a B1 measurement.
#   SIM_MODEL     (t19 only) the persona simulator. Same dated-or-escape
#                 rule as RUNNER_MODEL, default claude-sonnet-5,
#                 SIM_MODEL_UNDATED_OK=1 auto-set on that default path.
#
# run-info.txt / judge-info.txt (in each results/<tag>/ dir) are APPEND-ONLY
# logs. Every line that belongs to a record starts with `ts=`; readers MUST
# select record lines with `grep '^ts='` before `tail -1` — extra per-runner
# fields (e.g. t19's sim_model) are appended to the SAME record line via
# snapshot_and_record_run_info's second argument, never as a bare stray
# line, or a naive `tail -1` reader silently falls off the record (found
# 2026-09-22: an earlier fix appended a bare `sim_model=` line after the
# record and broke every `tail -1`-based reader for t19 — including the
# judge's snapshot lookup, which then silently fell back to the LIVE tree).
#
# A same-tag invocation whose runner model/skills-dir/skills-hash (or judge
# model/skills-dir) differs from the immediately preceding record gets a
# loud WARN, since that means the tag's results now mix two configurations
# — including a skills_hash change alone (e.g. an edit between two runs at
# the same commit), which a model/dir-only comparison would miss.
set -u

# --- Process-safety guard (2026-09-26 Chrome incident) ---------------------
# A live run's agent-under-test ran `pkill -f "Google Chrome"` after
# render_resume.py's headless Chrome hung, killing every Chrome process on
# the machine including the owner's own browser. Two independent fixes:
# render_resume.py now runs Chrome with its own --user-data-dir and kills
# only its own child PID on a hard timeout (skills/apply/scripts/
# render_resume.py); and — belt and suspenders, for anything else an agent
# under test might try — this dir goes FIRST on PATH for every runner, so
# pkill/killall/kill-by-name all hit a refusing shim instead of the real
# thing. See tests/always-on/guard-bin/pkill for the full reasoning.
export PATH="$ROOT/guard-bin:$PATH"

# --- No real browser in a harness run (owner ruling 2026-09-26) ------------
# The incident above started because render_resume.py's PDF step launched a
# REAL headless Chrome even inside a test session, and that Chrome hung
# (see its docstring). An earlier plan isolated the whole harness under a
# separate macOS user so a hang could be killed without touching the
# owner's own processes; the owner replaced that plan with a simpler fix:
# give a harness run no real browser to hang in the first place.
# render_resume.py's to_pdf() reads RENDER_RESUME_CHROME ONLY when its
# caller passes no explicit `chrome=` argument, so this is a no-op outside
# this harness (the var is unset in production). fixtures/fake-chrome
# writes a small, realistically-sized PDF immediately and exits 0 — there
# is nothing left for an agent under test to "fix" with a kill. This
# removes the TRIGGER; the guards below (PATH shims, then the permission
# layer) are defense in depth for anything else an agent under test might
# still try, real Chrome or not.
#
# RENDER_RESUME_CHROME is NOT exported here (measured miss, arm-A t10 fix
# round, 2026-09-27): an agent under test read this var, then `cat` the
# fixture BY PATH — fixtures/fake-chrome's own docstring says "harness-owned
# stand-in for headless Chrome", so it told the "candidate" it was running
# inside a sandbox, changing the very behaviour the harness measures.
# Pointing this var at the repo fixture at all, however early, is the
# exposure; the fix is staging a comment-free, neutrally-named COPY inside
# each trial's own sandbox $FAKEHOME and pointing this var at THAT instead —
# see stage_fake_chrome() below, called from sandbox_home_setup (so the
# copy always lands inside a sandbox HOME that already exists, never the
# real fixtures/ dir) once per trial (concurrent trials never share a
# fake home, same as FAKEHOME itself). The repo fixture at
# fixtures/fake-chrome keeps its full documentation — only the per-trial
# copy is stripped.

# --- Kill-command permission guard, second layer (2026-09-27 review) ------
# Independent review of the PATH guard above (0b748cb, probe_guards.sh)
# found it bypassable: an absolute path (/usr/bin/pkill), a numeric kill of
# a name LOOKUP (`kill $(pgrep -f X)`), or a pipe into xargs
# (`pgrep -f X | xargs kill`) all reach the REAL binary — PATH order only
# helps when the agent types the bare command name. None of that is fixable
# with more PATH shims (an absolute path skips PATH search entirely); it
# needs process isolation (a separate OS user or a cloud sandbox), which is
# the owner's call, not this fix's.
#
# This is a SECOND, independent layer in the meantime: Claude Code's own
# --disallowedTools. VERIFIED LIVE (2026-09-27, one Haiku call, $0.14):
# `--disallowedTools "Bash(pkill*)"` still applies even under
# --dangerously-skip-permissions — the tool call never reaches a shell at
# all; the tool_result is literally "Permission to use Bash with command
# pkill -f <x> has been denied." NOT independently verified (no further
# spend): whether every pattern below matches every listed bypass form —
# these are prefix matches (the documented shape is "Bash(git *)"), so
# each dangerous STARTING word gets its own entry below, deliberately
# redundant rather than relying on one clever pattern.
#
# A leading `*` wildcard DOES work (VERIFIED LIVE, 2026-09-27 fix round 2,
# one more Haiku call): `--disallowedTools "Bash(*Google Chrome*)"` denied
# `echo "Google Chrome"` — a command that does not START with "Google
# Chrome", it is a quoted argument to echo — so the pattern matches
# ANYWHERE in the command line, not just as a prefix. NOT independently
# re-verified per pattern below (no further spend): the Chromium/open -a/
# sh -c/bash -c entries use the identical `Bash(...)` glob syntax, so the
# same infix-match behavior is expected to extend to them, but only the
# one form above was actually exercised against a live denial.
#
# Second finding this round: real Chrome must never be launched DIRECTLY
# either, even with the incident's actual trigger removed (render_resume.py
# now never reaches for a real browser inside this harness — see
# RENDER_RESUME_CHROME below). An agent under test could still try to open
# Chrome itself, outside render_resume.py entirely, or route a kill/pkill
# through a `sh -c`/`bash -c` wrapper — the reviewer's own probe found
# CLAUDE_KILL_GUARD_ARGS's first cut did not deny `sh -c "/usr/bin/pkill
# ..."`.
#
# BLOCKING finding, fix round 5 (independent review): the bare `Bash(*sh
# -c*)` false-positived on ORDINARY text that merely CONTAINS "sh -c" as a
# substring with no shell wrapper involved at all — e.g. `echo "refresh
# -c"` ends in "...re-sh -c..." (the tail of "refresh" plus " -c"), which
# an unanchored infix pattern cannot tell apart from an actual `sh -c`
# invocation. Replaced with patterns anchored to COMMAND POSITION: a
# plain prefix (`Bash(sh -c*)` — the command itself STARTS with "sh -c",
# never true of "echo ...") for the shell wrapper as the whole command,
# and after the three ways one command follows another on one line
# (`;`, `&&`, `|`) so `echo hi; sh -c "..."` is still caught. `Bash(/bin/
# *sh -c*)` is one pattern that covers /bin/sh, /bin/bash AND /bin/zsh at
# once (the `*` falls between "/bin/" and "sh -c", matching "" for sh,
# "ba" for bash, "z" for zsh). RE-VERIFIED LIVE (2026-09-27, one more
# Haiku call, same session): `echo "refresh -c"` is no longer denied
# (false positive fixed); `sh -c "echo hi"` alone is still denied
# (prefix form); `echo hi; sh -c "echo hi"` is denied too (after-`;` form
# — VERIFIES this row genuinely provides coverage the plain prefix
# form doesn't, not just a redundant repeat of it).
# Every run_*.sh / judge_*.sh / check_env.sh `claude -p` call gets this
# whole array spliced in right after `--setting-sources project`.
CLAUDE_KILL_GUARD_ARGS=(
  --disallowedTools
  "Bash(pkill*)" "Bash(killall*)" "Bash(kill*)" "Bash(pgrep*)"
  "Bash(/bin/pkill*)" "Bash(/bin/killall*)" "Bash(/bin/kill*)"
  "Bash(/usr/bin/pkill*)" "Bash(/usr/bin/killall*)" "Bash(/usr/bin/kill*)"
  "Bash(env kill*)" "Bash(env pkill*)" "Bash(env killall*)"
  "Bash(command kill*)" "Bash(command pkill*)" "Bash(command killall*)"
  "Bash(xargs kill*)"
  "Bash(*Google Chrome*)" "Bash(*Chromium*)" "Bash(*chromium*)"
  "Bash(*google-chrome*)" "Bash(open -a*Chrome*)" "Bash(open -a*chrome*)"
  "Bash(sh -c*)" "Bash(bash -c*)" "Bash(zsh -c*)" "Bash(/bin/*sh -c*)"
  "Bash(*; sh -c*)" "Bash(*; bash -c*)" "Bash(*; zsh -c*)"
  "Bash(*&& sh -c*)" "Bash(*&& bash -c*)" "Bash(*&& zsh -c*)"
  "Bash(*| sh -c*)" "Bash(*| bash -c*)" "Bash(*| zsh -c*)"
)

# --- Clean environment (2026-09-26; widened 2026-09-27) --------------------
# A trial found that ambient CLAUDE_CODE_* vars from the CALLING desktop
# session (CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_TERMINAL_MCP_TOOLS, etc.)
# leak into every `claude -p` the runner starts and change what tools/mode
# the agent under test gets — a condition's behaviour must come from what
# that condition provides and nothing else (README, "the environment
# contract"). Review found the first cut too narrow: a live session also
# carries CLAUDE_EFFORT, CLAUDE_PID, CLAUDE_AGENT_SDK_VERSION,
# CLAUDE_PREVIEW_CLASSIFIER_FLOOR, and the bare CLAUDECODE (no underscore)
# — none of those match `^CLAUDE_CODE_`. The rule is now: every env var
# whose name starts with CLAUDE, scrubbed, no exceptions carved out by
# name — except what THIS harness itself sets, which happens AFTER this
# scrub runs, inline on the one `claude` invocation that needs it
# (run_t19.sh sets CLAUDE_CODE_OAUTH_TOKEN right on the command itself,
# same as it always has — assigning it there re-adds just that one var to
# just that one command, later than this loop).
for _v in $(env | grep -oE '^CLAUDE[A-Za-z0-9_]*' 2>/dev/null || true); do
  unset "$_v"
done
unset _v

# --- HOME sandbox for every runner (fix round 4) ---------------------------
# Re-test finding: an agent under test ran `find / -maxdepth 6 -iname coach`,
# then read and EXECUTED the owner's deployed
# ~/.claude/skills/coach/scripts/check_closeout.py — the run drew on the
# owner's installed skills, not the build under test (the environment
# contract's own rule 1), and it browsed the owner's real home. Only
# run_t19.sh sandboxed HOME before this; every other runner ran with the
# REAL $HOME, --dangerously-skip-permissions, and nothing stopping an agent
# from wandering into it.
#
# run_t19.sh's own sandbox was itself too broad: `cp -R "$HOME/.claude"
# "$FAKEHOME/.claude"` copies the owner's ENTIRE `.claude/` — skills/,
# history.jsonl, sessions/, session-env/, projects/ (removed after the
# fact, but skills/ and history/ were not) — into the fake home, so the
# agent finds the SAME deployed skills there, sandbox or not. VERIFIED LIVE
# (2026-09-27, one Haiku call): a minimal fake home — the top-level
# `.claude.json` copied in, plus an EMPTY `.claude/` dir, nothing else —
# still authenticates and runs a real turn successfully. Credentials never
# touch the fake home's filesystem at all: the owner's setup-token lands in
# `~/.claude/harness-token` (chmod 600, never in the repo or a log) and is
# read into `$HTOK` here, then handed to the sandboxed CLI as the
# CLAUDE_CODE_OAUTH_TOKEN environment variable on the invocation itself —
# a value that never gets written to disk under the fake home, so a failed
# auth there has nothing to write back into the real keychain (the
# 2026-08-18 incident a symlinked home caused). No keychain access of any
# kind is needed for this path.
#
# RESIDUAL RISK, stated plainly (2026-09-27, same live probe): HOME
# sandboxing stops `~`-relative reaches and stops the owner's deployed
# skills from being copied in — it does NOT stop an ABSOLUTE-PATH read.
# The same probe asked the sandboxed agent to `ls "/Users/<owner>/job-search"`
# by its literal path (never `~`) and it printed the real directory
# listing — Unix file permissions are per OWNING USER, not per $HOME, and
# the owner's ruling is that harness runs use the owner's own account (no
# separate OS user). vault_lock (above) already makes ~/job-search's files
# immutable for the run, so a WRITE through an absolute path fails at the
# OS level regardless of HOME — but a READ still succeeds. Closing that
# needs real process isolation (a separate OS user or a cloud sandbox),
# the same conclusion the kill-guard's own residual (CLAUDE_KILL_GUARD_ARGS
# above) already reached; it is not this fix's scope.
#
# Stage a neutral, comment-free COPY of fixtures/fake-chrome inside the
# sandbox HOME given as $1, and point RENDER_RESUME_CHROME at it (fix round,
# 2026-09-27 — see the "No real browser" comment above for the finding).
# tests/always-on/stage_fake_chrome.py does the actual stripping (ast to
# locate and blank the module docstring, tokenize to drop every comment
# except a line-1 shebang) — the LOGIC is untouched, byte for byte; only
# the repo fixture's own full documentation is gone from this copy. Must
# run AFTER $1 already exists (every caller below is sandbox_home_setup,
# right after it creates $FAKEHOME) so the copy lands inside the sandbox,
# never the real fixtures/ dir — and stages a FRESH copy per call, so
# concurrent trials (each with their own $FAKEHOME) never share one.
stage_fake_chrome() {
  local dst_dir="$1/.local/bin"
  mkdir -p "$dst_dir"
  python3 "$ROOT/stage_fake_chrome.py" "$ROOT/fixtures/fake-chrome" "$dst_dir/chrome-headless"
  export RENDER_RESUME_CHROME="$dst_dir/chrome-headless"
}

# Call once per trial/condition — concurrent trials must not share one
# fake home. Sets $FAKEHOME and $HTOK for the caller to splice onto its
# own `claude -p` line (`HOME="$FAKEHOME" USER=candidate LOGNAME=candidate
# CLAUDE_CODE_OAUTH_TOKEN="$HTOK" claude -p ...`, same as run_t19.sh
# already did); call sandbox_home_cleanup when the trial is done.
sandbox_home_setup() {
  FAKEHOME="$(mktemp -d)"
  [ -f "$HOME/.claude.json" ] && cp "$HOME/.claude.json" "$FAKEHOME/.claude.json" 2>/dev/null
  mkdir -p "$FAKEHOME/.claude"
  HTOK=""
  [ -f "$HOME/.claude/harness-token" ] && HTOK="$(cat "$HOME/.claude/harness-token")"
  stage_fake_chrome "$FAKEHOME"
}
sandbox_home_cleanup() { [ -n "${FAKEHOME:-}" ] && rm -rf "$FAKEHOME" 2>/dev/null; }

# --- Vault lock, reference-counted, keyed by VAULT (2026-09-26; fixed 2026-09-27) ---
# The founder's real ~/job-search is locked immutable (chflags uchg) for
# the whole duration ANY run needs it untouched. Every run_*.sh used to
# carry its own private vault_lock/vault_unlock pair and its own
# `trap vault_unlock EXIT` — so two SIBLING runners (two run_*.sh processes
# alive at once, e.g. two suites launched in parallel terminals) raced: the
# first one to exit unlocked the vault while the second was still relying
# on it staying locked. First fix (2026-09-26) made lock/unlock reference-
# counted, but kept the refcount under THIS CHECKOUT's own results/ dir —
# independent review (0b748cb, probe_guards.sh) found that a SECOND
# checkout (a different git worktree, same real vault) computes a
# DIFFERENT results/ path and so keeps its OWN, unrelated refcount: one
# checkout's runner can still unlock the vault while a runner in the OTHER
# checkout is relying on it staying locked. Fixed by keying the lock and
# the holder list off the VAULT's own resolved path (a hash of it), stored
# in a FIXED location outside every checkout (never inside the vault
# itself — that is the candidate's real workspace, never a place for our
# bookkeeping) — so every checkout on the machine agrees on where the
# bookkeeping lives, however many of them there are.
REALJS="${REALJS:-$HOME/job-search}"

_vault_key() {
  local real
  real="$(cd "$REALJS" 2>/dev/null && pwd -P)" || real="$REALJS"
  printf '%s' "$real" | shasum -a 256 | cut -c1-16
}
# NOT under $TMPDIR (fix round 3, reviewer's probe): a per-user macOS
# TMPDIR is process-environment-scoped, so the owner's own terminal and a
# sandboxed session can each see a DIFFERENT TMPDIR even for the SAME real
# user — probe_guards.sh's own "two runners, different TMPDIRs" check
# showed the vault going unprotected under exactly that split. $HOME does
# not have that problem: REALJS itself defaults to "$HOME/job-search", so
# anyone who can even SEE the same vault by default already shares the
# same $HOME — the lock's bookkeeping just rides alongside it, under the
# ordinary ~/.cache convention (never inside the vault directory itself,
# which is the candidate's real workspace, never a place for our
# bookkeeping).
_VAULT_STATE_DIR="${HOME:-/tmp}/.cache/.careercoach-vault-$(_vault_key)"
_VAULT_LOCKDIR="$_VAULT_STATE_DIR/mutex"
_VAULT_HOLDERS="$_VAULT_STATE_DIR/holders"
_VAULT_HELD=0
# $$ is unreliable as a holder id: inside a `( ... )` subshell, bash's $$
# still reports the TOP-LEVEL script's pid, not the subshell's own real
# one — two DIFFERENT concurrent subshells (exactly how this file's own
# vault-lock tests simulate two sibling runners) then collide on the SAME
# "$$" and corrupt each other's holder rows (found live: a 2-holder race
# test showed the second holder's release deleting BOTH rows at once,
# unlocking the vault out from under the first). `sh -c 'echo $PPID'`
# reports the ACTUAL calling (sub)shell's own real OS pid — portable, and
# correct on bash 3.2 too (no $BASHPID there) — but only written to a FILE
# by that plain command, then read back with a separate, ordinary
# `$(cat ...)`: wrapping the `sh -c` call itself in `$(...)` was tried
# first and found to sometimes report an already-dead transient pid
# instead (an extra fork bash takes for THAT construct specifically, in
# this sourced context, on this bash — reproduced live, not theoretical).
# Computed once per sourcing, so it is stable across every vault_lock/
# vault_unlock call this same process makes.
_vault_pid_tmp="$(mktemp 2>/dev/null || echo "/tmp/.vault-pid-$$-$RANDOM")"
sh -c 'echo $PPID' > "$_vault_pid_tmp" 2>/dev/null
_VAULT_MY_PID="$(cat "$_vault_pid_tmp" 2>/dev/null)"
rm -f "$_vault_pid_tmp"
unset _vault_pid_tmp

# The mutex around read-modify-write of $_VAULT_HOLDERS. A plain `mkdir` is
# atomic on any POSIX filesystem and portable (no `flock(1)` on macOS). The
# creator's own PID is recorded inside it so a mutex abandoned by a process
# that crashed INSIDE the critical section (between mkdir and rmdir) can be
# told apart from one a live holder still has: reviewer's finding — "a
# stale lock dir doesn't silently proceed unprotected" — so a dead
# creator's mutex is recovered and retried immediately, and a LIVE
# creator's mutex is waited out for as long as it takes, never bypassed on
# a timeout.
_vault_mutex_acquire() {
  mkdir -p "$_VAULT_STATE_DIR" 2>/dev/null
  local tries=0 holder_pid
  while ! mkdir "$_VAULT_LOCKDIR" 2>/dev/null; do
    holder_pid="$(cat "$_VAULT_LOCKDIR/pid" 2>/dev/null || echo "")"
    if [ -n "$holder_pid" ] && ! kill -0 "$holder_pid" 2>/dev/null; then
      rm -rf "$_VAULT_LOCKDIR" 2>/dev/null
      continue
    fi
    tries=$((tries + 1))
    if [ "$tries" -eq 200 ]; then
      echo "WARN: vault mutex ($_VAULT_LOCKDIR) held over ~20s by live pid ${holder_pid:-?} — still waiting (never proceeding unprotected)." >&2
    fi
    sleep 0.1
  done
  echo "$_VAULT_MY_PID" > "$_VAULT_LOCKDIR/pid" 2>/dev/null
}
_vault_mutex_release() { rm -rf "$_VAULT_LOCKDIR" 2>/dev/null; }

# Drops any holder PID that is no longer alive. Called with the mutex
# already held. Reviewer's stale-refcount finding: a holder killed with
# SIGKILL never reaches its own vault_unlock, so a plain integer count
# stays stuck above 0 forever — the vault then gets unlocked by hand (the
# only way to recover it) and the NEXT runner holds it with the vault
# UNPROTECTED, trusting a count that no longer describes anyone real.
# Pruning by LIVENESS, not by trusting the number, means the very next
# vault_lock or vault_unlock call self-heals: no live holders left means
# no one is actually relying on the lock, whatever a stale count said.
_vault_prune_holders() {
  [ -f "$_VAULT_HOLDERS" ] || return 0
  local pid live=""
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null && live="$live$pid
"
  done < "$_VAULT_HOLDERS"
  printf '%s' "$live" > "$_VAULT_HOLDERS"
}

# Call once, right after checking $REALJS exists (or unconditionally — both
# are no-ops when it doesn't). Registers this process (its real pid, see
# $_VAULT_MY_PID above) as a holder; only the call that finds NO live
# holder actually flips the immutable flag — so this is correct whether
# the "previous" state came from a sibling process in this checkout, a
# sibling in a DIFFERENT checkout, or a stale/dead holder being pruned.
vault_lock() {
  [ -d "$REALJS" ] || return 0
  _vault_mutex_acquire
  _vault_prune_holders
  if [ ! -s "$_VAULT_HOLDERS" ]; then
    # BLOCKING finding (independent review): `-type f` only marked FILES
    # immutable — on macOS, chflags uchg on a DIRECTORY (VERIFIED live:
    # create/delete/rename all refused after) is what stops a session
    # from adding a new top-level file, a file in a subdirectory, or a
    # new directory entirely, none of which touch an EXISTING file's own
    # flag. `-depth` visits a directory's own CONTENTS before the
    # directory itself (deepest-first) — locks the vault root LAST, after
    # everything under it, so the walk is never blocked by a directory
    # it just locked.
    find "$REALJS" -depth -not -path '*/.damaged*' -exec chflags uchg {} + 2>/dev/null
  fi
  echo "$_VAULT_MY_PID" >> "$_VAULT_HOLDERS"
  _VAULT_HELD=1
  _vault_mutex_release
}
# Safe to call from a trap even if vault_lock was never reached (e.g. an
# early exit) — a holder that never actually registered (_VAULT_HELD=0)
# removes nothing, so it can never unlock on someone else's behalf.
vault_unlock() {
  [ -d "$REALJS" ] || return 0
  [ "$_VAULT_HELD" = 1 ] || return 0
  _vault_mutex_acquire
  if [ -f "$_VAULT_HOLDERS" ]; then
    grep -v -x "$_VAULT_MY_PID" "$_VAULT_HOLDERS" > "$_VAULT_HOLDERS.tmp" 2>/dev/null
    mv "$_VAULT_HOLDERS.tmp" "$_VAULT_HOLDERS" 2>/dev/null
  fi
  _vault_prune_holders
  if [ ! -s "$_VAULT_HOLDERS" ]; then
    # Reverse of the lock: no `-depth`, so this is PRE-order — the vault
    # root is unlocked FIRST, then the walk descends. The lock took the
    # root last (after everything under it); the unlock takes it first.
    find "$REALJS" -flags +uchg -exec chflags nouchg {} + 2>/dev/null
    # $_VAULT_STATE_DIR itself is left in place (just an empty holders
    # file) rather than rm -rf'd here — removing the whole state dir while
    # a concurrent vault_lock's _vault_mutex_acquire is mid-retry would
    # delete the very parent directory its `mkdir` needs, which only
    # re-creates that parent at the START of _vault_mutex_acquire, not on
    # every retry. Callers that want it gone (tests) remove it themselves.
  fi
  _VAULT_HELD=0
  _vault_mutex_release
}

_KNOWN_MODEL_ALIASES="opus sonnet haiku fable"
# A dated model id ends in -20YYMMDD (e.g. -20250514). This is what actually
# pins a judge/runner against drift — a bare version number is not enough.
_lib_env_is_dated() { printf '%s' "$1" | grep -qE -- '-20[0-9]{6}$'; }

# $1 = var name (for messages), $2 = value, $3 = escape var name,
# $4 = escape value ("1" allows undated). Exits 2 on a bad value.
_lib_env_check_model() {
  local name="$1" val="$2" escname="$3" escval="$4" a
  [ -n "$val" ] || return 0   # emptiness handled by the caller (JUDGE_MODEL's requiredness)
  for a in $_KNOWN_MODEL_ALIASES; do
    if [ "$(printf '%s' "$val" | tr 'A-Z' 'a-z')" = "$a" ]; then
      echo "$name=$val is a bare alias, not a pinned id." >&2
      echo "Aliases float (their target model can change); a B1 measurement needs" >&2
      echo "a fixed model. Use an explicit, DATED model id, or set $escname=1 to" >&2
      echo "explicitly allow an undated one (recorded in the results)." >&2
      echo "(see tests/always-on/README.md, 'Pinned models')." >&2
      exit 2
    fi
  done
  _lib_env_is_dated "$val" && return 0
  [ "$escval" = "1" ] && return 0
  echo "$name=$val is not a DATED model id (expected a ...-20YYMMDD suffix)." >&2
  echo "Set $escname=1 to explicitly allow an undated id (recorded in the results)." >&2
  echo "(see tests/always-on/README.md, 'Pinned models')." >&2
  exit 2
}

# The owner-named default. Spelling this out explicitly must be treated
# EXACTLY like leaving RUNNER_MODEL/SIM_MODEL unset — both get the escape
# set FOR you and recorded as undated_ok=1. Any OTHER undated id still needs
# the caller's own explicit *_UNDATED_OK=1.
_LIB_ENV_OWNER_DEFAULT_MODEL="claude-sonnet-5"

# Caller is a judge script (judge_*.sh) if true. Judges don't use
# RUNNER_MODEL/MODEL at all (they only ever pass $JUDGE_MODEL to `claude`),
# so they must not be forced through its dated-or-escape validation.
_lib_env_caller_is_judge() {
  case "$(basename "${0:-}")" in
    judge_*) return 0 ;;
    *) return 1 ;;
  esac
}

RUNNER_MODEL="${RUNNER_MODEL:-${MODEL:-}}"
if [ -z "$RUNNER_MODEL" ]; then
  RUNNER_MODEL="$_LIB_ENV_OWNER_DEFAULT_MODEL"
fi
if [ "$RUNNER_MODEL" = "$_LIB_ENV_OWNER_DEFAULT_MODEL" ]; then
  # unset OR explicitly spelled-out default -> escape set FOR you either way
  RUNNER_MODEL_UNDATED_OK="${RUNNER_MODEL_UNDATED_OK:-1}"
fi
RUNNER_MODEL_UNDATED_OK="${RUNNER_MODEL_UNDATED_OK:-0}"
if ! _lib_env_caller_is_judge; then
  _lib_env_check_model RUNNER_MODEL "$RUNNER_MODEL" RUNNER_MODEL_UNDATED_OK "$RUNNER_MODEL_UNDATED_OK"
fi
MODEL="$RUNNER_MODEL"   # back-compat: every existing script reads $MODEL

RUNNER_SKILLS_DIR="${RUNNER_SKILLS_DIR:-$REPO/skills}"

_lib_env_require_judge_model() {
  if [ -z "${JUDGE_MODEL:-}" ]; then
    echo "JUDGE_MODEL is not set." >&2
    echo "It must be an explicit, DATED Opus model id — not the 'opus' alias" >&2
    echo "(see tests/always-on/README.md, 'Pinned models', for how to find one)." >&2
    echo "Example: JUDGE_MODEL=<dated-opus-id> $0 <tag>" >&2
    exit 2
  fi
  JUDGE_MODEL_UNDATED_OK="${JUDGE_MODEL_UNDATED_OK:-0}"
  _lib_env_check_model JUDGE_MODEL "$JUDGE_MODEL" JUDGE_MODEL_UNDATED_OK "$JUDGE_MODEL_UNDATED_OK"
}

git_commit() { git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo nogit; }

# "1" if skills/ differs from HEAD (staged, unstaged, or untracked files
# under skills/), "0" if clean, "unknown" outside a git repo.
skills_dirty() {
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo unknown; return; }
  if [ -n "$(git -C "$REPO" status --porcelain -- skills 2>/dev/null)" ]; then
    echo 1
  else
    echo 0
  fi
}

# A content hash of the REAL $REPO/skills tree (never RUNNER_SKILLS_DIR) —
# identifies a snapshot by what it actually contains, not just the commit
# it was taken at, since a dirty tree can change between two invocations at
# the same commit. Two fixes baked in:
#  - hashed as paths RELATIVE to skills/ (cd into it first), so the hash
#    does not depend on where the repo checkout lives on disk;
#  - __pycache__/, *.pyc, and .DS_Store are excluded — build/OS litter that
#    carries no skill content and must not perturb the hash or the snapshot.
_skills_hashable_files() {
  ( cd "$REPO/skills" 2>/dev/null && \
    find . -type f \
      ! -path '*/__pycache__/*' \
      ! -name '*.pyc' \
      ! -name '.DS_Store' \
      -print0 | sort -z )
}
skills_content_hash() {
  _skills_hashable_files \
    | ( cd "$REPO/skills" 2>/dev/null && xargs -0 shasum -a 256 ) 2>/dev/null \
    | shasum -a 256 | awk '{print $1}' | cut -c1-12
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The RECORD lines only (readers must never `tail -1` a raw info file — a
# per-runner extra field or a future stray line must not be mistaken for
# the last record). Empty output if the file doesn't exist yet.
last_record() { [ -f "$1" ] && grep '^ts=' "$1" | tail -1; }

_field() { # $1 = record line, $2 = field name -> value or ""
  printf '%s\n' "$1" | grep -oE "$2=[^ ]*" | tail -1 | cut -d= -f2-
}

# Runner side. Call once, early, right after $RESULTS is known and before
# any `claude` call. The SNAPSHOT is write-once per (commit, content hash);
# the run-info.txt RECORD is appended every invocation, always as ONE line
# starting with `ts=`.
#   $1 = results dir
#   $2 = optional EXTRA fields to fold into the same record line (e.g.
#        t19's "sim_model=... sim_model_undated_ok=..."). Never write a
#        second line for per-runner extras — see the file-header note.
snapshot_and_record_run_info() {
  local results="$1" extra="${2:-}"
  local commit dirty hash snap prev
  commit="$(git_commit)"
  dirty="$(skills_dirty)"
  hash="$(skills_content_hash)"
  snap="$results/_skills-snapshot-$commit-$hash"
  if [ ! -d "$snap" ]; then
    mkdir -p "$snap"
    cp -r "$REPO/skills/." "$snap/"
    find "$snap" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null
    find "$snap" -name '*.pyc' -delete 2>/dev/null
    find "$snap" -name '.DS_Store' -delete 2>/dev/null
  fi
  if [ "$dirty" = "1" ]; then
    echo "WARN: skills/ has uncommitted changes (commit=$commit, content_hash=$hash)" >&2
    echo "      — the 'unablated' judge baseline just snapshotted INCLUDES them." >&2
    echo "      Commit first if the baseline should be the last committed text." >&2
  fi
  JUDGE_SKILLS_DIR="${JUDGE_SKILLS_DIR:-$snap}"

  prev="$(last_record "$results/run-info.txt")"
  if [ -n "$prev" ]; then
    local prev_model prev_dir prev_hash prev_judge_dir
    prev_model="$(_field "$prev" runner_model)"
    prev_dir="$(_field "$prev" runner_skills_dir)"
    prev_hash="$(_field "$prev" skills_hash)"
    # the OLD snapshot's REAL path: read from the previous record's own
    # judge_skills_dir field, never rebuilt from THIS invocation's commit —
    # a rebuilt path silently gives the wrong path across a commit change.
    prev_judge_dir="$(_field "$prev" judge_skills_dir)"
    if [ "$prev_model" != "$RUNNER_MODEL" ] || [ "$prev_dir" != "$RUNNER_SKILLS_DIR" ]; then
      echo "WARN: $results is a REUSED tag whose runner config just changed:" >&2
      echo "      was runner_model=$prev_model runner_skills_dir=$prev_dir" >&2
      echo "      now  runner_model=$RUNNER_MODEL runner_skills_dir=$RUNNER_SKILLS_DIR" >&2
      echo "      Existing case results in this tag came from the OLD config." >&2
    fi
    if [ "$prev_hash" != "$hash" ]; then
      echo "WARN: $results is a REUSED tag whose skills content just changed" >&2
      echo "      (was skills_hash=$prev_hash, now skills_hash=$hash) — a NEW snapshot" >&2
      echo "      was taken at $snap." >&2
      echo "      The OLD snapshot earlier trials in this tag were judged against is" >&2
      echo "      ${prev_judge_dir:-<unknown: no judge_skills_dir on the previous record>}." >&2
      echo "      From here on, a judge run against $results grades ALL trials in the" >&2
      echo "      tag — including the earlier ones — against the NEW snapshot, not the" >&2
      echo "      one they actually ran under. Pick a fresh tag for a clean measurement." >&2
    fi
    # Any OTHER extra field (e.g. t19's sim_model) that differs from the
    # previous record's own value WARNs the same way the fields above do —
    # a reused tag mixing two simulator models is just as mixed a config.
    if [ -n "$extra" ]; then
      local kv k v pv
      for kv in $extra; do
        k="${kv%%=*}" v="${kv#*=}"
        pv="$(_field "$prev" "$k")"
        if [ -n "$pv" ] && [ "$pv" != "$v" ]; then
          echo "WARN: $results is a REUSED tag whose $k just changed:" >&2
          echo "      was $k=$pv" >&2
          echo "      now  $k=$v" >&2
          echo "      Existing case results in this tag came from the OLD config." >&2
        fi
      done
    fi
  fi
  printf 'ts=%s commit=%s dirty=%s skills_hash=%s runner_model=%s runner_model_undated_ok=%s runner_skills_dir=%s judge_skills_dir=%s%s\n' \
    "$(now)" "$commit" "$dirty" "$hash" "$RUNNER_MODEL" "$RUNNER_MODEL_UNDATED_OK" "$RUNNER_SKILLS_DIR" "$JUDGE_SKILLS_DIR" \
    "${extra:+ $extra}" \
    >> "$results/run-info.txt"
}

# The most recent RECORDED runner_skills_dir for a tag (what the runner
# actually shipped), falling back to this invocation's own RUNNER_SKILLS_DIR
# default only when no record exists yet.
recorded_runner_skills_dir() {
  local results="$1" prev
  prev="$(last_record "$results/run-info.txt")"
  if [ -n "$prev" ]; then
    local d; d="$(_field "$prev" runner_skills_dir)"
    [ -n "$d" ] && { echo "$d"; return; }
  fi
  echo "$RUNNER_SKILLS_DIR (no run-info.txt record yet — this is only this invocation's own default)"
}

# Judge side. Call once, early, right after $RESULTS is known and before
# any `claude` call. Resolves JUDGE_SKILLS_DIR (explicit env wins, then the
# run's run-info.txt RECORD, then — only for results dirs made before this
# fix — the live $REPO/skills, loudly flagged) and appends ONE judge-info.txt
# record.
resolve_and_record_judge_info() {
  local results="$1"
  _lib_env_require_judge_model   # fail before touching the filesystem
  mkdir -p "$results"
  if [ -z "${JUDGE_SKILLS_DIR:-}" ]; then
    local prev; prev="$(last_record "$results/run-info.txt")"
    if [ -n "$prev" ]; then
      local d; d="$(_field "$prev" judge_skills_dir)"
      [ -n "$d" ] && [ -d "$d" ] && JUDGE_SKILLS_DIR="$d"
    fi
  fi
  if [ -z "${JUDGE_SKILLS_DIR:-}" ]; then
    echo "WARN: no skills snapshot recorded for $results — grading against" >&2
    echo "LIVE $REPO/skills (pre-fix behaviour). Re-run the runner to get a" >&2
    echo "frozen snapshot, or set JUDGE_SKILLS_DIR explicitly." >&2
    JUDGE_SKILLS_DIR="$REPO/skills"
  fi

  local prevj; prevj="$(last_record "$results/judge-info.txt")"
  if [ -n "$prevj" ]; then
    local prev_model prev_dir
    prev_model="$(_field "$prevj" judge_model)"
    prev_dir="$(_field "$prevj" judge_skills_dir)"
    if [ "$prev_model" != "$JUDGE_MODEL" ] || [ "$prev_dir" != "$JUDGE_SKILLS_DIR" ]; then
      echo "WARN: $results is a REUSED tag whose judge config just changed:" >&2
      echo "      was judge_model=$prev_model judge_skills_dir=$prev_dir" >&2
      echo "      now  judge_model=$JUDGE_MODEL judge_skills_dir=$JUDGE_SKILLS_DIR" >&2
      echo "      Existing verdicts in this tag came from the OLD config." >&2
    fi
  fi
  printf 'ts=%s judge_model=%s judge_model_undated_ok=%s judge_skills_dir=%s\n' \
    "$(now)" "$JUDGE_MODEL" "${JUDGE_MODEL_UNDATED_OK:-0}" "$JUDGE_SKILLS_DIR" >> "$results/judge-info.txt"
}

# Best-effort: record the model the Claude CLI's stream-json output actually
# SERVED, next to each result — a served id can differ from what was
# requested (fallback, alias resolution). The SERVED model is read from
# `message.model` on "type":"assistant" lines (the last one, so a mid-stream
# fallback wins over an earlier value) — that is what the API actually
# returned content from. If no assistant line carries a model (e.g. an
# errored/empty stream), falls back to the init line's `model` field,
# labelled `configured:` so it is never presented as served. UNTESTED
# against a real API response in this fix (no spend) — implemented
# defensively: any parse miss (bad JSON, missing field, python3 crash)
# writes UNKNOWN rather than failing the run, and this is safe to call
# under `set -euo pipefail` (no unguarded pipeline; the python3 call's exit
# status is caught explicitly, not left to propagate).
#   $1 = prefix for this case's *.stream.json files, e.g. "$out" matches
#        "$out.stream.json" and "$out.turnN.stream.json" — NOT a longer
#        sibling tag's files (a bare "$prefix"*.stream.json glob would also
#        match "${prefix}0.stream.json", so e.g. prefix ".../a-t1" would
#        wrongly sweep up ".../a-t10.stream.json"; the separating "." is
#        required between the prefix and whatever follows).
# Judge scripts do NOT call this: they invoke `claude -p` with the default
# text output (their prompt asks the model to print a bare JSON verdict,
# captured as-is), not --output-format json/stream-json, so no CLI-level
# `model` field is present to extract without changing that capture shape
# — out of scope for this fix.
record_served_models() {
  local prefix="$1" f out dest
  dest="${prefix}.served-model.txt"
  : > "$dest"
  for f in "$prefix.stream.json" "$prefix".*.stream.json; do
    [ -f "$f" ] || continue
    out="$(python3 -c '
import json, sys
model = None
configured = None
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        continue
    if not isinstance(ev, dict):
        continue
    t = ev.get("type")
    if t == "assistant":
        m = (ev.get("message") or {}).get("model")
        if m:
            model = m   # last assistant line wins
    elif t == "system" and configured is None:
        m = ev.get("model")
        if m:
            configured = m
if model:
    print("served:" + model)
elif configured:
    print("configured:" + configured)
else:
    print("UNKNOWN")
' "$f" 2>/dev/null)" || out="UNKNOWN"
    printf '%s: %s\n' "$(basename "$f")" "${out:-UNKNOWN}" >> "$dest"
  done
}

# DRY_RUN=1 support (A3): print resolved config and exit before any `claude`
# call. role = runner|judge. Every judge script calls
# resolve_and_record_judge_info BEFORE this (which already validates
# JUDGE_MODEL and fails, before touching the filesystem, if it's bad) — this
# does NOT call it again, so a dry run appends exactly ONE record, same as a
# real run. It only reports what that call already resolved.
maybe_dry_run() {
  local role="$1" results="$2"
  [ -n "${DRY_RUN:-}" ] || return 1
  echo "== $role dry run =="
  echo "commit=$(git_commit)"
  echo "dirty=$(skills_dirty)"
  echo "runner_model=$RUNNER_MODEL (undated_ok=$RUNNER_MODEL_UNDATED_OK)"
  if [ "$role" = judge ]; then
    echo "judge_model=$JUDGE_MODEL (undated_ok=${JUDGE_MODEL_UNDATED_OK:-0})"
    echo "runner_skills_dir=$(recorded_runner_skills_dir "$results")"
    echo "judge_skills_dir=${JUDGE_SKILLS_DIR:-<unresolved: call resolve_and_record_judge_info first>}"
  else
    echo "runner_skills_dir=$RUNNER_SKILLS_DIR"
    local hash; hash="$(skills_content_hash)"
    echo "judge_skills_dir=(snapshot target) $results/_skills-snapshot-$(git_commit)-$hash"
  fi
  echo "results=$results"
  echo "== end dry run (no model calls made) =="
  return 0
}

# --- Shared judge preamble (docs/evals/b1-case-audit.md) -------------------
# Before this fix, 10 of 12 judge_*.sh scripts labelled the frozen skill
# text they show a judge as the text "the agent operates under" (some going
# further: "its contract binds every reply", "loaded by tailoring's first
# moment rule"). That's false for an ablated/lean arm, which never saw that
# text, and it invites the judge to fail the agent for skipping a step,
# read, phrase, or section order the CURRENT text prescribes — even where
# the case's own MUST/MUST NOT bullets don't ask for it. ONE shared copy so
# the framing can't drift out of sync across scripts: every judge_*.sh
# sources this file (via lib_env.sh, already required) and calls these two
# functions instead of writing its own wording. Edit the text here, never
# in an individual judge script.
judge_reference_note() {
  cat <<'EOF'
Reference only — the product's baseline skill text, frozen. The agent under
test may have run under a DIFFERENT, shorter text. Use this only to look up
what a term, file shape, script, or status value in the Expectations means.
It is not a checklist: never fail the agent for skipping a step, a read, a
phrase, a section name, or an order this text prescribes, unless an
Expectations bullet requires the result.
EOF
}

# Pins the judge to the case's own MUST/MUST NOT bullets — it must not
# invent additional criteria from the skill text above (finding 7: 11 of 12
# judges left the criteria list to the judge's own discretion, and a single
# invented failure fails the whole case).
judge_criteria_pin() {
  echo "\"criteria\" must have exactly one entry per MUST / MUST NOT bullet"
  echo "in Expectations, in order — add no criteria beyond them, and add"
  echo "none sourced from the reference skill text above."
}
