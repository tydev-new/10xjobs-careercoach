#!/usr/bin/env python3
"""Independent (tester) checks for tests/always-on/run_headless_voice.sh,
derived from docs/design-plain-replies.md § 4, the case runners and
judge_voice.sh, not from the driver's own tests. NO model call: every
`fetch` is a `--import` preload answering with a canned OpenRouter SSE
reply (or an error), and the key is a planted fake.

1. Staging fidelity, all nine § 4 cases: the workspace the model sees
   (listed and hashed by the preload AT REQUEST TIME) holds exactly the
   data files that case's own run_t*.sh plants, byte for byte, minus
   only the claude-CLI wiring (workspace CLAUDE.md, .claude/skills/),
   which the headless runner replaces with its system prompt + bundle.
   The expected sets below are written out from each runner's own cp
   lines (run_t4.sh:39, run_t6.sh:58-61, run_t8.sh:49-56,
   run_t10.sh:69-74, run_t13.sh:41-44, run_t21.sh:39-41).
2. The message sent is the case's prompt.md (turn1.md for t4-intake).
3. scan_voice.py is called with the --candidate / --plan-added inputs
   judge_voice.sh builds (judge_voice.sh:96-108), recorded by a wrapper
   around the real scanner in a symlinked copy of the repo.
4. A turn that ended on a provider error (empty reply) is not a finished,
   clean measurement: it must not score as exit 0 and must be re-run on
   the same tag (the driver's own header: "a crashed trial is re-run";
   README: "re-run only the cases with HARD hits ... finished trials are
   skipped").

    python3 tests/test_headless_voice_staging.py
"""
import hashlib, json, os, shutil, subprocess, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AO = os.path.join(REPO, "tests", "always-on")
CASES = os.path.join(AO, "cases")
FIX = os.path.join(AO, "fixtures")
MODEL = "deepseek/deepseek-v4.1-flash"
KEY_VAR = "HV_TESTER_FAKE_KEY"
FAKE_KEY = "sk-or-v1-TESTERFAKE-0a1b2c3d"
NINE = ["t4-intake", "t6-track-assignment", "t6-duplicate-row", "t8-stage-sensing",
        "t8-honesty-thresholds", "t10-over-budget", "t10-verbatim-panel", "t13-ceiling",
        "t21-plain-report"]

PRELOAD = r"""
import { appendFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const sse = (o) => "data: " + JSON.stringify(o) + "\n\n";
const i = process.argv.indexOf("--workspace");
const ws = i >= 0 ? process.argv[i + 1] : null;
const walk = (d, p = "") => readdirSync(d).flatMap((n) =>
  statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n), p + n + "/") : [p + n]);
globalThis.fetch = async (url, init = {}) => {
  const files = {};
  for (const f of walk(ws)) files[f] = createHash("sha256").update(readFileSync(path.join(ws, f))).digest("hex");
  let prompt = null;
  try { const b = JSON.parse(init.body); prompt = b.messages.filter((m) => m.role === "user").map((m) => typeof m.content === "string" ? m.content : m.content.map((c) => c.text ?? "").join("")).join("\n"); } catch {}
  appendFileSync(process.env.HV_MOCK_LOG, JSON.stringify({ files, prompt }) + "\n");
  if (process.env.HV_MOCK_STATUS) {
    return new Response(JSON.stringify({ error: { message: "Provider returned error", code: Number(process.env.HV_MOCK_STATUS) } }),
      { status: Number(process.env.HV_MOCK_STATUS), headers: { "content-type": "application/json" } });
  }
  const id = "gen-tester";
  const body = [
    sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: process.env.HV_MOCK_REPLY }, finish_reason: null }] }),
    sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    sse({ id, model: "m", choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.0001 } }),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
"""

REPLY = "Recorded in jobs.md as track A, investable_stretch. Ran check_materials.py on the JD."

SCAN_WRAPPER = r'''#!/usr/bin/env python3
import json, os, sys
with open(os.environ["HV_SCAN_LOG"], "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
os.execv(sys.executable, [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_voice.real.py")] + sys.argv[1:])
'''


