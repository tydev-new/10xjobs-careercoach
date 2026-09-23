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

**Fix round 1** (an independent tester's corpus, `tests/checkers-parity/`,
found 53/102 failures) and **fix round 2** (the tester's re-verification,
39 new adversarial cases, found 5/141 failures) are both fixed and
documented below. Current totals — `tests/checkers-parity/extra.mjs`:
**141/141** identical py-vs-jsbin, **140/141** identical py-vs-jsbash (the
one remaining jsbash diff, `cf-default-skills-as-the-skill-prose-calls-it`,
is a round-1 case whose own mount simulation is superseded by round 2's
more accurate one — see "check_files.py --skills's default" below);
`tests/checkers-parity/dispatch.test.mjs`: **6/6**; the tester's browser
proof (`tests/checkers-parity/browser/`): **11/11**, including a real repo
path containing a space; this package's own `test/parity.mjs`: **58/58**;
`test/unit/*.test.mjs`: **73/73**; `test/coverage-gate.mjs`: **PASS**
(now including `tests/test_e2e_lifecycle.py`, per § 5's own naming of it).

## Layout

```
src/                  the ports (ESM, no Node-only / browser-only imports)
  path-util.mjs        POSIX path helpers (join/normalize/dirname/relative — no node:path)
  py-text.mjs           Python string/regex-semantics helpers — see "Python semantics this
                        file replicates" below (whitespace, splitlines, int(), code points, sort)
  py-digits.mjs           Unicode decimal-digit (any script) value lookup for pyInt()
  argx.mjs               the shared mini-argparse all 7 CLIs use (see "Argument parsing")
  help-text.mjs           each script's exact `-h`/`--help` output, captured verbatim
  traceback.mjs           the uncaught-exception response shape (see "Uncaught exceptions")
  fs-walk.mjs            directory-walking helpers built only on the io interface (no glob module)
  jobs-md.mjs            jobs_md.py — the shared pipeline-record library
  check-materials.mjs    check_materials.py
  check-files.mjs        check_files.py
  proposal-block.mjs     proposal_block.py
  record-verdict.mjs     record_verdict.py
  update-job.mjs         update_job.py
  check-closeout.mjs     check_closeout.py (ported in spikes/2-just-bash/, reused here + a run() wrapper)
  render-resume.mjs      render_resume.py — HTML builder + word count only, no PDF (see below)
  dispatch.mjs            the file-name dispatch registry (design-web-agent.md § 5 / re-review S12)
  just-bash-command.mjs   registers "python3" as a just-bash custom command
  io-node.mjs             the Node fs adapter for the io interface
bin/                  Node CLI wrappers (spawned exactly like `python3 <script>.py ...`)
test/
  unit/                node --test unit tests, mirroring each tests/test_*.py
  parity.mjs            this package's own CLI-level parity harness against the REAL Python scripts
  coverage-gate.mjs      fails if any tests/test_*.py `def test_` has no parity-case/unit-test entry
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
io.readFile(path)        -> Promise<string>            (utf-8 text — see "CRLF, universal
                                                          newlines, and U+2028/U+2029" below)
io.writeFile(path, text) -> Promise<void>               (writers only; creates parent dirs)
io.mtimeMs(path)         -> Promise<number>             (epoch ms; check_closeout only)
io.isDir(path)           -> Promise<boolean>
io.readdir(path)         -> Promise<string[]>           (entry names, not full paths; gracefully
                                                          returns [] for a missing/non-dir path —
                                                          see "Uncaught exceptions" for the one
                                                          caller that needs the opposite)
```

Both real adapters (`io-node.mjs`, `just-bash-command.mjs`) decode file
bytes via `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` — a
standard Web API, not Node-only — so invalid UTF-8 throws (matching
Python's `UnicodeDecodeError`) and a leading BOM survives (matching
Python's `"utf-8"` codec, as opposed to `"utf-8-sig"`), then run the text
through `py-text.mjs`'s `universalNewlines()` before the checker ever sees
it.

A checker's exported `run(argv, io, now?)` parses `argv` the way the
Python script's `argparse` parser would (via `src/argx.mjs`), then does the
same file reads/writes through `io`. `now` is an injectable clock (`()
=> Date.now()` for `check_closeout`, `() => new Date()` for the
`jobs_md`-based scripts) — this is the "ports read `deps.clock`" line in
`docs/design-web-agent.md` § 5, and it is what lets `test/parity.mjs`
freeze time for a byte-for-byte diff against Python's wall-clock
`datetime.now()` (see "Timestamps and parity" below).

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
the web app: <name>` — see `test/unit/dispatch.test.mjs` and the tester's
`tests/checkers-parity/dispatch.test.mjs`.

## Argument parsing (`src/argx.mjs`)

Fix round 1 replaced seven ad-hoc, hand-rolled flag parsers with **one**
shared mini-argparse (`src/argx.mjs`'s `parseFlags`), driven by each
script's declarative `OPTIONS` (and, for `update_job.py`, a
`mutexGroups` entry). It is not a general argparse port — it reproduces
exactly the behaviors these 7 scripts' argument definitions can exercise:

- **`-h`/`--help`**: matched first, anywhere in argv, and short-circuits
  immediately (even past tokens that would otherwise have been errors) —
  prints the script's exact captured help text (`src/help-text.mjs`, see
  below) and exits 0.
- **Prefix (abbreviation) matching**: `--work` resolves to `--workspace` if
  it's an unambiguous prefix; two or more matches (`--comp` between
  `--company`/`--company-file`) is `ambiguous option: --comp could match
  --company, --company-file`, matching argparse's own message (and, for
  Python 3.14, its unquoted choice list — see "argparse error text"
  below).
- **`--flag=value`**: works for value-taking flags; for a boolean
  (`store_true`) flag it's an error — `argument --dismiss: ignored
  explicit argument 'yes'`.
- **A missing value**: `argument --resume: expected one argument` — a
  following token that itself looks like a flag (starts with `-`, isn't a
  negative number) is never consumed as the value, matching argparse's own
  "looks like an option" rule.
- **Repeated flags**: the last one wins, no error (`--stage Applied
  --stage Offer` is valid) — UNLESS the flag is part of a mutually
  exclusive group and a *different* group member was already set, which is
  a mid-parse error (`argument --dismiss: not allowed with argument
  --stage`) that fires immediately, before the end-of-parse required-flags
  check even runs (matches argparse's actual internal order — confirmed
  against real `python3` runs, see `update-job.mjs`'s `argx.mjs` usage).
- **Precedence order** for the checks that happen after a successful
  parse: individual required flags first, then an unsatisfied mutually
  exclusive group's own "one of the arguments ... is required", then (in
  the caller, same as argparse's own `parse_args()` vs
  `parse_known_args()` split) unrecognized leftover arguments.
- **`type=int`**: routed through `py-text.mjs`'s `pyInt()` — Python's
  `int(str)` semantics (whitespace-stripped, single leading sign,
  underscores between digit groups, any Unicode decimal digit), not JS's
  `parseInt`.

### argparse error text

Each script's `usage:` banner is a literal string captured once from the
real `python3 <script>.py` (the `USAGE` constant in each `src/*.mjs`), and
`src/help-text.mjs`'s `HELP` map holds each script's *entire* `-h` output
(the banner, the full docstring — `RawDescriptionHelpFormatter` prints it
verbatim — and the wrapped options list), captured the same way and
embedded as a literal string via `JSON.stringify` (never hand-typed, to
rule out a transcription slip). If a script's argparse definition or
docstring ever changes, re-capture with:

```
python3 skills/.../script.py 2>&1 1>/dev/null   # -> USAGE
python3 skills/.../script.py -h                 # -> HELP.<script>
```

## Python semantics this port replicates (`src/py-text.mjs`)

Nine distinct places JS's built-in string/regex behavior disagrees with
Python's, each with a real corpus case behind it:

1. **`str.replace(old, new)` replaces ALL occurrences** (JS's `.replace()`
   replaces only the first, unless given a global regex) — every port uses
   `.replaceAll()` or an explicit `/g` regex everywhere the Python source
   calls `.replace()` on a literal.
2. **`str.strip(chars)`** (a *character-set* strip, not a substring strip)
   has no JS built-in — `stripChars()`.
3. **CRLF and universal newlines**: Python's `open(path,
   encoding="utf-8").read()` (the default, no `newline=""`) translates
   `\r\n` and a bare `\r` to `\n` before the caller's code ever sees the
   text. `universalNewlines()` does the same, applied once by both `io`
   adapters — no individual port needs to think about `\r` again.
4. **U+2028/U+2029 ("LINE SEPARATOR"/"PARAGRAPH SEPARATOR") are ordinary
   characters to Python's `^`/`$`/`.` — never a line boundary — but ARE
   to JS's** (JS's LineTerminator set, which `^`/`$`/`.` are all sensitive
   to and which JS gives no flag to redefine, is LF/CR/U+2028/U+2029).
   Confirmed against CPython: `re.match(r"^(.+)$", "a b", re.M)`
   captures `"a b"` whole; the equivalent JS regex splits it at the
   U+2028. This was the corpus's `cm-u2028-in-heading` case: a heading
   whose "space" is really a U+2028 must still read as one heading name.
   Since neither character can simply be normalized away (they must
   survive byte-for-byte in output), `universalNewlines()` swaps them for
   two Private-Use-Area sentinel code points for the whole life of the
   string inside a checker; `restoreLineSeparators()` swaps them back at
   every checker's stdout/stderr return and before anything gets written
   to a file.
5. **`str.splitlines()` is a MUCH broader boundary set than `^`/`$`** — LF,
   CR, CRLF, vertical tab, form feed, a few rare control characters, NEL,
   and U+2028/U+2029 (`pySplitlines()`, used only where the Python source
   literally calls `.splitlines()` — `render_resume.py`'s `blocks()`,
   `proposal_block.py`'s table-line split, `check_files.py`'s
   `check_table`/`check_history`, `check_materials.py`'s case-prose
   split). Everywhere else "split into lines" is Python's `^`/`$` or a
   plain `.split("\n")`, which is LF-only.
6. **A BOM (U+FEFF) is whitespace to JS's `\s`/`.trim()`, but NOT to
   Python's `\s`/`.strip()`** (confirmed: `"﻿".isspace()` is `False`
   in CPython) — `PY_S` is JS's `\s` character set minus U+FEFF, used by
   `pyStrip()`/`pySplit()`/`normSpace()` and inline wherever a port used to
   reach for `.trim()`. This is the corpus's `cm-bom-letter` case: a
   BOM'd "Hello" must NOT read as a plain "Hello" once leading whitespace
   is stripped.
7. **`\b`/`\w` are Unicode-aware in Python (default, for `str` patterns)
   but ASCII-only in JS**, even with the `u` flag — a CJK ideograph, for
   Python, IS a "word" character. `\b(19|20)\d{2}\b` must NOT match
   "2015" in "2015年毕业" (the trailing `\b` fails in Python, since both
   "5" and "年" are `\w`) but a bare JS `\b` incorrectly matches. `PY_B_START`/`PY_B_END`
   are lookaround-based `\b` equivalents built on `[\p{L}\p{N}_]`
   (needs the regex `u` flag) — used in `check-materials.mjs`'s
   education-year check, the one place this repo's regexes put a `\b`
   next to text that can plausibly be adjacent to non-Latin script.
8. **`int(str)`**: whitespace-stripped, a single leading sign, underscores
   between digit groups (PEP 515), and ANY Unicode decimal digit (`int("１２")
   == 12`, fullwidth digits) — `pyInt()`. Used both by `argx.mjs`'s
   `type: "int"` flags (where a parse failure is a CLI error) and by
   `jobs_md.load()`'s score-field parsing (where Python's `try:
   int(...); except ValueError: None` means a parse failure is silently
   `None`, a completely different call site with the same underlying
   conversion).
9. **Code points vs UTF-16 code units**: Python `str` is a sequence of
   Unicode code points; JS string `.length`/`.slice()`/indexing and
   `Array.prototype.sort()`'s default comparator are UTF-16 code units,
   which silently mis-slices or mis-sorts anything with an astral
   character (an emoji, most CJK Extension B+ ideographs, code point >
   0xFFFF, encoded as a surrogate pair). `cpArray()`/`cpLength()`/`cpSlice()`
   wrap `Array.from(s)` (code-point iteration); `codePointCompare()`/
   `pySortStrings()` replace every `.sort()` on a list of strings this
   package does (truncating a finding's embedded snippet, sorting
   `jobs.md` rows, sorting a directory listing, sorting an enum's allowed
   values for its error message).

(Residual, documented gap in #8: `pyInt()` normalizes digits via NFKC,
which covers fullwidth digits — the corpus's tested case — and most
compatibility forms, but not every Unicode Nd character Python's `int()`
accepts, e.g. Arabic-indic digits are `Nd` but not NFKC-normalizable to
ASCII; those return `null` here where Python would parse them. Not in the
corpus, and no call site in these 7 scripts is likely to see one.)

## Uncaught exceptions (lead ruling)

Several of these scripts crash **uncaught** in Python for specific inputs
they never guard against:

- `proposal_block.py` / `render_resume.py`: no `os.path.exists()` check
  before `open()` — a missing `--application`/`--md` file.
- `check_materials.py`: `os.path.exists()` is `True` for a directory too,
  so a `--resume`/`--letter` pointing at one clears the "file not found"
  branch and then `open()` raises `IsADirectoryError`. A non-UTF-8 file
  raises `UnicodeDecodeError` the same way.
- `check_files.py`: `check_strays()`'s `os.listdir(workspace)` raises for
  a missing workspace or a workspace path that's actually a file — the
  ONE place in this file that needs `io.readdir` to fail loudly rather
  than the "nothing here" the rest of the file wants (see `checkStrays()`'s
  explicit `io.isDir` check before it calls `io.readdir`).

**The lead's ruling**: exit-code parity plus a stderr whose **first line**
is exactly `Traceback (most recent call last):` is sufficient; the
remaining traceback lines (Python's own file paths and frame names) may
differ. `src/traceback.mjs`'s `crashToTraceback()` implements this shape;
each affected `run()` catches the thrown error and returns it, along with
whatever stdout the Python script would already have flushed before the
crash (built incrementally, so a mid-function throw still returns the
correct partial stdout).

This ruling was **not** communicated to the tester's own harness
(`tests/checkers-parity/extra.mjs`) — per instruction, it wasn't edited.
Its `compare()` diffs the FULL stderr (not just line 1) once line 1
matches, so these 6 cases still print `[DIFF] ... stderr-rest` there —
that's expected, not a remaining bug: `cm-resume-is-a-directory`,
`cm-latin1-bytes`, `pb-missing-application`, `rr-missing-md`,
`cf-missing-workspace-dir`, `cf-workspace-is-a-file`.

## `render_resume`'s `--html`-omitted path

Python falls back to `tempfile.mkdtemp()` — a fresh directory OUTSIDE
wherever `--md` lives — so it never touches (or collides with) a file
already in the candidate's workspace. There is no "temporary directory"
concept a browser sandbox can use the same way, so the port instead
writes to a fixed path outside any reasonable relative workspace tree
(`/tmp/checkers-render-resume/resume.html`), for the same reason: never
silently overwrite a workspace file the caller didn't name (both `io`
adapters' `writeFile` now create the parent directory first, since
nothing has mkdir'd this one). The corpus's `rr-default-html-path` case
(its own note already says "path is random by design") therefore has one
irreducible difference: **the exact path in the printed `words: N -> <path>`
line can never be made byte-identical to Python's**, because Python's own
path is a fresh random directory on every single run — there is no "real"
value to match. The file-content side of that case (does the pre-existing
`applications/resume.html` in the workspace survive untouched?) IS now
identical.

## Running the tests

```
npm install                 # inside packages/checkers/
npm run test:unit           # node --test test/unit/*.test.mjs
npm run parity              # test/parity.mjs — needs python3 on PATH; skips loudly (exit 0) without it
npm run coverage-gate       # test/coverage-gate.mjs — the § 5 coverage gate (see below)
npm test                    # all three

npm run build:browser       # vite build test/browser
npm run verify:browser      # playwright: loads the built page, asserts the dispatch worked
```

`python3 tests/run.py` (repo root) runs all three too, plus (fix round 2,
item 4) the INDEPENDENT tester's own `tests/checkers-parity/dispatch.test.mjs`
and `tests/checkers-parity/extra.mjs` — skipping loudly (not silently) if
`node` isn't on PATH, the same pattern `tests/web` already uses. Since
`extra.mjs`'s own exit code can't know about the lead's uncaught-exception
ruling or the round-1/round-2 mount-convention supersession (see
"check_files.py --skills's default value" below), `tests/run.py`'s
`extra.mjs` step currently reports one failure for exactly that one
documented, reasoned case — not a silent gap.

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
`test/unit/*.test.mjs` mirror, or both — see "Coverage map" below, and
`test/coverage-gate.mjs`, which enforces this claim rather than letting it
drift out of date), every CLI's argparse error shape, and accented text
(café/Montréal) in the two scripts whose regexes are the design doc's
named parity risk (`check_materials`, `check_files`).

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

## The § 5 coverage gate (`test/coverage-gate.mjs`)

Extracts every `def test_` name from the six `tests/test_*.py` files this
step ports, and fails loudly if any name has no entry in the script's own
`MANIFEST` — an entry is either a `test/parity.mjs` case id or a
`test/unit/*.test.mjs` test title, both grep'd for at runtime (so a
renamed/removed case makes the gate fail too, not just a genuinely
uncovered Python test), or an explicit `N/A: <reason>` for the two Python
tests that assert something about the **Python file itself**
(`inspect.getsource`/deleted-function checks) rather than the checker's
runtime behavior, where there is no JS artifact to point a case at.

## Fix round 2 additions to "Python semantics" and "Argument parsing"

Three more items, on top of the nine in "Python semantics this port
replicates" and the behaviors already listed under "Argument parsing"
above:

- **`PY_S` was incomplete**: missing 0x1C-0x1F (the "information
  separator" controls) and 0x85 (NEL) — both members of Python's `\s`
  that JS's native `\s` doesn't count. `PY_S_CHARS` is now the exact
  29-code-point set, verified by iterating every BMP code point through
  CPython's own `str.isspace()` (see `py-text.mjs`'s comment for the
  full list and how to re-verify it). **A second, subtler bug in the
  SAME area**: `PY_S` must ALSO match `universalNewlines`'s own
  U+2028/U+2029 sentinels (not just the real characters, which never
  survive that far) — a field value like `"Location:  x"` where the
  second "space" is really a U+2029 needs `\s*`-equivalent parsing (e.g.
  `jobs_md.load()`'s field-line regex) to consume it as a separator, the
  way Python's real `\s*` consumes the real U+2029. This was
  `r2-rv-nel-and-u2028-in-fields`'s failure: without the sentinels in
  `PY_S`, the substitute character read as ordinary content and stayed
  glued to the front of the parsed value.
- **`int(str)`'s Unicode digit values are no longer NFKC-only**: fullwidth
  digits happen to NFKC-normalize to ASCII, but most other scripts'
  native digits (Arabic-Indic, Devanagari, ...) don't. `pyInt()` now
  looks up each digit's VALUE via `py-digits.mjs`'s `unicodeDigitValue()`
  — a lookup table of every Unicode decimal-digit (category Nd) "zero"
  code point, generated once from CPython's own `unicodedata.decimal()`
  — instead of normalizing the whole digit run. `int("٣")` (Arabic-Indic)
  now correctly gives `3`, the corpus's `r2-rv-unicode-digit-scores` case.
- **argparse's `--` (end of options)**: every token after a bare `--`
  is positional — since none of these 7 scripts declare a positional
  argument, that means every one becomes an unrecognized-argument extra,
  parsed no further (so a literal `--workspace` appearing after `--` is
  a STRING, not the flag). **`--help=value`** (or an abbreviation of it,
  `--hel=value`): argparse's help action is itself boolean (`nargs=0`),
  so an inline value is the same "ignored explicit argument" error a
  boolean flag gives — except it names BOTH of the action's registered
  option strings (`-h/--help`), confirmed against real `python3`.

## Quirks replicated exactly (beyond "Python semantics" above)

- **`jobs_md.now_iso()`**: `2026-09-23T12:34:56+00:00` — Python's
  `isoformat(timespec="seconds")`, not `toISOString()`'s `...56.000Z`.
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
- **`render_resume.py`'s `--html`-omitted path**: see the dedicated
  section above.
- **`check_files.py --skills`'s default value** (fix round 1 BLOCKER, then
  fix round 2 item 1 — the round-1 fix was itself wrong): Python's default
  is `os.path.dirname(__file__) + "/../.."` — wherever check_files.py's
  OWN file physically sits, go up two directories. Every MVP `SKILL.md`'s
  session-close line runs `check_files.py --workspace .` with **no**
  `--skills` (e.g. `skills/apply/SKILL.md:75`), so getting this default
  right matters.

  Round 1's fix computed the default from `import.meta.url` INSIDE the
  shared port itself — a **host disk path** (wherever `packages/checkers`
  happens to be installed on the machine running the code). That's
  meaningless inside just-bash's in-memory filesystem
  (`docs/design-web-agent.md` § 4's actual runtime — "the bundle mounted
  read-only at `skills/`" of the sandboxed workspace), so it only ever
  passed by ACCIDENT, when a test happened to also mirror the bundle into
  the sandbox at that same host path. Round 2's tester corpus added
  `r2-cf-default-skills-design-mount`, which mounts the bundle ONLY where
  the design doc says it lives (`<workspace>/skills/`) — exposing this.

  The fix (`src/check-files.mjs`'s `skillsRootFromScriptPath()`): the
  shared port does the SAME two-dirnames-up string arithmetic Python
  does, but on a value it never computes itself — `invokedScriptPath`, an
  explicit parameter every caller supplies its own equivalent of
  Python's `__file__` for:

  - **`src/just-bash-command.mjs`** (the real production dispatcher):
    `dispatchPython3`'s new `skillsMountRoot` parameter (= `ctx.cwd`,
    where § 4 GUARANTEES the bundle is mounted) is combined with
    `dispatch.mjs`'s new `CANONICAL_SKILL_PATH` map (each ported script's
    own position inside the bundle, e.g. `"profile/scripts/check_files.py"`)
    to reconstruct `<ctx.cwd>/skills/profile/scripts/check_files.py` —
    deliberately ignoring argv[0]'s own path (which, per the file-name-only
    S12 dispatch this whole package is built around, is often fictional
    and carries no reliable structural information).
  - **`bin/check_files.mjs`** (Node-only, like `io-node.mjs`): has no
    `ctx.cwd`/sandbox to ask, so it reconstructs the SAME kind of path
    using ITS OWN real position on disk (`fileURLToPath(import.meta.url)`,
    walked up to the repo root, then back down through
    `skills/profile/scripts/check_files.py`) — `fileURLToPath`, not a raw
    `new URL(...).pathname`, because the latter percent-encodes a space in
    the path (`%20`) instead of decoding it; a repo path containing a
    space was fix round 2's explicit test (verified: `pathname` gives
    `.../repo%20with%20space/skills`, `fileURLToPath` gives the real
    `.../repo with space/skills`).

  A second, related fix: with the bundle now genuinely mountable INSIDE
  the workspace tree (`<ws>/skills/`), `check_strays()` would otherwise
  WARN about it as an unrecognized stray directory — Python's own
  `MANIFEST_DIRS` never needed a "skills" entry (no local candidate
  workspace has ever had a `skills/` subdirectory of its own), but this
  port's `MANIFEST_DIRS` now has one, matching `docs/design-web-agent.md`
  § 4's own text a few lines later: "`CLAUDE.md` and `skills/` are
  refused" by `WorkspaceStore.write` — i.e. `skills/` is ALREADY a
  recognized, special, read-only directory in the design, the same way
  `CLAUDE.md` already is (in `MANIFEST_FILES`).

  **One test this leaves un-passable, believed obsolete rather than
  silently diverged**: round 1's own `cf-default-skills-as-the-skill-prose-calls-it`
  mounts the bundle at its literal HOST absolute path inside jsbash's
  in-memory fs (not `<ws>/skills/`) — the same accidental convention the
  round-1 fix's bug exploited. There is no single deterministic rule that
  satisfies both that mount convention AND `r2-cf-default-skills-design-mount`'s
  (design-accurate) one for the exact same "no `--skills` given" input;
  since design-web-agent.md § 4 is unambiguous about where the bundle
  really lives, this port follows `r2-cf-default-skills-design-mount`,
  and round 1's case is treated as superseded, not a target.
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
| `tests/test_render_resume.py` | 5 of 6 `test_*` functions call the pure `to_html`/`word_count` directly — mirrored in `test/unit/render-resume.test.mjs`; the HTML-builder path is also parity-tested via `test/parity.mjs`. `test_page_target_is_reported_not_enforced_by_default` asserts specific strings appear in the Python source via `inspect.getsource` — **N/A** (this port never implements page-count enforcement at all, so the property it guards can't regress here). |
| `tests/test_jobs_md.py` | `jobs_md.py` has no CLI of its own ("library for the two above" — design-web-agent.md § 5) — all 6 `test_*` functions mirrored in-process in `test/unit/jobs-md.test.mjs` against the JS port directly. |
| `tests/test_check_files.py` | 35 `test/unit/check-files.test.mjs` cases mirror the Python file's assertions (most run against the real `skills/` tree via `io-node`, matching how the Python tests import `check_files` directly) plus 13 CLI-level cases in `test/parity.mjs`. |
| `tests/test_e2e_lifecycle.py` | Its `check_materials` (Stage 5) and `record_verdict` (Stage 4) calls are reproduced as their own named parity cases (`e2e-stage5-writer-application`, `creates-new-role`). The other stages call unported scripts (`check_messages`, `check_knowledge`, `check_stories`) — out of step 3's scope per § 5's port list. |

`test/coverage-gate.mjs` enforces this table against the actual Python
files and the actual case ids/test titles, so it can't silently go stale.

## Not done / open questions for the lead

- `check_messages.py`, `check_knowledge.py`, `check_stories.py` are **not**
  in § 5's port list and are not ported — they exit 127 through the
  dispatcher, matching the contract.
- The browser proof (`test/browser/`) exercises `check_materials` (a
  reader) and `record_verdict` (a writer) end to end, per the slice's ask;
  the tester's own browser proof (`tests/checkers-parity/browser/`)
  exercises all 7 ports and passes 9/9.
- `render_resume.py`'s Python `--pages`/`--strict` "over target" exit-1
  path depends on a real PDF page count, which the web app never produces
  (see "Known, sanctioned divergences" above) — so that specific exit code
  is unreachable from the JS port by design, not by omission.
- `tests/run.py`'s new block (the `packages/checkers` section) was written
  once, before fix round 1, and extended in place during it (adding the
  `coverage-gate` step). The coordinator noted step 4's worktree adds a
  block "at the same spot" — I don't have visibility into that worktree's
  diff to pre-resolve a textual conflict, but this block is self-contained
  (its own `if not node: ... else: ...` guard, appended after the
  `tests/web` block) so it should interleave cleanly with an unrelated
  addition rather than requiring a real merge decision.
