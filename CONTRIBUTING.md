# Contributing

Thanks for helping. Read these first; they are short:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the system fits together.
- [`docs/TEAM.md`](docs/TEAM.md): who does what, and the loop every change goes through.
- [`PRINCIPLES.md`](PRINCIPLES.md): the promises the product keeps. Every
  change answers to them.

## Setup

You need **Node** (tested on v25; the test suites run `.ts` files
directly, which needs Node's built-in type stripping), **Python 3.10+**,
and **Deno 2** (for the server function tests). Then:

```bash
git clone https://github.com/tydev-new/10xjobs-careercoach.git && cd 10xjobs-careercoach
for d in apps/web packages/agent packages/checkers; do (cd "$d" && npm ci); done
python3 tests/run.py                    # every suite; must end "0 failed"
(cd apps/web && npm test)               # the web app's own unit tests
(cd apps/web && npm run dev)            # the app on http://localhost:5173
```

`npm run dev` opens the **mock preview**. It replays invented
conversations and needs no keys, no account and no network. Most UI,
agent and skill work never needs more than this, because the tests stub
the model and the database.

### Running the real stack locally (optional)

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
- **`python3 tests/run.py` is green.** Paste its last lines in the pull
  request. Never claim a pass you didn't run.
- **Patch, check and commit in one step.** Make the change, grep the file
  to prove it landed, and commit, all in one command block. A commit
  whose message describes a change that isn't in the file is a lie
  ([`PROCESS.md`](docs/PROCESS.md), non-negotiables).
- **Skill changes follow the full ritual** in [`PROCESS.md`](docs/PROCESS.md):
  independent review, a live run on a fixture persona, and a measured
  harness run. `tests/test_invariants.py` fails if a skill drifts from
  [the shape](docs/skill-shape.md).
- **Never commit** keys, `.env` files, home-directory paths, real
  candidate data or chat transcripts. A test fails on home paths, emails
  and phone numbers in shipped folders; see [`SECURITY.md`](SECURITY.md).

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
