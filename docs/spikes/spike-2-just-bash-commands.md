# Spike 2 — just-bash custom commands dispatch to a JS port

**Code:** `spikes/2-just-bash/` · **Date:** 2026-09-22 · **Node:** v25.6.0

**Versions:** `just-bash@3.4.2`, plus spike 1's `vite@8.3.0` /
`playwright@1.63.0` reused for the browser run.

**Script chosen:** `skills/coach/scripts/check_closeout.py` (110 lines),
not `skills/profile/scripts/check_files.py` (477 lines, evaluates every
skill's schemas) or `skills/evaluate/scripts/record_verdict.py` (75 lines
but imports `../../search/scripts/jobs_md.py`, so not self-contained).
`check_closeout.py` has zero imports beyond the stdlib and is the smallest
genuinely self-contained checker the MVP journey calls — the "smallest
self-contained one" the task asked to pick when going smaller than
`check_files.py`.

## Pass criteria and results

| # | Criterion | Result |
|---|---|---|
| 1 | Running exactly `python3 skills/coach/scripts/check_closeout.py <args>` inside just-bash reaches a JS function | **PASS** |
| 2 | Output and exit code match the Python script's | **PASS** — 6/6 fixtures byte-identical |
| 3 | Files the command writes land in the in-memory FS | **PASS (adapted)** — see note below |
| 4 | Runs in Node AND in the browser | **PASS** |

Note on #3: `check_closeout.py` is read-only by design (it only *reads*
`plan.md`/`jobs.md` and reports FAIL/WARN — see its docstring: "the script
checks the disk"). It writes nothing, so the literal claim doesn't apply to
this script. What's shown instead: a plain just-bash command (`cat <<EOF >
plan.md`) writes into the same in-memory `Bash` instance's filesystem, and
the very next `python3 skills/coach/scripts/check_closeout.py` call reads
that write back — proving the custom command and ordinary shell commands
share one in-memory FS, which is the property the MVP needs (`test/node-dispatch.test.mjs`,
test 3).

## Commands and real output

Parity (`node test/parity.mjs`, spawns the real `python3` and the JS CLI
against the same temp workspace per fixture, taken from the repo's
`tests/test_check_closeout.py`):

```
[PASS] clean  py.exit=0 js.exit=0
[PASS] bad_stage_fails  py.exit=1 js.exit=1
[PASS] question_without_row_fails  py.exit=1 js.exit=1
[PASS] stale_plan_fails  py.exit=1 js.exit=1
[PASS] missing_plan_fails  py.exit=1 js.exit=1
[PASS] stage_auto_inferred  py.exit=0 js.exit=0

6/6 cases byte-identical (stdout + exit code)
```

In-memory dispatch, in Node (`node --test test/node-dispatch.test.mjs`):

```
✔ exact skill command line dispatches to the JS port, in-memory FS (24.999084ms)
✔ an unrecognized python3 target still falls through with 127 (1.677542ms)
✔ the command reads whatever plan.md the in-memory FS holds at run time (10.663584ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

Build + real headless-browser run (`npx vite build && node verify.mjs`):

```
dist/assets/index-BYdFjJxN.js  1,282.79 kB │ gzip: 354.79 kB
✓ built in 301ms

DOM #done: { text: 'running', pass: 'true' }
DOM #result: exitCode=0
close-out clean: stage applying; plan.md written; 2 question(s) each have a row

VERIFY PASS
```

## Addendum 2026-09-22 — reviewer flag (step1-review.md S12)

The independent review flags that dispatch here matches the **exact
literal path** `skills/coach/scripts/check_closeout.py`
(`src/command.mjs`'s `PORTED_SCRIPT_PATH` check), not the **file name**
(`check_closeout.py`) regardless of the relative prefix used to reach it
— the design contract's own dispatch rule is file-name-based, because
skills genuinely invoke scripts with varying relative forms (`scripts/…`,
`../profile/scripts/…`). This spike proves the dispatch *mechanism* (a
custom `python3` command reaching a JS function) and the in-memory FS
sharing; it does not prove file-name-based matching. The review also
notes the flag parser here is hand-rolled with no argparse-error-parity
test. Neither was in this spike's original ask (plan:86-88 names
`check_materials.py`, not `check_closeout.py`, and doesn't specify the
matching rule) — flagging per the coordinator's rework instructions
rather than changing spike 2's code, which is out of this rework's scope
(`spikes/1-browser-loop/` and `docs/spikes/` only). O should either accept
exact-path dispatch explicitly, or step 3's first task should prove
file-name dispatch and full `check_materials.py` parity instead.

## Surprises

- `defineCommand` + `Bash({ customCommands })` was exactly as documented —
  registering `"python3"` and switching on `argv[0]` (the script path) was
  enough to intercept the one exact command line the task named, and fall
  through to a 127 for anything else, without needing to touch just-bash's
  real `python3` runtime (`python: true`, CPython-backed) at all.
- `ctx.fs.resolvePath(ctx.cwd, path)` was required to turn the checker's
  relative `--workspace .` / `plan.md` paths into what `ctx.fs.readFile` /
  `.exists` / `.stat` expect — passing the raw relative path through
  worked in quick manual checks but is not documented as guaranteed, so
  the port resolves explicitly.
- The Vite browser build of `just-bash` externalizes `node:zlib` (used by
  the unrelated `gzip`/`tar` commands this spike never calls) with a
  warning, not a failure — the build still succeeds and the page still
  runs. Worth knowing for step 4: if the MVP's tool list ever needs
  gzip/tar in the browser, that's the moment to revisit, not before.
- The core port (`src/check-closeout.mjs`) has zero imports — no
  `node:fs`, no `node:path` — by construction; only the two thin adapters
  (`src/io-node.mjs` for the Node CLI, and the just-bash `ctx.fs` closure
  inside `src/command.mjs`) touch a filesystem API. This is the shape step
  3 (porting the other five checkers) should copy.

## What it means for the design

- The custom-command approach (plan decision #6: ports to JS, parity test
  until the local plugin switches over) works exactly as the plan assumed:
  skill prose stays unchanged (`python3 …/check_closeout.py …` is still
  the literal command the skill's SKILL.md would write), and the dispatch
  layer is the only new code.
- The finish-reason gotcha from spike 1 doesn't recur here — just-bash's
  API matched its docs directly.
- Recommend step 3 keep the same three-file shape per checker (pure port +
  Node IO adapter + just-bash IO adapter) rather than writing the just-bash
  binding logic once per script — the adapters are ~15 lines each and the
  pure core is what the parity test exercises.
