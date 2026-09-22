# Step 1 re-review — web agent contracts, web UI, fixtures, spikes 1–2

**Reviewer:** architect (independent: authored none of the reviewed files)
**Date:** 2026-09-22 · **PROCESS.md step 5** (the reviewer verifies the fixes)
**At:** commit `4791788`, plus the working tree where noted. The working
tree holds the `gate-grammar.md` spend line, the coach "2–4" edits and the
`docs/README.md` listing. **None of these are in `4791788`.**
**Inputs:** `docs/reviews/step1-review.md` (first review; cited as R1),
`docs/design-web-agent.md` (C), `docs/design-web-ui.md` (UI),
`apps/web/fixtures/*.json`, `docs/spikes/*.md`, `spikes/`,
`skills/coach/references/gate-grammar.md`.
**Settled since R1:** default model Sonnet 5; plan holds 2–4 items; no B1
spend. **Pending owner:** the web MVP has only the spend gate.

**Verdict:** **not ready for owner approval.** The contract (C) closed
most of R1: 9 of 11 blockers are resolved or reduced to an owner decision.
What still blocks is at the seams. The fixtures and the UI doc were
revised against an earlier draft of C, and in places they now show
things C's code cannot produce. Five new blockers (N1–N5) are listed
below. None is large, and three are fixture edits.

`python3 tests/run.py` passes on the working tree (112 passed, 0 failed).

---

## 1. Every R1 finding, re-checked against the files

RESOLVED = the fix is in the file and does what R1 asked. PARTLY = fixed in
one place, still broken in another. OPEN = not fixed.

### Blockers

| R1 | status | evidence |
|---|---|---|
| B1 gate/card mechanism | **RESOLVED** in C | `request_gate` with code-filled fields, C:220-252. The card-build table is C:619-631, and "model never writes a card" is C:28-30 and 621. The test "no model output can produce a `data-card`" is C:654-655. Seam problems left over: N1, N3. |
| B2 spend line; submit line false | **RESOLVED (working tree only)** | Spend line at `gate-grammar.md:12`, not committed (`git status`: ` M`). The submit line only matters if the web has submits; decision 1 (C:22-27) removes them there. It stays true for the local plugin, which does click (`apply/SKILL.md:57`). But C:26-27 still says "that skill edit … is not made here", which is now stale. See N4. |
| B3 meaning of yes for send/submit | **RESOLVED by deletion** (pending owner) | No send/submit gates on the web: C:22-27, 214-218. The fixture no longer logs a send (mvp-journey.json has no `data-gate`). |
| B4 status stored twice | **RESOLVED** | Only `gate_log` holds status, and `setGateStatus` emits `data-gate-status`: C:272-288. `statusOf` scans the whole chat: C:282-283, 593-594. The fixture uses it: gate-moment.json:41, 57, 72. Small wording gap: NIT-5. |
| B5 language checker | **PARTLY** | `check_language` is proposed, pending owner, and the alternative is written down: C:429-448. But `mvp-journey.json:171` tells the candidate "Both are checker-clean". No language check ran, and the reply says nothing about it. That matches neither option (N2). |
| B6 chat persistence | **RESOLVED** | Chats are not saved, the history window is 4,000 words, and older pending gates expire: C:31-32, 284-285, 687-701. |
| B7 `raise` free money | **RESOLVED**; funding pending owner | `raise` is service role only (C:731). Beta starter credit: C:741-743. |
| B8 invented script output | **PARTLY** | The stdout for `check_materials`, `record_verdict`, `check_closeout`, `render_resume` and `proposal_block` now matches the scripts. I re-ran them on a temp workspace built from the fixture's own writes. Still invented: the `check_files` stdout leaves out the WARN the real script prints for the root-level PDF the fixture reads (mvp-journey.json:28-36; the real run printed `WARN  stray file "jordan-alvarez-resume.pdf"`); the `jobs.md` content is typed by hand (mvp-journey.json:188; the real file starts with `# Pipeline`); `"8 undecided rows"` (over-limit-error.json:22); and the cards are built by hand (N1). The `fetch_job` URL is fixed (mvp-journey.json:69). |
| B9 invented confirmation number | **RESOLVED** | `NW-88213` no longer appears anywhere (grep). |
| B10 `.html` create-only | **RESOLVED** in C | C:126, 144-147. Step 2 note: the local store's `TEXT_EXTENSIONS` (`workspace-core.mjs:6`) has no `.html`, so C:201's "same suite against the local folder store" will fail until that changes. |
| B11 spike 1 not a pass | **PARTLY** | The note is honest now: streaming with a mock model, a real request intercepted, the key read at run time, and the live row BLOCKED (spike-1:23-31). Two gaps remain. C:803-804 says the rework shows "the provider filter", but the intercepted body has no `provider` field (spike-1:60). The UI message stream that C § 6 rests on is still not exercised (spike-1:142-145). Spikes 3 and 4 are blocked on accounts (out of scope for this review). See S6. |

### Shoulds

