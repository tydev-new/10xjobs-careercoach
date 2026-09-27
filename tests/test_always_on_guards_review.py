#!/usr/bin/env python3
"""Independent review tests for 69f35ae's harness safety guards.

Derived from what the guards promise (commit message, lib_env.sh,
guard-bin/*), not from the builder's own tests — which check that the
words "guard-bin" and "CLAUDE_CODE_" appear in lib_env.sh, and pass even
when guard-bin is appended LAST on PATH or the scrub loop is commented
out. These tests check BEHAVIOUR in a shell that sourced lib_env.sh the
way every run_*.sh does.

Every "was it refused" check targets a harmless dummy process this test
spawned itself (a python sleeper with a unique tag in its argv) and then
checks the dummy is still alive. Nothing here ever names a real app.

The gaps this review found (absolute-path pkill/killall, pgrep-then-kill,
the vault refcount across checkouts, a stale refcount, render_resume's
orphaned grandchild) are NOT asserted here — they fail today and would
turn `python3 tests/run.py` red for everyone. They live in
tests/always-on/probe_guards.sh, which exits nonzero while any is open.

    python3 tests/test_always_on_guards_review.py
"""
import os, subprocess, sys, tempfile, time, uuid, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
AO = os.path.join(REPO, "tests", "always-on")
GUARD_BIN = os.path.join(AO, "guard-bin")
LIB_ENV = os.path.join(AO, "lib_env.sh")


def _harness_bash(script, env_extra=None):
    """Run `script` in bash after sourcing lib_env.sh exactly as a runner
    does (ROOT/REPO set first). REALJS points at a path that does not
    exist, so no vault is ever touched."""
    env = dict(os.environ)
    env["REALJS"] = "/nonexistent-review-vault"
    env.update(env_extra or {})
    prologue = f'set -u\nROOT="{AO}"\nREPO="{REPO}"\nsource "{LIB_ENV}"\n'
    return subprocess.run(["bash", "-c", prologue + script],
                          capture_output=True, text=True, env=env, timeout=60)


def _dummy():
    tag = "zzreview-" + uuid.uuid4().hex[:12]
    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)", tag])
    time.sleep(0.2)
    return tag, p


def _alive(p):
    return p.poll() is None


def test_guard_bin_is_first_on_path_in_a_harness_shell():
    r = _harness_bash('echo "${PATH%%:*}"; command -v pkill; command -v killall; type -P kill')
    first, pk, ka, k = r.stdout.split("\n")[:4]
    assert first == GUARD_BIN, first
    assert pk == os.path.join(GUARD_BIN, "pkill"), pk
    assert ka == os.path.join(GUARD_BIN, "killall"), ka
    assert k == os.path.join(GUARD_BIN, "kill"), k


def test_claude_code_vars_are_gone_in_a_harness_shell():
    r = _harness_bash("env | grep -E '^CLAUDE_CODE_' | cut -d= -f1 || true",
                      {"CLAUDE_CODE_REVIEW_PROBE": "1",
                       "CLAUDE_CODE_TERMINAL_MCP_TOOLS": "x"})
    assert r.stdout.strip() == "", r.stdout


def test_name_and_pattern_kills_are_refused_and_the_dummy_survives():
    tag, p = _dummy()
    try:
        forms = {
            "pkill -f": f"pkill -f {tag}",
            "pkill": f"pkill {tag}",
            "killall": f"killall {tag}",
            "command kill": f"command kill {tag}",
            "/bin/kill": f"/bin/kill {tag}",
            "env kill": f"env kill {tag}",
            "env kill -9 --": f"env kill -9 -- {tag}",
            "env kill -s KILL": f"env kill -s KILL {tag}",
            "xargs kill": f"echo {tag} | xargs kill",
        }
        for label, cmd in forms.items():
            r = _harness_bash(cmd + "; echo rc=$?")
            assert "rc=0" not in r.stdout, f"{label}: exited 0 — {r.stdout!r} {r.stderr!r}"
            assert _alive(p), f"{label} reached the dummy process ({tag})"
        # pkill/killall must be the SHIM's refusal, not a real binary's
        # "no match" — the shim names itself.
        for cmd in (f"pkill -f {tag}", f"killall {tag}"):
            r = _harness_bash(cmd)
            assert "disabled in this test harness" in r.stderr, (cmd, r.stderr)
    finally:
        p.kill(); p.wait()


