# packages/checkers

The `just-bash` `node`/`python3` dispatch adapter (`docs/design-web-agent.md`
§ 5, `docs/design-js-only.md` § 3.5, § 6). The checkers themselves — the
seven ported scripts' logic, and the shared helpers they import — live
under `skills/*/scripts/` and `skills/profile/scripts/lib/`, not here; this
package is only the seam that lets the web's in-browser sandbox
(`just-bash`, no real Node or Python interpreter) run them.

**Why this exists:** `packages/agent` runs the skills' own
`node scripts/check_materials.mjs ...` command lines inside just-bash's
in-browser sandbox. `src/dispatch.mjs` matches `node <argv[0]> ...` by
`argv[0]`'s file name — `scripts/check_materials.mjs`,
`../apply/scripts/check_materials.mjs`, and
`skills/apply/scripts/check_materials.mjs` all reach the same port, because
different skills invoke the same ported script with different relative
prefixes (`docs/design-web-agent.md` § 5, re-review S12). `python3` is also
registered, but only as a pointer: `python3 <name>.py …`, when `<name>.mjs`
is in the table, exits 127 naming the equivalent `node` command; anything
else gets the plain unknown-script message.

## Layout

```
src/
  dispatch.mjs            the file-name dispatch table — imports the ports
                           straight from skills/*/scripts/lib/
  just-bash-command.mjs   registers "node" and "python3" as just-bash
                           custom commands
test/
  unit/                   node --test — a handful of edge cases not already
                           covered by tests/checkers/cases/ (below)
  browser/                a Vite page + Playwright script proving the ports
                           (imported from skills/) run in a browser
```

## Where the scripts and their logic live

See `docs/design-js-only.md` § 2's table. In short: a script the model runs
is `skills/<skill>/scripts/<name>.mjs`; that script's logic, safe in a
browser, is `skills/<skill>/scripts/lib/<name>.mjs`; helpers more than one
skill uses live in `skills/profile/scripts/lib/`.

## Where the cases are

`tests/checkers/cases/<script>/<case>.json` — the expected-output cases
(`docs/design-js-only.md` § 5): one Python 3.14 run each (arguments, input
files, and the expected stdout, stderr, exit code and changed files),
replayed through both the `node` path (the script itself) and the web's
`node`/`python3` dispatch by `tests/checkers/run-cases.mjs`. These cases are
the specification now — this package carries no parity harness against a
live Python interpreter.

## Running the tests

```bash
npm install                 # inside packages/checkers/
npm test                    # node --test test/unit/*.test.mjs
node ../../tests/checkers/run-cases.mjs   # the expected-output cases, both paths
```

`python3 tests/run.py` (repo root) runs both.
