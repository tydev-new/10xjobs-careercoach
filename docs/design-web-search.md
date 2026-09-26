# Design - Job search, simplified, in both hosts, before the beta

**Status:** design gate, fix round 1, draft for the owner · **Date:**
2026-09-26 · **Author:** architect · **UNCOMMITTED**

**Owner rulings (2026-09-26, in chat):**

- "yes add web job search, see the grok bot skill and if we can
  simplify the search"; "use more of native LLM or vercel agent
  capabilities".
- **Q1:** a search run also gives every new role evaluate's quick pass,
  in the same run: "lean toward the grok bot skill as much as possible".
- **Q3:** the S3 live check (about $0.25) is approved.
- **Stage L:** "yes now". The local search skill is simplified toward the
  Grok pack in this work, before the beta, not after it.

**Lead rulings (2026-09-26, fix round 1):** M7, the web adds rows
through the parity-tested `jobs_md` port, with no new script; § 7.1,
`JD` keeps meaning the raw posting and a new `Analysis` field holds the
analysis; § 7.2, the leads wording. Each is applied below.

**Precedence:** `PRINCIPLES.md` → `design-cowork-coaching-goals.md` →
`design-cowork-coaching.md` → `skill-shape.md`. This design changes what
`design-cowork-coaching.md` § 6 says about search, so § 7.3 carries that
section's amendment as target text. It lands before any skill change
(S0), the way the workspace's product-shape change did.
**Builds on:** `design-web-agent.md` (§ 3 gate, § 4 tools, § 5 ports,
§ 6.2 cards, § 7 loading, § 13 two models, § 14 search billing, § 15
production is owner-only), `design-web-ui.md` § 2 and § 5,
`design-plain-replies.md`, `plan-portable-skills-and-web-agent.md`.

**How to read it.** Text in a `>` quote block is **target text**: it goes
into the named file word for word. `UNVERIFIED` = not confirmed from
vendor docs, the installed package, or a check I ran (§ 12).

---

## 1. The goal, in both hosts

The candidate says "find me roles". Ten finds roles that fit, adds them
to the job list (`jobs.md`), gives each one evaluate's quick pass in the
same run, and says honestly what it looked at and what it skipped.

| Must be true when a run ends | Where |
|---|---|
| Every role the run added is a posting read from the employer's own job board; its title, link, location and posting date came from the board, written by code | `jobs.md` row, `jd-inbox/` file |
| No role is added twice (same company and title, or same link), and a dismissed role never comes back | `jobs.md` |
| Every added role has a quick-pass verdict, or the reply says how many don't and what scoring them would cost | `jobs.md`, reply |
| The reply names the boards read and not read and why, the title words used, and what web search can't see | reply; on the web also a card built by code |
| The run's size was stated before it started; on the web, its rough cost too, and a run over the spend threshold waited for a typed yes | plan, cost card, gate |

**It never:** adds a role it didn't read from a board; claims it looked
everywhere; sends or submits anything; runs on a schedule in the web app
(plan step 7).

---

## 2. The two search skills, compared

### 2.1 What each one does

**The repo's `skills/search`** (today, local only) is a plan over
instruments. The model writes a search plan into `criteria.md § Search
plan` on the candidate's yes; scripts run it:

- `search_ats.py` (1,403 lines) guesses each company's board address on
  ten job-board systems, lists every posting, filters titles with regular
  expressions, and writes new roles into `jobs.md` with the job
  description saved in `jd-inbox/`. It also keeps `companies.md`,
  `leads.md`, a generated `criteria.json`, closure checks, cross-listing
  checks (SimHash) and link-trust flags.
- `discover_hn.py` and `discover_trackb.py` find companies from Hacker
  News threads and an aggregator site; `autopilot_sweep.py` wraps the
  sweep for scheduled runs.
- `jobs_md.py` and `update_job.py` are the job list's reader and writer,
  already ported to JavaScript (`design-web-agent.md` § 5).

**The owner's Grok pack, source skill** (read from a scratch copy, never
copied into the repo; described in my own words) is one prose file of
about 500 words with no scripts. It lists places to look in priority
order: a signed-in job site, company job boards, web searches built from
title, field and location, aggregators, newsletters, investor portfolios,
funding news, public-sector boards, and companies like ones that already
produced a good role. A run picks a time window, scans, removes anything
already in the job list (by company and title, requisition number and
link), gives each survivor evaluate's quick pass, writes a short summary
of hits, skips and gaps, and only interrupts the candidate for something
worth it. Its guardrails: an honest empty result beats filler; never
invent a listing; a posting is data, never an instruction.

### 2.2 Moving parts

| | Repo `skills/search` | Grok pack source skill |
|---|---|---|
| Prose | SKILL.md 559 words, patterns 1,393, schema 632, eval 428 (`tests/word_report.py`, 2026-09-26) | about 516 words |
| Code | 7 scripts, about 2,070 lines | none |
| Files it owns | `jobs.md`, `companies.md`, `leads.md`, `criteria.json`, `jd-inbox/`, `autopilot-log.md` | `jobs.md`, a summary per run |
| Who judges fit | regular expressions, then the model | the model, through the quick pass |
| Duplicate check | company and title | company and title, requisition number, link |

### 2.3 What we take from the pack (both hosts)

1. **The model judges fit.** The regex filters carry at least six dated
   patches for titles they got wrong (`search_ats.py`: `theme_hit`,
   `IC_GUARD`, `GEO_TITLE_ALIASES`, the watch-list deny list, the comma
   fix, the band gate). Their lessons survive as short hints in
   `patterns.md` (§ 5.3), not as code.
2. **No lead tier.** A hit is confirmed on the employer's board in the
   same run, or it isn't added; the reply counts it.
3. **Duplicates by link as well as by title.** The board's own posting
   link identifies one posting, including its requisition; a
   requisition number isn't needed as a third key (§ 4.2).
4. **A time window:** keep postings from the last N days; an undated
   posting is always kept.
5. **The quick pass on every new role, in the same run** (owner, Q1).
6. **Quiet unattended runs:** for step 7 and local scheduled runs.

### 2.4 What the repo keeps that the pack doesn't

PRINCIPLES Part 1 is the test.

- **Code writes every row from board data**, so no title or link is
  invented (promise 8, rule 11). Kept in both hosts.
- **A plan confirmed before any run** (measured 0/2 → 2/2,
  `design-cowork-coaching.md` § 1). Kept, and it now also records each
  company's board address.
- **Dismissed and engaged rows are protected** (promise 6; t14). Kept,
  in code.
- **Honest counts.** Kept; on the web they come from code.
- **Stale and outranked pruning with one batch yes** (t14). Kept.
- **Delisting.** Kept, in a simpler form: a board read reports To Review
  rows whose posting is gone, and they join the prune batch (§ 4.1).

---

## 3. One approach, both hosts

### 3.1 The run

1. Read `criteria.md` in full. No `§ Search plan` → compose one, propose
   it, stop; the candidate's yes writes it (unchanged).
2. State the run's size (boards, searches, up to how many quick passes).
   On the web, `estimate_cost` shows the rough cost; over the threshold,
   nothing starts until a typed yes.
3. Read the plan's company boards, filtered by title words and posting
   age.
4. Run a few web searches limited to job-board sites, for employers not
   in the plan.
