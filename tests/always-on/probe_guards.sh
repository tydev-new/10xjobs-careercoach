#!/bin/bash
# Reviewer's probe for the harness safety guards (69f35ae, 6670f5c). One
# line per check: CLOSED, OPEN, or RESIDUAL (a gap the owner accepted —
# printed so it stays visible, never counted). Exits 1 while any check is
# OPEN, 0 otherwise. Zero spend, no model calls. Kept out of tests/run.py:
# it is the re-verify command for the review's findings.
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
# `say` returns 0 always — so `cond && say ... || say ...` can never
# double-print (the 0b748cb version returned 1 for CLOSED and did).
say() { printf '  %-8s %s\n' "$1" "$2"; if [ "$1" = OPEN ]; then open=1; fi; return 0; }
check() {  # check "<closed text>" "<open text>" <command...>  — CLOSED iff the command succeeds
  local closed="$1" opentext="$2"; shift 2
  if "$@"; then say CLOSED "$closed"; else say OPEN "$opentext"; fi
}
vault_state_dir() {  # the state dir lib_env.sh derives for vault $1
  REALJS="$1" bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; echo \"\$_VAULT_STATE_DIR\""
}
cleanup() {
  /usr/bin/pkill -f "$T/zz" 2>/dev/null
  for v in "$T/v1" "$T/v2" "$T/v3" "$T/v4"; do [ -d "$v" ] && rm -rf "$(vault_state_dir "$v")"; done
  chflags -R nouchg "$T" 2>/dev/null; rm -rf "$T"
}
trap cleanup EXIT

