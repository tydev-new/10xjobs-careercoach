# Contributing

Thanks for helping. Read these first; they are short:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the system fits
  together, and a glossary of the words these docs use.
- [`docs/TEAM.md`](docs/TEAM.md): who does what, and the loop every change goes through.
- [`docs/PROCESS.md`](docs/PROCESS.md): that loop, step by step, with the
  incident behind each step.
- [`PRINCIPLES.md`](PRINCIPLES.md): the promises the product keeps. Every
  change answers to them.

## Setup

You need **Node** (tested on v25; the test suites run `.ts` files
directly, which needs Node's built-in type stripping), **Python 3.10+**,
and **Deno 2** (for the server function tests). Setup is three commands:

```bash
git clone https://github.com/tydev-new/10xjobs-careercoach.git && cd 10xjobs-careercoach
for d in apps/web packages/agent packages/checkers; do (cd "$d" && npm ci); done
(cd apps/web && npx playwright install chromium)   # some web tests open a real browser
```

## Tests

```bash
python3 tests/run.py          # almost every suite; must end "0 failed"
(cd apps/web && npm test)     # the web app's own unit tests (run.py skips these)
```

- **`python3 tests/run.py`** runs the skill tests, the repo rules, the
  doc guards, the JavaScript and Deno suites and the SQL harness. On its
  first run it also installs `tests/sql` and `tests/store` (`npm ci`,
  including a PGlite download), so it needs the network once. A missing
  tool prints `SKIPPED`; it never passes silently.
- **`apps/web`'s own unit tests** are not part of `run.py`; run them
  separately.
- **The browser end-to-end suite** (`tests/e2e-real/`, about 13 minutes
  in three browsers) is also separate. It needs every Playwright browser
  (`npx playwright install` in `apps/web`). How to run it is at the top
  of `tests/e2e-real/e2e.ts`. You only need it for changes to the live
  wiring.

## Your first contribution

Pick the track that fits your change.

### Track A: code or UI

1. Run the app: `(cd apps/web && npm run dev)`, then open
   http://localhost:5173. This is the **mock preview**: it replays
   invented conversations and needs no keys, no account and no network.
   The tests stub the model and the database too, so most work never
   needs anything more.
2. Make the change against the contract section it touches
   ([`ARCHITECTURE.md`](docs/ARCHITECTURE.md) says where things live).
3. Run both test commands above, then open a pull request (rules below).

### Track B: skill behavior (what the coach says or does)

1. **Try the skill locally in Claude Code.** Copy the skills in with
   `cp -r skills/* ~/.claude/skills/`. This overwrites any installed
   copies with the same names. And `cp` never deletes: a file you removed
   from the repo stays in `~/.claude/skills/` until you delete it there.
2. **Use a fresh temp workspace** (`cd "$(mktemp -d)"`, then `claude`),
   seeded with the invented persona in `tests/always-on/fixtures/`. Never
   run against a real job-search folder, yours or anyone's.
3. **Do the live run on that fixture persona** (PROCESS step 6). Write
   down what happened, in numbers only.
4. **You don't do the owner's real-data run, and you never ask for real
   data.** In the pull request, say the change needs it. The owner either
   runs it or records a waiver in the issue.
5. **The conduct harness costs money:** it runs on the `claude` CLI, so it
   bills whoever runs it. Before a batch, post its size (cases × trials)
   in the issue and wait for the owner's approval. Then either you run it
   on your own account, or a maintainer does. Put the eval record's path
   and the before-and-after pass counts in the pull request. Commands:
   [`tests/always-on/README.md`](tests/always-on/README.md).

## Running the real stack locally (optional)

Only for work on the proxy, the database or the live wiring. **Never
point local work at the production project.** Use your own accounts:

1. Create your own Supabase project. In its SQL editor, apply the three
   files in [`supabase/migrations/`](supabase/migrations/) in date order.
2. Get your own OpenRouter key and give it a low spending limit.
3. Deploy the two functions to *your* project and set
   `TEN_OPENROUTER_API_KEY` there. The steps are in
   [`supabase/functions/README.md`](supabase/functions/README.md); use
   your own project ref, not the one written there.
4. Sign up in your app, then make yourself a member by adding a $5 credit
   row (the SQL is at the end of the first migration).
5. Put `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_SITE_URL=http://localhost:5173` and `VITE_REAL=1` in
   `apps/web/.env.local`, then run `npm run dev`. The full list of
   settings is in [`apps/web/README.md`](apps/web/README.md).

`.env.local` and every other `.env*` file are git-ignored. Keep keys
there or in your Supabase settings, nowhere else. We haven't checked
this setup end to end on a brand-new project. If a step fails, please
open an issue.

## What a good pull request looks like

- **One change, with its reason.** Link the issue and the contract
  section it implements (for example "C § 12.1").
- **Behavior changes pass a design gate first.** Open an issue that
  states the goal, the assumptions, the tradeoffs and the test plan.
  Wait for the owner's approval before writing code.
- **Tests come from the spec, not the code.** Ideally someone other than
  the author writes them (another person, or another agent). A test that
  was adjusted to match the code proves nothing.
- **Both test commands are green.** Paste their last lines in the pull
  request. Never claim a pass you didn't run.
- **Patch, check and commit in one step.** Make the change, grep the file
  to prove it landed, and commit, all in one command block. A commit
  whose message describes a change that isn't in the file is a lie
  ([`PROCESS.md`](docs/PROCESS.md), non-negotiables).
- **Skill changes follow the full ritual** in [`PROCESS.md`](docs/PROCESS.md)
  (Track B above). `tests/test_invariants.py` fails if a skill drifts
  from [the shape](docs/skill-shape.md).
- **Never commit** keys, `.env` files, home-directory paths, real
  candidate data or chat transcripts. Two tests catch home paths,
  emails, phone numbers and profile links, but only in the folders they
  scan; [`SECURITY.md`](SECURITY.md) lists them.

## Issues

- **One issue per piece of work,** with its exit criteria as checkboxes.
- **Close it with receipts:** the commits, the test output, and what was
  measured. Never close one silently.
- **Record rejected ideas in the issue too,** with the reason, so they
  don't come back later.

## Working with AI agents

You are welcome to use them. The role files are in [`agents/`](agents/),
and [`docs/TEAM.md`](docs/TEAM.md) explains the loop. Whoever runs the
agents is responsible for checking every hand-back before believing it.
Never give an agent secrets, production access or real user data.

## Where to ask

Open a [GitHub issue](https://github.com/tydev-new/10xjobs-careercoach/issues).
Report security problems privately instead; see [`SECURITY.md`](SECURITY.md).

The project is MIT licensed ([`LICENSE`](LICENSE)). By contributing, you
agree your work is released under the same license.
