#!/usr/bin/env python3
"""tests/always-on/run_headless_voice.sh end to end with NO model call.

Issue #33: the driver the owner uses to measure the plain-replies voice
rule (docs/design-plain-replies.md § 4) on a site model through the
headless runner. Here every `fetch` is replaced by a `--import` preload
(the tests/agent/bin-run.test.ts pattern) that answers with a canned
OpenRouter SSE reply and records, at request time, what the workspace
held. A planted FAKE key only; HOME, the vault path and the results root
are temp dirs, so no real workspace or repo results dir is touched.

Proves: the key and model refusals make no request; the results layout;
scan_voice.py's HARD hit shows for a reply leaking `investable_stretch`
and not for a plain one; the case's grading files never enter the
workspace (checked live, inside the run, and in planted/ + ws/); the
source case folder is byte-for-byte unchanged; the key never appears in
any output or saved file; each trial's cost is run.mjs's own `[cost]`
line (OpenRouter's usage.cost in the stream), `unknown` without one, and
the summary total sums every trial.

    python3 tests/test_headless_voice_driver.py
"""
import hashlib, json, os, shutil, subprocess, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(REPO, "tests", "always-on", "run_headless_voice.sh")
CASE = "t21-plain-report"
CASE_DIR = os.path.join(REPO, "tests", "always-on", "cases", CASE)
MODEL = "deepseek/deepseek-v4.1-flash"
KEY_VAR = "HV_TEST_FAKE_KEY"
FAKE_KEY = "sk-or-v1-HVTESTFAKE-5e1a9c0d7b3f"
GRADING = {"expected.md", "prompt.md", "turn1.md", "turn2.md"}

PRELOAD = r"""
import { appendFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
const sse = (o) => "data: " + JSON.stringify(o) + "\n\n";
const i = process.argv.indexOf("--workspace");
const ws = i >= 0 ? process.argv[i + 1] : null;
const walk = (d, p = "") => readdirSync(d).flatMap((n) =>
  statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n), p + n + "/") : [p + n]);
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.HV_MOCK_LOG, JSON.stringify({ url: String(url), ws: ws ? walk(ws) : null }) + "\n");
  const id = "gen-hv-test";
  const body = [
    sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: process.env.HV_MOCK_REPLY }, finish_reason: null }] }),
    sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    // OpenRouter's trailing usage-only chunk (the shape ten-model-proxy's
    // parseUsageFromSSE reads); `cost` only when HV_MOCK_COST is set.
    sse({ id, model: "m", choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8,
      ...(process.env.HV_MOCK_COST ? { cost: Number(process.env.HV_MOCK_COST) } : {}) } }),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
"""

PLAIN = "Almost. The letter runs a little long for its length check, and the wording check hasn't run yet. Sending it is up to you."
LEAKY = "Almost. Acme is an investable_stretch for you; the letter runs a little long. Sending it is up to you."


def _tree_hash(root):
    h = hashlib.sha256()
    for d, _, files in sorted(os.walk(root)):
        for f in sorted(files):
            p = os.path.join(d, f)
            h.update(os.path.relpath(p, root).encode())
            with open(p, "rb") as fh:
                h.update(fh.read())
    return h.hexdigest()


def _files(root):
    out = set()
    for d, _, files in os.walk(root):
        for f in files:
            out.add(os.path.relpath(os.path.join(d, f), root))
    return out


def _run(tmp, tag, reply, args=None, key=True, cost=None, trials=None):
    preload = os.path.join(tmp, "preload.mjs")
    if not os.path.exists(preload):
        with open(preload, "w") as f:
            f.write(PRELOAD)
    log = os.path.join(tmp, f"{tag}.requests.jsonl")
    home = os.path.join(tmp, "home")
    os.makedirs(home, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if "OPENROUTER" not in k and not k.startswith("CLAUDE")}
    env.update({
        "HOME": home, "REALJS": os.path.join(tmp, "no-vault"),
        "RESULTS_ROOT": os.path.join(tmp, "results"), "KEY_ENV": KEY_VAR,
        "NODE_OPTIONS": f"--import {preload}", "HV_MOCK_LOG": log, "HV_MOCK_REPLY": reply,
    })
    if key:
        env[KEY_VAR] = FAKE_KEY
    if cost is not None:
        env["HV_MOCK_COST"] = cost
    if trials is not None:
        env["TRIALS"] = str(trials)
    r = subprocess.run(["bash", SCRIPT, *(args or [MODEL, tag, CASE])], env=env,
                       capture_output=True, text=True, timeout=300)
    reqs = []
    if os.path.exists(log):
        reqs = [json.loads(l) for l in open(log) if l.strip()]
    return r, reqs, os.path.join(tmp, "results", f"hv-{tag}")


