---
name: storybank
description: Use this skill when the candidate wants to build, review, improve, or practice their interview stories — e.g. "help me build my story bank", "capture this story", "interview me for stories", "mine my old résumé/reviews for stories", "find gaps in my stories", "drill me on story retrieval", or when another skill (positioning, prep, apply) needs grounded stories and none exist.
---

# Storybank

Interview stories are the candidate's evidence base — every strong pitch, résumé bullet, and behavioral answer is mined from them. **You don't sit down to author a story bank; you answer questions and one accumulates.** This skill asks the questions and owns the record.

## The goal, and the three measures of it

**A bank that covers the map, with complete stories, strong enough to use.**

| Measure | Target |
|---|---|
| **Complete** | every story, no exceptions |
| **Strong** | **4 or better** before a consumer sees it. 3 or below goes to the improve loop; 1–2 retires |
| **Covering** | every competency in `## Coverage`, and the three must-cover gaps among them |

`references/eval.md` is how to score these — read it when deciding whether something is finished. It also draws the line the measures depend on: *complete* and *confirmed* are different questions, and a story told live is confirmed however incomplete it is.

## Prerequisites

**Required — do not proceed without these.**

- **No workspace `CLAUDE.md` → the workspace isn't set up.** Run profile's folder + guardrails step before writing any file. Every skill is a door a NEW candidate can walk through first. *(This line is duplicated verbatim in every skill on purpose: it fires when the workspace `CLAUDE.md` is absent, so it cannot live inside that file.)*
- **The coverage map, before any question is asked.** Source it by this ladder, top rung available wins, recording each competency's source in `## Coverage`:
  1. **Real JDs** — the competency extractions in `jd-analysis/` for the target roles (evaluate writes these).
  2. **Derived from `criteria.md`'s own target definitions**, each labeled `[inferred]` — capture never blocks on a search having run. Upgrade silently as real decodes land.
  Seed the three must-cover gaps too: feedback · conflict · a TRUE failure (`references/patterns.md`).
- `base-resume.md § Claim rules`, read for the trace rule.

**Optional — better with, workable without.**

- `jd-analysis/` — rung 1 of the ladder. Without it, rung 2 applies and every row is `[inferred]`.
- `profile.md`'s story seeds, if intake planted any.
- `voice.md` — only if a story's text will be quoted into a candidate-voiced surface.

## The loops

The coverage map is the outer loop: it picks what to ask next, and the Covering measure says when there is enough. **Read `references/patterns.md` before a capture session**, and `references/schema.md` before writing any record.

**Which loop you are in is decided by what just happened, not by asking.** Each one names its own trigger below. If two could apply — a document dropped mid-capture — finish the turn you are in and say the other is waiting.

### Capture — how most stories arrive

**Runs when** the candidate is talking about their experience: they answered a question, volunteered a story, or asked to be interviewed. This is the default loop.

1. **Aim.** Pick the highest-priority uncovered competency; use `profile.md`'s story seeds to aim where a story is known to exist. One question at a time, then wait.
2. **Listen** for the story embedded in the answer. When you hear one: "That's a strong story. Let's capture it." Walk through STAR, drilling for specifics — **a vague answer gets a follow-up question, never a sharpened guess.**
3. **Write it the moment it lands** — story file + index row, with `TODO: <what to get>` for whatever drilling hasn't filled. Status is `confirmed`: they just told it to you. An interrupted session keeps the story; follow-ups refine the FILE, not a conversation buffer.
4. **If the answer surfaced a fact the base résumé doesn't have — or contradicts one — PROPOSE it now, in this reply.** Say what the fact is, show the résumé line you would write, and wait for the yes. Do not write it, and do not skip it: silence is not the safe option here. Full rule in § A story is not a résumé line.
5. **Extract the earned secret** (`references/patterns.md` has the questions). Until you have it the file carries `TODO: earned secret`.
6. **Rate strength 1–5** (`references/eval.md`), tag skills, update `## Coverage`.

**Exits** when the story is Complete, and carries nothing the candidate didn't say. Missing its secret means not done; an invented specific means failed, which is different.

Stories also arrive from **practice's post-interview debriefs** — one told live in a real interview is captured in this record format, `confirmed`, because they just told it.

### Mining — a document is a source, not a story

**Runs when** a document arrives — dropped in the folder, pasted, or named ("mine my old résumé"). Never on a document nobody offered.

Each candidate story in a supplied document becomes a **draft**: index Status `draft [source: <file>]`, story file marked the same, holding only what the document actually says.

**Exits** when a draft is confirmed — ONLY when the candidate answers at least one question about it — the answer usually supplies what no document has: the stakes, the specifics, the earned secret. **A candidate-authored document does not waive the question**; their own past write-up is still a document, and blanket assent ("stories confirmed") is not an answer.

Where the document and the candidate conflict, the candidate wins, and the correction is written at its source file.

### Improve — one story against a stated standard

**Runs when** a named story scores 3 or below, or the candidate asks to make one stronger, or find-gaps says a critical competency is covered only weakly.

