#!/usr/bin/env python3
"""Tester round 2 for tests/always-on/run_headless_voice.sh (issue #33, F1
fix): how the driver classifies turns that did NOT end in a normal reply.
Spec: the driver's header + README — a trial is a measurement only when
the turn produced a reply; an unfinished trial is FAILED, never scored as
0 HARD, and retried on a same-tag run; a finished trial is skipped and its
cost still counted. NO model call: a `--import` preload answers every
fetch per scenario (HV_SCEN), with a fake key.

  gate_text    step 1: text + a bash tool call, cost 0.6 -> spend gate
               opens before step 2 (DEFAULT_SPEND_GATE_USD 1.0). The
               model's own text is a real reply: ok, exit 0.
  gate_notext  same, no text: the gate stops the turn before ANY text ->
               FAILED:empty-reply.
  midcrash     the SSE body errors after a text chunk -> not ok.
  stepcap      every step is a tool call -> step_cap [error] -> exit 3.

    python3 tests/test_headless_voice_failures.py
"""
import json, os, shutil, subprocess, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(REPO, "tests", "always-on", "run_headless_voice.sh")
MODEL = "deepseek/deepseek-v4.1-flash"
CASE = "t21-plain-report"
KEY_VAR = "HV_R2_FAKE_KEY"
FAKE_KEY = "sk-or-v1-R2FAKE-77aa11bb"

PRELOAD = r"""
import { appendFileSync } from "node:fs";
const enc = new TextEncoder();
const sse = (o) => "data: " + JSON.stringify(o) + "\n\n";
const id = "gen-r2";
const usage = (cost) => ({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost });
const toolStep = (text, cost) => [
  ...(text ? [sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })] : []),
  sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_" + Math.random().toString(36).slice(2), type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "ls" }) } }] }, finish_reason: null }] }),
  sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: usage(cost) }),
  "data: [DONE]\n\n",
].join("");
const textStep = (text, cost) => [
  sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] }),
  sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: usage(cost) }),
  "data: [DONE]\n\n",
].join("");
const ok = (s) => new Response(s, { status: 200, headers: { "content-type": "text/event-stream" } });
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(process.env.HV_MOCK_LOG, "req\n");
  const scen = process.env.HV_SCEN;
  if (scen === "gate_text") return ok(toolStep("Let me look at the Acme folder first.", 0.6));
  if (scen === "gate_notext") return ok(toolStep("", 0.6));
  if (scen === "stepcap") return ok(toolStep("", 0.0001));
  if (scen === "midcrash") {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "Almost ready, the let" }, finish_reason: null }] })));
        setTimeout(() => c.error(new Error("socket hang up")), 20);
      },
    });
    return ok(body);
  }
  return ok(textStep("Almost. The letter runs long; sending it is up to you.", 0.0012));
};
"""


def run(tmp, tag, scen, trials=None):
    preload = os.path.join(tmp, "preload.mjs")
    if not os.path.exists(preload):
        with open(preload, "w") as f:
            f.write(PRELOAD)
    home = os.path.join(tmp, "home")
    os.makedirs(home, exist_ok=True)
    log = os.path.join(tmp, f"{tag}.log")
    env = {k: v for k, v in os.environ.items() if "OPENROUTER" not in k and not k.startswith("CLAUDE")}
    env.update({"HOME": home, "REALJS": os.path.join(tmp, "no-vault"), "RESULTS_ROOT": os.path.join(tmp, "results"),
                "KEY_ENV": KEY_VAR, KEY_VAR: FAKE_KEY, "NODE_OPTIONS": f"--import {preload}",
                "HV_MOCK_LOG": log, "HV_SCEN": scen})
    if trials:
        env["TRIALS"] = str(trials)
    r = subprocess.run(["bash", SCRIPT, MODEL, tag, CASE], env=env, capture_output=True, text=True, timeout=600)
    n = sum(1 for _ in open(log)) if os.path.exists(log) else 0
    trial = os.path.join(tmp, "results", f"hv-{tag}", CASE, "1")
    row = [l.split() for l in r.stdout.splitlines() if l.startswith(CASE)]
    return r, n, trial, row


def rd(p):
    return open(p).read() if os.path.exists(p) else ""