def test_refuses_without_key_and_makes_no_request():
    tmp = tempfile.mkdtemp(prefix="hv-test-")
    try:
        r, reqs, res = _run(tmp, "nokey", PLAIN, key=False)
        assert r.returncode == 1, r.stderr
        assert KEY_VAR in r.stderr, r.stderr
        assert reqs == [] and not os.path.exists(res)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_refuses_model_off_the_proxy_allowlist():
    tmp = tempfile.mkdtemp(prefix="hv-test-")
    try:
        r, reqs, res = _run(tmp, "badmodel", PLAIN, args=["openai/gpt-4o", "badmodel", CASE])
        assert r.returncode == 2, r.stderr
        assert "MODEL_IDS" in r.stderr and MODEL in r.stderr, r.stderr
        assert reqs == [] and not os.path.exists(res)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_plain_vs_leaky_end_to_end():
    tmp = tempfile.mkdtemp(prefix="hv-test-")
    before = _tree_hash(CASE_DIR)
    try:
        for tag, reply, want_hard, cost in (("plain", PLAIN, 0, "0.0012"), ("leaky", LEAKY, 1, None)):
            r, reqs, res = _run(tmp, tag, reply, cost=cost)
            assert r.returncode == 0, r.stdout + r.stderr
            trial = os.path.join(res, CASE, "1")
            for name in ("reply.md", "stderr.txt", "exit.txt", "prompt.txt", "plan-added.txt", "scan.txt"):
                assert os.path.isfile(os.path.join(trial, name)), name
            for d in ("planted", "ws"):
                assert os.path.isdir(os.path.join(trial, d)), d
            assert open(os.path.join(trial, "exit.txt")).read().strip() == "0"
            assert open(os.path.join(trial, "reply.md")).read().strip() == reply
            with open(os.path.join(CASE_DIR, "prompt.md")) as f:
                assert open(os.path.join(trial, "prompt.txt")).read() == f.read()
            assert "runner=headless" in open(os.path.join(res, "run-info.txt")).read()

            # scan_voice: HARD for the leak, none for the plain reply
            scan = open(os.path.join(trial, "scan.txt")).read().splitlines()
            hard = [l for l in scan if l.startswith("HARD")]
            assert len(hard) == want_hard, scan
            if want_hard:
                assert "investable_stretch" in hard[0], hard
            row = [l for l in r.stdout.splitlines() if l.startswith(CASE)]
            assert len(row) == 1 and row[0].split()[1:5] == ["1", str(want_hard), "0", "0"], r.stdout
            # cost: run.mjs's own line, the summary column and the total
            stderr = open(os.path.join(trial, "stderr.txt")).read()
            if cost:
                assert "[cost] usd=0.001200 steps=1" in stderr, stderr
                assert row[0].split()[-1] == "0.001200", row
                assert "total cost_usd=0.001200  (trials without a reported cost: 0" in r.stdout, r.stdout
            else:
                assert "[cost] unknown steps=1 reported=0" in stderr, stderr
                assert row[0].split()[-1] == "unknown", row
                assert "total cost_usd=0  (trials without a reported cost: 1" in r.stdout, r.stdout

            # grading files: never in the workspace the runner saw (live,
            # at request time), nor in planted/ or ws/
            assert len(reqs) == 1 and reqs[0]["url"].startswith("https://openrouter.ai/"), reqs
            live = set(reqs[0]["ws"])
            assert "plan.md" in live and "applications/acme-senior-data-analyst-cover-letter.md" in live, live
            for files in (live, _files(os.path.join(trial, "planted")), _files(os.path.join(trial, "ws"))):
                names = {os.path.basename(f) for f in files}
                assert not (names & GRADING), names
                assert not [n for n in names if n.startswith("_") and n.endswith(".txt")], names
            # the planted workspace is the case's own planted files, byte for byte
            with open(os.path.join(CASE_DIR, "plan.md")) as a, open(os.path.join(trial, "planted", "plan.md")) as b:
                assert a.read() == b.read()

            # the key: never printed, never saved
            assert FAKE_KEY not in r.stdout + r.stderr
            for d, _, files in os.walk(res):
                for f in files:
                    with open(os.path.join(d, f), "rb") as fh:
                        assert FAKE_KEY.encode() not in fh.read(), os.path.join(d, f)
        assert _tree_hash(CASE_DIR) == before, "source case folder changed"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_cost_total_sums_every_trial():
    tmp = tempfile.mkdtemp(prefix="hv-test-")
    try:
        r, reqs, _ = _run(tmp, "cost", PLAIN, cost="0.0012", trials=2)
        assert r.returncode == 0, r.stderr
        assert len(reqs) == 2, reqs
        rows = [l.split() for l in r.stdout.splitlines() if l.startswith(CASE)]
        assert [(x[1], x[-1]) for x in rows] == [("1", "0.001200"), ("2", "0.001200")], r.stdout
        assert "total cost_usd=0.002400  (trials without a reported cost: 0" in r.stdout, r.stdout
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_rerun_skips_a_completed_trial():
    tmp = tempfile.mkdtemp(prefix="hv-test-")
    try:
        _run(tmp, "resume", PLAIN)
        r, reqs, res = _run(tmp, "resume", LEAKY)   # same tag, same request log
        assert r.returncode == 0, r.stderr
        assert f"skip {CASE} trial 1" in r.stdout, r.stdout
        assert len(reqs) == 1, reqs   # the first run's one request; the re-run made none
        assert open(os.path.join(res, CASE, "1", "reply.md")).read().strip() == PLAIN
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
