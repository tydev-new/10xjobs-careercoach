#!/bin/bash
# Reviewer's probe for 69f35ae's safety guards — the OPEN gaps, one line
# each, OPEN or CLOSED. Exits 1 while any is open, 0 when all are closed.
# Zero spend, no model calls. Kept out of tests/run.py on purpose: every
# check here fails today, and run.py must stay green for everyone.
#
# Safety: every kill below targets a dummy sleeper this script started
# (a symlink to /bin/sleep under a unique name, in a temp dir). No real
# app is ever named. Vault checks use a throwaway temp "vault", never
# ~/job-search.
#
#   ./probe_guards.sh
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
T="$(mktemp -d)"
open=0
say() { printf '  %-6s %s\n' "$1" "$2"; [ "$1" = OPEN ] && open=1; }
cleanup() { /usr/bin/pkill -f "$T/zz" 2>/dev/null; chflags -R nouchg "$T" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

dummy() {  # start a sleeper named $1, echo nothing
  ln -sf /bin/sleep "$T/$1"
  (nohup "$T/$1" 300 >/dev/null 2>&1 &)
  sleep 0.3
}
alive() { pgrep -f "$T/$1" >/dev/null; }

# Run a command in a shell that sourced lib_env.sh the way run_*.sh does.
harness() {
  REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; $1" >/dev/null 2>&1
}

echo "== kill guard: name-based kills that bypass guard-bin (PATH shims) =="
dummy zzA; harness "/usr/bin/pkill -f zzA"
alive zzA && say CLOSED "absolute-path /usr/bin/pkill -f <name>" || say OPEN "absolute-path /usr/bin/pkill -f <name> reached a real process"
dummy zzB; harness "/usr/bin/killall zzB"
alive zzB && say CLOSED "absolute-path /usr/bin/killall <name>" || say OPEN "absolute-path /usr/bin/killall <name> reached a real process"
dummy zzC; harness 'kill $(pgrep -f zzC)'
alive zzC && say CLOSED 'kill $(pgrep -f <name>)' || say OPEN 'kill $(pgrep -f <name>) reached a real process (numeric kill of a name lookup)'
dummy zzD; harness 'pgrep -f zzD | xargs kill'
alive zzD && say CLOSED 'pgrep -f <name> | xargs kill' || say OPEN 'pgrep -f <name> | xargs kill reached a real process'

echo "== vault lock =="
# Two checkouts (worktrees) = two $ROOT/results refcounts, one real vault.
mkdir -p "$T/v1" "$T/wtA" "$T/wtB"; echo x > "$T/v1/f.md"
( export REALJS="$T/v1" _VAULT_LOCKDIR="$T/wtA/lock" _VAULT_COUNT="$T/wtA/count"
  source "$ROOT/lib_env.sh"; vault_lock; sleep 2
  ls -lO "$T/v1/f.md" | grep -q uchg && echo held > "$T/xa" || echo lapsed > "$T/xa"; vault_unlock ) &
sleep 0.4
( export REALJS="$T/v1" _VAULT_LOCKDIR="$T/wtB/lock" _VAULT_COUNT="$T/wtB/count"
  source "$ROOT/lib_env.sh"; vault_lock; sleep 0.3; vault_unlock )
wait
[ "$(cat "$T/xa")" = held ] && say CLOSED "vault stays locked for a runner in another checkout" \
  || say OPEN "vault UNLOCKED under a live runner when a runner in a different checkout (worktree) exited — refcount lives under each checkout's own results/"
# Stale count: a holder killed with SIGKILL leaves count=1; vault later
# unlocked by hand; the next runner then runs with the vault unlocked.
mkdir -p "$T/v2" "$T/st"; echo x > "$T/v2/f.md"
export REALJS="$T/v2" _VAULT_LOCKDIR="$T/st/lock" _VAULT_COUNT="$T/st/count"
bash -c "ROOT='$ROOT' REPO='$REPO'; source '$ROOT/lib_env.sh'; vault_lock; kill -9 \$\$" 2>/dev/null
chflags nouchg "$T/v2/f.md"
bash -c "ROOT='$ROOT' REPO='$REPO'; source '$ROOT/lib_env.sh'; vault_lock; ls -lO '$T/v2/f.md' | grep -q uchg && echo held > '$T/xs' || echo lapsed > '$T/xs'; vault_unlock"
unset REALJS _VAULT_LOCKDIR _VAULT_COUNT
[ "$(cat "$T/xs")" = held ] && say CLOSED "a stale refcount never leaves a new runner unprotected" \
  || say OPEN "stale refcount (holder SIGKILLed, vault unlocked by hand): the next runner holds with the vault UNLOCKED"

echo "== render_resume.py never launches a real browser in this harness =="
# Owner ruling 2026-09-26 (replacing the test-user isolation plan this whole
# file was originally written to demand): a harness run should have no REAL
# Chrome to hang in the first place. This does not remove the checks below
# (render_resume.py's own timeout/process-group/message safety still matters
# for a REAL candidate run, where RENDER_RESUME_CHROME is unset) — it closes
# the specific incident's TRIGGER inside this harness, which the checks
# below can no longer exercise here by construction (they call to_pdf()
# directly with an explicit chrome=, bypassing the harness's own env var —
# this section is what proves an AGENT under test, which never passes an
# explicit chrome=, gets the fake).
# NOTE on the && / || shape below: `say`'s own exit status is 0 for OPEN,
# 1 for CLOSED (its `[ "$1" = OPEN ] && open=1` tail) — so `cond && say
# CLOSED ... || say OPEN ...` spuriously ALSO prints the OPEN line whenever
# CLOSED fires (found live, resolving this same file's pre-existing vault
# checks above, which show the identical double-print when truly CLOSED).
# Every check added here puts the OPEN branch first instead, which does
# not have that problem.
harness_chrome="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; echo \"\$RENDER_RESUME_CHROME\"")"
[ "$harness_chrome" != "$ROOT/fixtures/fake-chrome" ] && say OPEN "RENDER_RESUME_CHROME is not wired to the harness fake (got: ${harness_chrome:-<empty>})" \
  || say CLOSED "lib_env.sh points RENDER_RESUME_CHROME at the harness fake"
