"""tests/always-on's process-safety guards (2026-09-26 Chrome incident):
guard-bin/{pkill,killall,kill} shims that must sit first on every runner's
PATH, and the vault lock's reference count. No test here kills a REAL
process by name/pattern — every "does it refuse" check targets a harmless
process this test itself spawned and can verify is still alive after.
"""
import os, subprocess, sys, time, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ALWAYS_ON = os.path.join(HERE, "always-on")
GUARD_BIN = os.path.join(ALWAYS_ON, "guard-bin")
LIB_ENV = os.path.join(ALWAYS_ON, "lib_env.sh")


def _run(argv, **kw):
    return subprocess.run(argv, capture_output=True, text=True, **kw)


def test_guard_bin_shims_exist_and_are_executable():
    for name in ("pkill", "killall", "kill"):
        p = os.path.join(GUARD_BIN, name)
        assert os.path.isfile(p), f"missing {p}"
        assert os.access(p, os.X_OK), f"{p} is not executable"


def test_pkill_shim_always_refuses():
    r = _run([os.path.join(GUARD_BIN, "pkill"), "-f", "Google Chrome"])
    assert r.returncode != 0, r
    assert "disabled" in r.stderr.lower() or "refus" in r.stderr.lower(), r.stderr


def test_killall_shim_always_refuses():
    r = _run([os.path.join(GUARD_BIN, "killall"), "Google Chrome"])
    assert r.returncode != 0, r
    assert "disabled" in r.stderr.lower() or "refus" in r.stderr.lower(), r.stderr


def test_kill_shim_refuses_a_name_and_kills_nothing():
    # A harmless process THIS TEST owns — proves the shim's refusal really
    # killed nothing, not just that it printed a refusal.
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"])
    try:
        r = _run([os.path.join(GUARD_BIN, "kill"), "-9", "Google Chrome"])
        assert r.returncode != 0, r
        assert "refus" in r.stderr.lower(), r.stderr
        time.sleep(0.2)
        assert proc.poll() is None, "the guard's refusal must not touch an unrelated process"
    finally:
        proc.kill()
        proc.wait()


def test_kill_shim_passes_through_a_numeric_pid():
    # Legitimate use (a script ending its OWN known child by PID, or the
    # harness's `kill 0` cleanup trap) must still work — the guard only
    # refuses a NAME target, never a numeric one.
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        r = _run([os.path.join(GUARD_BIN, "kill"), "-TERM", str(proc.pid)])
        assert r.returncode == 0, r
        proc.wait(timeout=5)
        assert proc.returncode is not None
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def test_kill_shim_list_mode_is_harmless_and_passes():
    r = _run([os.path.join(GUARD_BIN, "kill"), "-l"])
    assert r.returncode == 0, r
    assert "TERM" in r.stdout or "term" in r.stdout.lower(), r.stdout


def test_lib_env_puts_guard_bin_first_on_path():
    text = open(LIB_ENV, encoding="utf-8").read()
    assert "guard-bin" in text, "lib_env.sh must prepend guard-bin to PATH"


def test_lib_env_scrubs_ambient_claude_code_vars():
    text = open(LIB_ENV, encoding="utf-8").read()
    assert "CLAUDE_CODE_" in text, (
        "lib_env.sh must unset inherited CLAUDE_CODE_* vars — a desktop "
        "session's own vars were found to change the agent's tools"
    )


def _lib_env_sh(extra_script, env_overrides):
    """Runs `extra_script` in a bash process that has already sourced
    lib_env.sh, with ROOT/REPO set as every real caller sets them, and
    REALJS overridden to a throwaway test vault (never the real one)."""
    env = dict(os.environ)
    env.pop("RUNNER_SKILLS_DIR", None)
    env.update(env_overrides)
    script = f'''
set -u
ROOT="{ALWAYS_ON}"
REPO="{os.path.dirname(HERE)}"
source "{LIB_ENV}"
{extra_script}
'''
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env)


