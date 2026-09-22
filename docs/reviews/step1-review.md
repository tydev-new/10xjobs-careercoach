# Step 1 drift review — web agent contracts, web UI, fixtures, spikes 1–2

**Reviewer:** architect (independent: authored none of the reviewed files)
**Date:** 2026-09-22 · **PROCESS.md step 5**
**Reviewed together:** `docs/design-web-agent.md` (the contract, "C"),
`docs/design-web-ui.md` ("UI"), `apps/web/fixtures/*.json`,
`docs/spikes/spike-1-browser-loop.md`, `docs/spikes/spike-2-just-bash-commands.md`,
and the spike code under `spikes/`.
**Against:** `PRINCIPLES.md` → `docs/design-cowork-coaching-goals.md` →
`docs/design-cowork-coaching.md` → `docs/skill-shape.md`, and
`docs/plan-portable-skills-and-web-agent.md` (Phase 0 not re-opened).

**Verdict:** not ready for owner approval. 11 BLOCKERs. Most are one
missing piece: **nothing in the contract says how a gate or a card gets
into the stream**, and the fixtures were written by hand instead of
from real script output. Fix those two and most of the seams close.
Spike 1 is **not a pass** by the plan's own criterion, and spikes 3–4
have no notes, so step 1's first exit box is unmet whatever happens to
the docs.

Ranks: **BLOCKER** = must be fixed before O approves · **SHOULD** = fix
before the step that depends on it starts · **NIT** = cheap cleanup.

---

## BLOCKERs

### B1. No mechanism puts a gate or a card into the stream (rules 7, 11, 14)

The contract defines the `data-card` and `data-gate` parts (C:415-416)
and the gate machinery (C:165-210). But none of the eight tools
(C:259-268) opens a gate or shows a card, and nothing says whether card
`props` are written by the model or built by code. If the model writes
`whyReasons`, `checker`, or `checkerSummary`, a card is narration
dressed up as a file (rule 11), and checks with one right answer would
end up in prose (rule 14). `gateLine`, `artifactHash`, and `version`
must be filled in by code, not the model. Otherwise rule 7's "exact
wording" (PRINCIPLES:25) depends on the model copying it correctly.
Step 4 can't be built from this doc, and step 5b's "no screen rework"
(plan:191) can't be kept, because the source of every card is undefined.

**Smallest contract answer:**
- Add one tool, `request_gate({ kind, ref | text, label })`. Code
  fills in `gateLine` by `kind` from `gate-grammar.md`, reads the ref's
  current `version`, computes the hash, writes the `pending` row, emits
  `data-gate`, and ends the step. The model supplies only what to gate
  and a label of 6 words or fewer (this also answers UI § 5 Q7).
- Code builds cards from tool results, using one fixed table in the
  contract: `estimate_cost` → `cost`; `bash` running `record_verdict` →
  `verdict` (built from the `jobs.md` row plus `jd-analysis/<key>.md`);
  `bash` running `check_materials` → `checker` plus the `document`
  badge (parsed from stdout); a `plan.md` write followed by a clean
  `check_closeout` → `plan` (parsed from `plan.md § To do`). The model
  never writes card props. Count the new tool against the 300-word
  budget (C:472-474).

### B2. `gate-grammar.md` has no spend line, and its submit line is false in the MVP (rule 7)

C:175 says `gateLine` is "the sentence from gate-grammar.md for this
kind". `gate-grammar.md:9-11` has lines for Sends, Submits, and
Numbers. It has **no line for `spend`**. The Submits line says "Say the
word and I click". The MVP has no tool that submits (C:158-160), so
that sentence is false in the web app. The fixture shows the
contradiction: `gate-moment.json:25` says "I don't click submit for
you", and six lines later the gate line says "Say the word and I click"
(`gate-moment.json:31`). Rule 7 requires one plain sentence that
truthfully says what will happen.

