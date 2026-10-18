"""Independent review (tester, 2026-10-17) of the t22-feedback harness
(docs/design-feedback.md § 17.5): the loopback guard, the runner's refusal, and
that the runner stops only the stub it started. No model is called: `claude` is
a fake on PATH that runs the skill's real script. Nothing leaves 127.0.0.1.

The failure each check prevents: a harness run that writes a real note (the
guard), and a runner that kills a process it did not start (the shared
scratchpad makes name matching unsafe; kill only recorded PIDs).
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ALWAYS_ON = os.path.join(HERE, "always-on")
GUARD = os.path.join(ALWAYS_ON, "feedback_guard.sh")
RUNNER = os.path.join(ALWAYS_ON, "run_t22.sh")
STUB = os.path.join(ALWAYS_ON, "feedback_stub.mjs")


def _guard(url):
    return subprocess.run(["bash", "-c", 'source "$0"; require_loopback_feedback_url "$1"; echo PASSED', GUARD, url],
                          capture_output=True, text=True)


def test_guard_refuses_every_look_alike_of_the_loopback_address():
    refused = [
        "", "http://localhost:8080/x", "http://LOCALHOST:8080/x", "http://[::1]:8080/x", "http://[::ffff:127.0.0.1]:8080/x",
        "http://127.0.0.1.evil.example:8080/x", "http://127.0.0.1.evil.example/x", "http://127.0.0.1.nip.io:8080/x",
        "http://127.1:8080/x", "http://2130706433:8080/x", "http://0x7f000001:8080/x", "http://0177.0.0.1:8080/x", "http://127.0.0.01:8080/x",
        "http://127.0.0.1:8080@evil.example/x", "http://user@127.0.0.1:8080/x", "http://127.0.0.1:8080#@evil.example/",
        "http://127.0.0.1:8080\\@evil.example/", "HTTP://127.0.0.1:8080/x", "http://127.0.0.1:8080/x\nhttps://evil.example/",
        "http://127.0.0.1:8080/x?u=https://evil.example", "http://127.0.0.1:8080/%2e%2e/x", "https://ivunfotoggdxbjouumdk.supabase.co/functions/v1/ten-feedback",
        "http://127.0.0.1:8080/x\t", "\thttp://127.0.0.1:8080/x",
    ]
    bad = []
    for url in refused:
        r = _guard(url)
        if r.returncode != 2 or "PASSED" in r.stdout or "REFUSED" not in r.stderr:
            bad.append((url, r.returncode, r.stdout.strip()))
    assert bad == [], bad
    for ok in ["http://127.0.0.1:1/functions/v1/ten-feedback", "http://127.0.0.1:65535"]:
        r = _guard(ok)
        assert r.returncode == 0 and "PASSED" in r.stdout, (ok, r.stderr)


def test_runner_refuses_a_foreign_value_before_anything_is_made_and_treats_an_empty_one_as_unset():
    tag = f"review-guard-{os.getpid()}"
    results = os.path.join(ALWAYS_ON, "results", f"t22-{tag}")
    try:
        for url in ["http://localhost:9/x", "http://[::1]:9/x", "http://127.0.0.1.evil.example:9/x", "http://127.0.0.1:9@evil.example/x"]:
            env = dict(os.environ, TEN_FEEDBACK_URL=url, DRY_RUN="1")
            r = subprocess.run(["bash", RUNNER, tag], env=env, capture_output=True, text=True, timeout=60)
            assert r.returncode == 2 and "REFUSED" in r.stderr, (url, r.returncode, r.stderr[-300:])
            assert not os.path.exists(results), f"{url}: a refused run made its results directory"
        # unset and empty: the runner proceeds with its own stub (a dry run makes no model call)
        for env in [{k: v for k, v in os.environ.items() if k != "TEN_FEEDBACK_URL"}, dict(os.environ, TEN_FEEDBACK_URL="")]:
            r = subprocess.run(["bash", RUNNER, tag], env=dict(env, DRY_RUN="1"), capture_output=True, text=True, timeout=120)
            assert r.returncode == 0 and "no model calls made" in r.stdout, (r.returncode, r.stderr[-300:])
    finally:
        shutil.rmtree(results, ignore_errors=True)


FAKE_CLAUDE = r'''#!/usr/bin/env python3
"""A stand-in for `claude -p` (no model). Records the feedback URL it was handed,
then plays a well-behaved agent: turn 1 shows the dry run, a "yes" sends."""
import json, os, subprocess, sys
args = sys.argv[1:]
with open(os.environ["REVIEW_SEEN"], "a") as f:
    f.write(json.dumps({"url": os.environ.get("TEN_FEEDBACK_URL"), "cwd": os.getcwd()}) + "\n")
prompt = [a for a in args[args.index("-p") + 1:] if not a.startswith("--")][0]
script = os.path.join(os.getcwd(), ".claude", "skills", "feedback", "scripts", "feedback.mjs")
base = ["node", script, "--kind", "bug", "--comment", "the match score looks off to me"]
if "yes" in prompt.strip().lower()[:5]:
    reply = subprocess.run(base, capture_output=True, text=True).stdout.strip().splitlines()[-1]
else:
    reply = subprocess.run(base + ["--dry-run"], capture_output=True, text=True).stdout.strip()
print(json.dumps({"type": "system", "model": "fake-model"}))
print(json.dumps({"type": "assistant", "message": {"model": "fake-model", "content": [{"type": "text", "text": reply}]}}))
'''


def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def test_runner_stops_only_the_stub_it_started_even_with_a_look_alike_stub_running():
    work = tempfile.mkdtemp()
    tag = f"review-pids-{os.getpid()}"
    results = os.path.join(ALWAYS_ON, "results", f"t22-{tag}")
    decoy = None
    try:
        # a decoy: the same script, the same argument shape, started here, its PID recorded
        decoy = subprocess.Popen(["node", STUB, os.path.join(work, "decoy.jsonl"), "201", os.path.join(work, "decoy.port")])
        for _ in range(50):
            if os.path.exists(os.path.join(work, "decoy.port")) and open(os.path.join(work, "decoy.port")).read():
                break
            time.sleep(0.1)
        os.makedirs(os.path.join(work, "bin"))
        fake = os.path.join(work, "bin", "claude")
        open(fake, "w").write(FAKE_CLAUDE)
        os.chmod(fake, 0o755)
        seen = os.path.join(work, "seen.jsonl")
        env = {k: v for k, v in os.environ.items() if k != "TEN_FEEDBACK_URL"}
        env.update(PATH=os.path.join(work, "bin") + os.pathsep + env["PATH"], CASES="f1-bug-offered f6-send-fails", TRIALS="2",
                   REALJS=os.path.join(work, "no-such-vault"), REVIEW_SEEN=seen)
        r = subprocess.run(["bash", RUNNER, tag], env=env, capture_output=True, text=True, timeout=600)
        assert r.returncode == 0, (r.stdout[-800:], r.stderr[-800:])
        assert _alive(decoy.pid), "the runner stopped a stub it did not start"
        # every URL the agent was handed was a loopback stub of the runner's own
        urls = [json.loads(l)["url"] for l in open(seen)]
        assert urls and all(u.startswith("http://127.0.0.1:") and u.endswith("/functions/v1/ten-feedback") for u in urls), urls
        decoy_port = open(os.path.join(work, "decoy.port")).read().strip()
        assert all(f":{decoy_port}/" not in u for u in urls), "the agent was pointed at the decoy"
        # no stub of this run is left running: its log files name this run's results directory
        ps = subprocess.run(["ps", "-ax", "-o", "pid=,command="], capture_output=True, text=True).stdout
        left = [l for l in ps.splitlines() if "feedback_stub.mjs" in l and results in l]
        assert left == [], left
        # the decoy saw nothing; the runner's stubs saw the sends: f1 trial 1 and 2 (201), f6 trial 1 (503); f6 trial 2 is the closed port
        assert not os.path.exists(os.path.join(work, "decoy.jsonl")) or open(os.path.join(work, "decoy.jsonl")).read() == ""
        counts = {n: sum(1 for _ in open(os.path.join(results, f"{n}.posts.jsonl"))) for n in ["f1-bug-offered-t1", "f1-bug-offered-t2", "f6-send-fails-t1", "f6-send-fails-t2"]}
        assert counts == {"f1-bug-offered-t1": 1, "f1-bug-offered-t2": 1, "f6-send-fails-t1": 1, "f6-send-fails-t2": 0}, counts
        f6 = open(os.path.join(results, "f6-send-fails-t2.md"), encoding="utf-8").read()
        assert "This couldn't be sent just now, so nothing went." in f6, f6[-400:]
    finally:
        if decoy is not None:
            decoy.terminate()          # the one PID this test started
            decoy.wait(timeout=10)
        shutil.rmtree(results, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)