| R1 | status | evidence |
|---|---|---|
| S1 cost range, no "go", balance dep | **PARTLY** | C is fixed: `{lowUsd, highUsd, method}` (C:357, 407-420), `deps.balance()` (C:54, 758-762), and no second "go" word (C:419-420). But in `over-limit-error.json:17-39` the assistant ends on a bare cost card, and the candidate then types `go`. That teaches the second confirm word C removed. |
| S2 balance definition, two tabs | **RESOLVED** | C:721-734, 753-756. |
| S3 uploads | **PARTLY** | C is fixed (C:152-159). The fixture still uses `url: "blob:fixture/…"` and reads the PDF from the workspace root (mvp-journey.json:21, 28-30). UI § 5 Q6 still asks the question that C:152-159 answers (UI:815-825). |
| S4 UI reaches the store; fixture files | **PARTLY** | C: the UI gets the store (C:108-110), and a fixture is `{ files, turns }` (C:604-606). UI § 4 defines a fixture as `{ meta, messages }` (UI:706-711). **No fixture has `files`**, so the 5a side panel has nothing to open. See N5. |
| S5 `pdfPath` | **RESOLVED** in C, fixtures and UI § 2.3 | The UI wireframe still says "2 pages · 640 words" (UI:81). See NIT-2. |
| S6 mock matcher and replay | **RESOLVED** in C | C:77, 607-613. UI § 4 describes a different replay: "one `UIMessageChunk` per part … per message", with no branches (UI:713-716). See N5. |
| S7 plan card | **PARTLY** | `ref = plan.md` is fixed (C:631; mvp-journey.json:195). The card still cannot be built from the source C names, and the fixture's plan text breaks rule 8 (N1, N2). |
| S8 verdict card vs summary | **RESOLVED** (reasoned rejection accepted) | C:640-644: the card is the receipt of the file, the prose is the model's summary, and there is no `criteriaLine`. Rule 11 is a sound basis. |
| S9 fixture honesty and plain words | **PARTLY** | Fixed: "8 years", `Goal:`/`Budget:` moved into `plan.md` (mvp-journey.json:56), the unapproved rewording. Still open: an internal id shown to the candidate, "gate-priya-1 is still pending" (gate-moment.json:56); "self-passes" (UI:78); plus the new items in N2. |
| S10 spend gate "this turn" | **RESOLVED** | C:421-428. |
| S11 version tracking | **RESOLVED** | C:363-370. |
| S12 spike 2 letter vs mechanism | **RESOLVED** as a deferral (owner to accept) | Moved to step 3's first task: C:522-526, spike-2:77-95. |
| S13 delete path | **RESOLVED** | `delete_account`, C:730. |
| S14 step 2 testability | **RESOLVED** | Fixture workspace named at C:190-193 (it exists under `tests/always-on/fixtures/`); `updated_at` added to spike 3 at C:176-178. |
| S15 step 3 denominator | **PARTLY** | The corpus and coverage check are defined (C:508-521). But the six files listed do not exercise the `record_verdict` or `update_job` CLIs. Only `tests/test_e2e_lifecycle.py` does. So "100%" leaves out the two scripts that write `jobs.md`. Add that file, or require at least one case per CLI. |
| S16 build-time key; finishReason | **RESOLVED** | Spike-1:71-87; C:91-92. |

### NITs

| R1 | status | evidence |
|---|---|---|
| "six codes" | RESOLVED | not found (grep) |
| hash has 63 hex digits | **OPEN** | `gate-moment.json:37`: `textHash` has 63 hex digits (counted) |
| `DocumentCardProps.filePath` | RESOLVED | UI:380-384 |
| one parse for three views | RESOLVED | C:645-646 |
| `deferGate` / `DirectChatTransport` | RESOLVED | C:319-322 marks `deferGate` as later; `DirectChatTransport` not found (grep) |
| `artifactHash` on ref artifacts | RESOLVED | spend gates have no ref (C:244-252) |
| `docs/README.md` listing | RESOLVED (working tree only) | README:14-15, uncommitted |
| "OpenRouter key" jargon in the menu | **OPEN** | UI:99 |
| `data-error.message` generic | **PARTLY** | over-limit-error.json:69 is fixed. gate-moment.json:99 puts computed numbers in the message (N3) |
| over-limit estimate off about 3× | **OPEN** | The estimate is $0.60–$0.90 against a $1.00 balance (over-limit-error.json:25), yet the balance runs out at 2 of 8 roles (`:72`), and nobody says the estimate was wrong (rule 8) |

---

## 2. New findings

### BLOCKERs