[ ! -x "$ROOT/fixtures/fake-chrome" ] && say OPEN "fixtures/fake-chrome is missing or not executable" \
  || say CLOSED "fixtures/fake-chrome exists and is executable"
harness_pdf="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; python3 - '$REPO' '$T' <<'EOF'
import sys, os
sys.path.insert(0, os.path.join(sys.argv[1], 'skills', 'apply', 'scripts'))
import render_resume as rr
t = sys.argv[2]
open(os.path.join(t, 'harness.html'), 'w').write('<html></html>')
ok, err = rr.to_pdf(os.path.join(t, 'harness.html'), os.path.join(t, 'harness.pdf'))
print('OK' if ok else 'FAIL:' + str(err))
EOF")"
[ "$harness_pdf" != "OK" ] && say OPEN "an agent-under-test call (no explicit chrome=) did not resolve to the harness fake: $harness_pdf" \
  || say CLOSED "an agent-under-test call (no explicit chrome=) renders via the fake, never real Chrome, and never hangs"

echo "== render_resume.py to_pdf() timeout (production safety — RENDER_RESUME_CHROME is unset for a real candidate run, so these still apply there) =="
cat > "$T/fakechrome" <<EOF
#!/bin/bash
# stands in for Chrome: a browser process with a helper child of its own
"$T/zzHelper" 300 &
wait
EOF
chmod +x "$T/fakechrome"; ln -sf /bin/sleep "$T/zzHelper"
python3 - "$REPO" "$T" <<'EOF'
import sys, os
sys.path.insert(0, os.path.join(sys.argv[1], "skills", "apply", "scripts"))
import render_resume as rr
t = sys.argv[2]
open(os.path.join(t, "r.html"), "w").write("<html></html>")
rr.to_pdf(os.path.join(t, "r.html"), os.path.join(t, "r.pdf"), chrome=os.path.join(t, "fakechrome"), timeout=1)
EOF
sleep 0.3
alive zzHelper && say OPEN "timeout kills the Chrome PID only; its helper children are orphaned and keep running (no process-group kill)" \
  || say CLOSED "timeout stops Chrome's own helper children too"
dflt="$(python3 -c "import inspect,sys; sys.path.insert(0,'$REPO/skills/apply/scripts'); import render_resume as rr; print(inspect.signature(rr.to_pdf).parameters['timeout'].default)")"
[ "$dflt" -lt 120 ] && say CLOSED "to_pdf timeout ($dflt s) is under the agent Bash tool's 120 s default" \
  || say OPEN "to_pdf timeout default is ${dflt}s — not under the agent Bash tool's 120 s default, so the tool can cut the script off before its plain message prints"
grep -q -F 'check whether another Chrome window is open' "$REPO/skills/apply/scripts/render_resume.py" \
  && say OPEN "timeout message points the agent at 'another Chrome window' (the owner's browser) though the run no longer shares a profile" \
  || say CLOSED "timeout message does not point at other Chrome windows"

echo
[ "$open" = 0 ] && { echo "ALL CLOSED"; exit 0; } || { echo "OPEN GAPS REMAIN"; exit 1; }
