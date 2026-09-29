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
  for v in "$T/v1" "$T/v2" "$T/v3" "$T/v4" "$T/v5"; do [ -d "$v" ] && rm -rf "$(vault_state_dir "$v")"; done
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

# Lock coverage: vault_lock marks FILES immutable (`find -type f ... uchg`).
# A locked vault must also refuse NEW files and directories — a test
# session planting data in a real candidate workspace is the failure the
# lock exists for (CLAUDE.md: never plant test data in one).
mkdir -p "$T/v5/applications"; echo x > "$T/v5/profile.md"; echo y > "$T/v5/applications/a.md"
REALJS="$T/v5" bash -c "ROOT='$ROOT' REPO='$REPO'; source '$ROOT/lib_env.sh'; vault_lock
  r=''; echo n > '$T/v5/planted.md' 2>/dev/null && r=\"\$r top-file\"
  echo n > '$T/v5/applications/planted.md' 2>/dev/null && r=\"\$r sub-file\"
  mkdir '$T/v5/planted-dir' 2>/dev/null && r=\"\$r new-dir\"
  echo \"\$r\" > '$T/xc'; vault_unlock"
created="$(cat "$T/xc")"
none_created() { [ -z "$(printf '%s' "$created" | tr -d ' ')" ]; }
check "a locked vault refuses new files and directories" \
      "a locked vault still accepts new entries by absolute path:${created} (vault_lock marks only -type f uchg)" none_created