def test_vault_lock_is_reference_counted_across_two_holders():
    """The race this fixes: two sibling runners lock the same vault; the
    first one to finish must NOT unlock it while the second is still
    relying on it staying locked. Simulated with two real processes
    (not two calls in one process) sharing one refcount file on disk —
    that is exactly the "sibling run_*.sh scripts" scenario."""
    fake_vault = tempfile.mkdtemp(prefix="fake-job-search-")
    fixture = os.path.join(fake_vault, "resume.md")
    open(fixture, "w", encoding="utf-8").write("fixture, not real candidate data\n")
    lockstate = tempfile.mkdtemp(prefix="vault-refcount-test-")
    try:
        env = {"REALJS": fake_vault, "ROOT_RESULTS_OVERRIDE": lockstate}
        # Holder A: locks, then unlocks (simulating it finishing first).
        rA = _lib_env_sh(
            'export _VAULT_LOCKDIR="'
            + lockstate
            + '/lockdir" _VAULT_COUNT="'
            + lockstate
            + '/count"\nvault_lock\n'
            "if [ ! -f \"$REALJS/resume.md\" ]; then echo MISSING; exit 1; fi\n"
            "python3 -c \"import os,sys; sys.exit(0 if (os.stat('"
            + fixture
            + "').st_flags & 0x2) else 1)\" && echo LOCKED_AFTER_A_ACQUIRE || echo NOT_LOCKED_AFTER_A_ACQUIRE\n",
            env,
        )
        assert "LOCKED_AFTER_A_ACQUIRE" in rA.stdout, (rA.stdout, rA.stderr)

        # Holder B acquires too (refcount now 2), THEN A releases (refcount
        # 1) — the vault must STILL be locked, because B is still relying
        # on it.
        rB_acquire = _lib_env_sh(
            'export _VAULT_LOCKDIR="'
            + lockstate
            + '/lockdir" _VAULT_COUNT="'
            + lockstate
            + '/count"\nvault_lock\n',
            env,
        )
        assert rB_acquire.returncode == 0, rB_acquire.stderr

        rA_release = _lib_env_sh(
            'export _VAULT_LOCKDIR="'
            + lockstate
            + '/lockdir" _VAULT_COUNT="'
            + lockstate
            + '/count"\n_VAULT_HELD=1\nvault_unlock\n',
            env,
        )
        assert rA_release.returncode == 0, rA_release.stderr

        still_locked = subprocess.run(
            [sys.executable, "-c",
             f"import os,sys; sys.exit(0 if (os.stat({fixture!r}).st_flags & 0x2) else 1)"]
        ).returncode == 0
        assert still_locked, (
            "vault_unlock from the FIRST holder to exit must not unlock the "
            "vault while a sibling holder (B) is still counted as holding it"
        )

        # B releases too (refcount 0) — now it actually unlocks.
        rB_release = _lib_env_sh(
            'export _VAULT_LOCKDIR="'
            + lockstate
            + '/lockdir" _VAULT_COUNT="'
            + lockstate
            + '/count"\n_VAULT_HELD=1\nvault_unlock\n',
            env,
        )
        assert rB_release.returncode == 0, rB_release.stderr
        still_locked_after_both = subprocess.run(
            [sys.executable, "-c",
             f"import os,sys; sys.exit(0 if (os.stat({fixture!r}).st_flags & 0x2) else 1)"]
        ).returncode == 0
        assert not still_locked_after_both, "the LAST holder's release must actually unlock the vault"
    finally:
        # best-effort: the fixture may still be flagged immutable
        subprocess.run(["chflags", "nouchg", fixture], capture_output=True)
        shutil.rmtree(fake_vault, ignore_errors=True)
        shutil.rmtree(lockstate, ignore_errors=True)


def test_no_run_script_still_defines_its_own_vault_lock():
    """The 11 run_*.sh scripts used to each carry a private copy of
    vault_lock/vault_unlock (the race this whole thing fixes) — after the
    fix, the ONLY definition left is the shared one in lib_env.sh."""
    import glob
    definers = []
    for path in glob.glob(os.path.join(ALWAYS_ON, "run_*.sh")):
        text = open(path, encoding="utf-8").read()
        if "vault_unlock()" in text or "vault_lock()" in text:
            definers.append(os.path.basename(path))
    assert definers == [], f"still define their own vault_lock/vault_unlock (should call lib_env.sh's shared one): {definers}"
