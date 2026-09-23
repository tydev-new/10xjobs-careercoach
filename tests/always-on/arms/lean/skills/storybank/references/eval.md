# Storybank — how to score

`SKILL.md` names each goal and the score it has to reach. This file is
the method: what to look at, and how to judge it. Read it when you are
deciding whether something is finished.

## Complete and confirmed are different questions

They get confused, so keep them apart:

- **Complete** — does the record hold all its parts? STAR, stakes, an
  earned secret, no `TODO:` left. A story can be incomplete for weeks.
- **Confirmed** — has the candidate vouched for the content? They told
  it live, or they answered a question about a mined draft.

**A story told live in conversation is `confirmed` the moment it is
told, however many `TODO:`s it carries.** Incompleteness is never a
reason to mark something `draft`; `draft` means the words came from a
document nobody has checked with them yet.

## Who checks what

The split runs on what the check must read (goal 2's table, measured
t15: an independent checker caught 10/10 language violations where
self-check caught 1/7).

- **Structure and counts → `scripts/check_stories.py`**: IDs, index↔file
  correspondence, Status grammar, the history header. Run at session
  close; it FAILs, you fix.
- **Language against written rules → the checker-subagent**
  (`../../profile/references/language-check.md`): a ⚠ struck form or a
  never-say phrase inside a story's text, in any wording. Stories feed
  every downstream surface, so a struck form here propagates everywhere.
  Run it at session close over every story file written or edited this
  session, rule sources `base-resume.md § Claim rules` + `voice.md`.
- **Everything semantic → you, at the moment**, and the candidate's own
  confirmation: provenance of specifics, document-vs-candidate
  conflicts, whether a secret is earned. No checker sees these; the
  constraints below are what you hold yourself to.

## Judging the constraints

These are binary and they are not goals — they are the things that must
not have happened on the way. Look for the specific thing; do not score
it.

| Constraint | What to look at |
|---|---|
| Map before questions | `storybank.md § Coverage` exists, and every row names its source — a `jd-analysis/` extraction, or `[inferred]` |
| Story complete | open the file: STAR, stakes and an earned secret all present, and no `TODO: earned secret` |
| Nothing they did not say | every number, scope claim, name and quote is traceable to this session, to `base-resume.md`, or to the named mined source. A missing specific reads `TODO: <what to get>` — never a plausible value |
| Draft is not evidence | Status is `draft [source: <file>]` and `<file>` is a real document; it becomes `confirmed` only after the candidate answers a question about it |
| Document is not the truth | compare the story file against its source document; wherever they disagree the file should carry what the candidate said, and the source file should carry the correction |
| Nothing unruled in the base | `base-resume.md` is unchanged unless the candidate said yes to a specific line; the proposal appears in the reply as résumé wording |

## Scoring story strength — 1 to 5

Rate on the evidence actually present, not on what the story could become.

- **5** — unique, quantified, memorable; would impress any interviewer
- **4** — strong with good evidence, minor gaps
- **3** — solid but generic; others could tell a similar story
- **2** — thin evidence or a weak outcome
- **1** — barely usable; a retirement candidate

A draft is rated on what its source document says, and the rating
usually rises on confirmation, because the answer supplies what the
document could not.

## Scoring coverage

Count a `§ Coverage` competency as covered when at least one
**confirmed** story names it as its Primary Skill. A Secondary Skill
match is "workable" coverage, never full — the competency is not that
story's centrepiece. A draft never counts; name it as a draft instead.

## Scoring an improve round

Score the story against the standard stated at the start of that round —
the competency, plus "specific, owned, only you could tell it" — and
write the result into `storybank-history.md`. Two rounds in a row with no
movement is the ceiling, whatever the absolute score.

## Bars that are not ours

Interview's health heuristic (8–12 confirmed, ≥60% at 4+, in
`../../interview/references/patterns.md § The brief — construction protocol`) answers *is this bank ready to build a
brief from*. Interview's drill bar (8+ confirmed)
answers *can we run a retrieval drill*. Neither is the bank's own
destination, which is coverage of the map. Do not restate them here.