echo "== render_resume.mjs never launches a real browser in this harness, and never discloses that it's a stand-in (fix round, 2026-09-27) =="
# sandbox_home_setup (not a bare `source`) is the real per-trial path every
# run_*.sh now takes — RENDER_RESUME_CHROME is no longer set at source
# time, only once a sandbox HOME exists to stage the neutral copy into
# (see lib_env.sh's "No real browser" comment). Capture FAKEHOME, the var,
# and the staged copy's own bytes all from ONE subshell (sandbox_home_setup
# is a function, its effects don't survive a fresh subshell), delimited so
# the outer probe can pull each piece back out.
chrome_probe="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; sandbox_home_setup
echo \"FAKEHOME=\$FAKEHOME\"
echo \"RENDER_RESUME_CHROME=\$RENDER_RESUME_CHROME\"
echo '---COPY---'
cat \"\$RENDER_RESUME_CHROME\"")"
# sandbox_home_cleanup is deliberately NOT called inside the subshell above
# — the executable-ness check right below needs the staged file to still
# exist after this command substitution returns; it is removed by hand at
# the end of this block instead (never sandbox_home_cleanup itself, which
# only knows about ITS OWN caller's $FAKEHOME, not this probe's captured
# copy of it).
harness_fakehome="$(printf '%s\n' "$chrome_probe" | sed -n 's/^FAKEHOME=//p')"
harness_chrome="$(printf '%s\n' "$chrome_probe" | sed -n 's/^RENDER_RESUME_CHROME=//p')"
harness_copy="$(printf '%s\n' "$chrome_probe" | sed -n '/^---COPY---$/,$p' | tail -n +2)"
inside_sandbox() {
  [ -n "$harness_fakehome" ] && [ -n "$harness_chrome" ] || return 1
  case "$harness_chrome" in "$harness_fakehome"/*) [ -x "$harness_chrome" ];; *) false;; esac
}
check "lib_env.sh points RENDER_RESUME_CHROME at an executable copy inside the sandbox HOME" \
      "RENDER_RESUME_CHROME is not inside the sandbox HOME (FAKEHOME=${harness_fakehome:-<empty>}, got: ${harness_chrome:-<empty>})" inside_sandbox
no_giveaway() {
  # No exceptions (2026-09-27, second fix round): a live run sets
  # FAKE_CHROME_PDF_BYTES in the agent's own environment, so a plain `env`
  # printed "FAKE_CHROME" — the same leak this check exists to catch, just
  # reached through the environment instead of the file. Renamed to
  # PDF_PAD_BYTES everywhere (the fixture, this copy, every test/probe) so
  # the check can be a real zero-exceptions ban.
  ! printf '%s' "$harness_copy" | grep -qiE '\b(harness|stand-in|fake|test)\b'
}
check "the staged copy carries no 'harness'/'stand-in'/'fake'/'test' word an agent could read back (no exceptions)" \
      "the staged copy still discloses what it is: $(printf '%s' "$harness_copy" | grep -inE '\b(harness|stand-in|fake|test)\b' | head -3)" no_giveaway
[ -n "$harness_fakehome" ] && rm -rf "$harness_fakehome" 2>/dev/null

# A tiny .mjs helper, not inlined `node -e`: render_resume.mjs's toPdf()/
# findChrome() are ESM named exports, and this keeps every quoting layer
# (the outer bash -c, the sandboxed subshell) free of nested JS string
# literals.
cat > "$T/probe_agent_call.mjs" <<EOF
import { toPdf } from "$REPO/skills/apply/scripts/render_resume.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const t = "$T";
writeFileSync(join(t, "harness.html"), "<html></html>");
const { ok, err } = await toPdf(join(t, "harness.html"), join(t, "harness.pdf"));
console.log(ok ? "OK" : "FAIL:" + String(err));
EOF
harness_pdf="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; sandbox_home_setup; node '$T/probe_agent_call.mjs'
sandbox_home_cleanup")"
pdf_ok() { [ "$harness_pdf" = OK ]; }
check "an agent-style call (no explicit chrome=) renders via the staged copy" \
      "an agent-style call did not render via the staged copy: $harness_pdf" pdf_ok

# The fake must let t10-over-budget express its failure: that case's base is
# "measured at 2 rendered pages" (cases/t10-over-budget/expected.md), so an
# agent-style render of it through the staged copy must report 2+ pages,
# and its text layer must extract. Also checks the calibration fix's other
# two acceptance points (fixtures/resume-330w.md -> 1 page,
# fixtures/resume-600w.md -> 2 pages) the same way, through the same
# sandboxed copy — see tests/test_always_on_fake_chrome.py for the full,
# documented arithmetic this re-checks only the OUTCOME of.
page_probe="$(REALJS=/nonexistent-probe-vault bash -c "ROOT='$ROOT'; REPO='$REPO'; source '$ROOT/lib_env.sh'; sandbox_home_setup
node '$REPO/skills/apply/scripts/render_resume.mjs' --md '$ROOT/cases/t10-over-budget/base-resume.md' --pdf '$T/ob.pdf' --pages 1 2>&1 | grep '^pages:'
node '$REPO/skills/apply/scripts/render_resume.mjs' --md '$ROOT/fixtures/resume-330w.md' --pdf '$T/w330.pdf' --pages 1 2>&1 | grep '^pages:'
node '$REPO/skills/apply/scripts/render_resume.mjs' --md '$ROOT/fixtures/resume-600w.md' --pdf '$T/w600.pdf' --pages 1 2>&1 | grep '^pages:'
sandbox_home_cleanup")"
ob_pages="$(printf '%s\n' "$page_probe" | sed -n '1s/^pages: \([0-9]*\).*/\1/p')"
w330_pages="$(printf '%s\n' "$page_probe" | sed -n '2s/^pages: \([0-9]*\).*/\1/p')"
w600_pages="$(printf '%s\n' "$page_probe" | sed -n '3s/^pages: \([0-9]*\).*/\1/p')"
two_pages() { [ "${ob_pages:-0}" -ge 2 ]; }
check "t10-over-budget's 2-page base renders ${ob_pages} pages through the staged copy" \
      "t10-over-budget's base (measured at 2 real pages) renders ${ob_pages:-?} page(s) through the staged copy — the case cannot express its failure" two_pages
one_page_330() { [ "${w330_pages:-0}" -eq 1 ]; }
check "the 330-word résumé (the arm-A t10 over-cut trigger) renders 1 page through the staged copy" \
      "the 330-word résumé renders ${w330_pages:-?} page(s), not 1 — the over-strict miss this fix round exists for is still live" one_page_330
two_pages_600() { [ "${w600_pages:-0}" -eq 2 ]; }
check "the ~600-word résumé renders 2 pages through the staged copy" \
      "the ~600-word résumé renders ${w600_pages:-?} page(s), not 2" two_pages_600
has_text() { [ -f "$T/ob.pdf" ] && [ "$(pdftotext "$T/ob.pdf" - 2>/dev/null | wc -w)" -gt 100 ]; }
if command -v pdftotext >/dev/null; then
  check "the fake's PDF has an extractable text layer (pdftotext)" \
        "the fake's PDF has no extractable text (pdftotext) — apply's verify-by-extraction step fails" has_text
fi

echo "== render_resume.mjs toPdf() timeout (a real candidate run, RENDER_RESUME_CHROME unset) =="
cat > "$T/fakechrome" <<EOF
#!/bin/bash
# stands in for Chrome: a browser process with a helper child of its own
"$T/zzHelper" 300 &
wait
EOF
chmod +x "$T/fakechrome"; ln -sf /bin/sleep "$T/zzHelper"
cat > "$T/probe_timeout.mjs" <<EOF
import { toPdf } from "$REPO/skills/apply/scripts/render_resume.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const t = "$T";
writeFileSync(join(t, "r.html"), "<html></html>");
await toPdf(join(t, "r.html"), join(t, "r.pdf"), join(t, "fakechrome"), 1000);
EOF
node "$T/probe_timeout.mjs"
sleep 0.3
helper_gone() { ! alive zzHelper; }
check "timeout stops Chrome's own helper children too" \
      "timeout kills the Chrome PID only; its helper children keep running" helper_gone
# the source's own default (seconds) — no runtime introspection needed for
# a `timeoutMs = 90_000` default parameter the way Python's inspect.signature
# read to_pdf's `timeout=90`.
dflt_ms="$(grep -oE 'timeoutMs = [0-9_]+' "$REPO/skills/apply/scripts/render_resume.mjs" | grep -oE '[0-9_]+$' | tr -d '_')"
dflt="$((dflt_ms / 1000))"
# the 10 s reap after the kill counts too: timeout + 10 must land under 120
under_tool() { [ $((dflt + 10)) -lt 120 ]; }
check "toPdf timeout (${dflt}s + 10s reap) is under the agent Bash tool's 120s default" \
      "toPdf timeout ${dflt}s (+10s reap) is not under the agent Bash tool's 120s default" under_tool
no_hint() { ! grep -q -F 'another Chrome window' "$REPO/skills/apply/scripts/render_resume.mjs"; }
check "timeout message does not point at other Chrome windows" \
      "timeout message points the agent at 'another Chrome window' (the owner's browser)" no_hint

echo
if [ "$open" = 0 ]; then echo "NO OPEN GAPS (RESIDUAL lines are owner-accepted)"; exit 0; fi
echo "OPEN GAPS REMAIN"; exit 1
