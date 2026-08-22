#!/usr/bin/env python3
"""Run every tests/test_*.py without pytest (not installed on this host).

    python3 tests/run.py
"""
import glob, importlib, os, sys, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "skills", "profile", "scripts"))

passed = failed = 0
for path in sorted(glob.glob(os.path.join(HERE, "test_*.py"))):
    mod = importlib.import_module(os.path.basename(path)[:-3])
    for name in sorted(dir(mod)):
        if name.startswith("test_"):
            try:
                getattr(mod, name)()
                passed += 1
            except Exception:
                failed += 1
                print(f"FAIL {mod.__name__}.{name}")
                traceback.print_exc()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