dummy() { ln -sf /bin/sleep "$T/$1"; (nohup "$T/$1" 300 >/dev/null 2>&1 &); sleep 0.3; }
alive() { pgrep -f "$T/$1" >/dev/null; }
# A shell that sourced lib_env.sh the way run_*.sh does.
harness() { REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; $1" >/dev/null 2>&1; }
locked() { ls -lO "$1" | grep -q uchg; }

echo "== kill guard, shell layer (guard-bin PATH shims) =="
# Owner ruling 2026-09-26: these reach a real process from a plain shell;
# accepted residual risk, reduced by removing the trigger (no real Chrome
# in a harness run) and by --disallowedTools on every `claude -p`
# (lib_env.sh CLAUDE_KILL_GUARD_ARGS). That second layer is a claude-CLI
# rule and can't be probed without a model call; the reviewer's live check
# (2026-09-27, Haiku) found it denies all four forms below plus `true &&`
# and `echo;` compounds, and does NOT deny `sh -c "/usr/bin/pkill ..."` or
# a `python3 -c` os.kill of a pgrep lookup.
dummy zzA; harness "/usr/bin/pkill -f zzA"
if alive zzA; then say CLOSED "absolute-path /usr/bin/pkill -f <name>"; else say RESIDUAL "absolute-path /usr/bin/pkill -f <name> reaches a real process from a shell"; fi
dummy zzB; harness "/usr/bin/killall zzB"
if alive zzB; then say CLOSED "absolute-path /usr/bin/killall <name>"; else say RESIDUAL "absolute-path /usr/bin/killall <name> reaches a real process from a shell"; fi
dummy zzC; harness 'kill $(pgrep -f zzC)'
if alive zzC; then say CLOSED 'kill $(pgrep -f <name>)'; else say RESIDUAL 'kill $(pgrep -f <name>) reaches a real process from a shell'; fi
dummy zzD; harness 'pgrep -f zzD | xargs kill'
if alive zzD; then say CLOSED 'pgrep -f <name> | xargs kill'; else say RESIDUAL 'pgrep -f <name> | xargs kill reaches a real process from a shell'; fi
dummy zzE; harness "pkill -f zzE; killall zzE; env kill zzE"
check "bare pkill / killall / env kill <name> are refused (guard-bin)" \
      "a bare pkill / killall / env kill <name> reached a real process" alive zzE

echo "== vault lock (keyed by the vault's resolved path) =="
# Two checkouts: the second is a copy of lib_env.sh + guard-bin in another
# directory, so its ROOT (and results/) differs; one shared temp vault.
mkdir -p "$T/v1" "$T/checkout2"; echo x > "$T/v1/f.md"
cp "$ROOT/lib_env.sh" "$T/checkout2/"; cp -R "$ROOT/guard-bin" "$T/checkout2/"
( export REALJS="$T/v1"; source "$ROOT/lib_env.sh"; vault_lock; sleep 2
  if locked "$T/v1/f.md"; then echo held > "$T/xa"; else echo lapsed > "$T/xa"; fi; vault_unlock ) &
sleep 0.5
( export REALJS="$T/v1"; ROOT="$T/checkout2"; source "$T/checkout2/lib_env.sh"; vault_lock; sleep 0.3; vault_unlock )
wait
held_xa() { [ "$(cat "$T/xa")" = held ]; }
check "vault stays locked for a runner while a runner in another checkout exits" \
      "vault UNLOCKED under a live runner when a runner in a different checkout exited" held_xa
unlocked_v1() { ! locked "$T/v1/f.md"; }
check "vault unlocked once the last holder (either checkout) left" \
      "vault still locked after every holder left" unlocked_v1
# Stale holder: SIGKILLed while holding, vault then unlocked by hand; the
# next runner must lock it again, not trust the dead holder's registration.
mkdir -p "$T/v2"; echo x > "$T/v2/f.md"
REALJS="$T/v2" bash -c "ROOT='$ROOT' REPO='$REPO'; source '$ROOT/lib_env.sh'; vault_lock; kill -9 \$\$" 2>/dev/null
chflags nouchg "$T/v2/f.md"
REALJS="$T/v2" bash -c "ROOT='$ROOT' REPO='$REPO'; source '$ROOT/lib_env.sh'; vault_lock; if ls -lO '$T/v2/f.md' | grep -q uchg; then echo held; else echo lapsed; fi > '$T/xs'; vault_unlock"
held_xs() { [ "$(cat "$T/xs")" = held ]; }
check "a dead holder's registration never leaves a new runner unprotected" \
      "stale holder (SIGKILLed, vault unlocked by hand): the next runner holds with the vault UNLOCKED" held_xs
# Abandoned mutex (creator died inside the critical section): recovered
# promptly, not waited out or bypassed.
mkdir -p "$T/v3"; echo x > "$T/v3/f.md"
sd="$(vault_state_dir "$T/v3")"; mkdir -p "$sd/mutex"; echo 999999 > "$sd/mutex/pid"
s=$(date +%s)
REALJS="$T/v3" bash -c "ROOT='$ROOT' REPO='$REPO'; source '$ROOT/lib_env.sh'; vault_lock; if ls -lO '$T/v3/f.md' | grep -q uchg; then echo held; else echo lapsed; fi > '$T/xm'; vault_unlock" 2>/dev/null
waited=$(( $(date +%s) - s ))
mutex_ok() { [ "$(cat "$T/xm")" = held ] && [ "$waited" -lt 5 ]; }
check "a dead creator's mutex is recovered at once and the vault still locks (${waited}s)" \
      "abandoned mutex: waited ${waited}s or proceeded unprotected ($(cat "$T/xm"))" mutex_ok

# Two runners on one vault whose environments carry different TMPDIRs
# (e.g. the owner's terminal and a sandboxed agent session): lib_env.sh
# keys the state dir under ${TMPDIR:-/tmp}, so they may not share it.
mkdir -p "$T/v4" "$T/tmpA" "$T/tmpB"; echo x > "$T/v4/f.md"
( export REALJS="$T/v4" TMPDIR="$T/tmpA/"; source "$ROOT/lib_env.sh"; vault_lock; sleep 2
  if locked "$T/v4/f.md"; then echo held > "$T/xt"; else echo lapsed > "$T/xt"; fi; vault_unlock ) &
sleep 0.5
( export REALJS="$T/v4" TMPDIR="$T/tmpB/"; source "$ROOT/lib_env.sh"; vault_lock; sleep 0.3; vault_unlock )
wait
held_xt() { [ "$(cat "$T/xt")" = held ]; }
check "vault stays locked across runners whose TMPDIR differs" \
      "vault UNLOCKED under a live runner when a runner with a different TMPDIR exited — the state dir is keyed under \${TMPDIR:-/tmp}, not a fixed path" held_xt

echo "== render_resume.py never launches a real browser in this harness =="
harness_chrome="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; echo \"\$RENDER_RESUME_CHROME\"")"
is_fake() { [ "$harness_chrome" = "$ROOT/fixtures/fake-chrome" ] && [ -x "$ROOT/fixtures/fake-chrome" ]; }
check "lib_env.sh points RENDER_RESUME_CHROME at an executable harness fake" \
      "RENDER_RESUME_CHROME is not the harness fake (got: ${harness_chrome:-<empty>})" is_fake