def test_numeric_kill_and_process_group_kill_still_work():
    # own child by PID, through the shim (env forces the PATH lookup)
    r = _harness_bash("sleep 60 & c=$!; env kill $c; rc=$?; sleep 0.2; "
                      "kill -0 $c 2>/dev/null && echo ALIVE || echo DEAD; echo rc=$rc")
    assert "DEAD" in r.stdout and "rc=0" in r.stdout, r.stdout + r.stderr
    # the runners' own `kill 0` cleanup, in a throwaway session so it can
    # only ever end this test's own group
    r = subprocess.run(
        ["bash", "-c",
         f'ROOT="{AO}"; REPO="{REPO}"; REALJS=/nonexistent-review-vault; source "{LIB_ENV}"; '
         'sleep 60 & kill 0; echo unreachable'],
        capture_output=True, text=True, start_new_session=True, timeout=30)
    assert "unreachable" not in r.stdout and r.returncode != 0, (r.returncode, r.stdout)


def _race(n, old_style):
    """n concurrent holders on one fake vault + one refcount. Each checks
    the vault is still immutable just before its own unlock."""
    t = tempfile.mkdtemp(prefix="vault-race-")
    try:
        os.makedirs(os.path.join(t, "vault", "sub"))
        for f in ("vault/a.md", "vault/sub/b.md"):
            open(os.path.join(t, f), "w").write("x\n")
        override = ('vault_unlock() { find "$REALJS" -flags +uchg -exec chflags nouchg {} + 2>/dev/null; }; '
                    'vault_lock() { find "$REALJS" -type f -exec chflags uchg {} + 2>/dev/null; }'
                    if old_style else ":")
        holder = (f'ROOT="{AO}"; REPO="{REPO}"; source "{LIB_ENV}"; {override}\n'
                  'sleep "0.$((RANDOM % 4))"; vault_lock; sleep "0.$((RANDOM % 8 + 1))"\n'
                  'ls -lO "$REALJS/a.md" "$REALJS/sub/b.md" | grep -v -q uchg && echo RACE || echo held\n'
                  'vault_unlock\n')
        env = dict(os.environ, REALJS=os.path.join(t, "vault"),
                   _VAULT_LOCKDIR=os.path.join(t, "lockdir"),
                   _VAULT_COUNT=os.path.join(t, "refcount"))
        procs = [subprocess.Popen(["bash", "-c", holder], stdout=subprocess.PIPE, text=True, env=env)
                 for _ in range(n)]
        outs = [p.communicate(timeout=120)[0] for p in procs]
        races = sum(o.count("RACE") for o in outs)
        final_locked = "uchg" in subprocess.run(["ls", "-lO", os.path.join(t, "vault", "a.md")],
                                                capture_output=True, text=True).stdout
        count = open(os.path.join(t, "refcount")).read().strip() if os.path.exists(os.path.join(t, "refcount")) else None
        return races, final_locked, count, os.path.isdir(os.path.join(t, "lockdir"))
    finally:
        subprocess.run(["chflags", "-R", "nouchg", t], capture_output=True)
        shutil.rmtree(t, ignore_errors=True)


def test_vault_lock_holds_for_every_concurrent_holder_in_one_checkout():
    if sys.platform != "darwin":
        return  # chflags uchg is the macOS mechanism the runners use
    races, final_locked, count, mutex_left = _race(16, old_style=False)
    assert races == 0, f"{races} holder(s) saw the vault unlocked while holding it"
    assert not final_locked, "vault still locked after the last holder left"
    assert count == "0", count
    assert not mutex_left, "mutex dir left behind"


def test_the_race_test_can_see_a_race():
    """Control: the pre-fix per-runner unlock, same harness — the test
    above only means something if this one sees the race."""
    if sys.platform != "darwin":
        return
    races, _, _, _ = _race(16, old_style=True)
    assert races >= 1, "control saw no race — the race test is not sensitive"


if __name__ == "__main__":
    failed = 0
    for name in sorted(k for k in dir() if k.startswith("test_")):
        try:
            globals()[name]()
            print("ok  ", name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", name, "—", e)
    sys.exit(1 if failed else 0)