def with_tmp(fn):
    def w():
        tmp = tempfile.mkdtemp(prefix="hv-r2-")
        try:
            fn(tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    w.__name__ = fn.__name__
    return w


# row columns: case trial HARD REVIEW exit gate error search status cost
@with_tmp
def test_gate_after_model_text_is_a_finished_reply(tmp):
    r, n, trial, row = run(tmp, "gt", "gate_text")
    err = rd(os.path.join(trial, "stderr.txt"))
    assert "[gate]" in err and "[error]" not in err, err[-1500:]
    assert rd(os.path.join(trial, "exit.txt")).strip() == "0"
    assert "Let me look at the Acme folder" in rd(os.path.join(trial, "reply.md"))
    assert row and row[0][4] == "0" and row[0][5] == "1" and row[0][8] == "ok", r.stdout
    assert row[0][2] != "-", row           # scored
    assert r.returncode == 0, r.stdout
    assert row[0][9] == "0.600000", row    # one step recorded before the gate


@with_tmp
def test_gate_before_any_text_is_failed_empty_reply(tmp):
    r, n, trial, row = run(tmp, "gn", "gate_notext")
    err = rd(os.path.join(trial, "stderr.txt"))
    assert "[gate]" in err, err[-1500:]
    assert row and row[0][8] == "FAILED:empty-reply", r.stdout
    assert row[0][2] == "-" and row[0][3] == "-", row
    assert r.returncode == 1, r.stdout
    r2, n2, _, _ = run(tmp, "gn", "gate_notext")
    assert "skip" not in r2.stdout and n2 > n, (r2.stdout, n, n2)


@with_tmp
def test_crash_mid_stream_is_failed_and_retried(tmp):
    r, n, trial, row = run(tmp, "mc", "midcrash")
    ex = rd(os.path.join(trial, "exit.txt")).strip()
    assert ex != "0", (ex, rd(os.path.join(trial, "stderr.txt"))[-1500:])
    assert row and row[0][8] == f"FAILED:exit-{ex}" and row[0][2] == "-", r.stdout
    assert r.returncode == 1
    r2, n2, _, _ = run(tmp, "mc", "ok")
    assert "skip" not in r2.stdout and n2 > n
    _, _, _, row2 = run(tmp, "mc", "ok")   # now finished -> skipped
    assert row2[0][8] == "ok", row2


@with_tmp
def test_step_cap_is_exit_3_failed(tmp):
    r, n, trial, row = run(tmp, "sc", "stepcap")
    err = rd(os.path.join(trial, "stderr.txt"))
    assert "[error] step_cap" in err, err[-1500:]
    assert rd(os.path.join(trial, "exit.txt")).strip() == "3"
    assert row and row[0][8] == "FAILED:exit-3" and row[0][2] == "-", r.stdout
    assert r.returncode == 1
    assert "[cost] usd=" in err and n >= 2, (n, [l for l in err.splitlines() if l.startswith("[cost]")])


@with_tmp
def test_finished_trial_skipped_and_its_cost_still_totalled(tmp):
    r, n, trial, row = run(tmp, "fin", "ok")
    assert r.returncode == 0 and row[0][8] == "ok" and row[0][9] == "0.001200", r.stdout
    r2, n2, _, row2 = run(tmp, "fin", "ok", trials=2)   # trial 1 skipped, trial 2 new
    assert f"skip {CASE} trial 1" in r2.stdout and n2 == n + 1, (r2.stdout, n, n2)
    assert [x[9] for x in row2] == ["0.001200", "0.001200"], r2.stdout
    assert "total cost_usd=0.002400" in r2.stdout, r2.stdout
    assert r2.returncode == 0


@with_tmp
def test_key_never_in_outputs_on_failure_paths(tmp):
    for tag, scen in (("k1", "midcrash"), ("k2", "stepcap")):
        r, _, _, _ = run(tmp, tag, scen)
        assert FAKE_KEY not in r.stdout + r.stderr
    for d, _, files in os.walk(os.path.join(tmp, "results")):
        for f in files:
            with open(os.path.join(d, f), "rb") as fh:
                assert FAKE_KEY.encode() not in fh.read(), os.path.join(d, f)


if __name__ == "__main__":
    bad = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok", name)
            except AssertionError as e:
                bad += 1
                print("FAIL", name, "\n ", str(e)[-1500:])
    raise SystemExit(1 if bad else 0)
