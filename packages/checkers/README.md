# packages/checkers

JS ports of the MVP skill checkers (`docs/design-web-agent.md` § 5, step 3
of `docs/plan-portable-skills-and-web-agent.md`), the just-bash `python3`
dispatch adapter (so skill prose stays unchanged), and the Python parity
harness that proves the two runtimes agree.

**Why this exists:** `packages/agent` runs the skills' own `python3
scripts/check_materials.py ...` command lines inside just-bash's in-browser
sandbox, which has no real Python interpreter. This package supplies the JS
implementation those commands dispatch to, so the skill's `SKILL.md`
prose — and the local Claude Code plugin that still runs the real
Python — never have to fork.

## Layout

```
src/                  the ports (ESM, no Node-only / browser-only imports)
  path-util.mjs        POSIX path helpers (join/normalize/dirname/relative — no node:path)
  py-text.mjs           Python string-semantics helpers (pySplit, stripChars, pyInt, pyListRepr)
  argx.mjs               a tiny argv parser that reproduces argparse's error text
  fs-walk.mjs            directory-walking helpers built only on the io interface (no glob module)
  jobs-md.mjs            jobs_md.py — the shared pipeline-record library
  check-materials.mjs    check_materials.py
  check-files.mjs        check_files.py
  proposal-block.mjs     proposal_block.py
  record-verdict.mjs     record_verdict.py
  update-job.mjs         update_job.py
  check-closeout.mjs     check_closeout.py (ported in spikes/2-just-bash/, reused here verbatim + a run() wrapper)
  render-resume.mjs      render_resume.py — HTML builder + word count only, no PDF (see below)
  dispatch.mjs            the file-name dispatch registry (design-web-agent.md § 5 / re-review S12)
  just-bash-command.mjs   registers "python3" as a just-bash custom command
  io-node.mjs             the Node fs adapter for the io interface
bin/                  Node CLI wrappers (spawned exactly like `python3 <script>.py ...`)
test/
  unit/                node --test unit tests, mirroring each tests/test_*.py
  parity.mjs            the CLI-level parity harness against the REAL Python scripts
  browser/              a Vite page + Playwright script proving the ports run in a browser
