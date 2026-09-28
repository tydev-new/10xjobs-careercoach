"""tests/always-on's process-safety guards (2026-09-26 Chrome incident):
guard-bin/{pkill,killall,kill} shims that must sit first on every runner's
PATH, and the vault lock's reference count. No test here kills a REAL
process by name/pattern — every "does it refuse" check targets a harmless
process this test itself spawned and can verify is still alive after.
"""
import hashlib, os, subprocess, sys, time, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ALWAYS_ON = os.path.join(HERE, "always-on")
GUARD_BIN = os.path.join(ALWAYS_ON, "guard-bin")
LIB_ENV = os.path.join(ALWAYS_ON, "lib_env.sh")


def _run(argv, **kw):
    return subprocess.run(argv, capture_output=True, text=True, **kw)


def _vault_state_dir_for(vault_path):
    """Mirrors lib_env.sh's _vault_key()/_VAULT_STATE_DIR exactly, so
    tests using a THROWAWAY fake vault (a fresh tempfile.mkdtemp() every
    run) can remove their own state dir afterward — production's one real
    vault ($HOME/job-search) keeping ONE small, permanent state dir is
    fine; a test generating a NEW never-reused one every run and never
    cleaning it up is not (leaves no temp files, always-on rule). Fix
    round 3: the state dir moved from $TMPDIR to $HOME/.cache — a
    per-process TMPDIR meant the owner's own terminal and a sandboxed
    session could see a DIFFERENT vault lock for the SAME real vault."""
    real = os.path.realpath(vault_path)
    key = hashlib.sha256(real.encode()).hexdigest()[:16]
    home = os.environ.get("HOME") or "/tmp"
    return os.path.join(home, ".cache", f".careercoach-vault-{key}")


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


def _source_lib_env(script, env_extra=None):
    """Runs `script` in bash AFTER sourcing lib_env.sh exactly the way
    every run_*.sh does (ROOT/REPO set first, in a real subprocess — not
    a text scan of the file)."""
    env = dict(os.environ)
    env.update(env_extra or {})
    prologue = f'set -u\nROOT="{ALWAYS_ON}"\nREPO="{os.path.dirname(ALWAYS_ON)}"\nsource "{LIB_ENV}"\n'
    return subprocess.run(["bash", "-c", prologue + script],
                          capture_output=True, text=True, env=env)


def test_lib_env_puts_guard_bin_first_on_path():
    """Behavioural, not text-presence (a prior version of this test only
    grepped the file for the word "guard-bin", and would have passed even
    if guard-bin were appended LAST on PATH, after the real system
    binaries it needs to shadow)."""
    r = _source_lib_env('echo "${PATH%%:*}"')
    assert r.stdout.strip() == GUARD_BIN, (r.stdout, r.stderr)


def test_lib_env_scrubs_every_ambient_claude_var():
    """Behavioural: actually sources lib_env.sh with ambient CLAUDE* vars
    present (not just CLAUDE_CODE_*) and checks the environment a real
    `claude` invocation afterward would see, rather than grepping the
    file for a substring."""
    r = _source_lib_env(
        "env | grep -E '^CLAUDE' | cut -d= -f1 | sort || true",
        {"CLAUDE_CODE_REVIEW_PROBE": "1", "CLAUDE_EFFORT": "high",
         "CLAUDE_PID": "12345", "CLAUDE_AGENT_SDK_VERSION": "0.0.0",
         "CLAUDE_PREVIEW_CLASSIFIER_FLOOR": "1", "CLAUDECODE": "1"},
    )
    assert r.stdout.strip() == "", (r.stdout, r.stderr)


def _is_locked(fixture):
    return subprocess.run(
        [sys.executable, "-c",
         f"import os,sys; sys.exit(0 if (os.stat({fixture!r}).st_flags & 0x2) else 1)"]
    ).returncode == 0


