"""Independent review (tester, 2026-10-20) of the step counter, Phase A of
docs/design-fewer-steps.md (§ 1.1-§ 1.3): key safety and real-data safety
first. A FAKE key and a scripted fetch only (tests/step-trace-review/
hostile-fetch-preload.mjs, which also refuses every non-loopback socket); no
model is called and the owner's key is never read. HOME, the vault path and
the results root are temp dirs; the real ~/job-search is never named.

    python3 tests/test_step_trace_review.py
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(REPO, "packages", "agent", "bin", "run.mjs")
DRIVER = os.path.join(REPO, "tests", "always-on", "run_step_trace.sh")
SCORER = os.path.join(REPO, "tests", "always-on", "score_step_trace.py")
PRELOAD = os.path.join(REPO, "tests", "step-trace-review", "hostile-fetch-preload.mjs")
TEMPLATE = os.path.join(REPO, "skills", "profile", "templates", "workspace-CLAUDE.md")
MODEL = "deepseek/deepseek-v4.1-flash"
KEY = "sk-or-v1-REVIEWFAKE-9f3c1e7a2b6d4f08e1c5a9b3d7f2e6a0c4b8"
FRAGMENTS = [KEY, KEY[10:34], KEY[-24:]]
TMP = os.path.realpath(tempfile.gettempdir())


def _env(extra=None, key=True):
    env = {k: v for k, v in os.environ.items() if "OPENROUTER" not in k and not k.startswith("CLAUDE") and k not in ("DRY_RUN", "NODE_OPTIONS")}
    if key:
        env["OPENROUTER_API_KEY"] = KEY
    env.update(extra or {})
    return env


def _fresh_ws():
    ws = tempfile.mkdtemp(prefix="rv-ws-")
    shutil.copy(TEMPLATE, os.path.join(ws, "CLAUDE.md"))
    return ws


def _run(items, turns=None, ws=None, extra_args=None, env_extra=None, key=True, timeout=180):
    d = tempfile.mkdtemp(prefix="rv-run-")
    script = os.path.join(d, "script.json")
    log = os.path.join(d, "requests.jsonl")
    json.dump(items, open(script, "w"))
    ws = ws or _fresh_ws()
    args = ["node", "--import", PRELOAD, BIN, "--workspace", ws, "--skills", os.path.join(REPO, "skills"), "--model", MODEL, "--trace"]
    if turns is not None:
        tf = os.path.join(d, "turns.json")
        json.dump(turns, open(tf, "w"))
        args += ["--turns", tf, "--fixtures", d]
    else:
        args += ["--prompt", "hi"]
    args += extra_args or []
    r = subprocess.run(args, env=_env(dict(RV_SCRIPT=script, RV_LOG=log, **(env_extra or {})), key=key), capture_output=True, text=True, timeout=timeout, cwd=REPO)
    reqs = [json.loads(l) for l in open(log) if l.strip()] if os.path.exists(log) else []
    return r, reqs, ws, d


def _files_with_key(root):
    hits = []
    for dp, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(dp, f)
            try:
                b = open(p, "rb").read()
            except OSError:
                continue
            if any(x.encode() in b for x in FRAGMENTS):
                hits.append(os.path.relpath(p, root))
    return hits


def _no_key(text, where):
    for x in FRAGMENTS:
        assert x not in text, f"{where} holds the key (or part of it)"


# ---------------------------------------------------------------- 1. the key

PROBES = [
    {"tools": [{"name": "bash", "args": {"command": "env"}}], "cost": 0.001},
    {"tools": [{"name": "bash", "args": {"command": "printenv OPENROUTER_API_KEY; echo \"k=$OPENROUTER_API_KEY\"; set"}}], "cost": 0.001},
    {"tools": [{"name": "bash", "args": {"command": "cat /proc/self/environ; ls /; cat ~/.zshrc; ls ~"}}], "cost": 0.001},
    {"tools": [{"name": "read_file", "args": {"path": "../../../../../../etc/hosts"}}], "cost": 0.001},
    {"text": "Done for now.", "cost": 0.001},
]


def test_the_key_reaches_only_the_authorization_header_of_openrouter_requests():
    """A model that hunts for the key (env, printenv, set, /proc, ~/.zshrc, a path outside the workspace)
    finds nothing: no request body, no stdout, no stderr line, no workspace file holds it, and every
    request goes to openrouter.ai with it as the bearer token and nowhere else."""
    r, reqs, ws, d = _run(PROBES, turns=[{"text": "first"}, {"text": "second"}])
    assert r.returncode == 0, r.stderr[-1500:]
    assert len(reqs) >= 6, len(reqs)
    for q in reqs:
        assert q["url"].startswith("https://openrouter.ai/"), q["url"]
        assert q["headers"].get("authorization") == f"Bearer {KEY}"
        others = {k: v for k, v in q["headers"].items() if k != "authorization"}
        _no_key(json.dumps(others), f"request {q['n']} headers other than authorization")
        _no_key(q["body"], f"request {q['n']} body")
    _no_key(r.stdout, "stdout (replies)")
    _no_key(r.stderr, "stderr")
    assert _files_with_key(ws) == [], _files_with_key(ws)
    # and what the sandbox's bash actually answered (so the probes were live)
    bodies = "\n".join(q["body"] for q in reqs)
    assert "exitCode" in bodies or "exit" in bodies


def test_trace_lines_mask_a_key_the_model_echoes_in_a_command_a_file_write_or_a_path():
    items = [
        {"tools": [{"name": "bash", "args": {"command": f"echo {KEY} > notes.txt"}}], "cost": 0.001},
        {"tools": [{"name": "write_file", "args": {"path": f"documents/{KEY[:30]}.md", "content": f"key {KEY}"}}], "cost": 0.001},
        {"tools": [{"name": "read_file", "args": {"path": f"{KEY}.md"}}], "cost": 0.001},
        {"tools": [{"name": "web_search", "args": {"query": f"what is {KEY}"}}], "cost": 0.001},
        {"text": f"Your key is {KEY}", "cost": 0.001},
    ]
    r, reqs, ws, d = _run(items, turns=[{"text": "go"}])
    trace = [l for l in r.stderr.splitlines() if l.startswith("[trace]")]
    assert len(trace) >= 5, trace
    for l in trace:
        _no_key(l, "a [trace] line")
    assert any("[redacted]" in l for l in trace)
    # Outside the trace lines the key is only where the MODEL put it (the model never has it in this
    # runner: see the test above). Printed so the hand-back can say what is and isn't masked.
    print("  [echo] stdout holds the key:", any(x in r.stdout for x in FRAGMENTS))
    print("  [echo] non-trace stderr holds the key:", any(x in "\n".join(l for l in r.stderr.splitlines() if not l.startswith("[trace]")) for x in FRAGMENTS))
    print("  [echo] workspace files holding it:", _files_with_key(ws))


def test_failed_requests_never_print_the_key_even_when_the_provider_echoes_it():
    cases = {
        "401 echoing the auth header": [{"status": 401, "body": '{"error":{"message":"Invalid key {AUTH}","code":401}}'}],
        "403": [{"status": 403, "body": '{"error":{"message":"forbidden for {AUTH}"}}'}],
        "429": [{"status": 429, "body": '{"error":{"message":"rate limited {AUTH}"}}'}],
        "500": [{"status": 500, "body": "upstream said {AUTH}"}],
        "502 html": [{"status": 502, "body": "<html>bad gateway {AUTH}</html>"}],
        "network error": [{"throw": "fetch failed: connect ECONNRESET with {AUTH}"}],
        "error after a tool step": [{"tools": [{"name": "list_files", "args": {}}], "cost": 0.001}, {"status": 500, "body": "{AUTH}"}],
    }
    # FINDING (tester, 2026-10-20): a failed request's error is printed to stderr UNMASKED, twice: the
    # SDK's whole AI_APICallError (its responseBody and data.error.message) and the `[error] model_error:
    # <message>` line. Only `[trace]` lines pass through the mask. So a provider that echoes the bearer
    # token in its error text puts the key in stderr.txt. Pinned below as it is (the leaking cases are
    # listed); the test fails when the mask is extended, and then this block should become a plain
    # "never in stderr" assertion.
    seen = {}
    leaked = []
    for name, items in cases.items():
        for turns in (None, [{"text": "a"}, {"text": "b"}]):
            r, reqs, ws, d = _run(items, turns=turns)
            label = f"{name} ({'turns' if turns else 'prompt'})"
            seen[label] = (r.returncode, [l.replace(KEY, "<KEY>") for l in r.stderr.splitlines() if l.startswith(("[error]", "run.mjs failed"))][:2])
            _no_key(r.stdout, f"{label}: stdout")
            for l in r.stderr.splitlines():
                if l.startswith("[trace]") or l.startswith("[cost]"):
                    _no_key(l, f"{label}: a [trace]/[cost] line")
            if any(x in r.stderr for x in FRAGMENTS):
                leaked.append(label)
            assert r.returncode in (1, 3), (label, r.returncode, r.stderr[-600:])
            assert _files_with_key(ws) == [] and set(_files_with_key(d)) <= {"requests.jsonl"}, label  # the request log holds the header by design
    for k, v in seen.items():
        print(f"  [errors] {k}: exit {v[0]}; {v[1]}")
    print(f"  [errors] FINDING: the echoed key reached stderr in: {leaked}")
    assert not leaked, f"the echoed key reached stderr in: {leaked}"   # fixed: every stderr write is masked


def test_the_driver_under_bash_x_prints_the_key_value():
    """A characterization: `bash -x run_step_trace.sh` (a person debugging) prints the key's VALUE on
    stderr, from the `${!KEY_ENV:-}` test. The driver itself never turns xtrace on."""
    tmp = tempfile.mkdtemp(prefix="rv-x-")
    env = _env({"HOME": os.path.join(tmp, "home"), "REALJS": os.path.join(tmp, "no-vault"), "RESULTS_ROOT": os.path.join(tmp, "results"), "DRY_RUN": "1"})
    os.makedirs(env["HOME"])
    r = subprocess.run(["bash", "-x", DRIVER, MODEL, "xtrace"], env=env, capture_output=True, text=True, timeout=120)
    leaked = KEY in r.stderr
    print(f"  [bash -x] exit {r.returncode}; the key's value appears in xtrace output: {leaked}")
    src = open(DRIVER).read()
    assert "set -x" not in src and "set -o xtrace" not in src, "the driver turns xtrace on itself"
    # without -x, nothing prints it
    r2 = subprocess.run(["bash", DRIVER, MODEL, "plain"], env=env, capture_output=True, text=True, timeout=120)
    _no_key(r2.stdout + r2.stderr, "the driver's own output")
    assert _files_with_key(os.path.join(tmp, "results")) == []
    shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- 2. real data

def test_turns_refuses_every_workspace_that_is_not_a_fresh_temp_folder_before_any_request():
    outside = tempfile.mkdtemp(prefix="rv-outside-", dir=os.path.join(REPO, "tests"))   # a non-temp folder (in the repo)
    shutil.copy(TEMPLATE, os.path.join(outside, "CLAUDE.md"))
    link_dir = tempfile.mkdtemp(prefix="rv-link-")
    os.symlink(outside, os.path.join(link_dir, "ws"))
    full = _fresh_ws(); open(os.path.join(full, "profile.md"), "w").write("Zebulon\n")
    nested = _fresh_ws(); os.makedirs(os.path.join(nested, "documents")); open(os.path.join(nested, "documents", "cv.pdf"), "w").write("x")
    hidden = _fresh_ws(); os.makedirs(os.path.join(hidden, ".git")); open(os.path.join(hidden, ".git", "HEAD"), "w").write("x")
    sublink = _fresh_ws(); os.symlink(outside, os.path.join(sublink, "documents"))
    claude_link = tempfile.mkdtemp(prefix="rv-cl-"); os.symlink(os.path.join(outside, "CLAUDE.md"), os.path.join(claude_link, "CLAUDE.md"))
    try:
        cases = {
            "the repo": REPO,
            "a folder in the repo": outside,
            "a temp symlink to a non-temp folder": os.path.join(link_dir, "ws"),
            "a temp path climbing out with ..": os.path.join(TMP, "..", "..", os.path.relpath(outside, "/")),
            "the temp root itself": TMP,
            "a temp folder holding profile.md": full,
            "a temp folder holding documents/cv.pdf": nested,
            "a temp folder holding .git/HEAD": hidden,
            "a temp folder whose documents/ is a link out": sublink,
            "/": "/",
            "a path that does not exist": os.path.join(TMP, "rv-no-such-folder"),
        }
        bad = []
        for name, ws in cases.items():
            r, reqs, _, _ = _run([{"text": "x", "cost": 0.001}], turns=[{"text": "hi"}], ws=ws)
            if r.returncode != 2 or reqs:
                bad.append((name, r.returncode, len(reqs)))
        assert bad == [], bad
        assert sorted(os.listdir(outside)) == ["CLAUDE.md"], "the refused folder was changed"
        # a CLAUDE.md that is a symlink out: allowed by the name check; record what happens
        r, reqs, _, _ = _run([{"tools": [{"name": "read_file", "args": {"path": "CLAUDE.md"}}], "cost": 0.001}, {"text": "x", "cost": 0.001}], turns=[{"text": "hi"}], ws=claude_link)
        print(f"  [refusals] a temp folder whose CLAUDE.md links out: exit {r.returncode}, requests {len(reqs)}; read_file answered: {'outside_workspace' in json.dumps([q['body'] for q in reqs])}")
    finally:
        shutil.rmtree(outside, ignore_errors=True)


def test_tmpdir_widens_the_temp_check_to_any_folder():
    """A characterization of § 1.1's 'inside os.tmpdir()': TMPDIR moves os.tmpdir(), so TMPDIR=<a non-temp
    folder> lets a run proceed in a folder there, as long as it holds only CLAUDE.md."""
    fakehome = tempfile.mkdtemp(prefix="rv-fakehome-", dir=os.path.join(REPO, "tests"))
    try:
        ws = os.path.join(fakehome, "job-search")
        os.makedirs(ws)
        shutil.copy(TEMPLATE, os.path.join(ws, "CLAUDE.md"))
        r, reqs, _, _ = _run([{"text": "x", "cost": 0.001}], turns=[{"text": "hi"}], ws=ws, env_extra={"TMPDIR": fakehome})
        print(f"  [TMPDIR] TMPDIR=<a folder in the repo>: a run in <it>/job-search exits {r.returncode} with {len(reqs)} request(s)")
        r2, reqs2, _, _ = _run([{"text": "x", "cost": 0.001}], turns=[{"text": "hi"}], ws=ws)
        assert r2.returncode == 2 and not reqs2, "without TMPDIR the same folder is refused"
    finally:
        shutil.rmtree(fakehome, ignore_errors=True)


def _flags(p):
    return subprocess.run(["ls", "-ldO", p], capture_output=True, text=True).stdout


def _driver_env(tmp, items, extra=None):
    script = os.path.join(tmp, "script.json")
    json.dump(items, open(script, "w"))
    home = os.path.join(tmp, "home")
    os.makedirs(os.path.join(home, ".claude"), exist_ok=True)
    open(os.path.join(home, ".claude", "settings.json"), "w").write("{}")
    vault = os.path.join(tmp, "vault")
    os.makedirs(vault, exist_ok=True)
    open(os.path.join(vault, "profile.md"), "w").write("the fake vault\n")
    env = _env({"HOME": home, "REALJS": vault, "RESULTS_ROOT": os.path.join(tmp, "results"), "NODE_OPTIONS": f"--import {PRELOAD}",
                "RV_SCRIPT": script, "RV_LOG": os.path.join(tmp, "requests.jsonl")})
    env.update(extra or {})
    return env, home, vault


def _snapshot(root):
    out = {}
    for dp, dns, fs in os.walk(root):
        for f in fs:
            p = os.path.join(dp, f)
            st = os.lstat(p)
            out[os.path.relpath(p, root)] = (st.st_size, st.st_mtime_ns)
    return out


def test_driver_end_to_end_locks_the_vault_writes_nothing_under_home_and_leaves_no_key_anywhere():
    tmp = tempfile.mkdtemp(prefix="rv-drv-")
    items = PROBES + [{"text": "Thanks?", "cost": 0.001}]
    env, home, vault = _driver_env(tmp, items)
    before_home = _snapshot(home)
    r = subprocess.run(["bash", DRIVER, MODEL, "e2e"], env=env, capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, (r.stdout[-800:], r.stderr[-800:])
    _no_key(r.stdout + r.stderr, "driver output")
    assert _files_with_key(os.path.join(tmp, "results")) == [], _files_with_key(os.path.join(tmp, "results"))
    reqs = [json.loads(l) for l in open(env["RV_LOG"]) if l.strip()]
    assert reqs and all(q["url"].startswith("https://openrouter.ai/") for q in reqs)
    for q in reqs:
        _no_key(q["body"], "a request body")
    after_home = _snapshot(home)
    changed = sorted(k for k in after_home if after_home.get(k) != before_home.get(k))
    # the one write under HOME is lib_env.sh's shared vault-lock count (~/.cache/.careercoach-vault-*/holders)
    assert all(k.startswith(".cache/.careercoach-vault-") for k in changed), changed
    assert not any(k.startswith(".claude") for k in changed), changed
    assert "uchg" not in _flags(vault) and "uchg" not in _flags(os.path.join(vault, "profile.md")), "the vault was left locked"
    shutil.rmtree(tmp, ignore_errors=True)


def test_ctrl_c_mid_request_unlocks_the_vault_and_leaves_no_runner_behind():
    tmp = tempfile.mkdtemp(prefix="rv-int-")
    env, home, vault = _driver_env(tmp, [{"hang": True}])
    p = subprocess.Popen(["bash", DRIVER, MODEL, "sigint"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        log = env["RV_LOG"]
        for _ in range(300):
            if os.path.exists(log) and open(log).read().strip():
                break
            time.sleep(0.1)
        assert os.path.exists(log), "the run never made its first request"
        locked = "uchg" in _flags(vault)
        # Ctrl-C reaches the whole foreground group: the group THIS test started (its leader is p.pid).
        # macOS can answer killpg with EPERM; then signal each member of that same group by PID.
        try:
            os.killpg(p.pid, signal.SIGINT)
        except PermissionError:
            ps = subprocess.run(["ps", "-ax", "-o", "pid=,pgid="], capture_output=True, text=True).stdout
            for line in ps.splitlines():
                pid, pgid = line.split()
                if int(pgid) == p.pid:
                    try:
                        os.kill(int(pid), signal.SIGINT)
                    except ProcessLookupError:
                        pass
        out, err = p.communicate(timeout=60)
    finally:
        if p.poll() is None:
            os.killpg(p.pid, signal.SIGKILL)
    ps = subprocess.run(["ps", "-ax", "-o", "pid=,pgid=,command="], capture_output=True, text=True).stdout
    left = [l for l in ps.splitlines() if l.split()[1:2] == [str(p.pid)]]
    print(f"  [sigint] vault locked while the request hung: {locked}; driver exit {p.returncode}; processes left in its group: {left}")
    assert locked, "the vault was not locked during the run"
    assert "uchg" not in _flags(vault), "the vault stayed locked after Ctrl-C"
    assert left == [], left
    _no_key(out + err, "output on Ctrl-C")
    shutil.rmtree(tmp, ignore_errors=True)


def test_a_runner_crash_unlocks_the_vault_and_its_stack_trace_holds_no_key():
    tmp = tempfile.mkdtemp(prefix="rv-crash-")
    env, home, vault = _driver_env(tmp, [{"crash": True}])
    r = subprocess.run(["bash", DRIVER, MODEL, "crash"], env=env, capture_output=True, text=True, timeout=300)
    trial = os.path.join(tmp, "results", "st-crash", "1")
    err = open(os.path.join(trial, "stderr.txt"), errors="replace").read() if os.path.exists(os.path.join(trial, "stderr.txt")) else ""
    print(f"  [crash] driver exit {r.returncode}; trial exit {open(os.path.join(trial, 'exit.txt')).read().strip()}; a stack trace in stderr.txt: {'at ' in err}")
    assert "rv crash" in err, "the crash did not happen"
    _no_key(r.stdout + r.stderr + err, "crash output")
    assert _files_with_key(os.path.join(tmp, "results")) == []
    assert "uchg" not in _flags(vault), "the vault stayed locked after a crash"
    shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- 3. spending

def test_the_cost_stop_fires_before_the_next_request():
    tool = {"tools": [{"name": "list_files", "args": {}}], "cost": 0.4}
    r, reqs, _, _ = _run([tool] * 20, turns=[{"text": "a"}, {"text": "b"}, {"text": "c"}], extra_args=["--max-usd", "1"])
    assert r.returncode == 4, (r.returncode, r.stderr[-600:])
    assert len(reqs) == 3, f"requests made: {len(reqs)} (0.4 + 0.4 + 0.4 passes $1 at the third)"
    assert "[stop]" in r.stderr and "=== turn 3 ===" not in r.stdout, "a turn ran after the stop"
    # exactly at the line is not over it
    r, reqs, _, _ = _run([{"tools": [{"name": "list_files", "args": {}}], "cost": 0.5}, {"text": "x", "cost": 0.5}, {"text": "y", "cost": 0.1}], turns=[{"text": "a"}, {"text": "b"}], extra_args=["--max-usd", "1"])
    print(f"  [cap] exactly $1.00 after turn 1: exit {r.returncode}, requests {len(reqs)}")
    # --turns without --max-usd defaults to $1
    # (reply-only turns: with $0.40 tool steps the coach's own spend gate pauses a turn after two steps first)
    replies = [{"text": f"reply {i}", "cost": 0.45} for i in range(6)]
    r, reqs, _, _ = _run(replies, turns=[{"text": "a"}, {"text": "b"}, {"text": "c"}, {"text": "d"}])
    assert r.returncode == 4 and len(reqs) == 3 and "=== turn 4 ===" not in r.stdout, (r.returncode, len(reqs))


def test_a_provider_that_reports_no_cost_is_never_stopped_by_the_cap():
    """A characterization: the stop reads the provider's reported cost; steps with none add nothing,
    so the cap can't fire. What bounds such a run is the coach's own step limit per turn."""
    r, reqs, _, _ = _run([{"tools": [{"name": "list_files", "args": {}}], "nocost": True}] * 60 + [{"text": "x", "nocost": True}], turns=[{"text": "a"}, {"text": "b"}], extra_args=["--max-usd", "0.01"])
    unknown = [l for l in r.stderr.splitlines() if l.startswith("[cost]")]
    print(f"  [nocost] exit {r.returncode}; requests {len(reqs)}; cost lines {unknown}")
    assert len(reqs) > 3, "the cap fired with no cost reported (then this characterization is stale)"


def test_trials_3_spend_at_most_one_cap_overrun_then_stop():
    tmp = tempfile.mkdtemp(prefix="rv-trials-")
    tool = {"tools": [{"name": "list_files", "args": {}}], "cost": 0.3}
    env, home, vault = _driver_env(tmp, [tool] * 40, {"TRIALS": "3"})
    r = subprocess.run(["bash", DRIVER, MODEL, "trials"], env=env, capture_output=True, text=True, timeout=600)
    reqs = [json.loads(l) for l in open(env["RV_LOG"]) if l.strip()]
    print(f"  [trials] TRIALS=3 at $0.30 a step: driver exit {r.returncode}, requests {len(reqs)}, trials run {sorted(os.listdir(os.path.join(tmp, 'results', 'st-trials')))}")
    assert r.returncode == 4 and len(reqs) == 4, (r.returncode, len(reqs))
    assert not os.path.exists(os.path.join(tmp, "results", "st-trials", "2")), "a second trial ran after the stop"
    # under the cap, three trials of about $0.90 each: at most 3 x $1
    shutil.rmtree(tmp, ignore_errors=True)
    tmp = tempfile.mkdtemp(prefix="rv-trials2-")
    items = [{"tools": [{"name": "list_files", "args": {}}], "cost": 0.2}, {"text": "a", "cost": 0.2}] * 2 + [{"text": "b", "cost": 0.1}] * 4
    env, home, vault = _driver_env(tmp, items, {"TRIALS": "3"})
    r = subprocess.run(["bash", DRIVER, MODEL, "trials2"], env=env, capture_output=True, text=True, timeout=600)
    total = [l for l in r.stdout.splitlines() if l.startswith("total cost_usd=")]
    print(f"  [trials] three trials under the cap: exit {r.returncode}; {total}")
    shutil.rmtree(tmp, ignore_errors=True)


def test_the_model_allowlist_holds_in_the_driver_and_the_runner():
    tmp = tempfile.mkdtemp(prefix="rv-model-")
    env, home, vault = _driver_env(tmp, [{"text": "x", "cost": 0.001}])
    for m in ["openai/gpt-5", "deepseek/deepseek-v4.1-flash ", " deepseek/deepseek-v4.1-flash", "DEEPSEEK/deepseek-v4.1-flash", "", "anthropic/claude-sonnet-5;touch /tmp/rv-pwned", "deepseek/deepseek-v4.1-flash:free", "anthropic/claude-sonnet-5'); process.exit(0); ('"]:
        r = subprocess.run(["bash", DRIVER, m, "model"], env=env, capture_output=True, text=True, timeout=120)
        assert r.returncode == 2, (m, r.returncode, r.stderr[-300:])
        assert not os.path.exists(env["RV_LOG"]), f"{m!r}: a request was made"
        assert not os.path.exists("/tmp/rv-pwned")
    for m in ["openai/gpt-5", "deepseek/deepseek-v4.1-flash:free"]:
        d = tempfile.mkdtemp(prefix="rv-m-")
        json.dump([{"text": "x"}], open(os.path.join(d, "none.json"), "w"))
        r = subprocess.run(["node", "--import", PRELOAD, BIN, "--workspace", _fresh_ws(), "--skills", os.path.join(REPO, "skills"), "--model", m, "--prompt", "hi"],
                           env=_env({"RV_SCRIPT": os.path.join(d, "none.json"), "RV_LOG": os.path.join(d, "log")}), capture_output=True, text=True, timeout=60)
        assert r.returncode == 2 and not os.path.exists(os.path.join(d, "log")), (m, r.returncode)
    shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- 4. the scorer

def test_the_scorer_adds_up_marks_a_mismatch_and_never_prints_reply_text():
    tmp = tempfile.mkdtemp(prefix="rv-score-")
    t1 = os.path.join(tmp, "1")
    os.makedirs(t1)
    lines = [
        "[trace] turn=1 step=1 tool=list_files in=(all) out=1 files",
        "[trace] turn=1 step=1 tool=read_file in=CLAUDE.md out=900 chars",
        "[trace] turn=1 step=2 tool=load_skill in=profile out=ok",
        "[trace] turn=1 step=3 tool=bash in=mkdir -p documents out=exit=0 clean",
        "[trace] turn=1 step=4 tool=bash in=ls skills out=exit=0 clean",
        "[trace] turn=1 step=5 tool=write_file in=profile.md (120 chars) out=written",
        "[trace] turn=1 step=6 tool=bash in=node skills/coach/scripts/check_closeout.mjs out=exit=1 FAIL plan.md",
        "[trace] turn=1 step=7 tool=bash in=node skills/coach/scripts/check_closeout.mjs out=exit=0 clean",
        "[trace] turn=1 step=8 tool=estimate_cost in=search out=needsGate=false",
        "[trace] turn=1 step=9 reply (40 chars)",
        "[cost] turn=1 usd=0.010000 steps=9",
        "[trace] turn=2 step=1 reply (10 chars)",
        "[trace] WARN steps ui=1 cost=2",
        "[cost] turn=2 usd=0.002000 steps=2",
        "[trace] turn=3 step=1 tool=bash in=node skills/coach/scripts/check_closeout.mjs out=exit=0 clean",
        "[trace] turn=3 step=2 reply (5 chars)",
        "[cost] turn=3 usd=0.002000 steps=2",
        "[trace] turn=4 step=1 reply (12 chars)",
        "[cost] turn=4 usd=0.001000 steps=1",
        "[cost] usd=0.015000 steps=14",
    ]
    open(os.path.join(t1, "stderr.txt"), "w").write("\n".join(lines) + "\n")
    SENT = "REPLYSENTINEL-Zebulon-417k"
    open(os.path.join(t1, "replies.md"), "w").write(f"=== turn 1 ===\n{SENT} one\n=== turn 2 ===\n{SENT}\n=== turn 3 ===\n{SENT}\n=== turn 4 ===\n{SENT} see you\n")
    r = subprocess.run([sys.executable, SCORER, tmp], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    out = r.stdout
    assert SENT not in out, "reply text reached the scorer's output"
    t1_block = out.split("turn 1 ")[1].split("turn 2 ")[0]
    by = [l for l in t1_block.splitlines() if "by class:" in l][0]
    counts = dict((p.split()[0], int(p.split()[1])) for p in by.split("by class:")[1].split("(=")[0].split("·"))
    total_rows = int(by.split("(=")[1].split()[0])
    assert sum(counts.values()) == total_rows == 10, (counts, total_rows)
    assert counts == {"setup": 2, "check": 1, "write": 1, "read": 2, "explore": 1, "retry": 1, "other": 1, "reply": 1}, counts
    assert "turn 2  steps=2" in out and "NOT A MEASUREMENT" in out.split("turn 2 ")[1].split("\n")[0]
    assert "MISS step count mismatch in turn(s) 2" in out
    assert "ok   turn 4: ran no check and wrote nothing" in out
    # a ? in turn 4's reply flips the turn-4 check, and the reply still is not printed
    open(os.path.join(t1, "replies.md"), "w").write(f"=== turn 4 ===\n{SENT} anything else?\n")
    out2 = subprocess.run([sys.executable, SCORER, tmp], capture_output=True, text=True).stdout
    assert SENT not in out2 and "turn 4: the reply asks a question, so the close-out did NOT run" in out2
    print("  [scorer] turn 1 counts", counts)
    shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- 5. --prompt unchanged

def test_without_the_new_flags_the_runner_prints_no_trace_and_one_cost_line():
    d = tempfile.mkdtemp(prefix="rv-plain-")
    script = os.path.join(d, "s.json"); json.dump([{"tools": [{"name": "list_files", "args": {}}], "cost": 0.001}, {"text": "Hello.", "cost": 0.002}], open(script, "w"))
    ws = tempfile.mkdtemp(prefix="rv-plainws-")
    open(os.path.join(ws, "profile.md"), "w").write("a non-empty folder is fine without --turns\n")
    r = subprocess.run(["node", "--import", PRELOAD, BIN, "--workspace", ws, "--skills", os.path.join(REPO, "skills"), "--model", MODEL, "--prompt", "hi"],
                       env=_env({"RV_SCRIPT": script, "RV_LOG": os.path.join(d, "log")}), capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-500:]
    assert r.stdout.strip() == "Hello."
    assert not any(l.startswith("[trace]") or l.startswith("[stop]") for l in r.stderr.splitlines())
    costs = [l for l in r.stderr.splitlines() if l.startswith("[cost]")]
    assert costs == ["[cost] usd=0.003000 steps=2"], costs
    assert r.stderr.strip().splitlines()[-1] == costs[0]


if __name__ == "__main__":
    failed = 0
    for name in sorted(n for n in dir() if n.startswith("test_")):
        try:
            globals()[name]()
            print("PASS", name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", name, "-", str(e)[:600])
    sys.exit(1 if failed else 0)
