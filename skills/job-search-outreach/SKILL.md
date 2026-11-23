---
name: Job search outreach
description: >-
  Use when finding hiring contacts, drafting LinkedIn or email notes, syncing
  Gmail for application outcomes, or preparing warm introductions.
---
# Job-search outreach

Run `python3 <apps-workspace>/lib/agent_config.py`. The workspace is `paths.search_workspace`. Contacts live in `paths.contacts/<company>.md`. The standing craft notes are `paths.outreach_playbook`, summarized in `outreach.craft`.

## Goal
Useful human paths next to the application form.
- Drafts ready for the candidate.
- The inbox reflected in the jobs database (`pipeline/update_status.py`).

Replies come from a person, not from more silent applications.

## Finding contacts
1. Start with live Applied roles and roles you are about to apply to. Also include companies of interest that have no posting, when you are using the cold-email motion.
2. Prefer the real hiring manager (head of engineering, head of forward deployed engineering, or a sales-engineering lead). At startups under about 100 people, prefer the chief executive or the chief technology officer. If you are unsure, use the chief executive. A recruiter is a backup route, not the only note. At large companies, use a named hiring manager or sales-engineering lead, and do not write the chief executive (`outreach.enterprise_targets_use_named_hm`).
3. Note mutual contacts and warm paths first. They are still the strongest. Draft notes that the candidate, or a mutual contact, can send.
4. Find an email when you can (the `first@` or `first.last@` pattern, plus a public confirmation). LinkedIn is fine when there is no email. Write your confidence in the contacts file.

## Cold-email bar
Follow the playbook. The bar is a short, specific note with one clear ask.

Do not:
- go over about 200 words
- use buzzwords
- leave out the ask
- write in vague abstractions
- fake a personal detail
- send more than 2 follow-ups

Do:
- Say who you are, why you are writing, why they should care, and make one clear ask.
- Give specific proof (numbers and named products).
- Write in a human voice.
- Add a personal line only if it is true.
- Follow up once, and at most twice.
- Build volume across many companies, rather than one perfect note.

Showing the work is optional and takes about 15 to 30 minutes: a small research note, a competitor note, a candidate list, a short video, or a note on their careers page. Attach that, then ask.

Proof lines: `python3 <apps-workspace>/lib/agent_config.py outreach-proof` prints the default lines. The text comes from claims.yaml, with each line's usage rule (for example, never merging two teams). Use a line as written, or shorten it without changing what it says. Check each draft with `python3 <apps-workspace>/tools/check_claims.py --text "…" --scope <lane>`. Do not paraphrase a claim into a different technology or a different scale.

## How a draft should sound
Short, specific, and not needy. Aim for `outreach.draft_length_words`, not a soft check-in essay. Ask for a 15-minute call or a pointer, not a resume dump. Do not put internal pipeline talk in a note someone else will read. Prefer whole words to abbreviations. Sign-offs come from `profile/profile.yaml`.

## Cadence
The weekly batch is `outreach.weekly_wave` drafts, for Applied roles that have gone quiet plus new companies of interest. Log them in contacts/, then stop for the candidate to approve sending. Pair the batch with the Gmail sync so a rejected role does not get a follow-up.

## Gmail and outcomes
Do this on daily apply-prep runs, and whenever they ask.
1. Search recent application and recruiting mail (confirmations, rejections, interviews, questionnaires).
2. Update statuses with `pipeline/update_status.py`.
   - A confirmation that they applied stays Applied.
   - Rejected.
   - Interviewing.
   - `--replied` when a person replied.
   Gmail is read-only here.
3. List action items (optional surveys, scheduling links) apart from the noise.
4. Send one digest: rejections, confirmations, interviews, and actions.

## Guardrails
Do not send the same note to a crowd. Passwords and one-time codes go through a secure form or a handoff to the candidate. Do not invent a password.
