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

# packages/checkers: the JS ports' own unit tests, plus the parity test
# against the real Python scripts (docs/design-web-agent.md § 5, step 3).
# Skips loudly (not silently) when node isn't on PATH, same pattern as
# tests/web above.
CHECKERS = os.path.join(HERE, "..", "packages", "checkers")
if not node:
    print("\nSKIPPED packages/checkers (unit + parity): no `node` on PATH")
else:
    print("\n--- node --test packages/checkers/test/unit/*.test.mjs ---")
    unit_tests = sorted(glob.glob(os.path.join(CHECKERS, "test", "unit", "*.test.mjs")))
    result = subprocess.run([node, "--test", *unit_tests], cwd=CHECKERS)
    if result.returncode != 0:
        failed += 1
        print("FAIL packages/checkers/test/unit (node --test) — see output above")
    else:
        passed += 1

    print("\n--- node packages/checkers/test/parity.mjs ---")
    result = subprocess.run([node, os.path.join(CHECKERS, "test", "parity.mjs")], cwd=CHECKERS)
    if result.returncode != 0:
        failed += 1
        print("FAIL packages/checkers/test/parity.mjs — see output above")
    else:
        passed += 1

    print("\n--- node packages/checkers/test/coverage-gate.mjs ---")
    result = subprocess.run([node, os.path.join(CHECKERS, "test", "coverage-gate.mjs")], cwd=CHECKERS)
    if result.returncode != 0:
        failed += 1
        print("FAIL packages/checkers/test/coverage-gate.mjs — see output above")
    else:
        passed += 1

# tests/checkers-parity/: the INDEPENDENT tester's own suite for
# packages/checkers (plan step 3, fix round 2 item 4; fix round 3 brought
# it to 156/156 both engines) — separate from packages/checkers/test/
# (the coder's own tests, above).
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

    print("\n--- node tests/checkers-parity/extra.mjs ---")
    result = subprocess.run([node, os.path.join(CHECKERS_PARITY, "extra.mjs")], cwd=CHECKERS_PARITY)
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/checkers-parity/extra.mjs — see output above")
    else:
        passed += 1

    # tests/checkers-parity/e2e_both.py: the independent tester's own
    # replay of test_e2e_lifecycle.py's fixtures through BOTH engines (fix
    # round 3, item "wire e2e_both.py into tests/run.py"). It's a
    # standalone script, not a test_*.py module of test_*() functions
    # (importing it runs the whole thing immediately, including its own
    # sys.exit) — so it's run as a subprocess here, the same pattern as
    # the other node-based suites above, not imported like tests/test_*.py.
    # It also shells out to `node` itself (to run packages/checkers/bin/),
    # so it's gated on `node` being on PATH, same as its siblings here.
    print("\n--- python3 tests/checkers-parity/e2e_both.py ---")
    result = subprocess.run([sys.executable, os.path.join(CHECKERS_PARITY, "e2e_both.py")])
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/checkers-parity/e2e_both.py — see output above")
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

# tests/sql — the PGlite SQL harness over the APPLIED migration (fix
# round 1 CI instruction: "spike 3 turned into CI"). Its own package.json
# "test" script chains all three runners (run.mjs; run-r2.mjs; r3-own.mjs)
# with plain `;`, not `&&` — run.mjs has 3 KNOWN/expected failures (see
# tests/sql/README.md: its teardown cases assume the teardown deletes
# storage.* in SQL, which the applied migration makes impossible on
# purpose), so only the LAST command's exit code (r3-own.mjs) is the
# overall pass/fail signal, matching that script's own designed contract.
# Skips loudly (not silently) when `npm` isn't on PATH or node_modules
# hasn't been installed there yet (a real download: @electric-sql/pglite).
npm = shutil.which("npm")
sql_dir = os.path.join(HERE, "sql")
if not npm:
    print("\nSKIPPED tests/sql (PGlite SQL harness): no `npm` on PATH")
elif not os.path.isdir(os.path.join(sql_dir, "node_modules")):
    print("\nSKIPPED tests/sql (PGlite SQL harness): node_modules not installed — run `npm install` in tests/sql first")
else:
    print("\n--- npm test (tests/sql) ---")
    result = subprocess.run([npm, "test"], cwd=sql_dir)
    if result.returncode != 0:
        failed += 1
        print("FAIL tests/sql (npm test) — see output above")
    else:
        passed += 1

# tests/store/*.test.ts — the independent tester's step 2 suite (plan
# step 2 fix round 1): SupabaseWorkspaceStore driven against a PGlite
# stand-in that runs the APPLIED migration (not a hand-written fake),
# export/import adversarial cases (path rules, caps, zip-bomb defense),
# and auth. Owned by the tester, not this script — don't edit those
# files. Skips loudly when node_modules isn't installed there yet (a
# real download: @electric-sql/pglite) or no test files are found.
store_dir = os.path.join(HERE, "store")
store_tests = sorted(glob.glob(os.path.join(store_dir, "*.test.ts")))
if not node:
    print("\nSKIPPED tests/store/*.test.ts: no `node` on PATH")
elif not os.path.isdir(os.path.join(store_dir, "node_modules")):
    print("\nSKIPPED tests/store/*.test.ts: node_modules not installed — run `npm install` in tests/store first")
elif not store_tests:
    print("\nSKIPPED tests/store/*.test.ts: no test files found")
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
