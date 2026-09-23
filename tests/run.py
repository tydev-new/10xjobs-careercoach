#!/usr/bin/env python3
"""Run every tests/test_*.py without pytest (not installed on this host).

    python3 tests/run.py
"""
import glob, importlib, importlib.util, os, shutil, subprocess, sys, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "skills", "profile", "scripts"))

passed = failed = 0
KIT = os.path.join(HERE, "..", "kit", "tests")
# append, never insert: kit/tests has its own test_invariants.py, and a
# front-of-path KIT silently shadowed this repo's (found 2026-09-22).
sys.path.append(KIT)
paths = sorted(glob.glob(os.path.join(HERE, "test_*.py")))
paths += [os.path.join(KIT, "test_kit.py")]          # the kit's guarded copies
for path in paths:
    name = os.path.basename(path)[:-3]
    if path.startswith(KIT):
        name = "kit_" + name
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    else:
        mod = importlib.import_module(name)
    for name in sorted(dir(mod)):
        if name.startswith("test_"):
            try:
                getattr(mod, name)()
                passed += 1
            except Exception:
                failed += 1
                print(f"FAIL {mod.__name__}.{name}")
                traceback.print_exc()
# apps/web's tester-owned suite (tests/web/*.test.ts) is Node's own test
# runner, not pytest-shaped — run it here too so one command covers both,
# rather than a second command the repo has to remember. Skips loudly
# (not silently) when node isn't on PATH, and its own pass/fail folds into
# this script's exit code.
node = shutil.which("node")
web_tests = sorted(glob.glob(os.path.join(HERE, "web", "*.test.ts")))
if not node:
    print("\nSKIPPED tests/web/*.test.ts: no `node` on PATH")
elif not web_tests:
    print("\nSKIPPED tests/web/*.test.ts: no test files found")
else:
    print(f"\n--- node --test tests/web/*.test.ts ({len(web_tests)} file(s)) ---")
    result = subprocess.run([node, "--test", *web_tests], cwd=os.path.join(HERE, ".."))
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/web/*.test.ts (node --test) — see output above")
    else:
        passed += 1

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