- **Read `storybank-history.md` first** — the rows for this story are what tell you which round you are on and whether the last one moved anything. A fresh session remembers nothing; without this read the ceiling cannot fire.
- **Standard:** the competency this story must cover, plus "specific, owned, only you could tell it." **Budget:** 2–3 rounds. Say both first.
- **Diagnose by the current score** rather than saying "add more specifics" — the score-band diagnostic and its questions are in `references/patterns.md § Improving by score band`.
- **Apply the minimum change that moves the score.** Show before/after for the changed section, re-score, and update the index row's changed columns (Strength, Earned Secret, Impact) — `scripts/check_stories.py` catches index↔file drift at session close.
- **Append the round** to `storybank-history.md` (row format and lifecycle: `references/schema.md`), even a round that changed nothing.
- **Exits — three ways out.** The story clears the standard — *say so plainly when it does*. Or the budget runs out. Or **the ceiling: two rounds in a row with no movement** — then change strata (prose → checklist → code) or hand the candidate the tradeoff as a **DECISION**. Never grind out another round, and **never relax the standard to end the loop.**

### Asking the bank — three questions it can answer

These are not loops: they report on the bank rather than build it. Each
one keeps its trigger and its threshold here; the protocol for running it
is in `references/patterns.md`.

| Question | Runs when | Threshold | Exits with |
|---|---|---|---|
| **Find gaps** — what's missing? | the candidate asks, another skill needs a competency the bank may not cover, or a target changes | none | a ranked list **and a named next action** — never a list alone |
| **Drill** — can you retrieve under pressure? | the candidate asks to practice retrieval | **8+ confirmed** stories. Below that, say the bar isn't met and offer capture instead | the debrief: retrieval gaps named, and any drilled draft's Status updated — **answering on a drilled draft is that draft's confirmation** |
| **Narrative identity** — what do these stories say about them? | the candidate asks who they are across their stories, or positioning needs a thesis | **5+ confirmed** stories. Below that it is guessing — say so | `## Narrative identity` written |

## State

**`storybank.md` — the index.** Created when the coverage map is first written.
- `## Coverage` — the competency map the bank is measured against, each row with its source and its story coverage
- `## Stories` — the index table (columns in `references/schema.md`)
- `## Narrative identity` — optional
- `## Other notes` — optional

`stories/S###-<slug>.md` — one file per story. `storybank-history.md` — append-only, one row per improve round. Both shapes are in `references/schema.md`.

**What this skill does NOT own.** `base-resume.md` is profile's; storybank writes there only what the candidate has ruled on (below). Practice writes back after real interviews, scoped to the Use Count / Last Used / Notes columns only. Consumers (positioning, prep, apply, practice) cite stories by `S###`; story text is never copied into another file's ownership.

**A `draft [source: <file>]` story is a document's claim, not the candidate's.** Its Status is the only marker there is. What each consumer does with a draft differs, so the rule lives at each of their moments: the pitch uses `confirmed` only (`../positioning/SKILL.md § Prerequisites`); prep reports drafts separately and never counts them toward the bar (`../prep/SKILL.md § The brief`, rule 4); apply may use one but proposes its claims rather than asserting them (`../apply/SKILL.md § Tailoring`, step 3); practice excludes drafts from its drill bar and its thin-material read (`../practice/references/patterns.md § The gated ladder`).

**Hands back** when the ask is answered and the record is written — the story on disk, `## Coverage` current, any proposal put to the candidate. A loop left mid-flight says so in the closing line, with what it is waiting on.

**Session close:** run `scripts/check_stories.py --workspace .` AND `../profile/scripts/check_files.py --workspace .` — IDs, correspondence, Status grammar, history headers, and the section schema are code's job, not memory's. **Then the language check**: spawn the checker-subagent (`../profile/references/language-check.md`) over every story file written or edited this session, rule sources `base-resume.md § Claim rules` + `voice.md` — a struck form in a story propagates to every surface that quotes it. Fix-before-delivery flags are fixed before the reply ends; a reply that is not the JSON table is a VOID check, not a pass.

**The candidate sees both results, as outcomes — never as narration.** Clean: one line in the close ("both checks clean — N stories, index consistent, no flagged language"). Script FAILs: fix them, then say what was fixed. Language flags: the verdict table is shown with the fix or the defence beside it — a check that leaves no record didn't happen. Never announce that you are about to run a check; report what it found.

## A story is not a résumé line

**No claim from a capture enters `base-resume.md` unless the candidate has ruled on it. You propose; they decide; then it is written.**

A story is long-form: situation, stakes, what they did, what it cost, what they learned. A résumé line is compressed and has to stand alone. A fragment lifted out of a story loses the context that made it true — which is how a capture becomes a claim nobody can defend in the room.

So when a capture surfaces something the base doesn't have, or contradicts something it does:

- say so in the reply, in one line, with the story it came from
- propose the résumé wording you'd use — written as a résumé line, not as a clipping from the story
- write it only on an explicit yes to that line. Blanket assent to the session is not a yes to a claim
- a "no" is a ruling: record it in `base-resume.md § Claim rules` as declined, so no later session re-proposes it

A contradiction is raised the same way, never silently corrected — the candidate is the source, and the base is the whole system's fact floor.

## Guardrails

- **Never fabricate** — no invented stories, metrics, or secrets. A gap named honestly beats a hollow story.
- **Force specificity without inflating ownership**: the candidate's own contribution (not "we"), quantified impact or the explicit reason it can't be, real stakes. Numbers and scope claims trace to the base résumé (`../profile/SKILL.md § State`, base-resume entry).
- **An earned secret comes from direct experience** and survives challenge; generic advice and borrowed insight don't qualify.

*Every reply ends with ONE contextual next step — a sentence with its why, not a menu.*
