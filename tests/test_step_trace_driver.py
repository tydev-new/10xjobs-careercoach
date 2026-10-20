#!/usr/bin/env python3
"""tests/always-on/run_step_trace.sh end to end with NO model call
(docs/design-fewer-steps.md § 1.2), the tests/test_headless_voice_driver.py way:
every `fetch` is replaced by a `--import` preload
(packages/agent/test/support/scripted-fetch-preload.mjs) that answers with
canned replies and records, at request time, what the workspace held. A planted
FAKE key only; HOME, the vault path and the results root are temp dirs, so no
real workspace or repo results dir is touched, and the owner's key is never read.

Proves: the key and model refusals make no request; the site's starting state
(only the template CLAUDE.md) at turn 1; the résumé PDF built at run time into
the trial folder (never the workspace), valid, and stored byte for byte at
documents/resume.pdf by the upload turn; the results layout; the key never
printed or saved; the scorer reads what the run left; a run over the cost line
stops, and the driver stops with it; a re-run skips a finished trial; a real
workspace (the vault) is locked while the run is on (macOS) and unlocked after.

    python3 tests/test_step_trace_driver.py
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(REPO, "tests", "always-on", "run_step_trace.sh")
SCORER = os.path.join(REPO, "tests", "always-on", "score_step_trace.py")
PRELOAD = os.path.join(REPO, "packages", "agent", "test", "support", "scripted-fetch-preload.mjs")
TEMPLATE = os.path.join(REPO, "skills", "profile", "templates", "workspace-CLAUDE.md")
MODEL = "deepseek/deepseek-v4.1-flash"
KEY_VAR = "ST_TEST_FAKE_KEY"
FAKE_KEY = "sk-or-v1-STTESTFAKE-7c2e9a41d0b5f386"


def _sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _script(tmp, items):
    p = os.path.join(tmp, "script.json")
    with open(p, "w") as f:
        json.dump(items, f)
    return p


def _run(tmp, tag, items, args=None, key=True, trials=None, extra_env=None):
    home = os.path.join(tmp, "home")
    os.makedirs(home, exist_ok=True)
    log = os.path.join(tmp, f"{tag}.requests.jsonl")
    env = {k: v for k, v in os.environ.items() if "OPENROUTER" not in k and not k.startswith("CLAUDE") and k != "DRY_RUN"}
    env.update({
        "HOME": home, "REALJS": os.path.join(tmp, "no-vault"),
        "RESULTS_ROOT": os.path.join(tmp, "results"), "KEY_ENV": KEY_VAR,
        "NODE_OPTIONS": f"--import {PRELOAD}", "ST_SCRIPT": _script(tmp, items), "ST_LOG": log,
    })
    if key:
        env[KEY_VAR] = FAKE_KEY
    if trials is not None:
        env["TRIALS"] = str(trials)
    env.update(extra_env or {})
    r = subprocess.run(["bash", SCRIPT, *(args or [MODEL, tag])], env=env, capture_output=True, text=True, timeout=300)
    reqs = [json.loads(l) for l in open(log) if l.strip()] if os.path.exists(log) else []
    return r, reqs, os.path.join(tmp, "results", f"st-{tag}")


def _replies(cost=0.002, n=4):
    return [{"text": f"Reply {i}. All set.", "cost": cost} for i in range(1, n + 1)]


def test_refuses_without_key_and_makes_no_request():
    tmp = tempfile.mkdtemp(prefix="st-drv-")
    try:
        r, reqs, res = _run(tmp, "nokey", _replies(), key=False)
        assert r.returncode == 1, r.stderr
        assert KEY_VAR in r.stderr and FAKE_KEY not in r.stderr, r.stderr
        assert reqs == [] and not os.path.exists(res)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_refuses_a_model_off_the_proxy_allowlist():
    tmp = tempfile.mkdtemp(prefix="st-drv-")
    try:
        for bad in ("openai/gpt-4o", "deepseek/deepseek-v4.1", "anthropic/claude-opus-4"):
            r, reqs, res = _run(tmp, "badmodel", _replies(), args=[bad, "badmodel"])
            assert r.returncode == 2, (bad, r.stderr)
            assert "MODEL_IDS" in r.stderr and MODEL in r.stderr, r.stderr
            assert reqs == [] and not os.path.exists(res)
        # the two the site serves are accepted by the check (a dry run makes no call)
        for ok in (MODEL, "anthropic/claude-sonnet-5"):
            r, reqs, res = _run(tmp, "okmodel", _replies(), args=[ok, "okmodel"], extra_env={"DRY_RUN": "1"})
            assert r.returncode == 0 and "no model calls made" in r.stdout, (ok, r.stdout, r.stderr)
            assert reqs == []
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_bad_arguments_are_refused_before_anything():
    tmp = tempfile.mkdtemp(prefix="st-drv-")
    try:
        assert _run(tmp, "a", _replies(), args=[MODEL])[0].returncode == 2
        assert _run(tmp, "b", _replies(), args=[MODEL, "../x"])[0].returncode == 2
        assert _run(tmp, "c", _replies(), trials=0)[0].returncode == 2
        assert _run(tmp, "d", _replies(), extra_env={"MAX_USD": "lots"})[0].returncode == 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_four_turns_from_the_sites_starting_state_and_the_pdf_it_builds():
    tmp = tempfile.mkdtemp(prefix="st-drv-")
    try:
        r, reqs, res = _run(tmp, "full", _replies())
        assert r.returncode == 0, r.stdout + r.stderr
        trial = os.path.join(res, "1")
        for name in ("stderr.txt", "replies.md", "exit.txt", "resume.pdf"):
            assert os.path.isfile(os.path.join(trial, name)), name
        assert os.path.isdir(os.path.join(trial, "ws"))
        assert open(os.path.join(trial, "exit.txt")).read().strip() == "0"
        assert "runner=headless-step-trace" in open(os.path.join(res, "run-info.txt")).read()

        # four turns, one request each (the canned replies are text-only)
        assert len(reqs) == 4 and all(q["url"].startswith("https://openrouter.ai/") for q in reqs), reqs
        # turn 1 starts exactly where the site does: the template CLAUDE.md, nothing else
        assert reqs[0]["ws"] == ["CLAUDE.md"], reqs[0]["ws"]
        # the résumé arrives by upload in turn 2, and only then
        assert reqs[1]["ws"] == ["CLAUDE.md", "documents/resume.pdf"], reqs[1]["ws"]
        assert reqs[3]["ws"] == ["CLAUDE.md", "documents/resume.pdf"], reqs[3]["ws"]
        # the staged CLAUDE.md is the bundled template, byte for byte
        assert _sha(os.path.join(trial, "ws", "CLAUDE.md")) == _sha(TEMPLATE)
        # the upload is the built PDF, byte for byte, where the site stores it
        assert _sha(os.path.join(trial, "ws", "documents", "resume.pdf")) == _sha(os.path.join(trial, "resume.pdf"))
        # ...and it was built into the trial folder, never into the workspace beforehand
        assert not os.path.exists(os.path.join(trial, "ws", "resume.pdf"))
        # the script of § 1.2, word for word, and the existing conversion line
        bodies = [q["body"] for q in reqs]
        assert "I'm looking for FDE job in SF Bay Area" in bodies[0]
        assert "here's my resume" in bodies[1] and "The candidate attached `documents/resume.pdf`." in bodies[1]
        assert "what's next?" in bodies[2]
        assert "thanks, that's all for today" in bodies[3]
        assert "%PDF" not in "".join(bodies), "the PDF bytes never reach the model"

        # the PDF is a real PDF with Alex Chen's résumé text in it
        probe = os.path.join(tmp, "extract.mjs")
        with open(probe, "w") as f:
            f.write("import { readFileSync } from 'node:fs';\n"
                    f"import {{ extractText }} from {json.dumps(os.path.join(REPO, 'apps/web/src/backend/extract-text.ts'))};\n"
                    "const t = await extractText('documents/resume.pdf', new Uint8Array(readFileSync(process.argv[2])));\n"
                    "console.log(JSON.stringify(t));\n")
        out = subprocess.run(["node", probe, os.path.join(trial, "resume.pdf")], capture_output=True, text=True, timeout=120)
        assert out.returncode == 0, out.stderr
        text = json.loads(out.stdout)
        assert "ALEX CHEN" in text and "Meridian Health" in text and "dbt" in text, text[:200]

        # the trace and cost lines the scorer reads
        stderr = open(os.path.join(trial, "stderr.txt")).read()
        assert stderr.count("[trace] ") == 4 and "reply (" in stderr and "WARN" not in stderr, stderr
        costs = [l for l in stderr.splitlines() if l.startswith("[cost]")]
        assert costs[-1] == "[cost] usd=0.008000 steps=4" and costs[0] == "[cost] turn=1 usd=0.002000 steps=1", costs
        assert "total cost_usd=0.008000" in r.stdout, r.stdout

        # the key: never printed, never saved
        assert FAKE_KEY not in r.stdout + r.stderr
        for d, _, files in os.walk(res):
            for f in files:
                with open(os.path.join(d, f), "rb") as fh:
                    assert FAKE_KEY.encode() not in fh.read(), os.path.join(d, f)

        # and the scorer reads the run
        s = subprocess.run([sys.executable, SCORER, res], capture_output=True, text=True)
        assert s.returncode == 0, s.stderr
        assert "turn 4  steps=1" in s.stdout and "(= 1 rows)" in s.stdout, s.stdout
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_a_run_over_the_cost_line_stops_and_the_driver_stops_with_it():
    tmp = tempfile.mkdtemp(prefix="st-drv-")
    try:
        r, reqs, res = _run(tmp, "costly", _replies(cost=0.55), trials=3)
        assert r.returncode == 4, r.stdout + r.stderr
        assert "STOPPED: trial 1 cost more than $1" in r.stderr, r.stderr
        assert len(reqs) == 2, "the run stopped after the turn that passed the line"
        assert os.listdir(res).count("2") == 0 and os.listdir(res).count("3") == 0, "no further trial was run"
        assert open(os.path.join(res, "1", "exit.txt")).read().strip() == "4"
        assert "[stop]" in open(os.path.join(res, "1", "stderr.txt")).read()
        # MAX_USD moves the line
        r2, reqs2, _ = _run(tmp, "costly2", _replies(cost=0.55), extra_env={"MAX_USD": "5"})
        assert r2.returncode == 0 and len(reqs2) == 4, r2.stderr
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_rerun_skips_a_finished_trial():
    tmp = tempfile.mkdtemp(prefix="st-drv-")
    try:
        _run(tmp, "resume", _replies())
        r, reqs, res = _run(tmp, "resume", _replies())   # same tag, same request log
        assert r.returncode == 0, r.stderr
        assert "skip trial 1 (exists)" in r.stdout, r.stdout
        assert len(reqs) == 4, "the re-run made no request"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_a_real_workspace_is_locked_while_the_run_is_on_and_unlocked_after():
    if sys.platform != "darwin":
        print("SKIPPED: the vault lock is macOS chflags")
        return
    tmp = tempfile.mkdtemp(prefix="st-drv-")
    vault = os.path.join(tmp, "vault")
    os.makedirs(os.path.join(vault, "stories"))
    with open(os.path.join(vault, "profile.md"), "w") as f:
        f.write("# a stand-in for a real workspace\n")
    try:
        before = _sha(os.path.join(vault, "profile.md"))
        r, reqs, res = _run(tmp, "vault", _replies(), extra_env={"REALJS": vault, "ST_PROBE": vault})
        assert r.returncode == 0, r.stdout + r.stderr
        assert reqs and all("uchg" in (q["probe"] or "") for q in reqs), [q["probe"] for q in reqs]
        after = subprocess.run(["ls", "-ldO", vault], capture_output=True, text=True).stdout
        assert "uchg" not in after, after
        assert _sha(os.path.join(vault, "profile.md")) == before
        # the run never used it as a workspace: it staged its own fresh temp folder
        assert reqs[0]["ws"] == ["CLAUDE.md"]
    finally:
        subprocess.run(["chflags", "-R", "nouchg", vault], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
