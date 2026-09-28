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
    try:
        if path.startswith(KIT):
            name = "kit_" + name
            spec = importlib.util.spec_from_file_location(name, path)
            mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        else:
            mod = importlib.import_module(name)
    except Exception:
        # A single test file's own import failing (e.g. a module it
        # imports was deleted this stage) must not crash every OTHER
        # test file's run — reported as one FAIL, not a hard stop.
        failed += 1
        print(f"FAIL {name} (import)")
        traceback.print_exc()
        continue
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

# scripts/test/*.test.mjs — unit tests for the dev-only helper scripts
# under scripts/ (design-sample.mjs, check-handback-paths.mjs,
# capture.mjs). Same node --test pattern as tests/web above; skips
# loudly (not silently) when node isn't on PATH or no test files exist.
scripts_tests = sorted(glob.glob(os.path.join(HERE, "..", "scripts", "test", "*.test.mjs")))
if not node:
    print("\nSKIPPED scripts/test/*.test.mjs: no `node` on PATH")
elif not scripts_tests:
    print("\nSKIPPED scripts/test/*.test.mjs: no test files found")
else:
    print(f"\n--- node --test scripts/test/*.test.mjs ({len(scripts_tests)} file(s)) ---")
    result = subprocess.run([node, "--test", *scripts_tests], cwd=os.path.join(HERE, ".."))
    if result.returncode != 0:
        failed += 1
        print("FAIL scripts/test/*.test.mjs (node --test) — see output above")
    else:
        passed += 1

# tests/scripts/*.test.mjs — the INDEPENDENT tester's acceptance suite for
# the same helper scripts (separate from scripts/test/, the coder's own).
# Same node --test pattern; skips loudly when node isn't on PATH.
tester_scripts_tests = sorted(glob.glob(os.path.join(HERE, "scripts", "*.test.mjs")))
if not node:
    print("\nSKIPPED tests/scripts/*.test.mjs: no `node` on PATH")
elif not tester_scripts_tests:
    print("\nSKIPPED tests/scripts/*.test.mjs: no test files found")