**N1. The plan card and the verdict card in the fixture cannot come from C's builder (rules 11, 12).**
- C:631 builds the plan card with "the existing `parsePlan` in
  `workspace-core.mjs`". That function reads only numbered lines
  (`/^\s*(\d+)\.\s+(.+)$/`, `workspace-core.mjs:80`). The fixture's
  `plan.md` uses `- ` bullets (mvp-journey.json:190), so `parsePlan`
  returns `[]` and there is no card. It also returns
  `{ id, priority, task, detail, context, due, action, … }`
  (`workspace-core.mjs:83-94`), not the UI's `{ title, why, minutes,
  filePath }` (UI:326-331). And three of its fields are invented labels:
  `priority` is "Now/Next/Later" by position, `due` is "Today/This week"
  by position, and `action` is guessed by regex. Putting those on a card
  would break rule 8.
- The fixture's card text is not in the file either. Card item 2's `why`
  adds "I don't have a submit tool yet" (mvp-journey.json:206), which is
  not in `plan.md` (`:190`). No `filePath` appears anywhere in the
  `plan.md` text.
- The verdict card sets `ref: "jd-analysis/acme-staff-pm.md"`
  (mvp-journey.json:103). But the `record_verdict` call passes no
  `--jd-file` (`:101`), so the row's `jd_file` is empty
  (`record_verdict.py:64`, confirmed by a real run), and C:628 gives
  `ref` = the row's `jd_file`.
- **Fix:** the smallest `parsePlan` answer is in § 4a. Make the fixture
  call pass `--jd-file`, or drop the card's `ref`.

**N2. The fixtures still say things no file supports (rule 8), and the approval screens are the oracle the tester will check against.**
- "109-word résumé, **277-word letter**" (mvp-journey.json:171). No tool
  output gives a word count for the letter.
- "Nothing here needs your word yet — that's only for **a send, a
  submit**, or a run over your spend limit" (`:171`). This is false on
  the web: C:22-27 says there are no send or submit gates.
- "Both are checker-clean" (`:171`). The language checker did not run,
  and the reply does not say so. That breaks B5 under either of C's
  options (C:445-448). The application file's own Standard lists
  "language checker clean" as a requirement (`:166`).
- The plan says "the posting is fresh" (`:190`, `:200`), but nothing
  returned a posting date. It says "one application in flight isn't a
  pipeline yet" (`:190`, `:212`), but nothing has been submitted.
- "I can look at their LinkedIn pages without spending from this run"
  (gate-moment.json:56). The app cannot open pages (C:669-670), and every
  model step costs money.
- **Fix:** edit each line above. For the language check, show whichever
  path O picks. Until then, the reply says "the language check did not
  run".

**N3. The UI and a fixture invent an over-balance path the contract doesn't have (rules 11, 14, 18).**
- UI:584-591 says that when `highUsd` > balance, "no spend gate follows",
  and the agent emits a `data-error over_balance`. gate-moment.json:97-101
  shows it, with the message "Your balance is $0.90 — this run is
  estimated at $1.80–$2.10".
- C has no such rule. `needsGate` compares against `spendGateUsd` only
  (C:417). `data-error` comes from the loop when OpenRouter rejects a call
  (C:764-766), and its message is "a fixed, generic sentence per `code`"
  (C:575-578). No code path can emit this part, and the model cannot
  emit data parts (C:654-655).
- **Fix (delete, rule 18):** drop the path. The `cost` card already
  shows `balanceUsd` next to the range. The model's prose says a top-up
  is needed. The key's own limit (C:764-766) is the backstop. Remove
  UI:584-591 and gate-moment.json:97-101.

**N4. The approved commit must contain the skill edits the contract depends on (CLAUDE.md "patch, grep, commit in one block"; rule 11).**
- C's gate test is "the gate line equals the spend line in the bundled
  `gate-grammar.md`" (C:333-334), and `request_gate` "fails loudly" if the
  line is missing (C:234-235). At `4791788` there is no spend line. The
  line exists only in the working tree.
- The UI's plan card rests on "2–4" (UI:318-323), and that change to coach
  `SKILL.md`/`schema.md` is also uncommitted.
- Those are Policy edits (gates) and coach contract edits. Each needs its
  own reviewed commit before O approves a contract that assumes them.
- Also fix C:26-27 ("not made here") and UI:320 ("not coach SKILL.md's
  'at most 3'"). Both are stale once the edit lands.

**N5. Two different fixture formats, and neither can open the side panel (5a exit, plan:171).**
- C:604-613 says `{ files, turns }`, replayed one assistant message per
  `sendMessages`, with an approve branch and a fixed "not approved" branch.
- UI:706-716 says `{ meta, messages }`, one chunk per part, linear.
- All five fixtures follow the UI's format. None has `files`, and the
  `read_file` outputs hold placeholders (`"# Deshawn Whitfield…"`,
  `"…"`, checker-failure.json:22, 25).
- Step 5a starts the moment step 1 is approved, so this has to be settled
  now.
- **Fix:** keep C's shape. Put `files` on each fixture (the workspace
  after the last turn is enough, because the panel shows current files),
  and make `turns` the user/assistant pairs with an optional `declined`
  branch at a gate. Delete UI:706-727 and point to C § 6.1.

### SHOULDs

**S1. `CLAUDE.md` is the system prompt, and the model can write it (rule 7; plan § Risks, prompt injection).**
C:666-668 loads the workspace's `CLAUDE.md` as Tier 0, and `write_file`
accepts any editable path (C:352). A job post that tricks the model into
one `write_file` changes the always-on guardrails for every later chat.
Locally, the profile skill only copies the template (`profile/SKILL.md:46`).
**Fix:** the web always loads the bundled template as Tier 0. `CLAUDE.md`
in the workspace is written only by that copy step and exported as-is
(rule 9). `write_file` refuses `CLAUDE.md` with `not_editable`, like
`skills/` (C:149-150).
*Proved by:* a test that `write_file("CLAUDE.md")` fails and the system
prompt equals the bundled template.

**S2. The spend gate line states an exact spend when only a range is known (rule 8), and the amount-filling rule isn't written down.**
`"This spends $0.70 — confirm before I commit it."`
(gate-moment.json:38) sits under a $0.50–$0.70 estimate (`:36`), and the
real cost is unknown. C:234-235 says "word for word", but the line holds
`$<amount>`, and only the UI doc says code fills it in (UI:513).
**Fix:** C:234 should say "with `$<amount>` filled from `amountUsd`, two
decimals". Reword the grammar line (a Policy edit, separate review) to
"This run costs up to $<amount> from your balance — nothing starts until
you say yes." "Up to" matches the allowance (C:421-423) and drops
"commit it".

**S3. The UI doc copies contract types, and the copies have drifted (rule 12).**
- `statusOf`'s `needs-you` requires `"ready"` in the UI (UI:164). C has no
  such condition, and C's order puts it first (C:593-594). Pick one: the
  UI's guard is better, because the avatar reads `working` while a run is
  going.
- The hover table has no row for `request_gate` or `check_language`
  (UI:174-184).
- UI says "polls … every N seconds" (UI:807-811); C says "no polling"
  (C:760-761).
- UI says "the eight tools" (UI:786); C lists nine or ten.
- UI builds checker cards from `check_files.py` too (UI:421, 455). C:629
  has only `check_materials`, and `check_files` prints no `LABEL` line.
- UI adds "fewer than 2 is a plain text reply, not a card" (UI:334). No
  such rule is in C:631.

**Fix:** the UI doc refers to C's types instead of copying them. Each
drift above goes one way or the other.

**S4. The apply skill's "three artifacts" and "ATS PDF" versus the web MVP (goal chain).**
`apply/SKILL.md:10`: "An application ships THREE artifacts: tailored
résumé (+ ATS PDF), cover letter, and outreach plan". The MVP journey
delivers two, and the prose isn't changed (C:467-468). So on the web the
skill's goal is silently unmet, and `check_messages` exits 127
(C:505-507). **Fix:** one line in the host note (C:669-673): "outreach
plans and PDF files are not made in this app; say so when you deliver."
The fixture reply should say it too. Or O adds outreach drafts (files
only) to the MVP.

**S5. First run with $0, and where the greeting comes from.**
C:741-743 says "the first-run screen says so" (the $0 balance). UI:227-231
and empty-first-run.json:11 don't say it. Also, the greeting is an
assistant message that no turn produced, which `Coach.stream` can't
emit. **Fix:** the greeting is static UI text, not a `UIMessage`. It is
never sent to the model. It names the $0 balance when that applies.

**S6. Finish the keyless half of spike 1 before approval.** It's cheap.
Two items in C:800-805 are claimed but not shown:
- the provider filter in the intercepted request (spike-1:60 has no
  `provider` field);
- `streamText` → `toUIMessageStream` in the page (spike-1:142-145 defers
  it, but C § 6 depends on it).

Both run with the existing canned-SSE harness. Also update C:797-808,
where "A coder is re-doing" is stale.

**S7. Two UNVERIFIEDs can be settled from the vendor docs now.**
OpenRouter's limits page documents `GET /api/v1/key` returning `data.limit_remaining`,
and 402 when a key's credit limit is exceeded
(https://openrouter.ai/docs/api_reference/limits, read 2026-09-22).
Change C:761-765 to "documented; spike 4 confirms live".

**S8. Tool outputs in the fixtures versus C.**
The fixtures return `version` from `write_file` and `read_file`
(mvp-journey.json:33, 128). C says `{ path, written: true }` and
`{ path, content, readOnly }` (C:351-352), and that versions are the
package's business, not the model's (C:363). Drop `version` from the
fixtures.

### NITs

1. Delete the revision-history fields in the fixtures (`note_round3`,
   `note_round4`, `todo_bN` at UI:745-749). Also delete the "Revision
   note/history" at UI:18-46. That history is in git, and in data it is
   clutter (rule 18).
2. Clean up the wireframe (UI:78-91). It still shows a send gate,
   "2 pages", and "2 self-passes".
3. UI:771-774 describes checker-failure as "a `document` card with
   `checker: "fail"`". The fixture rightly has no such card
   (checker-failure.json:5).
4. C:683 says ~3,300 words per turn, but the plan's step 4 exit says
   ~3,000 (plan:158-159). Update the plan, or cite where the owner
   restated it.
5. C:275-278 re-writes the row when a gate is "left open", but C:316-317
   says status moves from `pending` exactly once. Say that "left open"
   emits the part without a write.
6. Spike-1:138-139 and 175 cite C line numbers that no longer exist.
7. `statusOf` `idle` means "this session" in the UI (UI:161) and "this
   chat" in C (C:600).

---

## 3. Rule 18 pass — what to cut from the contract

C is **6,958 words** by `wc`. Section counts: preamble 303 · §1 404 · §2 792 ·
§3 1,002 · §4 1,212 · §5 783 · §6 1,126 · §7 430 · §8 554 · spikes 305.

**Target: ≤ 4,800 words**, with every "Prevents / Proved by" kept. About
4,500 if O settles `check_language` so it shrinks to one table row.

| section | action | est. words saved | why |
|---|---|---|---|
| Preamble, decision 4 prices (C:33-36) | **move** to spike 1's note | 40 | a price is a measurement, not a contract |
| Preamble, "Card props:" and UNVERIFIED/PENDING legend (C:11-18) | cut to one line | 60 | |
| §1 finishReason bullet (C:91-92) | **move** to spike 1's note (already there, spike-1:91-95) | 30 | test-helper detail |
| §2 Storage access-rule predicate (C:163-168) | **move** to step 2's issue | 70 | build detail; the contract is "user A can't reach B", and spike 3 proves it |
| §2 upload name collisions `-2`, `-3` (C:155) | keep | – | testable |
| §3 **merge `request_gate` into `estimate_cost`** | **cut** the tool, its label rules, the "model opens a gate" path, and the UI copy of it | ~250 (C) + ~300 (UI § 2.5) | When `estimate_cost` returns `needsGate: true`, code opens the spend gate itself, with label = `action`, text = `action` + the cost line, and amount = `highUsd`. Then the turn ends. The loop's own mid-run gate (C:421-428) stays as the backstop. That makes one way to open a gate instead of two, and one fewer tool whose description costs words every turn (rule 15). The model supplies only `action`, which is short and already an input. |
| §3 `deferGate` paragraph (C:319-322) | **cut**; plan step 7 already has it (plan:61-62, 271-273) | 50 | beyond the MVP |
| §3 the "no" matcher line "courtesy only" (C:265-268) | trim | 30 | |
| §4 `check_language` proposal (C:429-448) | **cut to 2 lines now**; once O decides, keep one row plus its test | 150 | a decision request belongs in the owner questions, not the contract |
| §4 "Prevents" list | keep | – | |
| §5 "Spike 2 accepted…" (C:522-526) | **cut**; the spikes section and spike-2:77-95 say it | 60 | said three times |
| §5 port table, dispatch rule, corpus | keep | – | testable |
| §6.1 `ChatTransport` interface copied from `ai@7` (C:543-556) | **cut** to "the SDK's `ChatTransport` (`ai@7.0.111`)" | 80 | a copy of the vendor's type will drift (rule 12) |
| §6.1 "Reviewer findings B8, B9 and S9 are for the designer" (C:617) | **cut** | 15 | a review pointer, not a contract |
| §6.2 "Consequences for design-web-ui.md" (C:633-648) | **move** into the UI doc, as its edits | 200 | instructions to another author; decision-log material |
| §6.2 verdict-vs-summary rationale (C:640-644) | cut to one sentence | 50 | |
| §7 | keep; add the S1 `CLAUDE.md` rule | – | |
| §8 endpoint list (C:736-739) | keep | – | step 5b builds against it |
| Spikes section, plan criteria copied word for word (C:781-793) | **cut**; point to plan:79-93 | 120 | the plan owns them |
| Spikes section, status (C:795-816) | cut to 4 lines, one per spike, each pointing to its note | 120 | the notes own the detail |

Total ≈ 1,570 words from C (to about 5,400) before the edits proper.
The text still addressing R1 ("Revised against", "(S8)", "B1's fix")
is scattered through C and the UI doc, and deleting it takes the rest
down to ≤ 4,800.

**The UI doc (6,576 words) has more to cut.** Delete the revision
history (UI:18-46, about 330 words). Delete § 5's answered questions
(UI:778-835, about 450 words). Keep only the open items, of which none
remain after S3 and S7. Delete the per-card "Dropped from round 2"
paragraphs (about 350 words). Replace the verbatim copies of `GateRequest`,
`statusOf` and `DataErrorPart` with pointers (about 400 words; S3). Delete
UI § 2.5 by the `request_gate` merge (about 300). **Target: ≤ 3,500
words.**

---

## 4. The two known open items

### (a) What `parsePlan` returns for the plan card

The existing function (`workspace-core.mjs:71-97`) is the wrong source as
it stands (N1). It reads only numbered lines, and it makes up
priority/due/action labels.

**Smallest answer: show each To do line word for word, and derive the link only.**

```ts
// shared module, pure, used by the card builder and by workspace-ui
parsePlanTodo(md: string): { text: string; ref?: string }[]
//  - lines under "To do" up to the next board heading or "##"
//  - accepts "1. ", "- ", "* " bullets; text = the line minus its bullet, word for word
//  - ref = the first `backticked` workspace path in the line (the existing
//    parsePlan's own `context` rule, workspace-core.mjs:88), else absent
type PlanCardProps = { stage: Stage; items: { text: string; ref?: string }[] };
```

- **Why `text` and not `title`/`why`/`minutes`:** coach's schema already
  puts the why and the minutes inside each line (`schema.md:33-34`).
  Splitting them with a regex means parsing prose, and a failed split
  would show a wrong number. Showing the line word for word is the rule 11
  receipt, and it removes the problem instead of solving it. The card
  shows exactly what `plan.md` says.
- **What changes elsewhere:** `workspace-ui`'s `parsePlan` maps from
  `parsePlanTodo`. It keeps or drops `priority`/`due`/`action` for its own
  screens; that is outside this MVP. The fixture's `plan.md` lines put the
  file path in backticks. UI:326-363's `PlanItem` becomes
  `{ text, ref? }`, and the "fewer than 2" rule goes (S3). Whether the
  count is 2–4 is coach's rule. If it needs enforcing, that goes in a
  script (rule 14), not the card.
- **Prevents:** a card that says more than the file does (rule 8), and a
  parser that disagrees with the file.
- **Proved by:** a table test on `-` bullets, numbered bullets, a line
  with a backticked path, and a line without one. Plus N1's fixture,
  rebuilt through the function.

### (b) `gate-grammar.md` "three parts" versus rule 7's "four steps"

**Not a real conflict. The two count different things.** The grammar's
three parts are what the **agent shows and says**: the artifact, the gate
line, the report-back. The candidate's yes is carried in its Rules
section (`gate-grammar.md:17`, "only the candidate's explicit go in
conversation fires it"). Rule 7 (PRINCIPLES:25) and Tier 0
(`workspace-CLAUDE.md:36`) count the **protocol**, including the
candidate's step.

The heading still misleads. "Three parts, in order" puts the report-back
right after the gate line, as if nothing happened in between. The new
spend line ("confirm before I commit it") leans on exactly that missing
step.

**Proposed wording:** replace `gate-grammar.md:5` and renumber part 3. This
is a Policy edit, so it gets its own reviewed commit (N4).

```
## The four steps (PRINCIPLES rule 7), in order