**Fix:** in `gate-grammar.md` itself, since it is a shared, host-neutral
contract (gate-grammar.md:3), add a spend line (e.g. "This run costs
about $X–$Y from your balance. Nothing starts until you type yes.") and
a line for a submit the candidate does themselves, worded like the
Sends line. Rewire every consumer in the same commit, as the file's
header requires.

### B3. What the "yes" means for send and submit contradicts itself (rule 7, rule 8)

C:159-161 says that for send and submit "their yes records that they
did". The mvp-journey fixture treats one yes as three different
things. The gate opens on the letter (`mvp-journey.json:178-185`). A
"yes" typed straight after (`:193`) is logged as "Sent 2026-09-22 by
candidate" and moves Acme to Applied (`:201-204`). Then the plan tells
the candidate to "Send the Acme cover letter you already approved"
(`:242`). The log now says something happened that the plan says has
not happened. Also, the Sends gate line asks the candidate to "tell me
so I log it", and people naturally answer "sent" or "done", which the
exact-`yes` matcher (C:185-189) rejects.

**Fix:** decide in the contract that in the MVP, a send or submit gate's
yes means "I have sent / submitted it". The gate line (B2) must tell
the candidate to type yes once they have done it. Only that yes moves
the stage or writes "Sent". Fix the fixture so the plan does not
re-list the send.

### B4. Gate status is stored twice and has no update path (rule 12)

The `data-gate` part carries `status` (C:416; UI:396-397), and
`gate_log.status` (C:224) carries it again. A part is frozen in the
message it was emitted in. No mechanism exists for the "later message
updates its status" that UI:428-431 relies on. In the fixtures, both
approved gates stay `"pending"` forever (`mvp-journey.json:184`,
`gate-moment.json:59`), and `gate-nw-1` never shows as expired
(`gate-moment.json:32`). `statusOf` looks only at the latest assistant
message (C:438-439). So if the candidate asks a question while a gate
is open, the avatar shows `done` while `gate_log` says `pending`.

**Fix:** `gate_log` is the only authority. After every gate row write,
the package emits one `data-gate` status part in the current or next
assistant message, carrying only `{gateId, status}`. The UI shows the
latest status for each `gateId` across the transcript. `statusOf`
returns `needs-you` when any `gateId`'s latest status is `pending`.
One rule, derived from the stream.

### B5. The language checker has no way to run on the web (rules 14, 8)

`skills/apply/SKILL.md:75`: "Language checker-subagent runs on every
delivered document". `skills/profile/references/language-check.md:15`
says to spawn a subagent. Rule 14 gives language checks to independent
subagents. The MVP tools (C:259-268) include no subagent or second
model call, and the skill prose is not changed (C:330-331). On the web,
the journey step "tailored résumé and cover letter with the checker
clean" (plan:189-190) would silently skip the check that catches voice
and claim-strength problems. That is the rule 8 guard.

**Fix:** add `check_language({ files })`. It makes one separate model
call with fresh context, `language-check.md`, and the rule sources, and
returns findings. Or O explicitly defers the check, and step 4's
conduct cases record the gap. Either way, the contract has to name it.

### B6. Conversation persistence and size are undefined (rules 12, 9, 15, 5)

`Coach.stream` takes "the whole conversation" (C:43). Phase 0 #4 allows
database rows only for accounts, balances, and the gate log (plan:35).
Nothing says where chat history lives across a reload, and nothing
caps what gets re-sent. Loaded skills "stay in the conversation"
(C:468). The result: step 4's exit "a turn loads roughly ~3,000 words"
(plan:158-159) cannot be measured on turn 20. Cost per turn grows
without limit (rule 5). A saved transcript would also be user data
that the export leaves out (rule 9).

**Smallest answer:** chat history is **not persisted**. Files are the
memory (goals doc § 3, "Every session that changed the picture leaves
a file behind"). A reload starts a new `chatId`. On load, any
`pending` gate from an older `chatId` expires. Name a per-chat word
cap: at the cap, the agent runs close-out and says "start a fresh
chat". This removes the persistence question entirely.

### B7. `raise` can be called with the user's own session: free money (rule 5)

`openrouter-key` "is called with the user's Supabase session"
(C:488-489). `raise` "adds the amount to `balance_usd`" (C:494). As
written, any signed-in user can raise their own balance.

**Fix:** only the payment webhook can call `raise`, authenticated
server to server. The user session can call only `mint` and `revoke`.
Related gap: the MVP journey starts at sign-up with a balance of $0.00
(UI:208), and the "payment page" (C:162) is not designed anywhere, so
the journey in plan:187-190 cannot reach its first model call.
**Owner question:** is the beta funded by a starter credit set by an
admin (no payment in the MVP), or does the MVP need a payment page?

### B8. The fixtures invent output formats for real scripts (rule 11; step 5b "no screen rework")

The UI parses checker findings "verbatim" from `bash` stdout (UI:335-341,
366-368), but the fixtures' stdout is not what the scripts print:

| script | real output | fixture |
|---|---|---|
| `check_materials.py` | `RESUME x.md: FAIL (1 fail, 0 warn)` / `  [FAIL] msg` / `✔ mechanical checks clean` (check_materials.py:268-294) | `"clean"`, `"FAIL: …"` (checker-failure.json:30,52) |
| `record_verdict.py` | `recorded (created): Acme — Staff PM → strong (82)` (record_verdict.py:70) | `created jobs.md row: …` (mvp-journey.json:98) |
| `update_job.py` | `updated: … — …` (update_job.py:50) | `updated jobs.md row: … -> Applied` (mvp-journey.json:202) |
| `check_closeout.py` | `close-out clean: stage …` (check_closeout.py:105) | `"clean"` (mvp-journey.json:237) |
| `proposal_block.py` | the block, then `clean: proposal block printed; no FAIL, no WARN` (proposal_block.py:140-146) | `2 cuts, 1 reworded pair, 0 gaps` (mvp-journey.json:155) |
| `render_resume.py` | `words: N  ->  path`; pages only with `--pdf` (render_resume.py:153-165) | `— 2 pages, 640 words` (mvp-journey.json:152) |

A checker card built against these formats has to be redone in 5b.
Also, `fetch_job` on `https://acme.example.com/careers/…` returns
`board: "greenhouse"` (mvp-journey.json:75-77), while C:303 says any
unsupported URL returns `unsupported_url`.

**Fix:** generate fixture tool outputs by running the real scripts on
an invented fixture workspace, and use a supported URL shape (or show
the `unsupported_url` → paste path, which is the likelier real path).

### B9. A fixture invents a confirmation number (rules 8, 11)

`gate-moment.json:79-81` writes "Confirmation ref #NW-88213" into the
application file and tells the candidate "Submitted — confirmation ref
#NW-88213". The candidate only typed "yes" (`:68`). The number exists
in no input. The fixtures are the oracle the tester checks against and
the screens O approves, so this teaches exactly what rule 8 forbids.
Remove it. The report-back logs the date and stage only, unless the
candidate gives a reference.

### B10. `.html` is classified binary create-only, but the résumé gets re-rendered (step 4)

C:107-108 puts `.html` with the binary types, and binary files go
through `upload`, which is create-only (C:84). `render_resume` rewrites
the same `--html` path every time the résumé is revised, and `bash`
write-back goes through `WorkspaceStore.write`. That call refuses
non-editable types (`not_editable`, per `workspace-core.mjs:209`) and
would hit `already_exists` on the second render. **Fix:** make `.html`
an editable text type (2 MB cap). The UI still displays it only in a
sandboxed iframe.

### B11. Spike 1 is not a pass, and spikes 3–4 have no notes (plan step 1 exit)

The plan's criterion (plan:83-85): "it **streams**, calls tools in a
loop, and a **cache read shows up on turn 2** with a Claude model".
The spike note replaces this with its own four sub-criteria
(spike-1:11-16):
- The passing loop uses `generateText` with a mock model
  (`spikes/1-browser-loop/src/main.ts:91`). **Streaming is exercised
  only in the blocked real path** (`main.ts:144-179`).
- The cache read is **BLOCKED** (spike-1:15).
- Row 2 claims the provider "builds a request". The code only
  constructs the model object with a dummy key (`main.ts:117-122`).
  No request is built or intercepted.
- The UI message stream (`toUIMessageStream` / `UIMessageChunk`),
  which is what C § 6 rests on, is not exercised at all.
- The `web_search` annotation check that C:540-541 asked for is not
  done.
- The model id is `anthropic/claude-3.5-sonnet` (`main.ts:118`), not
  the MVP default.

Spike 1 should read **BLOCKED (2 of 3 properties unproven)**. It must
be re-run with a key through `streamText` → UI message stream. Only
spike 1 and spike 2 notes exist in `docs/spikes/`, so spikes 3 and 4
are missing too.

---

## SHOULDs

**S1. Cost: one honest range computed by code, and no second confirm word (rules 5, 8, 7).**
`estimate_cost` returns one `usd` (C:268). The UI "widens it to a
range in copy" (UI:455-456), but no one is named to do it and no
method is given. The ±20% in `over-limit-error.json:27` is an invented
number. **Fix:** code returns `{ lowUsd, highUsd }` and states its
method. Also cut `goAheadInstruction` / "Say go and I'll start"
(UI:449; over-limit-error.json:29). That creates a second approval
word that looks like a gate but isn't, and gate-grammar requires every
gate to look the same (gate-grammar.md:3). Separately, `Deps` has no
balance source (C:28-37), yet `estimate_cost` returns `balanceUsd`,
and the package never sees the key (C:53-54). **Fix:** add
`balance(): Promise<number>` to `Deps`. The chip and the tool read
that one source (rule 12). This also answers UI § 5 Q5: re-read it
when a turn ends and when the window regains focus, with no polling.

**S2. The balance is two numbers, and two tabs break the loop (rules 12, 5).**
The `accounts.balance_usd` note says "money not yet charged to any
key" (C:503). But `mint` sets the new key's `limit = balance_usd`
(C:493), so while a key is live the real balance is
`balance_usd − key usage`. The note is wrong. `mint` also runs on
every page load and deletes the live key (C:493, 507-508), so opening
a second tab kills the first tab's loop mid-run. **Fix:** define
balance = `balance_usd − live key usage` in one sentence. Allow one
active tab (a second tab shows "Ten is open in another tab"), which
fits "one conversation". In `mint`, disable the old key before reading
its usage, then delete it (this closes the read-then-delete race).

**S3. Uploads (UI § 5 Q6).**
The UI uploads the file with `WorkspaceStore.upload("documents/<name>")`
**before** sending. `documents/` is the candidate's existing drop
folder (check_files.py:69-72). The message's `file` part has
`url: "workspace:documents/<name>"`. The package turns every file part
into one text line ("the candidate attached documents/<name>") before
the model sees it, so the PDF is not sent to the model as file input
(a second copy that costs tokens). The fixture currently reads
`jordan-alvarez-resume.pdf` at the root (mvp-journey.json:28), which
`check_files` would WARN as a stray, yet the fixture reports "clean"
(`:35`).

**S4. How the UI reaches the workspace is unspecified (5a).**
The side panel, Download, and gate artifact rendering all read files.
UI:401-403 says the UI reads "through the same `read_file` the agent
used", but the UI doesn't call tools. **Fix:** the UI gets the same
`WorkspaceStore` (`list`/`read`). For 5a, a fixture adds
`files: Record<path, string>`, seeded into the in-memory store.
Without this, the 5a exit "the whole MVP journey can be clicked
through" (plan:171) can't open a single panel.

**S5. `pdfPath` points to a file that never exists (rules 11, 8).**
C:361-365 says `--pdf` is ignored and the candidate prints the page to
PDF from the browser. The fixtures still set `pdfPath:
"…resume.pdf"` (mvp-journey.json:162; checker-failure.json:62), and
UI:329-331 shows Download only when `pdfPath` is set. **Fix:** replace
`pdfPath` with `htmlPath`. Download PDF = print of the sandboxed
iframe. Drop the "2 pages" claims (mvp-journey.json:161,
checker-failure.json:61) until page count is measured, which is
UNVERIFIED (C:364). Show words only.

**S6. The mock can't prove "only a typed yes approves" (5a exit, plan:177).**
The matcher lives in `packages/agent` (C:180-181), and the mock only
replays. Typing "sure" at a gate on the mock would still advance.
**Fix:** export the matcher as a pure function
(`matchGateReply(text, origin)`) and have the mock call it. Specify
the replay: each `sendMessages` emits the next assistant message; a
non-approving reply at an open gate plays a fixed "not approved"
branch. Also specify how message parts become `UIMessageChunk`s
(`start`/`text-*`/`tool-input-available`/`tool-output-available`/
`finish`), with a delay so `working` can show (UI:566-584 assumes
this but doesn't define it).

**S7. The plan card is a copy of `plan.md` with no link to it (rules 12, 11, 3, 6).**
UI:296 sets no `ref`. **Fix:** set `ref = "plan.md"`, with props
parsed by code (B1). In the fixture, item 2, "Give me 10 more minutes
to find 2-3 more Track A roles" (mvp-journey.json:248), is Ten's work.
coach schema.md:33-35 and rule 3 say agent work never goes on the list.
"Keeps your application near the top" (`:243`) is an unsupported
claim (rule 8).

**S8. The verdict card drops the measured criteria line (goal chain).**
evaluate `schema.md:89` requires a "Your criteria" line when
`criteria.md` exists (measured: eval-m13). `VerdictCardProps`
(UI:251-262) has no field for it. Add `criteriaLine?: string`. Also
decide on one representation. The unchanged skill prose will still
write the markdown summary card as reply text, so a verdict card plus
that text shows the same verdict twice (rule 12). Either the card
replaces the text, or there is no card.

**S9. Fixture honesty and plain language (rules 8, 11, 18).**
- `whyReasons` "6 years leading…" vs the base résumé's "8 years"
  (mvp-journey.json:107 vs `:31`). "3 similar staff-level PM reqs
  opened this quarter" (`:109`) appears in no tool output.
- The cover letter's `checkerSummary` is an invented rubric line
  (`:176`). `check_materials` prints nothing like it, and UI:335-337
  requires the script's own words.
- `gate-moment.json:25` says "resume and letter both checker-clean",
  but only the résumé was checked (`:23`).
- An unapproved rewording passes clean (mvp-journey.json:164), while
  the same act FAILs in `checker-failure.json:30`.
- Internal references shown to the candidate: "design-web-agent.md
  § 3" (gate-moment.json:25), "gate-nw-1 stayed pending" (`:48`).
  Jargon: "2/2 held", "2 held out of 2", "self-passes"
  (checker-failure.json:64; mvp-journey.json:164; UI:58).
- `Goal:`/`Budget:` are written into `CLAUDE.md` (mvp-journey.json:55).
  They belong in `plan.md` (coach schema.md:20-22). `CLAUDE.md` is the
  Tier 0 guardrail file (profile SKILL.md:46), which the web loads as
  the system prompt (C:458-460), so this write would replace the
  always-on guardrails.

**S10. The spend gate's "approved this turn" can't happen (rule 5).**
C:313-316: a turn's spend may not pass the threshold "unless a `spend`
gate … was approved this turn". But approval arrives as the next user
message, which is a new turn. **Fix:** the loop stops and opens a
spend gate for spent-so-far plus the remaining estimate. A typed yes
raises the allowance for the next turn, and the model resumes from the
files.

**S11. Version tracking for `write_file` (C:272-275, 283-284).**
Tracked versions must also come from `write_file` results and `bash`
write-backs. Otherwise `record_verdict` writes `jobs.md`, and the
model's next `write_file` on `jobs.md` fails with a conflict. State
the recovery: on conflict, re-read the file and redo the change.

**S12. Spike 2 passes on the mechanism, not the letter.**
The plan names `check_materials.py` (plan:86-88). The spike used
`check_closeout.py` (spike-2:8-15). The dispatch is an exact-path
match (`spikes/2-just-bash/src/command.mjs:45-47`), not the file-name
rule in C:333-337, and the skills really do call relative forms
(`scripts/…`, `../profile/scripts/…`). The flag parser is hand-rolled
(`command.mjs:11-18`), and nothing tests argparse-error parity
(C:369-371). The dispatch mechanism and in-memory FS sharing are
proven. O should accept this explicitly, or step 3's first task
proves file-name dispatch and `check_materials` parity. Note the
browser cost: just-bash adds about 1.28 MB / 355 KB gzipped
(spike-2:67).

**S13. Rule 9 "gone when you delete it" has no path.**
The ⋯ menu (UI:78-79) and the function's actions (C:491-495) have no
delete. Add `delete`: revoke the key, delete `users/{uid}/ws/`, delete
the rows.

**S14. Step 2 testability.**
Name the fixture workspace used for the byte-identical round trip and
the local Claude Code proof (plan:124-126). No invented workspace
exists yet; the files in `apps/web/fixtures` are chats. Add to
spike 3 whether Storage's `updated_at` changes on overwrite
(C:128); `check_closeout`'s freshness check depends on it (C:91).

**S15. Step 3 testability.**
"Every fixture in `tests/test_check_*.py`" (C:375-378) are unittest
cases with temporary directories. Spike 2 copied 6 of them by hand
(spike-2:38-50). Say how the cases are enumerated, so "100%" has a
known denominator. Flag Python-vs-JS regex differences (`\w`, Unicode)
as the known parity risk for `check_materials`.

**S16. What the spikes mean for the design.**
(a) The spike reads the key at **build time**
(`VITE_OPENROUTER_API_KEY`, main.ts:138). A built bundle would contain
the key, which is against C:506-508 and the 5b exit (plan:192). The
real re-run should take the key at runtime. (b) Put the AI SDK 7
`finishReason: { unified, raw }` shape (spike-1:55-62) in one shared
mock-model helper in `packages/agent` tests, and note it in C § 1.
`mockTransport` works at the UI-stream layer and is not affected.

---

## NITs

- UI:486 says "the six codes"; there are five (C:417).
- Every fixture `artifactHash` has 63 hex digits (a sha256 has 64),
  e.g. `mvp-journey.json:182`.
- `DocumentCardProps.filePath` repeats the wrapper `ref` (UI:317,
  325-329), which is a small rule 12 duplicate. The card can read `ref`.
- The checker card, the document badge, and the expanded "ran" line all
  show the same stdout. Build all three from one parse (B1).
- `deferGate`, `runner`, and `deferred` (C:224, 226, 234-238) belong to
  step 7. Mark them "not built in the MVP" (rule 18). Cut the
  `DirectChatTransport` aside (C:404-406).
- `artifactHash` duplicates `version` for `ref` artifacts. Keep it for
  `text` artifacts only.
- `docs/README.md` doesn't list the two new design docs (PRINCIPLES:55).
- "OpenRouter key" in the ⋯ menu (UI:79) is jargon. Say what it does.
- `data-error.message` is written by the loop's code, which can't know
  "2 of the 8 roles" (over-limit-error.json:68). Use a generic message
  and let the model's next turn say what's done.
- The over-limit fixture estimates $0.75 of $1.00, then runs out at 2
  of 8 (over-limit-error.json:24, 68). Its own estimate was off by
  about 3×, and nothing says so (rule 8).

---

## Designer's open questions (UI § 5): gaps, and the smallest answers

| Q | Real gap? | Smallest answer |
|---|---|---|
| 5 balance refresh | yes (no balance dep) | S1: `deps.balance()`; re-read when a turn ends and on window focus; no polling |
| 6 upload part | yes | S3: upload to `documents/<name>` before sending; file part → one text line for the model |
| 7 gate title | yes | B1: `label` (6 words or fewer) is an input to `request_gate` and a field on `GateRequest` |
| 8 `spendGateUsd` | owner decision, not a contract gap | O sets it; for the fixtures, label the placeholder value as a placeholder |

## Can each step be built and tested from these docs alone?

| step | buildable? | what's missing |
|---|---|---|
| 2 | mostly | the `If-Match` precondition (UNVERIFIED, C:123-127); `updated_at` on overwrite; a named fixture workspace; the delete path (S13, S14) |
| 3 | yes | how parity cases are enumerated (S15); file-name dispatch proof (S12) |
| 4 | **no** | gate and card emission (B1); language checker (B5); conversation window (B6); spend-gate turn logic (S10); balance dep (S1); version tracking (S11) |
| 5a | **no** | fixture script outputs (B8, B9); workspace files for the panel (S4); mock replay and matcher (S6); gate status updates (B4); `pdfPath` (S5) |
| 5b | **no** | funding path and `raise` auth (B7); the two-tab key problem (S2); the spike 1 real run (B11) |

## Over-engineering (rule 18: deletion is the default)

The contract is mostly lean. Cut from the MVP text: `deferGate`/`runner`
/`deferred`, the `DirectChatTransport` aside, `artifactHash` on `ref`
artifacts, and `DocumentCardProps.filePath`. B6's answer (no chat
persistence) deletes a whole design problem instead of solving it.
The one addition I recommend (`request_gate`, plus cards built by
code) replaces unspecified model behavior, so it adds no complexity.