else:
    print(f"\n--- node --test tests/scripts/*.test.mjs ({len(tester_scripts_tests)} file(s)) ---")
    result = subprocess.run([node, "--test", *tester_scripts_tests], cwd=os.path.join(HERE, ".."))
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/scripts/*.test.mjs (node --test) — see output above")
    else:
        passed += 1

# packages/checkers: the JS ports' own unit tests (docs/design-web-agent.md
# § 5). The parity machinery (parity.mjs, coverage-gate.mjs) is gone at J2
# (docs/design-js-only.md § 6): tests/checkers/run-cases.mjs's
# expected-output cases are the specification now. Skips loudly (not
# silently) when node isn't on PATH, same pattern as tests/web above.
CHECKERS = os.path.join(HERE, "..", "packages", "checkers")
if not node:
    print("\nSKIPPED packages/checkers (unit): no `node` on PATH")
else:
    print("\n--- node --test packages/checkers/test/unit/*.test.mjs ---")
    unit_tests = sorted(glob.glob(os.path.join(CHECKERS, "test", "unit", "*.test.mjs")))
    result = subprocess.run([node, "--test", *unit_tests], cwd=CHECKERS)
    if result.returncode != 0:
        failed += 1
        print("FAIL packages/checkers/test/unit (node --test) — see output above")
    else:
        passed += 1

# tests/checkers-parity/dispatch.test.mjs: the INDEPENDENT tester's own
# dispatch-contract suite (plan step 3), separate from
# packages/checkers/test/ (the coder's own tests, above). extra.mjs and
# e2e_both.py (the tester's parity harness against Python) are gone at J2,
# same reason as packages/checkers/test/parity.mjs above.
CHECKERS_PARITY = os.path.join(HERE, "checkers-parity")
if not node:
    print("\nSKIPPED tests/checkers-parity: no `node` on PATH")
else:
    print("\n--- node --test tests/checkers-parity/dispatch.test.mjs ---")
    result = subprocess.run([node, "--test", os.path.join(CHECKERS_PARITY, "dispatch.test.mjs")], cwd=CHECKERS)
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/checkers-parity/dispatch.test.mjs — see output above")
    else:
        passed += 1

# tests/checkers/: the expected-output cases (docs/design-js-only.md § 5) —
# Python 3.14's recorded output for all eleven shipped scripts, replayed
# through the `node` path (the ports; python3 for the three unported
# scripts until J3) and the web's just-bash dispatch; then the § 5.4 tester
# checks (a planted wrong output, an edited input, the masked temp path and
# the stub Chrome page line must each FAIL). Node 18 (the floor, § 5.4)
# runs the `node` path too when NODE18_BIN names a Node 18 binary.
CASES = os.path.join(HERE, "checkers")
if not node:
    print("\nSKIPPED tests/checkers/run-cases.mjs: no `node` on PATH")
else:
    for label, args in (
        ("run-cases.mjs", []),
        ("run-cases.mjs --self-test", ["--self-test"]),
    ):
        print(f"\n--- node tests/checkers/{label} ---")
        result = subprocess.run([node, os.path.join(CASES, "run-cases.mjs"), *args], cwd=os.path.join(HERE, ".."))
        if result.returncode != 0:
            failed += 1
            print(f"FAIL tests/checkers/{label} — see output above")
        else:
            passed += 1
    node18 = os.environ.get("NODE18_BIN")
    if not node18:
        print("\nSKIPPED tests/checkers/run-cases.mjs on Node 18: set NODE18_BIN to a Node 18.19.1 binary")
    else:
        print(f"\n--- {node18} tests/checkers/run-cases.mjs --paths=node ---")
        result = subprocess.run([node18, os.path.join(CASES, "run-cases.mjs"), "--paths=node"], cwd=os.path.join(HERE, ".."))
        if result.returncode != 0:
            failed += 1
            print("FAIL tests/checkers/run-cases.mjs on Node 18 — see output above")
        else:
            passed += 1

# packages/agent's own suite (node --test) — plan step 4. Run with cwd
# set to packages/agent so its own node_modules (ai,
# @openrouter/ai-sdk-provider) resolve; `node --test` with no path args
# auto-discovers everything under packages/agent/test/. Skips loudly (not
# silently) when node isn't on PATH.
agent_dir = os.path.join(HERE, "..", "packages", "agent")
if not node:
    print("\nSKIPPED packages/agent tests: no `node` on PATH")
elif not os.path.isdir(agent_dir):
    print("\nSKIPPED packages/agent tests: packages/agent not found")
else:
    print("\n--- node --test (packages/agent) ---")
    result = subprocess.run([node, "--test"], cwd=agent_dir)
    if result.returncode != 0:
        failed += 1
        print("FAIL packages/agent tests (node --test) — see output above")
    else:
        passed += 1

# tests/agent/*.test.ts — the INDEPENDENT tester's own suite for
# packages/agent (plan step 4), separate from packages/agent/test/ (the
# coder's own tests). Run from the repo root; _support.ts resolves the
# repo root itself from import.meta.url, so cwd doesn't matter to it, but
# it also imports "ai"/"ai/test" straight from packages/agent/node_modules.
agent_suite_tests = sorted(glob.glob(os.path.join(HERE, "agent", "*.test.ts")))
if not node:
    print("\nSKIPPED tests/agent/*.test.ts: no `node` on PATH")
elif not agent_suite_tests:
    print("\nSKIPPED tests/agent/*.test.ts: no test files found")
else:
    print(f"\n--- node --test tests/agent/*.test.ts ({len(agent_suite_tests)} file(s)) ---")
    result = subprocess.run([node, "--test", *agent_suite_tests], cwd=os.path.join(HERE, ".."))
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/agent/*.test.ts (node --test) — see output above")
    else:
        passed += 1

# Edge Functions (supabase/functions, Deno): the coder's own tests plus the
# independent tester's adversarial suite (tests/functions). Loopback only;
# no live OpenRouter or Supabase. Skips loudly when deno isn't installed.
import shutil as _shutil
deno = _shutil.which("deno")
if not deno:
    print("\nSKIPPED supabase/functions + tests/functions: no `deno` on PATH")
else:
    for label, args in (
        ("supabase/functions", [deno, "test", "--allow-net", os.path.join(HERE, "..", "supabase", "functions")]),
        ("tests/functions", [deno, "test", "--allow-net=127.0.0.1", os.path.join(HERE, "functions")]),
    ):
        print(f"\n--- deno test {label} ---")
        result = subprocess.run(args, cwd=os.path.join(HERE, ".."))
        if result.returncode != 0:
            failed += 1
            print(f"FAIL deno test {label} — see output above")
        else:
            passed += 1

# tests/sql and tests/store both need `npm install` once before their
# suites can run (@electric-sql/pglite is a real download). Fix round 2,
# M-new-3: when `node` is on PATH, a missing node_modules is no longer a
# silent/loud SKIP — it's a FAIL, unless it can be fixed automatically.
#
# Decision: auto-install with `npm ci` (not "fail and print the command")
# when a package-lock.json is present, which it is in both directories.
# Justification: CLAUDE.md's own rule is "Tests: python3 tests/run.py" —
# ONE command, with every other suite in this file already auto-discovered
# and run with no separate setup step; making these two the sole exception
# that requires a manual `npm install` first would be a surprise on a
# fresh checkout and break that "one command" property. `npm ci` (not
# `npm install`) keeps it deterministic — exactly the pinned lockfile
# versions, not whatever `npm install` might resolve to — and is a no-op
# past the first run (node_modules already present). If the install
# itself fails (e.g. no network), that is reported as a genuine FAIL with
# the manual command to run, not swallowed.
def ensure_node_modules(dir_path, label):
    if os.path.isdir(os.path.join(dir_path, "node_modules")):
        return True
    rel = os.path.relpath(dir_path, os.path.join(HERE, ".."))
    if not npm:
        print(f"\nFAIL {label}: node_modules not installed and no `npm` on PATH to install it. Run: (cd {rel} && npm install)")
        return False
    lockfile_present = os.path.isfile(os.path.join(dir_path, "package-lock.json"))
    install_cmd = [npm, "ci"] if lockfile_present else [npm, "install"]
    print(f"\n{label}: node_modules not installed — running `{' '.join(install_cmd)}` (auto-install, M-new-3)...")
    result = subprocess.run(install_cmd, cwd=dir_path)
    if result.returncode != 0:
        print(f"FAIL {label}: `{' '.join(install_cmd)}` failed — see output above. Run it manually: (cd {rel} && {' '.join(install_cmd)})")
        return False
    return True

npm = shutil.which("npm")

# tests/sql — the PGlite SQL harness over the APPLIED migration ("spike 3
# turned into CI"). Its own package.json "test" script now chains all
# FOUR runners (run.mjs && run-r2.mjs && r3-own.mjs && r4-own.mjs) — each
# sets process.exitCode = 1 on any FAIL (fix round 2, M-new-3); run.mjs's
# 3 KNOWN legacy teardown cases (the migration's teardown now refuses an
# in-SQL storage.* delete on purpose) are named and treated as expected,
# so it still exits 0 when only those differ. Skips loudly (not silently)
# only when `node` itself isn't on PATH at all (nothing here could ever
# run); a missing node_modules with `node` present is a FAIL, per above.
sql_dir = os.path.join(HERE, "sql")
if not node:
    print("\nSKIPPED tests/sql (PGlite SQL harness): no `node` on PATH")
elif not ensure_node_modules(sql_dir, "tests/sql"):
    failed += 1
else:
    print("\n--- npm test (tests/sql) ---")
    result = subprocess.run([npm, "test"], cwd=sql_dir)
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/sql (npm test) — see output above")
    else:
        passed += 1

# tests/store/*.test.ts — the independent tester's step 2 suite: SupabaseWorkspaceStore
# driven against a PGlite stand-in that runs the APPLIED migration (not a
# hand-written fake), export/import adversarial cases (path rules, caps,
# zip-bomb/CRC32 defense), isolation, and auth. Owned by the tester, not
# this script — don't edit those files. Skips loudly only when `node`
# itself isn't on PATH; a missing node_modules with `node` present is a
# FAIL (auto-installed first, per above).
store_dir = os.path.join(HERE, "store")
store_tests = sorted(glob.glob(os.path.join(store_dir, "*.test.ts")))
if not node:
    print("\nSKIPPED tests/store/*.test.ts: no `node` on PATH")
elif not store_tests:
    print("\nSKIPPED tests/store/*.test.ts: no test files found")
elif not ensure_node_modules(store_dir, "tests/store"):
    failed += 1
else:
    print(f"\n--- node --test tests/store/*.test.ts ({len(store_tests)} file(s)) ---")
    result = subprocess.run([node, "--test", *store_tests], cwd=os.path.join(HERE, ".."))
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/store/*.test.ts (node --test) — see output above")
    else:
        passed += 1

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
