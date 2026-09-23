#!/usr/bin/env python3
"""Tester-owned: replay tests/test_e2e_lifecycle.py's own fixtures through BOTH
engines (design-web-agent.md § 5 names test_e2e_lifecycle for the parity
corpus). Every run_py() call the e2e tests make to a PORTED script also runs
the JS bin (packages/checkers/bin/<name>.mjs) on the same input:
  readers  -> same workspace, right after Python; stdout/stderr/exit exact
  writers  -> a pre-run copy of the workspace; stdout/exit exact (copy path
              mapped back), jobs.md compared with timestamps masked
Unported scripts (check_messages, check_stories, ...) run Python only.

    python3 tests/checkers-parity/e2e_both.py      # exit 1 on any mismatch
"""
import os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = os.path.dirname(HERE)
BIN = os.path.join(TESTS, "..", "packages", "checkers", "bin")
sys.path.insert(0, TESTS)
import test_e2e_lifecycle as e2e  # noqa: E402

PORTED = {"check_materials", "proposal_block", "render_resume", "record_verdict",
          "update_job", "check_files", "check_closeout"}
WRITERS = {"record_verdict", "update_job"}
TS = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00|updated \d{4}-\d{2}-\d{2}")
orig = e2e.run_py
calls, mismatches = [], []


def js(name, args):
    p = subprocess.run(["node", os.path.join(BIN, name + ".mjs"), *args], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def shadow(script_path, *args):
    name = os.path.basename(script_path)[:-3]
    if name not in PORTED:
        return orig(script_path, *args)
    ws = args[args.index("--workspace") + 1] if "--workspace" in args else None
    copy = None
    if name in WRITERS and ws:
        copy = tempfile.mkdtemp(prefix="e2e-js-")
        shutil.copytree(ws, copy, dirs_exist_ok=True)
    py = orig(script_path, *args)
    if copy:
        jargs = [copy if a == ws else a for a in args]
        jr = js(name, jargs)
        jr = (jr[0], jr[1].replace(copy, ws), jr[2].replace(copy, ws))
        a = open(os.path.join(ws, "jobs.md"), encoding="utf-8").read() if os.path.exists(os.path.join(ws, "jobs.md")) else None
        b = open(os.path.join(copy, "jobs.md"), encoding="utf-8").read() if os.path.exists(os.path.join(copy, "jobs.md")) else None
        same_file = (a is None and b is None) or (a is not None and b is not None and TS.sub("<TS>", a) == TS.sub("<TS>", b))
        shutil.rmtree(copy, ignore_errors=True)
    else:
        jr = js(name, list(args))
        same_file = True
    same = py == jr and same_file
    calls.append((name, same))
    if not same:
        mismatches.append((name, args, py, jr, same_file))
    return py


e2e.run_py = shadow
failed_tests = 0
for t in sorted(n for n in dir(e2e) if n.startswith("test_")):
    try:
        getattr(e2e, t)()
        print(f"ran {t}")
    except Exception as ex:  # the e2e test itself failing is reported, not hidden
        failed_tests += 1
        print(f"E2E TEST FAILED {t}: {ex!r}")
for name, same in calls:
    print(f"[{'SAME' if same else 'DIFF'}] {name}")
for name, args, py, jr, sf in mismatches:
    print(f"--- {name} {args}\n py={py!r}\n js={jr!r}\n jobs.md same (masked)={sf}")
print(f"\n{len(calls) - len(mismatches)}/{len(calls)} ported-script calls identical across the e2e fixtures")
sys.exit(1 if mismatches or failed_tests or not calls else 0)