harness_pdf="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; python3 - '$REPO' '$T' <<'EOF'
import sys, os
sys.path.insert(0, os.path.join(sys.argv[1], 'skills', 'apply', 'scripts'))
import render_resume as rr
t = sys.argv[2]
open(os.path.join(t, 'harness.html'), 'w').write('<html></html>')
ok, err = rr.to_pdf(os.path.join(t, 'harness.html'), os.path.join(t, 'harness.pdf'))
print('OK' if ok else 'FAIL:' + str(err))
EOF")"
pdf_ok() { [ "$harness_pdf" = OK ]; }
check "an agent-style call (no explicit chrome=) renders via the fake" \
      "an agent-style call did not render via the harness fake: $harness_pdf" pdf_ok

# The fake must let t10-over-budget express its failure: that case's base is
# "measured at 2 rendered pages" (cases/t10-over-budget/expected.md), so an
# agent-style render of it through the harness fake must report 2+ pages,
# and its text layer must extract.
ob_line="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; python3 '$REPO/skills/apply/scripts/render_resume.py' --md '$ROOT/cases/t10-over-budget/base-resume.md' --pdf '$T/ob.pdf' --pages 1" 2>&1 | grep '^pages:')"
ob_pages="$(printf '%s' "$ob_line" | sed -n 's/^pages: \([0-9]*\).*/\1/p')"
two_pages() { [ "${ob_pages:-0}" -ge 2 ]; }
check "t10-over-budget's 2-page base renders ${ob_pages} pages through the harness fake" \
      "t10-over-budget's base (measured at 2 real pages) renders ${ob_pages:-?} page(s) through the harness fake — the case cannot express its failure" two_pages
has_text() { [ -f "$T/ob.pdf" ] && [ "$(pdftotext "$T/ob.pdf" - 2>/dev/null | wc -w)" -gt 100 ]; }
if command -v pdftotext >/dev/null; then
  check "the fake's PDF has an extractable text layer (pdftotext)" \
        "the fake's PDF has no extractable text (pdftotext) — apply's verify-by-extraction step fails" has_text
fi

echo "== render_resume.py to_pdf() timeout (a real candidate run, RENDER_RESUME_CHROME unset) =="
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
helper_gone() { ! alive zzHelper; }
check "timeout stops Chrome's own helper children too" \
      "timeout kills the Chrome PID only; its helper children keep running" helper_gone
dflt="$(python3 -c "import inspect,sys; sys.path.insert(0,'$REPO/skills/apply/scripts'); import render_resume as rr; print(inspect.signature(rr.to_pdf).parameters['timeout'].default)")"
# the 10 s reap after the kill counts too: timeout + 10 must land under 120
under_tool() { [ $((dflt + 10)) -lt 120 ]; }
check "to_pdf timeout (${dflt}s + 10s reap) is under the agent Bash tool's 120s default" \
      "to_pdf timeout ${dflt}s (+10s reap) is not under the agent Bash tool's 120s default" under_tool
no_hint() { ! grep -q -F 'another Chrome window' "$REPO/skills/apply/scripts/render_resume.py"; }
check "timeout message does not point at other Chrome windows" \
      "timeout message points the agent at 'another Chrome window' (the owner's browser)" no_hint

echo
if [ "$open" = 0 ]; then echo "NO OPEN GAPS (RESIDUAL lines are owner-accepted)"; exit 0; fi
echo "OPEN GAPS REMAIN"; exit 1