1. **The artifact** — (unchanged)
2. **The gate line** — (unchanged)
3. **The candidate's yes** — given by the candidate in the conversation,
   after steps 1 and 2. Nothing else fires it (see Rules).
4. **The report-back** — (the current part 3, unchanged)
```

The consumers cite the file, not the count (`apply/SKILL.md:57`,
`outreach/SKILL.md:75`, `coach/SKILL.md:33`, `workspace-CLAUDE.md:36`), so
nothing else needs rewiring. `check_files` link checks are unaffected.

---

## 5. Verdict

**Not ready for owner approval yet,** even setting aside spikes 3 and 4 and
spike 1's live call. Before O approves:

1. **N4:** commit the gate-grammar spend line (with the S2 wording and the
   § 4b heading) and the coach 2–4 edits, each reviewed. Then fix C:26-27
   and UI:320.
2. **N1 and § 4a:** put `parsePlanTodo` in C § 6.2 and make the plan-card
   fixture agree with it. Fix the verdict card's `ref`.
3. **N2, N3, N5:** fixture edits (the rule 8 lines, removing the
   over-balance path, one fixture format with `files`).
4. **S1:** the `CLAUDE.md` rule. It is small, and it closes the prompt
   injection path this architecture opens.

Owner decisions to record at approval: no web send/submit gates;
`check_language` adopted or deferred (step 4 needs it); beta funding by
admin credit; `spendGateUsd`; accepting spike 2 on the mechanism; the
`request_gate` merge (§ 3).

**The contract's core holds up:** one loop, code-built cards and gates,
`gate_log` as the one status owner, no saved chat, the balance as one
number. It needs no redesign. What remains is making the fixtures and
the UI doc match it, then cutting it back.

---

## Verification of fixes (a03363f)

**Checked:** `0f9a16a`, `c46028f` (gate-grammar and coach lines only),
`6478755` (gate-grammar only) and `a03363f`. I read each file myself and
did not rely on the commit messages. The harness changes in `c46028f` and
`6478755` are out of scope and not reviewed here.

**Spot checks, run on a `mktemp -d` workspace built from each fixture's
own `files` (never `~/job-search`):**

- `mvp-journey`:
  - `check_materials` (résumé + letter + base): stdout matches, exit 0.
  - `render_resume`: prints `words: 109`, and the HTML is byte-identical
    to the fixture's `.html`.
  - `proposal_block`: its WARN tail matches.
  - `check_closeout --stage applying`: stdout matches, exit 0.
  - `record_verdict … --jd-file … --company-file`: writes the same
    `JD:` / `Company file:` lines as the fixture's `jobs.md`.
- `checker-failure`: I rebuilt the first-pass résumé (the final file with
  the "Scaled … 4x" bullet put back). `check_materials` stdout is
  byte-identical to the fixture's FAIL output, exit 1.
- Every fixture is `{ meta, files, messages }`. Every `data-card.ref`,
  plan item `ref`, and `read_file`/`write_file` path exists in `files`
  (checked by script over all five fixtures).
- Word counts (`wc -w`): the contract is **4,786** (target ≤ 4,800 met);
  the UI doc is **2,304** (target ≤ 3,500 met).
- `python3 tests/run.py`: 112 passed, 0 failed.

### Re-review findings

| item | status | evidence |
|---|---|---|
| **N1** plan and verdict cards from the builder | **RESOLVED** | `parsePlanTodo` is exported and specified (C:44, 420-429), with its test (C:438-439). The fixture card's `text` matches the `plan.md` lines word for word, and each `ref` is the backticked path. `record_verdict` passes `--jd-file`, and `jobs.md` carries `JD: jd-analysis/acme-staff-pm.md`. Residual: V3. |
| **N2** unsupported claims | **RESOLVED**, one residual | The letter word count, "checker-clean", "the posting is fresh", "pipeline", the send/submit gate talk and the LinkedIn claim are all gone. The reply says the language check has not run (mvp-journey m9). Residual: the internal id "gate-priya-1" still appears in candidate-facing text (gate-moment.json:53), and "I have no submit tool **yet**" (`plan.md` item 2) implies a promise (NIT). |
| **N3** invented over-balance path | **RESOLVED** in C and the fixtures | C:273-274. gate-moment.json has no `data-error`. over-limit-error.json shows only the loop's real rejection. Residual in the UI doc: V4. |
| **N4** skill edits committed | **RESOLVED** | Spend line in `0f9a16a`; four steps plus the new spend line in `6478755`; coach 2–4 in `0f9a16a`. The stale C:26-27 and UI "at most 3" text is gone. Residuals: V5 (a precedence-chain doc still says 1–3); `docs/README.md` is still uncommitted (` M`). |
| **N5** one fixture format with files | **RESOLVED** | C:380-387 and UI:242-252 agree. All five fixtures follow it, and every path resolves (checked above). |
| **S1** Tier 0 injection | **RESOLVED** in C | Path rule C:89-90; bash write-back refusal C:240-243; bundle-only Tier 0 C:449-452; tests C:485-488. NIT: the fixtures' `files` have no `CLAUDE.md`, but C:450-451 says code writes it at sign-up. |
| **S2** spend line wording and fill rule | **RESOLVED** | `gate-grammar.md:12`, "This costs up to $<amount> — nothing starts until you say yes.", equals C:149 and gate-moment.json `gateLine` "This costs up to $0.70 — nothing starts until you say yes." word for word. The fill rule is C:146-148. |
| **S3** UI copied contract types | **RESOLVED** | The UI now points to C instead of copying it (UI:11-17). The `statusOf` `ready` guard is in C:375; polling, "eight tools", `check_files` cards and "fewer than 2" are all gone. |
| **S4** apply's three artifacts | **PARTLY** | The host note says it (C:455-456). The mvp-journey delivery reply (m9) never says the outreach plan and PDF are not made here. |
| **S5** first-run greeting | **PARTLY** | C:515-517 says it is static text, not a `UIMessage`, and names the $0 balance. But UI:98-107 claims its sample names the $0 balance, and the sample doesn't. `empty-first-run.json` m1 and `mvp-journey.json` m1 still carry the greeting as an assistant `UIMessage`. |
| **S6** keyless half of spike 1 | **OPEN** | Now listed as still to do (C:543-544). `docs/spikes/spike-1-browser-loop.md` is unchanged since `4791788`. |
| **S7** UNVERIFIEDs settled from docs | **RESOLVED** | C:522-527. |
| **S8** versions in fixture outputs | **RESOLVED** | Outputs are `{ path, written: true }` / `{ path, content, readOnly }`, matching C:221-222. |
| NIT-1 revision history in data | **PARTLY** | The `note_round*` and `todo_b*` keys are gone. The `meta.description` fields still narrate review rounds. |
| NIT-2 wireframe | **RESOLVED** | UI:28-52 |
| NIT-3 checker-failure description | **RESOLVED** | UI:280-282 |
| NIT-4 3,300 vs 3,000 words | **RESOLVED as an owner decision** | C:468-470 |
| NIT-5 re-emit without a write | **RESOLVED** | C:186 |
| NIT-6 spike-1 stale line refs | **OPEN** | spike note unchanged |
| NIT-7 idle "session" vs "chat" | **OPEN** | UI:79 vs C:378 |

### First-review items that were PARTLY

| R1 | status | evidence |
|---|---|---|
| B5 language checker | **RESOLVED** pending the owner decision | The reply and `plan.md` say it did not run (mvp-journey m9, `plan.md`). C:228, 569-572. |
| B8 invented output | **RESOLVED**, one NIT | Script stdout re-run as above, and `jobs.md` is the real script format. NIT: `write_file` inputs and `read_file` outputs are cut short with "…" (e.g. checker-failure `"# Deshawn Whitfield…\n- Scaled …"`). UI:236-238 promises the expanded "ran" row shows the literal input, so the fixture shows an input that was never written. `files` already holds the full text, so use it. |
| B11 spike 1 | **PARTLY** | unchanged; see S6 above |
| S1 cost / "go" | **RESOLVED** | over-limit-error.json m2 now says "no gate needed — starting now"; the candidate never types "go". |
| S3 uploads | **OPEN in the fixture** | The file part is still `url: "blob:fixture/…"`, and the PDF sits at the workspace root. The fixture now builds on that: the `check_files` WARN is real, and the agent offers to move the file. C:92-96 says the upload lands in `documents/` with a `workspace:` URL. See V2. |
| S7 plan card | **RESOLVED** (N1), with V3 | |
| S9 plain words | **PARTLY** | "gate-priya-1" is still in candidate text (gate-moment.json:53). "self-passes" is gone. |
| S15 parity denominator | **RESOLVED** | `test_e2e_lifecycle` added (C:329-331). |
| NIT hash | **PARTLY** | Now 64 hex digits, but it is not sha256 of the gate's `text` (checked). The builder will compute it, so give the fixture the real hash. |
| NIT "OpenRouter key" jargon | **OPEN** | UI:57-58 "manage the OpenRouter key" |
| NIT over-limit estimate | **OPEN** | $0.60–$0.90 estimated against a $1.00 balance; out after 2 of 8 roles; the final reply doesn't say the estimate was wrong (rule 8). |

### New findings the fixes introduced

No BLOCKERs.

**SHOULD**

- **V1. The spend gate shows less of "the complete thing" after the merge (rule 7, Part 1).**
  - `text` is now the ≤ 6-word `action` plus the cost line (C:143-144).
    In the fixture that is "evaluate 6 saved roles. Estimated cost:
    $0.50–$0.70." (gate-moment m2). The candidate cannot see *which* six
    roles.
  - `gate-grammar.md:7` says of the artifact: "Never a description of it;
    the thing itself."
  - **Smallest fix:** `estimate_cost` takes an optional `items: string[]`
    (the roles or files the run covers, 10 at most). Code lists them in
    `text` under the action. `label` stays the action. This is an owner
    decision because it touches the merge (decision 6 below).
- **V2. Save locations: `documents/` for uploads, `jd-inbox/` for fetched posts (C § 2 and § 4; rule 12).**
  - mvp-journey uploads to the root (a `blob:` URL). `fetch_job`
    `saveTo` writes `jd-acme-staff-pm.txt` at the root.
  - Running `check_files` on the fixture's final `files` prints **two**
    stray WARNs (both files).
  - The search schema already names the place: `jd-inbox/<company>-<title>.md`
    (`skills/search/references/schema.md:45`).
  - **Fix:**
    - C § 4 says `saveTo` defaults to `jd-inbox/<company>-<title>.md`.
    - The fixture uploads to `documents/jordan-alvarez-resume.pdf` with a
      `workspace:` URL, which removes the WARN and the "move it?" line.
    - Its session close runs `check_files` (C:311 lists it for "every MVP
      skill at close").
- **V3. The fixture's `plan.md` items have no minutes (coach `schema.md:33-34`, rule 6).**
  - The schema says each To do item is "fully prepared, each with its why
    + minutes". C's decision log (C:561-562) keeps lines word for word *on
    the grounds that* each line already carries why and minutes.
  - All three fixture items lack minutes, and item 3 has no why either.
    The approval screen shows a plan the coach schema forbids.
  - **Fix:** the fixture's lines. The card is unaffected.
- **V4. The UI doc says an over-balance spend gets no gate, but code always opens one when `needsGate` (seam, rule 12).**
  - UI:202-206: "A spend that would exceed the balance never gets a gate
    at all … the agent's prose says a top-up is needed."
  - In C, code opens the gate whenever `highUsd > spendGateUsd`
    (C:140-141, 270). The model cannot hold it back.
  - **Fix:** delete that sentence. The `cost` card already shows the
    balance next to the range, and the key's limit is the backstop
    (C:273-274).
- **V5. A precedence-chain document still says "1–3" (chain conflict, CLAUDE.md precedence).**
  - `docs/design-cowork-coaching.md:541`: "prescribes the 1–3 next
    actions". PRINCIPLES rule 6 and the committed coach skill say 2–4.
  - The chain is wrong at this line. Fix the doc; don't pick a winner.

**NIT**

- `apps/workspace-ui/` is **untracked** (`git ls-files` is empty), yet C
  builds on `workspace-core.mjs` (C:6, 62, 421-422).
  `docs/design-cross-host-active-context.md` is also untracked. An
  approved contract should cite committed files.
- The fixtures' `meta.description` fields narrate review rounds
  ("Round 4 (docs/reviews/…)"). Keep a one-line description.

### Verdict

**The contracts (`docs/design-web-agent.md`) are ready for owner approval.**
This excludes spikes 3 and 4 and spike 1's live call, which wait on
owner accounts and keys. No blocker remains. What is left is SHOULDs and
NITs.

**The fixture screens should get one more small pass before O approves
them.** Step 5a starts the moment step 1 exits, and it builds from these
fixtures. The pass:

1. V2: save locations.
2. V3: minutes in the `plan.md` lines.
3. V4: delete the UI sentence.
4. S5: the greeting as static text that names $0.
5. S4: the delivery reply says no outreach plan or PDF.
6. The "gate-priya-1" id in candidate text.

These are fixture and UI-doc edits. None touches the contract.

Also before step 1 closes:
- V5: fix the chain doc.
- S6: the keyless half of spike 1.
- Commit `docs/README.md`, and settle where `apps/workspace-ui` lives in
  the repo.

**Owner decisions to record at approval:**

1. The web MVP has **only the spend gate**. Sends and submits are
   candidate to-dos in `plan.md`, and the local plugin keeps its send and
   submit gates.
2. **`check_language`:** adopt it (one fresh-context model call per
   document set, about $0.015–$0.02 a call, to be measured), or defer it
   (the reply says the check did not run; the gap is recorded in step 4's
   t15). Step 4 needs this answer.
3. **Beta funding** is an admin-set starter credit through `raise`, with
   no payment page.
4. **`spendGateUsd`:** the per-turn spend threshold.
5. **Accept spike 2 on the mechanism.** File-name dispatch and
   `check_materials` parity become step 3's first task.
6. **The gate opens from `estimate_cost`** (the `request_gate` merge),
   including V1: whether the spend gate lists the run's items.
7. **The per-turn target is ~3,300 words of instructions**, instead of
   the plan's ~3,000. If approved, update plan:158-159.
8. **On the web, Tier 0 always comes from the bundle, and `CLAUDE.md` is
   not writable.** A candidate's own edits to `CLAUDE.md` (for example, a
   folder imported from local use) are kept and exported, but the web
   ignores them.