def sha(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def tree(src, prefix=""):
    """{relpath: sha} for every file under src, keys prefixed."""
    out = {}
    for d, _, files in os.walk(src):
        for n in files:
            p = os.path.join(d, n)
            out[prefix + os.path.relpath(p, src)] = sha(p)
    return out


def expected_planted(case):
    """What the case's OWN runner copies into its workspace (data files
    only — CLAUDE.md and .claude/skills/ are claude-CLI wiring)."""
    C = os.path.join(CASES, case)
    e = {}
    def f(src, name=None):
        e[name or os.path.basename(src)] = sha(src)
    def first(*cands):
        for c in cands:
            if os.path.isfile(c):
                return c
        raise AssertionError(cands)
    if case.startswith("t4-"):                                   # run_t4.sh:39
        f(os.path.join(C, "resume.md"))
    elif case.startswith("t6-"):                                 # run_t6.sh:58-61
        f(first(os.path.join(C, "profile.md"), os.path.join(FIX, "profile.md")), "profile.md")
        f(first(os.path.join(C, "criteria.md"), os.path.join(FIX, "criteria.md")), "criteria.md")
        f(os.path.join(C, "jobs.md"))
        e.update(tree(os.path.join(C, "jd-inbox"), "jd-inbox/"))
    elif case.startswith("t8-"):                                 # run_t8.sh:49-56
        f(os.path.join(FIX, "profile.md"))
        f(first(os.path.join(C, "criteria.md"), os.path.join(FIX, "criteria.md")), "criteria.md")
        for n in ("jobs.md", "plan.md", "knowledge.md", "storybank.md", "pitch.md", "base-resume.md"):
            if os.path.isfile(os.path.join(C, n)):
                f(os.path.join(C, n))
        for d in ("jd-analysis", "courses", "stories"):
            if os.path.isdir(os.path.join(C, d)):
                e.update(tree(os.path.join(C, d), d + "/"))
    elif case.startswith("t10-") or case.startswith("t13-"):    # run_t10.sh:69-74 / run_t13.sh:41-44
        A = os.path.join(FIX, "apply")
        f(os.path.join(FIX, "profile.md"))
        for n in ("base-resume.md", "voice.md", "storybank.md", "jobs.md"):
            f(os.path.join(A, n))
        for d in ("stories", "jd-inbox", "jd-analysis", "company"):
            e.update(tree(os.path.join(A, d), d + "/"))
        if case.startswith("t10-"):
            if os.path.isfile(os.path.join(C, "base-resume.md")):
                f(os.path.join(C, "base-resume.md"))
            if os.path.isdir(os.path.join(C, "jd-analysis")):
                for n in os.listdir(os.path.join(C, "jd-analysis")):
                    if n.endswith(".md"):
                        e["jd-analysis/" + n] = sha(os.path.join(C, "jd-analysis", n))
        else:
            extra = os.path.join(C, "ws-extra")
            if not os.path.isdir(extra):
                extra = os.path.join(CASES, "t13-ceiling", "ws-extra")
            e.update(tree(extra))
    elif case.startswith("t21-"):                                # run_t21.sh:39-41
        for n in ("plan.md", "criteria.md", "jobs.md", "base-resume.md"):
            f(os.path.join(C, n))
        for n in os.listdir(os.path.join(C, "applications")):
            if n.endswith(".md"):
                e["applications/" + n] = sha(os.path.join(C, "applications", n))
    else:
        raise AssertionError(case)
    return e


def judge_voice_candidate_args(root, case):
    """judge_voice.sh:96-101, as a list, paths under `root`."""
    C = os.path.join(root, "cases", case)
    args = []
    for n in ["prompt.md"] + sorted(x for x in os.listdir(C) if x.startswith("turn") and x.endswith(".md")):
        if os.path.isfile(os.path.join(C, n)):
            args += ["--candidate", os.path.join(C, n)]
    if os.path.isdir(os.path.join(C, "ws-extra")):
        args += ["--candidate", os.path.join(C, "ws-extra")]
    return args


def make_repo_copy(tmp):
    """A repo whose tests/always-on is a real copy (scan_voice.py wrapped
    to log its argv) and everything else symlinked to the worktree."""
    root = os.path.join(tmp, "repo")
    os.makedirs(os.path.join(root, "tests"))
    for n in os.listdir(REPO):
        if n == "tests":
            continue
        os.symlink(os.path.join(REPO, n), os.path.join(root, n))
    ao = os.path.join(root, "tests", "always-on")
    shutil.copytree(AO, ao, ignore=shutil.ignore_patterns("results", "__pycache__"))
    os.rename(os.path.join(ao, "scan_voice.py"), os.path.join(ao, "scan_voice.real.py"))
    with open(os.path.join(ao, "scan_voice.py"), "w") as f:
        f.write(SCAN_WRAPPER)
    return root


def run(tmp, script, tag, cases, reply=REPLY, status=None, extra_env=None):
    preload = os.path.join(tmp, "preload.mjs")
    if not os.path.exists(preload):
        with open(preload, "w") as f:
            f.write(PRELOAD)
    home = os.path.join(tmp, "home")
    os.makedirs(home, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if "OPENROUTER" not in k and not k.startswith("CLAUDE")}
    env.update({
        "HOME": home, "REALJS": os.path.join(tmp, "no-vault"), "RESULTS_ROOT": os.path.join(tmp, "results"),
        "KEY_ENV": KEY_VAR, KEY_VAR: FAKE_KEY, "NODE_OPTIONS": f"--import {preload}",
        "HV_MOCK_REPLY": reply, "PAR": "3",
    })
    if status:
        env["HV_MOCK_STATUS"] = str(status)
    env.update(extra_env or {})
    r = subprocess.run(["bash", script, MODEL, tag, *cases], env=env, capture_output=True, text=True, timeout=900)
    return r, os.path.join(tmp, "results", f"hv-{tag}")


def test_staging_prompt_and_scan_inputs_all_nine_cases():
    tmp = tempfile.mkdtemp(prefix="hv-tester-")
    before = tree(CASES)
    try:
        root = make_repo_copy(tmp)
        script = os.path.join(root, "tests", "always-on", "run_headless_voice.sh")
        failures = []
        logs = {}
        for case in NINE:
            logs[case] = os.path.join(tmp, f"{case}.req.jsonl")
        # one invocation per case so each case has its own request log
        scanlog = os.path.join(tmp, "scan.jsonl")
        for case in NINE:
            r, res = run(tmp, script, "stage-" + case, [case],
                         extra_env={"HV_MOCK_LOG": logs[case], "HV_SCAN_LOG": scanlog})
            assert r.returncode == 0, (case, r.stdout[-2000:], r.stderr[-2000:])
            reqs = [json.loads(l) for l in open(logs[case]) if l.strip()]
            assert len(reqs) == 1, (case, len(reqs))
            seen = reqs[0]["files"]
            want = expected_planted(case)
            missing = sorted(set(want) - set(seen))
            extra = sorted(set(seen) - set(want))
            differ = sorted(k for k in set(want) & set(seen) if want[k] != seen[k])
            if missing or extra or differ:
                failures.append(f"{case}: missing={missing} extra={extra} differ={differ}")
            # the message sent
            C = os.path.join(CASES, case)
            pf = os.path.join(C, "turn1.md" if case == "t4-intake" else "prompt.md")
            sent = open(pf).read()
            if reqs[0]["prompt"] is not None and sent.strip() not in reqs[0]["prompt"]:
                failures.append(f"{case}: user message is not {os.path.basename(pf)}")
            trial = os.path.join(res, case, "1")
            if open(os.path.join(trial, "prompt.txt")).read() != sent:
                failures.append(f"{case}: prompt.txt != {os.path.basename(pf)}")
            # the key
            for d, _, files in os.walk(res):
                for n in files:
                    with open(os.path.join(d, n), "rb") as fh:
                        assert FAKE_KEY.encode() not in fh.read(), os.path.join(d, n)
            assert FAKE_KEY not in r.stdout + r.stderr
        # scan_voice inputs == judge_voice.sh's, per case
        calls = [json.loads(l) for l in open(scanlog) if l.strip()]
        assert len(calls) == len(NINE), calls
        ao = os.path.join(root, "tests", "always-on")
        for argv in calls:
            reply = argv[argv.index("--reply") + 1]
            case = reply.split(os.sep)[-3]
            want = judge_voice_candidate_args(ao, case)
            got = [a for i, a in enumerate(argv) if a == "--candidate" or (i and argv[i - 1] == "--candidate")]
            if got != want:
                failures.append(f"{case}: scan --candidate {got} != judge_voice's {want}")
            plan_added = os.path.join(os.path.dirname(reply), "plan-added.txt")
            has_plan = "--plan-added" in argv
            if has_plan != (os.path.getsize(plan_added) > 0):
                failures.append(f"{case}: --plan-added passed={has_plan} but plan-added.txt size={os.path.getsize(plan_added)}")
        assert not failures, "\n".join(failures)
        assert tree(CASES) == before, "source case folders changed"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_provider_error_trial_is_not_a_finished_clean_measurement():
    """An upstream 429 ends the turn with an empty reply and an [error]
    line. An empty reply scans as 0 HARD, so if the trial counts as done
    (exit 0) the table reads as a voice-clean pass and a same-tag re-run
    never retries it."""
    tmp = tempfile.mkdtemp(prefix="hv-tester-")
    try:
        script = os.path.join(AO, "run_headless_voice.sh")
        log = os.path.join(tmp, "req.jsonl")
        r, res = run(tmp, script, "err", ["t21-plain-report"], status=429, extra_env={"HV_MOCK_LOG": log})
        trial = os.path.join(res, "t21-plain-report", "1")
        stderr = open(os.path.join(trial, "stderr.txt")).read()
        assert "[error]" in stderr, stderr[-1500:]
        problems = []
        if open(os.path.join(trial, "exit.txt")).read().strip() == "0":
            problems.append("exit.txt says 0 for a turn that ended on a provider error")
        if r.returncode == 0:
            problems.append("driver exit 0 with an errored trial")
        n1 = sum(1 for _ in open(log))
        r2, _ = run(tmp, script, "err", ["t21-plain-report"], extra_env={"HV_MOCK_LOG": log})
        if "skip t21-plain-report trial 1" in r2.stdout or sum(1 for _ in open(log)) == n1:
            problems.append("same-tag re-run skipped the errored trial instead of retrying it")
        assert not problems, "; ".join(problems)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    bad = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok", name)
            except AssertionError as e:
                bad += 1
                print("FAIL", name, "\n ", e)
    raise SystemExit(1 if bad else 0)