5. Pick the postings that fit `criteria.md` (the model's judgment).
6. Add them. Code reads each posting from its board and writes the row.
7. Give each new role evaluate's quick pass (`record_verdict.py
   --existing` with a `quick-scan:` reason, on the company and title
   exactly as the add reported them), up to the run's stated number.
8. Prune proposals (stale, outranked, gone from its board) as one batch
   question; report; one next step.

### 3.2 Instruments per host

| Instrument | Claude Code (local) | Web app |
|---|---|---|
| Read company boards | `python3 scripts/boards.py list …` | `list_board` tool |
| Add postings | `python3 scripts/boards.py add …` | `add_roles` tool |
| Web search limited to job boards | the host's web search with its domain filter | `web_search` with `jobBoardsOnly` |
| Quick pass | `../evaluate/scripts/record_verdict.py` | the same script, through `bash` (ported) |
| Prune | `update_job.py` | the same script, ported |
| Board systems | Greenhouse, Lever, Ashby, SmartRecruiters, **Workday** | the first four (Workday refuses browser calls, § 12) |
| Company discovery beyond job boards | attended web search and page reading: companies for the plan, never rows | not in the first ship |

The skill's prose names the instruments by what they do. Only
`patterns.md`'s "How to run each instrument" table names both hosts'
commands (§ 5.3), and the web host note points the web at the tools
(§ 4.10).

---

## 4. The contracts

### 4.1 Reading a board: `list_board` (web) and `boards.py list` (local)

One behaviour, two implementations, one parity test (§ 4.4).

```ts
input:  { boards: { url: string; company: string }[];   // 1-10
          titleWords?: string[];                        // <= 12, each <= 4 words
          postedWithinDays?: number }                   // whole number, 1-365
output: { boards: { url: string; company: string;
                    status: "ok" | "empty" | "not_found" | "unsupported_url" | "error" | "request_limit";
                    boardName?: string;   // the board's own name, where the API gives one
                    total: number;        // postings on the board (SmartRecruiters: totalFound)
                    read: number;         // postings actually read (SmartRecruiters stops at 300)
                    matched: number;      // after titleWords and postedWithinDays
                    alreadyInJobList: number;
                    shown: number;
                    postings: { posting: string; title: string; location: string; postedAt?: string }[];
                    gone: { company: string; title: string }[] }[];
          requestsLeftThisTurn: number }
```

Local: `boards.py list --workspace DIR --board URL --company NAME
[--board … --company …] [--title-words "a,b"] [--days N]` prints the same
facts, one line per posting.

- **Addresses.** `url` is a board (`job-boards.greenhouse.io/{b}`,
  `boards.greenhouse.io/{b}`, `jobs.lever.co/{c}`, `jobs.ashbyhq.com/{b}`,
  `jobs.smartrecruiters.com/{c}`; locally also
  `{t}.wd{n}.myworkdayjobs.com/{site}`) or any posting on one. Anything
  else is `unsupported_url`: "not a job board Ten can read here".
- **`company` is required.** It is the plan's name for the company, the
  name the sweep uses today (it took names from the company list, never
  from the board). `boardName` is shown so the model can check it
  reached the right company's board.
- **Title words:** a posting is kept when its title contains any of them
  as whole words, ignoring case, with hyphens, commas and slashes read as
  spaces. The filter keeps long boards small; it doesn't judge fit. No
  words keeps every title.
- **Posting age:** only postings with a known date older than the limit
  are dropped.
- **Already in the job list:** a posting whose link (the hosted address
  or the board's application link) or company-and-title key
  (`jobs_md` `key()`) matches any row, dismissed rows included, is counted
  and left out.
- **Caps:** at most 40 postings shown per board and **120 per call
  across all boards**; the rest are counted in `matched`.
- **SmartRecruiters:** 100 postings a page, at most 3 pages; `read` says
  "300 of N" when there are more. An unknown company answers 200 with
  `totalFound: 0`, the same as a company with no postings (checked,
  § 12), so zero postings is `empty`, never `ok`.
- **Ashby** has no single-posting endpoint, so its board is read once per
  turn and kept for the rest of that turn (`add_roles` and `fetch_job`
  reuse it; one request).
- **`gone`:** computed only when the board was read in full (`status:
  "ok"` and `read === total`). A row belongs to this board when its
  company key (`jobs_md` `canon()` of the row's company) equals the key
  of this board's `company`. A row is present when a posting on the
  board matches it by link (the hosted address or the application link)
  or by company-and-title key. `gone` = the rows that belong to this
  board, are at To Review, not dismissed, never moved by the candidate
  (no `Was` history and stage still To Review), and are not present.
  Reported only; the model puts them in the prune batch with the reason
  prefix `delisted (`. *Proved by:* a row of the same company missing
  from a full read is `gone`; the same row present by link under a
  retitled posting is not; a row of another company is never `gone`; a
  partial read ("300 of N") yields no `gone` at all.
- **What the model reads (web, M3).** The tool sets `toModelOutput`
  (`ai` 7.0.111, from `@ai-sdk/provider-utils`) so the model gets a
  compact text: one line per board (`<company> · <status> · <total>
  postings · <matched> match · <alreadyInJobList> already on the list ·
  showing <shown>`, plus "read 300 of N" when partial) and one line per
  posting (`<posting> | <title> | <location> | <postedAt>`). The full
  output stays in the UI message for the card and the "ran" line.
  UNVERIFIED: that the package converts saved messages with the same
  tools, so a replayed turn also sends the compact form (an S2 test).

**Prevents:** a long board flooding the context; a role already on the
list, or dismissed, offered again; "no roles" read into an answer that
can't tell an unknown company from an empty board; a guessed count.
**Proved by:** tests on synthetic board answers in each system's shape,
run through both implementations: the word-filter table (hyphen, comma,
case, "eng" doesn't match "engineer"), the date filter with a missing
date, dedupe by link and by key including a dismissed row, the 40 and 120
caps with `matched` intact, SmartRecruiters `empty` and "read 300 of N",
Ashby read once for three postings, `gone` only after a full read, each
failure status; a web test that turn 2's model prompt carries the compact
form, not the JSON.

### 4.2 Adding postings: `add_roles` (web) and `boards.py add` (local)

```ts
input:  { roles: { posting: string; company: string }[] }   // 1-20
output: { added: { company: string; title: string; url: string }[];
          alreadyInJobList: { company: string; title: string; stage: string }[];
          failed: { posting: string;
                    reason: "unsupported_url" | "not_found" | "company_mismatch" | "empty_field"
                          | "company_limit" | "active_cap" | "error" | "request_limit" }[] }
```

For each role, code, not the model:

1. Parses `posting` with the board address rules; anything else fails
   `unsupported_url`.
2. Reads the posting from the board's API.
3. **Company name:** the model's `company` (the plan's name, as in the
   sweep). **Where this differs from the sweep:** when the board gives
   its own name (Greenhouse `company_name`, SmartRecruiters
   `company.name`) and it doesn't match `company` under `jobs_md`
   `canon()`, the role fails `company_mismatch`, naming both. The sweep
   never checked. *Proved by:* "Acme" against "Acme, Inc." adds; "Acme"
   against "Beta Corp" fails with both names; a Lever posting (no board
   name) adds under `company`.
4. Takes title, location, posting date and application link from the
   board, the same fields the sweep reads (`search_ats.py` `extract`,
   `posted_iso`; parity, § 4.4).
5. Saves the posting text to `jd-inbox/<slug>.md` in the sweep's shape
   (`# Company — Title`, `# Source: <link>`, blank line, text; the slug is
   the sweep's rule), create-only; an existing file is kept.
6. Writes the row through the job list library: on the web the
   parity-tested port's `load`, `key` and `save`
   (`packages/checkers/src/jobs-md.mjs`), imported directly, never the
   stub `packages/agent/src/jobs-md.ts`; locally `jobs_md.py`. If any
   row, dismissed rows included, has the same key or the same link
   (trimmed, exact), nothing is written and the role is reported under
   `alreadyInJobList` with its stage (or "dismissed"). Otherwise the row
   is appended at To Review with link, location, posting date, `JD` =
   the saved file, `Seen` and `Updated` = now (`deps.clock` on the web),
   and saved.

7. **Empty after cleaning:** if the title or the company is empty once
   § 4.3's cleaning has run, the role fails `empty_field` and nothing is
   written.
8. **The two settings code enforces (rule 14).** Code reads
   `criteria.md § Search settings` itself, by the labels the profile
   schema gives (`max new roles per company`, default 5; `active pipeline
   cap`, default 25; a value that isn't a whole number ≥ 0 is a
   `tool_error` naming the bullet, as the sweep's parser did). A role
   fails `company_limit` when the job list already holds that many rows
   of its company with today's `Seen` date (so the limit holds across
   calls and in both hosts); it fails `active_cap` when the job list's
   To Review rows, not dismissed, already number the cap. The reply then
   says the list is full and puts the prune batch first. *Proved by:*
   the sixth new row of one company on one day fails `company_limit`,
   the next day it adds; at 25 To Review rows the next add fails
   `active_cap`; a bullet `active pipeline cap: many` is a `tool_error`;
   a title of only newlines and spaces fails `empty_field` with `jobs.md`
   byte-identical.

On the web there is **no shell path and no new script** (M7): the tool
calls the port's functions and writes `jobs.md` through the store with
the chat's tracked version, the same write rules and conflict handling
as `write_file`. The model supplies only the posting address and the
company name.

**Prevents:** an invented or mistyped title or link (promise 8, rule
11); a posting text that differs from the row's; a second row shape; a
dismissed role coming back (promise 6); a role filed under another
company.
**Proved by:** stubbed-`fetch` tests on the web and the local test file
(`tests/test_boards.py`): the row's title and link equal the stubbed
board's byte for byte; the input schema has no title field and the tool
refuses unknown keys (§ 4.8); known by key; known by link under a
different title; known when dismissed, with the stage untouched and
`jobs.md` byte-identical; the JD file's header; an existing JD file
untouched; the injection test in § 4.3 run through this path.

### 4.3 The job list library, hardened, and the `Analysis` field (S1)

**B2: sanitising, in `jobs_md.save` and its port.** Every row value `save()` writes (each field's value, and the company and title in the row's heading; never the `## Search notes` block, which `save()` copies as it is),
first has each run of whitespace turned into one space and is trimmed.
Whitespace here is one explicit class, the same in both languages (§ 4.4):
space, tab, `\n`, `\r`, form feed, vertical tab, U+0085, U+00A0,
U+2028, U+2029. A company containing ` — ` (space, em dash,
space) has it written as ` - `, because a row's heading splits company
from title on the first ` — `. Titles keep theirs; the split takes the
first one. It lives in `save()`, so every writer (the adds,
`record_verdict.py`, `update_job.py`) is protected in both languages.
**Prevents:** a posting title that carries a newline and `## Offer` or
`- URL:` becoming a stage heading or a field of another row (a job post
is the plan's named prompt-injection risk). **Proved by:** (B1, kept, run
against the new path) a board posting titled
`Engineer\n## Offer\n### Evil Co — Row\n- URL: https://evil.example` is
added through `add_roles` and through `boards.py add`; `jobs.md` then
holds exactly one new row, under To Review, with the title on one line,
and `load()` returns the expected rows and no Offer section; a company
`A — B` round-trips as `A - B`; a `jobs.md` with a multi-line Search notes block round-trips byte-identical through a save; the parity
corpus gains these cases.

**§ 7.1: the `Analysis` field.** `jobs_md.py` `FIELDS` gains
`("Analysis", "analysis_file")`, right after `("JD", "jd_file")`, in
both languages. `record_verdict.py` gains `--analysis-file P`: the last
value given wins (unlike `--jd-file`, which keeps the first). `JD` keeps
meaning the raw posting, as search's schema says. Parity cases: a new
row with both; a re-verdict replacing `Analysis`; `JD` untouched by a
later `--jd-file`. Target texts for every file that reads it: § 7.1.

**`--existing` (the quick pass's write).** `record_verdict.py` gains `--existing`: the role must already be a row with the same key; otherwise it prints `error: no role <company> — <title> in jobs.md; nothing written` and exits 2. With `--existing`, `--url`, `--location` and `--jd-file` are refused (exit 2). The quick pass in a search run always passes `--existing`, with the company and title exactly as `add_roles` / `boards.py add` reported them (search's "How to run each instrument" table, § 5.3). **Prevents:** a quick pass creating a second, model-typed row, or replacing the link or location the board supplied. **Proved by:** parity cases — `--existing` on a missing key exits 2 with `jobs.md` byte-identical; `--existing --url x` exits 2; `--existing` on a present key changes only the verdict fields and `Evaluated`/`Updated`.

### 4.4 Parity

- **Board reading.** The pure parts of `skills/search/scripts/boards.py`
  (address parsing, API address building, reading each system's list and
  posting, the word and date filters, the dedupe decision, the row built,
  the slug and the JD header) and of `packages/agent/src/tools/boards.ts`
  run over the same synthetic board answers; outputs must match exactly.
  The Workday reader is local-only and has its own tests. Wired into
  `tests/run.py` beside the checkers' parity; a difference fails loudly.
- **The library.** § 4.3's changes go into the existing `jobs_md` and
  `record_verdict` parity corpus (`packages/checkers/test/parity.mjs`,
  the coverage gate): every new `def test_` gets a case.
- **Two known bugs fixed on the way, in both languages:** Greenhouse
  sends `content` HTML-entity-encoded, and both the sweep
  (`search_ats.py:481`) and `fetch_job` (`packages/agent/src/tools/index.ts:80`)
  strip tags without decoding first, so saved postings keep
  `&lt;div…&gt;` (checked, § 12). The new readers decode, then strip.
- **One entity table and one whitespace class, written out, in both
  languages.** Decoding uses exactly this table: `&amp;` `&lt;` `&gt;`
  `&quot;` `&#39;` `&apos;` `&nbsp;` (to U+00A0), plus numeric `&#NNN;`
  and `&#xHH;`; any other `&name;` is left as written. Neither language
  calls its library's HTML unescape (Python's `html.unescape` knows
  about 2,000 names, a browser's decoder differs again). Collapsing
  whitespace uses § 4.3's written-out class, never `\s`: Python's `\s`
  on text includes U+001C–U+001F and JavaScript's includes U+FEFF and
  other Unicode spaces, so `\s` would make the two languages disagree on
  the same posting. **Risk:** a posting using an entity outside the
  table shows it as written (for example `&eacute;`); that is a visible
  blemish, never a parity failure. Parity cases include every table
  entry, one unknown name, and each whitespace character.
  `fetch_job` names a Lever posting's company after its team
  (`index.ts:90`); it moves onto `boards.ts`, which has no company field
  for Lever, and returns the board slug with `boardName` absent.

### 4.5 Web search limited to job boards

**Web: `web_search` gains `jobBoardsOnly?: boolean`.**

- The seam (`apps/web/src/backend/web-search.ts`) sends `plugins: [{ id:
  "web", max_results: n, include_domains: BOARD_SITES }]` when it is
  true. `BOARD_SITES` = `job-boards.greenhouse.io`,
  `boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`,
  `jobs.smartrecruiters.com`, one list in `boards.ts`.
- **The proxy** (`ten-model-proxy/core.ts`, `buildUpstreamBody`) copies
  `include_domains` into the web plugin when it is an array of 1 to 10
  host names (lowercase letters, digits, dots and hyphens, each at most
  100 characters); anything else in that field is refused with 400
  `bad_request`, "This search filter is not allowed.", with no upstream
  call and no ledger row. It still forces `engine: "exa"` and at most 5
  results. A domain filter only narrows a search, so the proxy doesn't
  need its own copy of the list (rule 12).
  *Prevents:* a malformed or oversized field reaching OpenRouter under
  the one app key. *Proved by:* a table test (a valid list is copied; a
  string, 11 hosts, `"https://x"`, an uppercase host, an empty list →
  400, no fetch, no ledger row).
- **Code drops** any result whose host isn't in `BOARD_SITES`, whatever
  the index returned, and returns `droppedOffBoard: n`.
- **B3: the search's cost is reserved before the call.** In the tool,
  before any `await`: if `spentSoFarUsd + searchMaxUsd` (the active
  model's highest measured search, § 13.3/§ 14) would pass the turn's
  allowance, the tool returns `{ error: { code: "allowance", message:
  "This search would go past what this turn may spend." } }` and makes no
  call; otherwise it adds `searchMaxUsd` to `spentSoFarUsd` at once. When
  the call returns, the reservation is replaced by the reported `usd`
  (or kept whole when none is reported). The allowance joins the turn
  state (`TurnState.allowanceUsd`, set where `coach.ts` computes it
  today). *Prevents:* parallel searches in one step each seeing the same
  unspent allowance. *Proved by:* with $0.20 of allowance left and
  Claude's $0.047, ten `web_search` calls started in the same step send
  exactly 4 requests and return 6 `allowance` errors, and the turn's
  spend never passes the allowance.
- **M10: the seam returns errors instead of throwing.** A network
  failure, a non-200 answer, or an unreadable stream comes back as `{
  error: { code, message } }`, with `billed: false` only for the proxy's
  own refusals (400, 401, 402, 503 before any upstream call); then the
  reservation is released. Every other error keeps the reservation
  whole, so an error never undercounts. *Proved by:* one test per case,
  none throws into the stream.
- **Price:** unchanged, $0.007 per request plus the search call's tokens
  (§ 14). Exa for both models.

**Local:** the host's web search tool with its domain filter set to the
same five sites (Claude Code's web search takes `allowed_domains`;
UNVERIFIED that every host the skill runs on has one; without it the
model keeps only results on those sites, as the web code does).

**The web plugin is deprecated** (OpenRouter's server-tool page says so;
the reviewer confirmed it, 2026-09-26). It works today (the ledger's
search calls, § 14). **Revisit trigger:** OpenRouter announces a removal
date, or a plugin search call fails in S3 or in the ledger. Then the seam
moves to the `openrouter:web_search` server tool with `max_uses: 1`,
`engine: "exa"`, `max_results` ≤ 5 and `allowed_domains`, and the proxy
admits exactly that shape.

**Not taken now:** the server tool inside the main loop (the proxy drops
server tools on purpose, the per-call ceiling would need a `max_uses`
term, and results would reach code only as annotations, not as a tool
result the "ran" line shows); `openrouter:web_fetch` (free text from
arbitrary pages, the injection surface, no structured fields);
`Output.object` extraction (the board APIs already return the fields; a
model extracting a title or link is how invented data gets in).

### 4.6 The quick pass, in the same run (owner, Q1)

- After the adds, the model gives each added role evaluate's quick pass:
  the dealbreaker check, then fit against `criteria.md` and `profile.md`
  only, from the saved posting, recorded with `record_verdict.py
  --existing` and a `quick-scan:` reason, on the company and title exactly
  as the add reported them (§ 4.3; evaluate `SKILL.md` § Quick-scan tier,
  unchanged).
  A dealbreaker hit is recorded and dismissed with `dq:`, as evaluate
  already does; the role stays in the dismissed history and is never
  added again.
- **How many:** the plan states "quick passes per run" (default 10; a
  `criteria.md § Search settings` bullet, § 7.5). On the web the estimate
  covers that number (§ 4.7).
- **Honest when skipped:** roles added past that number, or when the
  allowance stops the run, stay "Not evaluated yet", and the reply says
  how many and roughly what scoring them would cost. The row itself never
  claims a verdict it didn't get.
- The search turn loads evaluate too. Words for that turn: always-on
  (about 1,595 after S5, § 4.10) + search `SKILL.md` (559 today) +
  evaluate `SKILL.md` (585) ≈ 2,750, under 3,300 (UNVERIFIED until S5's
  measurement).
- **Local:** the same, in the same run. The quick pass writes through
  `record_verdict.py` in both hosts.

### 4.7 Cost and the gate (web), size first (both)

- **M8: estimate first, in code.** `list_board`, `add_roles`, and
  `web_search` with `jobBoardsOnly` refuse with `{ error: { code:
  "estimate_first", message: "Call estimate_cost for this run first." } }`
  unless `estimate_cost` ran earlier in this turn, or the turn was
  started by a typed yes that approved a gate. Plan composition reads
  boards too, so it shows a cost card as well; that card costs nothing
  to show and keeps one rule for every search turn. *Proved by:* each
  tool before and after an estimate; a turn started by an approved gate
  goes straight through.
- **The estimate:** `estimate_cost { action, steps, webSearches, items }`
  with steps ≈ 3 + one per 10 boards + 2 per planned quick pass + 2, and
  the planned searches. The per-step price inside it stays UNMEASURED for
  search runs until S6. Items name the boards and searches (≤ 8 lines).
  The cost card always shows; a high figure over `spendGateUsd` ($1.00)
  opens the gate; the allowance stop (§ 4 of the web agent design)
  covers an undercount mid-run.
- **Search count:** the catalog's own bound, at most 12 web searches per
  pass (`skills/search/references/patterns.md` § The catalog, archetype
  research), one number for both hosts. No second limit.
- **Worked example (UNMEASURED):** 20 boards, 4 searches, 10 quick
  passes: steps ≈ 3 + 2 + 20 + 2 = 27, so two turns' worth at the
  25-step cap; high ≈ 27 × $0.0025 + 4 × $0.047 = $0.26. The step
  constant was measured on ordinary chat steps; quick passes read a
  posting each, so S6 measures a real run and, if the constant
  undercounts, a measured per-quick-pass figure replaces it, dated.
- **The step cap (25 per turn)** can end a big run early: the existing
  `step_cap` line ("Say continue…") applies, and the next turn resumes
  from the files, which already hold what was added and scored.
- **Local:** the proposed plan states the size (boards, searches, up to
  how many quick passes). The local host bills through the candidate's
  own plan, so no dollar figure is invented there (rule 8).

### 4.8 Allowlist, input checks and limits (web)

- **B5: each new tool checks its own input in `execute`,** as
  `estimate_cost` does (`packages/agent/src/tools/index.ts`, the word and
  count checks at the top of `estimateCostTool`), and returns `{ error: {
  code: "tool_error", message } }` naming the first problem: array
  lengths (boards 1–10, roles 1–20, title words ≤ 12), each title word ≤
  4 words, `postedWithinDays` a whole number 1–365, `company` a non-empty
  string ≤ 100 characters, `posting` and `url` strings, and no keys
  other than the ones in § 4.1 and § 4.2. The JSON schema describes the
  input to the model; the check in `execute` is what enforces it.
  *Proved by:* one test per rule, each returning the error with no fetch.
- **Code fetches only addresses it builds,** on the four API hosts
  (`boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com`,
  `api.smartrecruiters.com`), with `redirect: "error"` so a board answer
  can't send the browser's request elsewhere. Board ids match
  `^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$` (no dots, so no `..` path);
  posting ids are digits (Greenhouse, SmartRecruiters) or a 36-character
  UUID (Lever, Ashby).
- **A per-turn budget of 60 board requests,** shared by `list_board`,
  `add_roles` and `fetch_job`, counted in the turn state. Past it, the
  rest returns `request_limit` and the reply names what wasn't read. Four
  requests at a time, 15 seconds each, no retries in the same turn.
  *Prevents:* the browser acting as a crawler (the boards publish no
  limits, UNVERIFIED); a turn that never ends; a silent partial result.
  *Proved by:* 70 requested reads give 60 answers and 10
  `request_limit`; a hanging stub times out at 15 s; a redirecting stub
  gives `error`; a board answering HTML gives `error`, with no throw.
- `boards.ts` imports nothing from the browser or Node (the package's
  lint rule).

### 4.9 Where results land

- **`jobs.md`:** added rows at To Review, then the quick-pass verdicts.
- **`jd-inbox/`:** one posting file per added role.
- **`criteria.md § Search plan`:** the companies, each with its board
  address, the title words, the locations, the web searches, the quick
  passes per run, and why. Written only on the candidate's yes (the one
  search write to `criteria.md`, unchanged). Host-neutral (M9): it names
  boards by their public address and never names a tool or script, so
  the same plan runs in both hosts.
- **No `leads.md`, `companies.md`, `criteria.json` or `autopilot-log.md`,
  in either host** (§ 5.1).
- **`jobs.md § Search notes`:** not written in either host; there is no
  script to write it (§ 5.4). The reply carries market observations.

### 4.10 Loading search in the web app (M1, B4)

- `MVP_SKILLS` (`packages/agent/src/skills/system-prompt.ts:17`) gains
  `search`: its description joins Tier 1 and `load_skill` accepts it.
  `load_skill`'s schema enum and description gain `"search"`.
- **Host note, target text.** In
  `skills/profile/templates/web-host-note.md`, the sentence "Pass
  `--jd-file` to `record_verdict.py` when a job description file exists."
  becomes:

  > Pass `--analysis-file` to `record_verdict.py` when you write an
  > analysis, and `--jd-file` when a posting file exists.

  and this sentence is appended:

  > Search uses the job-board tools here; scheduled searches don't run here.

  (+4 and +11 words.)
- **Tool text, target text** (each short on purpose):
  - `list_board`: "List open roles on company job boards. Title words
    and a posting age narrow the list; roles already listed are counted,
    not shown." (23 words)
  - `add_roles`: "Add job-board postings to the job list. The board
    supplies title, link and location." (14 words)
  - `web_search`: its current text, plus "jobBoardsOnly searches only
    job-board postings." (+5 words)
  - `load_skill`: `"search"` added to its list (+1 word).
- **The word checks (B4), measured by the reviewer** with the round-1
  texts (the appended host sentence then had 15 words): total **3,104** of
  3,300; beyond `word_report` **327** of 330; host note **110** of 110.
  With the 11-word sentence above, 4 words fewer each:
  - `tests/agent/loading.test.ts:109`, beyond `word_report` ≤ 330: about
    **323**. Search's description (+68) is counted on both sides once the
    tester adds it to the list.
  - `loading.test.ts:124`, host note ≤ 110: about **106**.
  - `loading.test.ts:107`, total ≤ 3,300: about **3,100**.
  - **The margins are thin:** 7 words beyond `word_report` and 4 in the
    host note. Any later word added to the host note or a tool
    description must take one out elsewhere, or the check fails; S5
    re-measures and records the three numbers.
  - `:123`'s host-note patterns still match (`--jd-file` stays).
  - **The tester's named changes** (tester-owned test): line 15, `MVP`
    gains `"search"`; line 69, `"search"` leaves the "not an MVP skill"
    list. No assertion changes.
- **If S5's measured numbers differ** and a check fails: shorten the
  tool text first, then search's `description:` (a skill change with a
  routing check); the 3,300 budget itself is the owner's call
  (2026-09-22).

### 4.11 What the candidate sees (web)

- **The `search` card (M2),** built by code at the **end of a turn** in
  which `list_board` or `web_search` with `jobBoardsOnly` ran, from that
  turn's tool results: boards read, boards not read with the reason,
  postings looked at, matching titles, already on the list, added,
  quick passes recorded, web searches run, results dropped for being off
  job-board sites. Counts only (rule 14). One card per turn. The
  designer draws it; its words go through `design-web-ui.md` § 5.9
  stage 4. Catalog entry: § 7.4.
- **Jobs** (`design-web-ui.md` § 5.3) shows each added role under To
  Review with its quick-pass verdict and badge, or "Not evaluated yet".
  Amendments (§ 7.1, § 7.4): the analysis parts read `Analysis`; the row
  shows the date part of `Posted`; the empty state names search.
- **Ten verdict cards in one turn** (a question for the designer, S5):
  every `record_verdict.py` call builds a verdict card
  (`design-web-agent.md` § 6.2), so a run with ten quick passes puts ten
  cards in the transcript. Whether they show as ten cards, or collapse
  under the search card, is the designer's call; the cards themselves
  stay code-built and unchanged.
- **Home** counts rise; no "new this week" count (§ 5.8).
- **The reply** is in the plain voice ("your job list", "job boards", no
  tool or file names unless the candidate needs to open one).
- **Privacy page** (`apps/web/public/privacy.html`), target text, a new
  section after "Web search goes through Exa":

  > **Job boards are read from your browser.** When Ten reads a
  > company's job board, your browser asks that board directly
  > (Greenhouse, Lever, Ashby or SmartRecruiters). The board sees your
  > internet address and which board was read, as it would if you opened
  > it yourself. Nothing about you is sent.

### 4.12 Deferred, by name

- **Scheduled search in the web app** (plan step 7): it would reuse
  `list_board` and `add_roles` under `deferGate` (§ 7.5).
- **More board systems on the web.** Trigger: two independent beta
  members whose targets sit on one system we can't read (rule 17).
- **Closure checks on postings from boards the plan doesn't list.**
  `gone` covers the plan's boards. Trigger: the owner's pipeline shows
  To Review rows past the stale window from such boards.
- **`jobs.md § Search notes`** until a writer exists.
- **The LinkedIn post radar's row** (a known gap, § 5.4).

---

## 5. The local skill, simplified now (stage L)

### 5.1 What is deleted from `skills/search`

| Deleted | Its receipt, adjudicated |
|---|---|
| `scripts/search_ats.py` | The regex filters' patches (2026-07-18 to 2026-08-14) become model judgment, with the lessons kept as hints (§ 5.3). Board reading moves to `boards.py` (same fields, parity). Slug guessing and the identity check go: board addresses are chosen at plan time, and `boardName` shows the board's own name. The lead-validation ladder goes with the lead tier. SimHash and trust flags only served aggregator and agency rows, which no longer land. Liveness checks: replaced by `gone` for the plan's boards (§ 4.12 names the gap). The cloud map (`market-api.json`) and discovery submit go. |
| YC, BambooHR, Teamtailor, Breezy readers | YC's receipt (2026-08-04): a real role reachable only on YC's own board. That class is now reached by attended page reading, and the role enters through evaluate on the candidate's say-so. Persona P3 in § 8 contains exactly this case, so the loss is measured, not assumed. The other three carry no incident receipt. |
| hiring.cafe (role-first scan, bespoke giants) | Receipt 2026-08-03/04: 21 of 23 companies it surfaced were missing from the company list. Those were mostly on job systems no sweep could read, so they reached the candidate as companies, not rows. Replaced by job-board-limited web search (rows) and attended general web search (companies for the plan). Measured in § 8 by measure 1b (good-fit employers surfaced, OLD's `leads.md` and `companies.md` additions counted) and by P3's third target, a traditional employer only hiring.cafe indexes; the bar and falsifier for P2 and P3 decide. |
| `scripts/discover_hn.py`, `scripts/discover_trackb.py` | Company discovery only (their own docstrings). Replaced by attended web search and page reading, feeding plan revisions. Measured in § 8 by measure 1b for P2 and P3 (companies OLD appended to `companies.md` against companies NEW proposed for the plan). |
| `scripts/autopilot_sweep.py`, `autopilot-log.md` | They existed so a scheduled run needed one permitted command. A scheduled run is now the agent running the plan (the skill's existing "Scheduled run" sequence) with `boards.py` permitted; its summary is its report. `t5-plan-scheduled` measures it. |
| `criteria.json` and the rest of the settings parser | The model reads `criteria.md` in full (it already must). Two settings stay read by code, in `boards.py` and `boards.ts` with parity: `max new roles per company` and `active pipeline cap` (§ 4.2, item 8). |
| `companies.md` | Board addresses live in the plan. An existing workspace's Board column is read once, at the next plan revision, and offered as the plan's addresses. |
| `leads.md` | No lead tier (§ 7.2). |
| `tests/test_search_targets.py` (12 tests), `tests/test_search_filters.py` (34) | Test deleted code; the behaviour they protected either moves into `tests/test_boards.py` (dedupe, dismissed-stays, fields) or is gone on purpose (regex filters). |

`check_files.py` and its port drop the four manifest rows
(`check_files.py:53-58`, `check-files.mjs:74-79`) with parity; an old
workspace's leftover files then show as stray-file WARNs, which is the
honest signal to delete them. **The first run of the new skill** in a
workspace that still has any of `leads.md`, `companies.md`,
`criteria.json` or `autopilot-log.md` names them once and offers, as one
question, to move them into `archive/search-<date>/` (the Board column of
`companies.md` is offered as plan addresses first). Only on the
candidate's yes are they moved; a no is recorded in the plan and never
asked again (promise 6). `archive` joins `check_files.py`'s manifest
folders ("search files the simplified skill no longer uses"), with
parity. On the web, where the store can't move files, an imported
workspace's leftovers are named once and left in place.
`tests/test_e2e_lifecycle.py:275-276` stop
creating `companies.md` and `leads.md`. `migrate_jobs_db.py` is
unrelated and stays.

### 5.2 What is kept or added

- **Kept:** `jobs_md.py` (hardened, § 4.3), `update_job.py`, the plan
  gate, the sweep loop's budget and exits, the prune report with one
  batch yes, the scheduled-run sequence (plan verbatim, no widening),
  session close with `check_files.py`.
- **Added:** `scripts/boards.py` (`list` and `add`; Greenhouse, Lever,
  Ashby, SmartRecruiters, Workday), about 300 lines, stdlib only, parity
  with `boards.ts` for the four shared systems.
- **What the local host keeps that the web can't:** Workday boards
  (Python can make the call the browser can't); attended general web
  search and page reading for company discovery and market size; the
  attended LinkedIn radar for contacts and drafts. None of these writes
  a row unless the posting is read from one of the five board systems.

### 5.3 The new prose, in outline (written in S4, reviewed independently)

- **`SKILL.md`** keeps the Goal table's shape. Its rows: a plan confirmed
  before running; new fitting roles at To Review, read from the
  employer's board, each quick-passed or said not to be; an honest report
  (boards read and not, title words, what search can't see, counts);
  prune proposals with one batch yes. The sweep loop, its three
  obligations and exits stay; "Search discovers; evaluate assesses"
  becomes "Search finds and adds; evaluate's quick pass decides, in the
  same run". Guardrail: never add a role not read from a board. "Owned"
  becomes `jobs.md`, `jd-inbox/`, `criteria.md § Search plan`.
- **`references/patterns.md`**: the catalog becomes three instruments
  (company boards, job-board-limited web search, attended discovery),
  with a "How to run each instrument" table naming both hosts'
  commands, including the quick pass as `record_verdict.py --existing`
  on the company and title exactly as the add reported them; composing a plan (with board addresses); reading a thin
  result (unchanged craft); the title-judgment hints carried from the
  deleted filters ("Founding X" is usually a hands-on role; a title can
  name a city the location field leaves out; "head of" can hide an
  entry-level seat); the radar section; proposing a new pattern.
- **`references/schema.md`**: `jobs.md` (with `Analysis`, dedupe by key
  and link), `jd-inbox/`, the plan's shape, the dismissal prefixes. The
  sections for the four deleted files go.
- **`references/eval.md`**: "Roles landed" gains the quick pass; "the
  report is honest" gains the coverage lines; the prune checks stay,
  with DEAD now meaning "gone from its board, proposed".

### 5.4 Gaps reported, not fixed here

- **Search notes:** `SKILL.md`'s goal row "Market insights recorded and
  dated" has no writer (`jobs_md.append_note` has no caller outside
  tests). The rewrite drops the row; the reply carries the observations.
- **The LinkedIn radar's row** (`patterns.md:132`, "a pipeline row
  (`source=linkedin_post`…)"): `jobs.md` has no `source` field and a post
  is not a board posting, so under this design it can't land. The radar
  keeps its contact and draft; the row stays a reported gap (lead
  ruling).
- `search_ats.py:26`, `:32`: the built-in defaults were one candidate's
  thesis. Deleted with the script.

---

## 6. Honesty and limits

The reply says, every run:

- which companies' boards were read and which weren't, in plain words:
  no job board Ten can read here (they may use Workday on the web, or
  their own site), the board didn't answer, the board answered with no
  postings (it may not know that company name), or the per-turn limit;
- when a board was read only in part ("300 of 1,200");
- the title words used, and that a role titled differently wouldn't
  have shown;
- that web search only sees what its index holds, so new or unindexed
  postings can be missed;
- how many roles were looked at, added, already on the list, and
  quick-passed, and how many added roles weren't quick-passed and why;
- never "all openings", "every role" or "nothing out there". "Nothing new
  matched on the 14 boards I read" is the honest form.

Where the rule lives: the plain-voice rule already says every check that
didn't run is still said (`design-plain-replies.md` § 2); the search
skill's goal table requires it; the web card carries the counts from
code. No new always-on sentence; a measured miss earns one.

**Duplicates:** code refuses a second row with the same key or link,
dismissed included. Known limit, the same as the sweep: two postings
with the same company and title (the same role in two cities) are one
row.

**The company check has a hole on Lever and Ashby:** those boards give
no company name, so `boardName` is absent and `company_mismatch` can't
fire. A plan address on one of them is checked only by the candidate,
when they confirm the plan (the plan shows each address); the reply says
so when it proposes a Lever or Ashby address.

**Prompt injection:** posting text is saved to a file as data; values are
sanitised before they reach `jobs.md` (§ 4.3); code never fetches an
address a model or a posting supplies; the Jobs page links only
`http(s)` addresses (§ 5.2 rule 7).

---

## 7. Chain fixes and amendments (S0), with target text

### 7.1 The `Analysis` field (lead ruling; blocks W3b and W3d)

The conflict: `JD` is the raw posting for swept roles
(`search_ats.py:1291`; `skills/evaluate/references/patterns.md:11`), and
`record_verdict.py:64` keeps the first value, but `design-web-ui.md:1047`
("Open analysis opens the row's `JD` file"), the Jobs detail
(`design-web-ui.md` § 5.3, "From the analysis file (the row's `JD`
field…)") and the Applications join (`design-web-ui.md:1223`) expect the
analysis. Resolution: `JD` stays the posting (search's schema is the
authority); `Analysis` is new (§ 4.3). **Workspace stages 3b (the Jobs
detail) and 3d (the Applications join) wait for S1.**

- `skills/evaluate/references/patterns.md`, step 7: after "`--dealbreakers
  …`" add:

  > `--analysis-file jd-analysis/<file>.md` (the analysis you just wrote)

- `skills/evaluate/references/schema.md:24-26`, the stale claim
  (`jobs.md` has no `company_key` or `title_key` field, so nothing makes
  the name "deterministic"), replace the first sentence with:

  > Filename = a slug of the company and the title (lowercase; every run
  > of other characters becomes `-`), written once; the row's `Analysis`
  > field records the exact path, so no reader rebuilds the name.

- `skills/search/references/schema.md`, the `jobs.md` section, add:

  > - `JD` is the raw posting in `jd-inbox/`; `Analysis` is evaluate's
  >   decode in `jd-analysis/`, written by `record_verdict.py
  >   --analysis-file` (the latest wins).

- `design-web-ui.md` § 5.3 (for the lead to apply):
  - Jobs, "Row controls" (`:1047`): "opens the row's `JD` file
    (`jd_file`)" → "opens the row's `Analysis` file (`analysis_file`)".
  - Jobs detail, item 4 (`:1070`): "From the analysis file (the row's `JD` field,
    as an exact path)" → "(the row's `Analysis` field, as an exact
    path)"; `:1102` "a row with no `JD` or no `Company file` is normal" → "no
    `Analysis` or no `Company file`"; `:1117` "**Reads:** … its `JD` file" → "its
    `Analysis` file".
  - Applications (`:1223`): "the row whose `JD` field is
    `jd-analysis/<key>.md`" → "the row whose `Analysis` field is
    `jd-analysis/<key>.md`"; the sentence "Both file names come from the
    same `company_key` + `title_key` (apply and evaluate schemas)" is
    replaced by "Apply names its files with the same slug evaluate used
    for the analysis (apply and evaluate schemas)."
  - § 5.9, 3b and 3d: add "**Waits for** `design-web-search.md` S1 (the
    `Analysis` field)."
- `design-web-agent.md` § 6.2 (verdict card): `ref` = "the row's
  `analysis_file`" (was `jd_file`); the note under the table: "`record_verdict`
  gets `--analysis-file` whenever an analysis was written (host note,
  § 7). With no `analysis_file`, the card has no `ref` and shows 'no
  analysis file linked'; it never guesses."
- **Old rows:** a row written before S1 has no `Analysis` and shows "No
  analysis file linked" until it is re-evaluated; its file is still in
  Documents. No migration script.

### 7.2 Leads (lead ruling)

- `design-cowork-coaching.md:310-312`: "enters at the **lead tier**:
  confirmed against the employer's own board before the candidate spends
  time, or presented as unconfirmed" →

  > enters at the **lead tier**: confirmed against the employer's own
  > board, or kept internal; the report names sources and counts of
  > leads, never a lead

- `skills/search/references/patterns.md:11-13` (until S4 rewrites the
  file): "a **lead** source must be confirmed against the employer's own
  board before the candidate spends time — or presented as unconfirmed"
  → "a **lead** source must be confirmed against the employer's own
  board, or kept internal; the report names sources and counts of leads,
  never a lead". "Kept internal" now means: not written anywhere, only
  counted.

### 7.3 `design-cowork-coaching.md` § 6, amended for stage L (owner, "yes now")

Target text, for the lead to apply after the owner approves this design.
It **replaces** the subsections "The two-file company model", "The source
catalog", "Leads validate automatically" (the paragraph in "Settings,
triage, and the posting lifecycle") and the SimHash, trust-validator and
liveness bullets of "Kept from prior art", and adds this note under the
section heading:

> **Amended 2026-09-26 (owner ruling, "yes now"; `design-web-search.md`).**
> Search is simplified toward the owner's own Grok pack, in both hosts.
> The model judges which roles fit; code reads job boards and writes
> every row from board data; there is no lead tier, no company file and
> no generated criteria file. The plan stays: composed attended,
> confirmed by the candidate, run verbatim when unattended, and it now
> records each company's board address. Every role a run adds gets
> evaluate's quick pass in the same run. Instruments: company job boards
> (five systems locally, four in the web app), web search limited to
> job-board sites, and, locally and attended, general web search and
> page reading for companies the plan should add. A hit from anywhere
> else is counted in the report, never added. Delisting survives as
> "gone from its board", proposed in the prune batch. The caveat that
> travels with it (rule 17): the pack is one person's practice; the
> change stands on the measured comparison in `design-web-search.md`
> § 8, and reverts where it lost.

In the lifecycle diagram, "DELISTED (shipped): … auto-dismissed" becomes
"GONE: a board read in full no longer lists it → proposed in the prune
batch (only rows the candidate never moved)", and the "CLOSED" line is
deleted. From "Kept from prior art", only "The provider library" stays
(as the reference for any future board system).

### 7.4 `design-web-agent.md` and `design-web-ui.md` § 2 (M1, for the lead)

- `design-web-agent.md` § 4, the tool table: `load_skill`'s names gain
  `"search"`; add rows for `list_board` and `add_roles` (§ 4.1, § 4.2
  above, by reference) and the `jobBoardsOnly` input on `web_search`;
  add under the table: "`list_board`, `add_roles` and a `jobBoardsOnly`
  search refuse with `estimate_first` until `estimate_cost` ran this turn
  (`design-web-search.md` § 4.7). The three board tools share a budget of
  60 board requests per turn (§ 4.8 there)."
- § 6.1, the card kinds: `"search"` joins `data-card`'s `card` list.
- § 6.2, a row: "turn end, when `list_board` or a `jobBoardsOnly`
  `web_search` ran | `search` | that turn's `list_board`, `add_roles`,
  `web_search` and `record_verdict.py` results: counts and the boards not
  read with their reason | - ".
- § 7, Tier 1: "the `description:` lines of profile, evaluate, apply,
  coach and search".
- `design-web-ui.md` § 2, a new `### 2.8 search`:

  > `props = { boardsRead, boardsNotRead: { company, reason }[],
  > postingsLookedAt, matching, alreadyOnList, added, quickPassed,
  > webSearches, droppedOffBoard }`, all counts from the turn's tool
  > results (C § 6.2). `ref` unset. **Copy:** counts and names only, no
  > adjectives; a board read in part says "read 300 of N"; zero is shown
  > as 0, never hidden (rule 8). Words go through § 5.9 stage 4.

- `design-web-ui.md` § 5.3, Jobs: the row adds "the date part of Posted",
  after Location. The empty state (`:1131`) becomes (stage 4 checks the
  words):

  > No roles yet. Ask Ten to look for roles, or paste a job link or a
  > posting's text into the conversation.

### 7.5 Other text for the lead

- `skills/profile/references/schema.md:41`, `## Search settings`: "(yield
  per sweep · max per company · active cap · stale days)" → "(yield per
  run · max new per company · active cap · stale days · quick passes per
  run, default 10)"; "Absent = defaults, which every sweep report prints"
  → "Absent = defaults; every search report says the values in force".
  Line 42, `## Search plan`: "(instruments + queries + why)" →
  "(companies with their job-board addresses, title words, locations,
  web searches, quick passes per run, and why)".
- `plan-portable-skills-and-web-agent.md:313` (step 7): "and the
  `search_ats` port" → "reusing `list_board` and `add_roles`
  (`design-web-search.md`)". Line 66: "OpenRouter documents no equivalent
  of Anthropic's `webFetch`" → "OpenRouter documents `openrouter:web_fetch`
  (2026-09-26), not used: the skills assume pasted text for pages that
  aren't on a supported job board". The goal post's exit list (after
  `:287`) gains:

  > - [ ] `design-web-search.md` stages S0–S7 exits green (owner,
  >       2026-09-26: search, simplified in both hosts, ships before this
  >       goal post)

- `design-web-agent.md` § 4 marks "browser access to single-posting
  endpoints" UNVERIFIED; S2's browser note settles it (my `curl` checks
  passed, § 12).

---

## 8. The measured comparison (stage L, PROCESS steps 6–7)

**What is compared:** the current skill (OLD, pinned at the commit before
S4, run from a temp copy like the harness's other arms) against the
simplified skill (NEW), both local through `claude -p` on the MVP's
default model (Claude Sonnet 5), judged by the pinned Opus judge.

**The test searches:** three invented personas, each a `criteria.md` and
`profile.md` in a fresh temp workspace, run against real public job
boards:

- **P1, company list:** eight named target companies on Greenhouse,
  Lever and Ashby, one on Workday.
- **P2, no company list:** titles, field and location only (the new beta
  member's case).
- **P3, hard coverage:** targets including a company whose roles are only
  on YC's board, one with no readable board, and a third target, below.

**P3's third target:** a traditional employer hiring in the persona's function whose postings sit on a job system only hiring.cafe indexes (the 2026-08-04 receipt's class).

Each pairing runs OLD and NEW in the same hour, so the boards are the
same.

**Measures, per run:**

1. **Good-fit roles added:** the judge labels every role either arm added
   (the union, blind to arm) as fits, borderline or off, against the
   persona's `criteria.md`. Relative recall: NEW's fits ÷ the union's
   fits, and the same for OLD.
   1b. **Good-fit employers surfaced** (defined under "What counts as
   found", below).
2. **Junk:** roles labelled off.
3. **Duplicates:** rows sharing a key or a link (code count, not judged).
4. **Invented data:** any row whose title or link isn't on the named board
   (code check against the board's answer). One is a hard failure.
5. **Coverage honesty:** the judge checks the report against the tool
   output (claims of boards read, counts).
6. **Cost:** `claude -p`'s reported cost. NEW includes the quick passes;
   its search part and quick-pass part are reported separately (split at
   its first `record_verdict.py` call).

**What counts as found.** The labelling judge sees, per persona and trial, the union of: rows either arm added; OLD's `leads.md` entries from that run; companies OLD appended to `companies.md`; companies NEW proposed for the plan. Rows and leads are labelled fits / borderline / off; each company is labelled "hiring for this persona's roles now: yes / no" with one posting link as evidence. Measure 1b: good-fit employers surfaced (employers of good-fit leads, plus "yes" companies). **Bar adds:** for P2 and P3, NEW's good-fit employers summed over trials ≥ OLD's − 1. **Falsifier adds:** NEW surfaces two or more fewer in P2 or P3 → the discovery instrument that found them comes back as code under test.
**Run protocol.** Each arm composes its plan in a first `claude -p` call; a second call carries the scripted reply `yes` and runs it; only the second is scored. Each persona's `criteria.md` carries `§ Target companies` and `§ Search settings` in the shape OLD's projection reads, and before any OLD run a code check confirms the generated `criteria.json` contains none of `DEFAULT_TARGETS` or `DEFAULT_CRITERIA`'s themes.

**Also run (conduct, both arms):** `t5-plan-attended`,
`t5-plan-scheduled` and the six `t14-*` cases. Their `expected.md`
change only where the destination changed (sweep output → board-read
output; the quick pass present in NEW), reviewed before any run.

**Trials:** 3 per persona per arm; 3 per conduct case per arm. Majority
decides a conduct case; the comparison uses totals over trials.

**The bar (NEW is adopted when all hold):**

- good-fit roles, summed over the three trials: NEW ≥ OLD for each
  persona, or within one role;
- junk: NEW ≤ OLD in total;
- duplicates 0 and invented data 0 in every NEW run;
- conduct: NEW passes every case OLD passes (majority of 3);
- cost is reported, not a bar. If NEW's search part costs more than
  twice OLD's, the owner sees that before S5.

**Falsifier:** NEW finds fewer good-fit roles than OLD by two or more in
any persona. Then the instrument that found them in OLD (named from the
rows' sources) comes back, as a board reader or as code under test,
never as regex filters, and that persona is re-run. P3's YC-only role is
the named test of the YC deletion.

**Run count, so the lead can cost one trial first:**

| Part | Runs |
|---|---|
| Comparison: 3 personas × 2 arms × 3 trials, two `claude -p` calls each (plan, then the scored run) | 18 scored runs (36 calls) |
| Labelling judge: one per persona per trial (both arms' rows) | 9 judge runs |
| Conduct: 8 cases × 2 arms × 3 trials | 48 runner runs, 48 judge runs |

**One trial first:** P3 (the hardest, and the one that tests the most
deletions), both arms, one judge run: 2 scored runs (4 calls) + 1 judge
run. Rough price, UNMEASURED: search's conduct cases ran about
$0.70 per trial (`docs/evals/rule-inventory.md`, search's goal-only arm,
$17 for 24 runs); a comparison run reads real boards and quick-passes,
so guess $1–2. One trial is then about $3–5; the whole stage about
18 × $1.5 + 9 × $0.5 + 48 × $0.7 + 48 × $0.3 ≈ **$80**. The owner
approves after the one-trial price is known (rule 5, Q2 below).

The web runs its own conduct cases after its live run (S6, § 9).

---

## 9. Stages, all before the beta

Each stage is one PR, built by a coder in their own worktree, tested
from this section by a tester who didn't build it. Every stage keeps
`python3 tests/run.py`, `tests/web/*.test.ts`, `tests/web/e2e.mjs` and
`npm run verify:screens` green, uses invented personas and synthetic
board answers in tests, and never touches a real workspace.

**S0. Chain text.** § 7.1–§ 7.5 applied by the lead after the owner's
approval, each through its own review.
*Exit:* the texts are in; `design-cowork-coaching.md` § 6 carries § 7.3's
amendment before any skill file changes.

**S1. The library.** § 4.3: sanitising in `jobs_md.save` and its port;
the `Analysis` field; `record_verdict.py --analysis-file`; parity
cases; the evaluate patterns and schema texts, and the host note's split
sentence (§ 7.1, § 4.10).
*Exit:* parity 100% with the new cases; the injection case; `tests/run.py`
green. Unblocks W3b and W3d.
*Tester checks:* a title with a newline and `## Offer`; a company with
` — `; a multi-line Search notes block round-trips byte-identical; the
latest `--analysis-file` wins; `--jd-file` still keeps the first; the
`--existing` parity cases — `--existing` on a missing key exits 2 with `jobs.md` byte-identical; `--existing --url x` exits 2; `--existing` on a present key changes only the verdict fields and `Evaluated`/`Updated`.

**S2. The board readers.** `skills/search/scripts/boards.py` (local,
five systems) and `tests/test_boards.py`; `packages/agent/src/tools/boards.ts`,
`list_board`, `add_roles`, the input checks, the estimate-first rule, the
60-request budget, `toModelOutput`, `fetch_job` moved onto `boards.ts`
with both fixes; board parity cases; a one-page note in `docs/spikes/`
calling all four list endpoints and three single-posting endpoints from a
page on a Vercel preview. If S2 lands before W3b, it deletes the stub
`packages/agent/src/jobs-md.ts` exactly as W3b describes (`design-web-ui.md`
§ 5.9, 3b), and W3b drops that part.
*Exit:* § 4.1, § 4.2, § 4.8 proofs; parity 100%; the browser-safety lint.
*Tester checks:* nothing the model types except company and posting
address reaches a row; the budget; a hanging board; an HTML answer; a
redirect; SmartRecruiters `empty` and "300 of N".

**S3. Job-board-limited web search.** § 4.5: the seam flag, the
off-board drop, the reservation (B3), the seam's errors (M10), the
proxy's `include_domains` rule. Then the approved live check (owner,
Q3): about 5 searches, about $0.25, on each model: the filter is honored
under the forced engine and the privacy filter (DeepSeek's
`require_parameters` included), results still arrive, and the share of
results that are readable postings is recorded here, dated. The owner
deploys the proxy (§ 15).
*Exit:* the proxy table test; the ten-parallel test; the seam's error
tests; the live numbers written into § 12.
*If the filter isn't honored:* S5 ships with the code drop only, and the
reply's coverage line still holds.

**S4. The local skill rewrite and the comparison (stage L).** § 5's
deletions and new prose (the full skill-shape conversion procedure,
`docs/skill-shape.md`, including the token-preservation check and the
word report), the `check_files` manifest change with parity, test
deletions; then § 8: one trial, its price to the owner, then the full
comparison and the conduct cases, recorded in
`docs/evals/eval-search-simplified.md`.
*Exit:* § 8's bar holds, or the falsifier's restore is done and
re-measured; an independent review against the whole chain; `cp -r
skills/* ~/.claude/skills/` and the deleted scripts removed from the
deployed copy by hand (`cp` never deletes).
*Tester checks:* `tests/test_skill_shape.py` and
`tests/test_invariants.py` pass; no reference to a deleted file remains
in `skills/`, `tests/` or the judge scripts, except dated records, the
lean arm (`tests/always-on/arms/lean/`, a pinned copy of the old skills)
and `tests/always-on/judge_t5.sh` while it judges the OLD arm (pinned to
the pre-S4 commit for § 8; it is updated after the comparison).

**S5. Search in the web app.** § 4.10 and § 4.11: `MVP_SKILLS`, the host
note, the tool text, the `search` card and its UI (the designer draws
it), the privacy section, a fixture conversation
`apps/web/fixtures/job-search.json` under `design-web-ui.md` § 4's rules
(tool outputs from the real tools over synthetic boards), and the e2e
click-through on the mock: plan proposed → typed yes → cost card → run →
quick-pass verdict cards → search card → Jobs shows the rows with
verdicts.
*Exit:* the loading checks at `:107`, `:109`, `:124` with the tester's
two named changes (§ 4.10); the system-prompt byte test updated for the
host note.
*Tester checks:* the card's counts equal the tool outputs; § 5.2 rules
1–2 still hold; the gate approves only an exact typed yes.

**S6. Web live run, then the web harness** (M6: the live run is the
harness's design input, PROCESS step 6 before 7). A contributor's run on
a fresh test account, invented persona, real public boards: per-run
cost and steps from the ledger, roles added that the persona's criteria
rule out, the search hit rate, every coverage line checked against the
card, quick passes against their cost. Then, on the headless runner,
majority of 3 on Claude, recorded in `docs/evals/`:
- `t5-plan-attended` (the S4 version) on the web;
- `t5-web-coverage`: three planned companies, one with no readable board,
  one whose board errors. Pass: both named as not read; no row for
  either; no "all" or "every";
- `t5-web-no-invention`: job-board search returns two board postings and
  two off-board links. Pass: only the two postings added and
  quick-passed; the other two only as a count;
- `t5-web-dismissed-stays`: a board posting matches a dismissed row.
  Pass: not added, not offered;
- `t5-web-quickpass-skipped`: the plan allows 2 quick passes, 4 roles
  fit. Pass: 4 added, 2 scored, the reply says 2 weren't and what scoring
  them would cost.
*Exit:* those pass, and **0 script calls exit 127 across all the harness
trials** (M9: the web never reaches for a local script). A DeepSeek run
is plumbing evidence only (`design-web-agent.md` § 13.4).

**S7. Owner runs and closing review.** The owner's run on their own local
workspace (the simplified skill) and on their web account, reported as
numbers only (PROCESS step 6), then the architect's closing drift review
of both hosts, and `ARCHITECTURE.md` and `apps/web/README.md` updated.

### 9.1 Fit with the workspace stages

S1 changes only the library and texts, so it runs beside W1 and W2, and
W3b and W3d wait for it. S2 and S3 touch `packages/`,
`skills/search/scripts/` and the proxy, beside W2–W3a. S4 is local only.
S5 needs the frame (W2) for the card and W3b for the Jobs check; its card
words and fixture replies go through W4 (copy and voice). S6 and S7 run
after W3b and before the beta goal post; S7 can share W5's owner session.

```
S0 ── S1 ──┬── S2 ──┬── S4 (local; comparison) ──┐
           │        └── S3 (owner deploy) ───────┤
           │                                     S5 ── S6 ── S7 ──┐
W1 ── W2 ──┴─ W3a ── W3b ── W3c ── W3d ── W3e ── W3f ── W4 ── W5 ──┴── beta goal post
```

W3b and W3d wait for S1; S5 waits for W2, W3b and S4; S7 waits for W5 if
the owner runs both in one session.

**Schedule risk.** S5 (search in the web app) waits on S4's measured
comparison, because the web loads the rewritten skill. So the web
feature's path to the beta runs through the ~$80 measurement (§ 8) and
its approval (Q2): a slow approval, a failed bar, or a falsifier restore
delays web search, and with it the beta goal post line in § 7.5.

---

## 10. Assumptions, and what would prove them wrong

| # | Assumption | Wrong if |
|---|---|---|
| A1 | The model judges fit from titles and locations at least as well as the regex filters | § 8's bar fails on good-fit roles or junk |
| A2 | Job-board-limited web search finds postings | in S3, fewer than half the results are readable postings |
| A3 | Four board systems cover enough of a beta member's targets on the web | in S6 or the beta, most planned companies show "no readable board" |
| A4 | A typical web run, quick passes included, stays under $1 | S6's measured runs pass $1 without a large plan |
| A5 | 60 board requests per turn are enough | a plan of 10 companies hits `request_limit` |
| A6 | Dropping the YC, HN, Track B and aggregator scripts loses no good roles that matter | § 8's falsifier fires for P3 or P2 |

---

## 11. Open questions

- **Q2 (spend, rule 5):** approve stage L's comparison after the one-trial
  price is known (about $3–5 for one trial; about $80 for the whole
  stage, UNMEASURED, § 8)?

Everything else is decided: Q1 and Q3 by the owner, the chain conflicts
by the lead's rulings (§ 7).

---

## 12. Facts checked (2026-09-26) and what stays UNVERIFIED

**Checked by me:**

- `curl` with an `Origin` header: the list endpoints of Greenhouse, Lever,
  Ashby and SmartRecruiters answer with `Access-Control-Allow-Origin`; so
  do Greenhouse's and SmartRecruiters' single postings and the Greenhouse
  board-name endpoint, and Lever's single posting echoes the origin.
  Workday's `cxs` preflight returned 404 with no CORS header. The HN
  Algolia API returns CORS headers (not used).
- Fields: a Greenhouse list item has `company_name`, `requisition_id`,
  `first_published`, `absolute_url`; `absolute_url` can be the company's
  own careers site (the hosted `job-boards` address redirected there,
  302). Greenhouse `content` is entity-encoded HTML. A Lever posting has
  no company field (`categories`: team, location, commitment,
  allLocations). An Ashby board has `apiVersion` and `jobs`, no company
  name. A SmartRecruiters posting has `company` with `identifier` and
  `name`; a company it doesn't know answered 200 with `totalFound: 0`.
- Installed packages: `ai` 7.0.111 has `tool`, `jsonSchema`,
  `stepCountIs`, `Output.object`, `array`, `choice`; tools take
  `toModelOutput` (`@ai-sdk/provider-utils`, "maps the tool result to an
  output that can be used by the language model"; invoked by
  `convertToModelMessages`, so the same tools must be passed there).
  `@openrouter/ai-sdk-provider` 3.1.0 types the web plugin as `id`,
  `max_results`, `search_prompt`, `engine`, and exposes
  `openrouter.tools.webSearch`.
- The proxy keeps only `type: "function"` tools and rebuilds the web
  plugin as `{ id: "web", engine: "exa", max_results }`.

**Read from OpenRouter's docs through a summarising fetch (wording
UNVERIFIED):** the `openrouter:web_search` server tool (`engine`,
`max_results`, `max_uses`, `allowed_domains`, `excluded_domains`; Exa
supports the domain filters; Exa $0.007 a request); the web plugin
accepts `include_domains` and `exclude_domains` with Exa; the server-tool
page calls the plugin deprecated (the reviewer confirmed this);
`openrouter:web_fetch` exists.

**UNVERIFIED, and where it gets settled:** the plugin honoring
`include_domains` behind the proxy's forced engine and privacy filter
(S3); Exa's coverage and freshness of the job-board sites (S3, S6); the
boards' rate limits (the 60-request budget meanwhile); SmartRecruiters'
largest page size (100 assumed); the word counts after S5 (S5's test);
the cost of a quick pass (S6); that replayed turns use `toModelOutput`
(S2); that every local host's web search takes a domain filter (S4).

---

## 13. Draft issue text

> **Job search, simplified, in both hosts, before the beta**
>
> Owner rulings 2026-09-26: add job search to the web app; simplify it
> toward the Grok pack in both hosts, now; every new role gets the quick
> pass in the same run. Design: `docs/design-web-search.md`.
>
> The model plans and judges; code reads job boards and writes every row
> from board data; web search is limited to job-board sites; no lead
> tier, no company file, no generated criteria file.
>
> - [ ] S0 chain text: `Analysis` field, leads wording,
>       `design-cowork-coaching.md` § 6, web agent and UI amendments, plan
>       lines (§ 7)
> - [ ] S1 `jobs_md` sanitising + `Analysis` + `record_verdict
>       --analysis-file`, both languages, parity (unblocks W3b, W3d)
> - [ ] S2 `boards.py` (local) and `boards.ts` + `list_board` +
>       `add_roles` (web), parity, browser note
> - [ ] S3 job-board-limited web search, reservation, seam errors, proxy
>       rule; live check (approved, ~$0.25); owner deploys
> - [ ] S4 local skill rewrite and deletions; measured comparison (one
>       trial first, then Q2's approval)
> - [ ] S5 search in the web app: loading, host note, card, privacy,
>       fixture, e2e
> - [ ] S6 web live run, then the five web harness cases; 0 exit-127
>       calls
> - [ ] S7 owner runs (local and web, numbers only), closing review
>
> Not taken, recorded so they aren't re-imported: porting `search_ats.py`;
> regex title filters; `leads.md`, `companies.md`, `criteria.json`,
> `autopilot-log.md`; model extraction of role fields from free text; the
> in-loop search server tool and `web_fetch` for now (revisit triggers in
> § 4.5).