def test_vault_lock_is_reference_counted_across_two_holders():
    """The race this fixes: two sibling runners (in this checkout OR a
    DIFFERENT one — the lock is keyed by the vault's own path, not by
    checkout) lock the same vault; the first one to finish must NOT
    unlock it while the second is still relying on it staying locked.
    Uses two REAL, CONCURRENT, long-lived processes (subprocess.Popen,
    not two sequential subprocess.run calls) — a sequential version
    would have each "holder" already exited by the time the next call's
    liveness-pruning ran, which trivially passes for the wrong reason
    (found live while fixing this exact test after the pruning behavior
    landed)."""
    fake_vault = tempfile.mkdtemp(prefix="fake-job-search-")
    fixture = os.path.join(fake_vault, "resume.md")
    open(fixture, "w", encoding="utf-8").write("fixture, not real candidate data\n")
    try:
        env = dict(os.environ, REALJS=fake_vault)
        holder_script = (
            f'set -u\nROOT="{ALWAYS_ON}"\nREPO="{os.path.dirname(HERE)}"\n'
            f'source "{LIB_ENV}"\nvault_lock\necho LOCKED\nsleep "$1"\nvault_unlock\necho DONE\n'
        )
        a = subprocess.Popen(["bash", "-c", holder_script, "_", "2"],
                              stdout=subprocess.PIPE, text=True, env=env)
        time.sleep(0.5)  # let A actually acquire before B starts
        assert _is_locked(fixture), "holder A's own lock did not take effect"
        b = subprocess.Popen(["bash", "-c", holder_script, "_", "0.3"],
                              stdout=subprocess.PIPE, text=True, env=env)
        b_out = b.communicate(timeout=30)[0]
        assert "DONE" in b_out, b_out
        assert _is_locked(fixture), (
            "vault_unlock from holder B (which finished first) must not unlock "
            "the vault while holder A is still counted as holding it"
        )
        a_out = a.communicate(timeout=30)[0]
        assert "DONE" in a_out, a_out
        assert not _is_locked(fixture), "the LAST holder's release must actually unlock the vault"
    finally:
        subprocess.run(["chflags", "nouchg", fixture], capture_output=True)
        shutil.rmtree(_vault_state_dir_for(fake_vault), ignore_errors=True)
        shutil.rmtree(fake_vault, ignore_errors=True)