```

## The io interface

Every port that touches a file takes an `io` object as an explicit
argument — never `node:fs`, never a global. This is what makes the same
`src/*.mjs` file run in Node (`src/io-node.mjs`), inside just-bash's
in-memory filesystem (`src/just-bash-command.mjs`'s `makeIo`), and inside a
unit test's fake filesystem (`test/unit/fake-io.mjs`) unchanged.

```
io.exists(path)          -> Promise<boolean>
io.readFile(path)        -> Promise<string>            (utf-8 text)
io.writeFile(path, text) -> Promise<void>               (writers only)
io.mtimeMs(path)         -> Promise<number>             (epoch ms; check_closeout only)
io.isDir(path)           -> Promise<boolean>
io.readdir(path)         -> Promise<string[]>           (entry names, not full paths)
```

A checker's exported `run(argv, io, now?)` parses `argv` the way the
Python script's `argparse` parser would, then does the same file
reads/writes through `io`. `now` is an injectable clock (`() => Date.now()`
for `check_closeout`, `() => new Date()` for the `jobs_md`-based scripts) —
this is the "ports read `deps.clock`" line in `docs/design-web-agent.md` §
5, and it is what lets `test/parity.mjs` freeze time for a byte-for-byte
diff against Python's wall-clock `datetime.now()` (see "Timestamps and
parity" below).

## File-name dispatch (design-web-agent.md § 5 / re-review S12)

`src/dispatch.mjs` matches `python3 <argv[0]> ...` by `argv[0]`'s **file
name**, not its exact path — `scripts/check_materials.py`,
`../apply/scripts/check_materials.py`, and
`skills/apply/scripts/check_materials.py` all reach the same port, because
different skills genuinely invoke the same ported script with different
relative prefixes. This closes the gap the independent review flagged
against spike 2's exact-path dispatch (`docs/spikes/spike-2-just-bash-commands.md`'s
addendum, "S12").

An unknown script (e.g. `check_messages.py`, not in § 5's port list), a
bare `-c`, or no script argument at all exits 127 with `not available in
the web app: <name>` — see `test/unit/dispatch.test.mjs`.

## Running the tests

```
npm install                 # inside packages/checkers/
npm run test:unit           # node --test test/unit/*.test.mjs
npm run parity              # test/parity.mjs — needs python3 on PATH
npm test                    # both

npm run build:browser       # vite build test/browser
npm run verify:browser      # playwright: loads the built page, asserts the dispatch worked
```

`python3 tests/run.py` (repo root) runs `test:unit` and `parity` too,
skipping loudly (not silently) if `node` isn't on PATH — the same pattern
`tests/web` already uses.

## The parity test (`test/parity.mjs`)

For every ported CLI, the harness runs the **real** Python script and the
JS port's Node CLI (`bin/*.mjs`) against **separate, identically-seeded**
temp workspaces, then diffs:

- stdout and stderr (after normalizing each engine's own workspace's
  absolute path to a placeholder — the two temp dirs necessarily have
  different names, which has nothing to do with checker behavior)
- the exit code
- for writers (`record_verdict`, `update_job`, `render_resume`), the
  resulting file's content, byte for byte

The corpus covers every CLI at least once, every `def test_` in the
matching `tests/test_*.py` file (via a CLI-level case, an in-process
`test/unit/*.test.mjs` mirror, or both — see "Coverage map" below), every
CLI's argparse error shape, and accented text (café/Montréal) in the two
scripts whose regexes are the design doc's named parity risk
(`check_materials`, `check_files`).

As of this writing: **58/58 parity cases byte-identical**, **73/73 unit
tests passing**.

### Timestamps and parity

`record_verdict.py`, `update_job.py`, and `jobs_md.py`'s `save()` all stamp
`datetime.now(timezone.utc)` into `jobs.md`. Python's own clock can't be
frozen from outside the process, so the harness instead: runs Python
first, diffs the written file against its *pre-run* content to find the
timestamp(s) THIS run freshly wrote (never a preserved field, like an
existing row's untouched `Seen:`), then re-runs the JS CLI with
`CHECKER_NOW_ISO=<that exact instant>` (read only by `bin/record_verdict.mjs`
and `bin/update_job.mjs`, only for this purpose — the just-bash command
adapter never reads it, so the browser and a real local run always use the
real clock). This makes the file diff deterministic without ever touching
Python.

## Quirks replicated exactly

- **`jobs_md.now_iso()`**: `2026-09-23T12:34:56+00:00` — Python's
  `isoformat(timespec="seconds")`, not `toISOString()`'s
  `...56.000Z`.
- **argparse error text**: each script's `usage:` banner is a literal
  string captured once from the real `python3 <script>.py` (see the `USAGE`
  constant in each `src/*.mjs`) — not a general argparse re-implementation.
  `src/argx.mjs` reproduces the "missing required", "invalid choice", and
  "unrecognized arguments" message shapes exactly; `update-job.mjs`
  hand-rolls its mutually-exclusive-group (`--stage`/`--dismiss`/`--restore`)
  error, since that shape doesn't generalize. If a script's flags ever
  change, re-capture its usage banner with
  `python3 skills/.../script.py 2>&1 1>/dev/null` and update the constant.
- **Python `str.replace(old, new)` replaces ALL occurrences** (unlike JS's
  `.replace()`, which replaces only the first unless given a global
  regex) — every port uses `.replaceAll()` or an explicit `/g` regex
  everywhere the Python source calls `.replace()` on a literal.
- **`str.strip(chars)`** (a *character-set* strip, not a substring strip)
  has no JS built-in — `py-text.mjs`'s `stripChars()` replicates it.
- **List reprs in f-strings** (e.g. `f"...{sorted(allowed)}..."`) print
  Python's `repr()` of each string (`['a', 'b']`, single-quoted) —
  `py-text.mjs`'s `pyListRepr()`/`pyStrRepr()` reproduce this for the
  plain-word lists these checkers ever embed.
- **`SystemExit(str)`**: `jobs_md.save()`'s duplicate-key guard raises
  `SystemExit(message)` in Python, which — uncaught — prints the message to
  stderr and exits 1 with no traceback. `jobs-md.mjs` throws a
  `DuplicateKeyError`; every CLI wrapper and the just-bash adapter catch it
  and reproduce the same stderr/exit-1 shape.

## Known, sanctioned divergences from Python

These are deliberate — not gaps in the port — and are called out here so a
future diff against the Python source doesn't "fix" them back:

- **`render_resume.py --pdf`** (`docs/design-web-agent.md` § 5): the
  Python script shells out to a local Chrome/Chromium to render and
  measure a PDF. There is no subprocess in a browser sandbox, so the JS
  port never attempts it: `--pdf` is accepted for CLI-shape compatibility,
  prints one line (`PDF: NOT RENDERED — ...`), and never claims a page
  count. This is **not** parity-tested against Python (Python's own
  `--pdf` output is itself machine-dependent — it differs by whether
  Chrome happens to be installed on the machine running the test — so
  there is no single "real" output to diff against). It is unit-tested on
  its own (`test/unit/render-resume.test.mjs`).
- **`check_files.py --skills`'s default value**: Python defaults to a path
  computed from `os.path.dirname(__file__)` (the script's own location on
  disk) — meaningless in a bundled/browser context, where there is no
  script file location. The JS port has no default beyond `"."`; every
  real caller (the parity harness, the just-bash dispatcher, the agent
  package) passes `--skills` explicitly. Every parity/unit test does too,
  so this never actually diverges in tested behavior.
- **`check_files.py --workspace`'s `~` expansion**: Python calls
  `os.path.expanduser()` on the workspace path. The web app never sees a
  real home directory (rule 9: workspace files live in Storage, not on a
  local disk), so the JS port passes the path through unchanged. Real
  callers never pass a `~`-prefixed path.

## Coverage map (tests/test_*.py -> this package's tests)

| Python test file | How it's covered here |
|---|---|
| `tests/test_check_materials.py` | `test/unit/check-materials.test.mjs` (all `test_mechanical_cases` sub-cases + the three rewording tests, run in-process against the pure `checkResume`/`checkLetter`) **and** CLI-level cases in `test/parity.mjs`. `test_language_parsers_deleted_and_contract_exists` is Python-implementation-only (asserts specific functions were deleted from the Python module) — **N/A** to a port that never had them. |
| `tests/test_check_closeout.py` | All 6 `test_*` functions are themselves CLI-level (subprocess) — covered 1:1 by `test/parity.mjs`'s 6 cases (reusing `spikes/2-just-bash/`'s fixtures) plus `test/unit/dispatch.test.mjs`. |
| `tests/test_proposal_block.py` | All 5 `test_*` functions are CLI-level — covered by `test/parity.mjs`'s 4 cases (one case exercises 3 of the 5 assertions together) and mirrored in-process in `test/unit/proposal-block.test.mjs`. |
| `tests/test_render_resume.py` | All 5 `test_*` functions call the pure `to_html`/`word_count` directly — mirrored in `test/unit/render-resume.test.mjs`; the HTML-builder path is also parity-tested via `test/parity.mjs`. |
| `tests/test_jobs_md.py` | `jobs_md.py` has no CLI of its own ("library for the two above" — design-web-agent.md § 5) — all 6 `test_*` functions mirrored in-process in `test/unit/jobs-md.test.mjs` against the JS port directly. |
| `tests/test_check_files.py` | 35 `test/unit/check-files.test.mjs` cases mirror the Python file's assertions (most run against the real `skills/` tree via `io-node`, matching how the Python tests import `check_files` directly) plus 13 CLI-level cases in `test/parity.mjs`. |
| `tests/test_e2e_lifecycle.py` | Its `check_materials` (Stage 5) and `record_verdict` (Stage 4) calls are reproduced as their own named parity cases (`e2e-stage5-writer-application`, `creates-new-role`). The other stages call unported scripts (`check_messages`, `check_knowledge`, `check_stories`) — out of step 3's scope per § 5's port list. |

## Not done / open questions for the lead

- `check_messages.py`, `check_knowledge.py`, `check_stories.py` are **not**
  in § 5's port list and are not ported — they exit 127 through the
  dispatcher, matching the contract.
- The browser proof (`test/browser/`) exercises `check_materials` (a
  reader) and `record_verdict` (a writer) end to end, per the slice's ask.
  It does not exercise all seven ports in the browser — the parity harness
  and unit tests already prove each port's *logic* has no Node-only or
  browser-only import; the browser proof's job is to prove the
  *dispatch mechanism* works in a real browser, which it does regardless of
  which two ported scripts it happens to call.
- `render_resume.py`'s Python `--pages`/`--strict` "over target" exit-1
  path depends on a real PDF page count, which the web app never produces
  (see "Known, sanctioned divergences" above) — so that specific exit code
  is unreachable from the JS port by design, not by omission.