def test_vault_lock_recovers_a_stale_refcount_after_a_sigkilled_holder():
    """A holder killed with SIGKILL never reaches its own vault_unlock. A
    plain integer count would stay stuck above 0 forever; this asserts the
    NEXT vault_lock call self-heals (prunes the dead holder) instead of
    trusting a stale count and leaving the vault unprotected."""
    fake_vault = tempfile.mkdtemp(prefix="fake-job-search-")
    fixture = os.path.join(fake_vault, "resume.md")
    open(fixture, "w", encoding="utf-8").write("fixture, not real candidate data\n")
    try:
        env = dict(os.environ, REALJS=fake_vault)
        crash_script = (
            f'set -u\nROOT="{ALWAYS_ON}"\nREPO="{os.path.dirname(HERE)}"\n'
            f'source "{LIB_ENV}"\nvault_lock\nkill -9 $$\n'
        )
        subprocess.run(["bash", "-c", crash_script], env=env, capture_output=True)
        assert _is_locked(fixture), "the crashed holder's own lock should still show (nothing unlocked it)"
        # Simulate an operator manually clearing the flag after the crash —
        # the only way to recover it under the OLD, non-pruning design.
        subprocess.run(["chflags", "nouchg", fixture], capture_output=True)
        next_script = (
            f'set -u\nROOT="{ALWAYS_ON}"\nREPO="{os.path.dirname(HERE)}"\n'
            f'source "{LIB_ENV}"\nvault_lock\n'
        )
        r = subprocess.run(["bash", "-c", next_script], env=env, capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        assert _is_locked(fixture), (
            "a stale refcount (dead holder never pruned) leaves the vault "
            "UNPROTECTED for the next runner instead of re-locking it"
        )
    finally:
        subprocess.run(["chflags", "nouchg", fixture], capture_output=True)
        shutil.rmtree(_vault_state_dir_for(fake_vault), ignore_errors=True)
        shutil.rmtree(fake_vault, ignore_errors=True)


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


def test_kill_guard_args_array_is_populated_behaviourally():
    """Not text-presence: actually sources lib_env.sh and inspects the
    resulting bash array, rather than grepping the file for a pattern
    string."""
    r = _source_lib_env('printf "%s\\n" "${CLAUDE_KILL_GUARD_ARGS[@]}"')
    lines = [l for l in r.stdout.splitlines() if l]
    assert "--disallowedTools" in lines, (lines, r.stderr)
    for must in ("Bash(pkill*)", "Bash(killall*)", "Bash(/usr/bin/pkill*)",
                 "Bash(/usr/bin/killall*)", "Bash(kill*)", "Bash(pgrep*)",
                 "Bash(*Google Chrome*)", "Bash(*Chromium*)",
                 "Bash(sh -c*)", "Bash(bash -c*)", "Bash(zsh -c*)",
                 "Bash(/bin/*sh -c*)",
                 "Bash(*; sh -c*)", "Bash(*&& sh -c*)", "Bash(*| sh -c*)"):
        assert must in lines, (must, lines)
    # Fix round 5 (BLOCKING, independent review): the earlier `Bash(*sh -c*)`
    # / `Bash(*bash -c*)` infix forms false-positived on ordinary text that
    # merely CONTAINS "sh -c" as a substring (e.g. `echo "refresh -c"`, whose
    # tail is "...re" + "sh -c" + "\""). They must be gone; command-position
    # anchored forms above replace the coverage they were meant to provide.
    for banned in ("Bash(*sh -c*)", "Bash(*bash -c*)"):
        assert banned not in lines, (
            f"{banned} is an unanchored infix pattern that false-positives "
            "on ordinary text containing the substring 'sh -c' with no "
            "shell wrapper involved at all", lines
        )


def test_every_claude_p_invocation_site_splices_in_the_kill_guard_args():
    """Structural check across every run_*.sh / judge_*.sh / check_env.sh:
    a `claude -p` invocation that passes --setting-sources project but
    NOT the shared CLAUDE_KILL_GUARD_ARGS array is a site the 2026-09-27
    permission-guard rollout missed."""
    import glob
    missed = []
    for path in sorted(glob.glob(os.path.join(ALWAYS_ON, "*.sh"))):
        if os.path.basename(path) == "probe_guards.sh":
            continue  # the reviewer's own probe, not a runner/judge
        text = open(path, encoding="utf-8").read()
        for i, line in enumerate(text.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            # check_env.sh's own STATIC CHECK of other files' text (grepping
            # for the flag, or naming it in a FAIL message) is not itself an
            # invocation — skip those two shapes specifically.
            if "grep -q" in line or "is MISSING" in line:
                continue
            if "--setting-sources project" in line and "CLAUDE_KILL_GUARD_ARGS" not in line:
                missed.append(f"{os.path.basename(path)}:{i}")
    assert missed == [], f"claude invocation(s) missing the kill-guard args: {missed}"


# --- HOME sandbox for every runner (fix round 4) ---------------------------
# A re-test found an agent under test ran `find / -maxdepth 6 -iname coach`
# and executed the owner's DEPLOYED ~/.claude/skills/coach/scripts/
# check_closeout.py — only run_t19.sh sandboxed HOME before this fix, and
# even ITS sandbox was too broad (a wholesale `cp -R "$HOME/.claude"`
# copied the owner's skills/history/sessions into the "fake" home too).


def test_sandbox_home_setup_never_copies_the_owners_skills_or_history():
    """Behavioural: actually calls sandbox_home_setup (sourced the way
    every run_*.sh does) and inspects the REAL resulting directory, not a
    text scan of lib_env.sh."""
    r = _source_lib_env(
        'sandbox_home_setup\n'
        'echo "FAKEHOME=$FAKEHOME"\n'
        'ls -A "$FAKEHOME/.claude" 2>/dev/null | wc -l | tr -d " "\n'
        'echo "HTOK_LEN=${#HTOK}"\n'
        'sandbox_home_cleanup\n'
        '[ -d "$FAKEHOME" ] && echo STILL_EXISTS || echo GONE\n'
    )
    lines = r.stdout.splitlines()
    assert lines, (r.stdout, r.stderr)
    fakehome_line = next(l for l in lines if l.startswith("FAKEHOME="))
    fakehome = fakehome_line.split("=", 1)[1]
    assert fakehome != os.environ.get("HOME"), "must be a throwaway dir, never the real HOME"
    claude_dir_count = lines[lines.index(fakehome_line) + 1]
    assert claude_dir_count == "0", (
        f"$FAKEHOME/.claude/ must be EMPTY (no skills/, no history, no "
        f"projects/) — found {claude_dir_count} entries"
    )
    assert "GONE" in lines, "sandbox_home_cleanup must remove the fake home"


def test_sandbox_home_setup_reads_the_harness_token_without_writing_it_anywhere():
    """The owner's setup-token (~/.claude/harness-token, chmod 600) must be
    read into $HTOK for the ONE invocation's env var — never written to
    the fake home's filesystem (that's the whole point: nothing there for
    a failed auth to write an empty token back through)."""
    if not os.path.isfile(os.path.join(os.environ.get("HOME", ""), ".claude", "harness-token")):
        print("SKIPPED: no ~/.claude/harness-token on this host")
        return
    r = _source_lib_env(
        'sandbox_home_setup\n'
        'echo "HTOK_LEN=${#HTOK}"\n'
        'find "$FAKEHOME" -iname "*harness-token*" | wc -l | tr -d " "\n'
        'sandbox_home_cleanup\n'
    )
    lines = r.stdout.splitlines()
    htok_len = int(next(l for l in lines if l.startswith("HTOK_LEN=")).split("=", 1)[1])
    assert htok_len > 0, "HTOK must be populated from the real harness-token"
    found_count = lines[-1] if lines else "?"
    assert found_count == "0", "the token file itself must never be copied into the fake home"


def test_every_dangerously_skip_permissions_site_calls_sandbox_home_setup():
    """Structural check: every run_*.sh that grants --dangerously-skip-
    permissions or --permission-mode (a conversational, tool-using agent
    under test) must call sandbox_home_setup somewhere in the file — the
    HOME it hands to `claude -p` must come from that call, never the
    real, ambient $HOME."""
    import glob
    missed = []
    for path in sorted(glob.glob(os.path.join(ALWAYS_ON, "run_*.sh"))):
        text = open(path, encoding="utf-8").read()
        needs_sandbox = "--dangerously-skip-permissions" in text or "--permission-mode" in text
        if needs_sandbox and "sandbox_home_setup" not in text:
            missed.append(os.path.basename(path))
    assert missed == [], f"runner(s) grant tool access without a HOME sandbox: {missed}"


def test_every_claude_p_site_that_uses_fakehome_also_cleans_it_up():
    """Every run_*.sh that calls sandbox_home_setup must also call
    sandbox_home_cleanup — a fake home leaked forever is still a smaller
    problem than none at all, but it is still a leak (temp files, always-
    on rule)."""
    import glob
    missed = []
    for path in sorted(glob.glob(os.path.join(ALWAYS_ON, "run_*.sh"))):
        text = open(path, encoding="utf-8").read()
        if "sandbox_home_setup" in text and "sandbox_home_cleanup" not in text:
            missed.append(os.path.basename(path))
    assert missed == [], f"runner(s) call sandbox_home_setup with no matching cleanup: {missed}"


# --- Every conduct-probe workspace ships coach (fix round 5) ---------------
# A re-test found an agent under test `find`-ing and RUNNING the owner's
# DEPLOYED ~/.claude/skills/coach/scripts/check_closeout.py by absolute
# path — the product ships coach in every real workspace (the daily
# driver), and a conduct-probe workspace missing it is unrealistic enough
# to invite exactly this hunt, contaminating the measurement (env contract
# rule 1). t4 and run_replay.sh are DELIBERATE exceptions: they are
# attribution/isolation experiments whose whole point is testing WITHOUT
# extra skills (model alone / +guardrails / +guardrails+ONE skill) — the
# coordinator's instruction is read as "conduct-probe runners", not these
# two, since adding coach there would change what they measure. run_t15.sh
# never installs any skills at all (materials inlined into the prompt, no
# tools needed) — there is no `.claude/skills/` for it to add coach to.
_CONDUCT_PROBE_RUNNERS = [
    "run_t5.sh", "run_t6.sh", "run_t7.sh", "run_t8.sh", "run_t9.sh",
    "run_t10.sh", "run_t12.sh", "run_t13.sh", "run_t14.sh", "run_t19.sh",
    "run_t21.sh",
]


def test_every_conduct_probe_runner_installs_coach():
    for name in _CONDUCT_PROBE_RUNNERS:
        text = open(os.path.join(ALWAYS_ON, name), encoding="utf-8").read()
        assert ("RUNNER_SKILLS_DIR/coach" in text
                or 'RUNNER_SKILLS_DIR"/*' in text), (
            f"{name} installs a partial skill set without coach — an agent "
            "without it hunts the disk for the owner's deployed copy"
        )
