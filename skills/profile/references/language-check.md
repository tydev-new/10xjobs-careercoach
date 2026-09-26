# Language check — the checker's contract

*(A shared contract, not profile's own technique: apply, outreach and
storybank spawn this checker; two of their scripts print this file's
path. Profile hosts it because the rule sources are its files. It moves
only with every consumer rewired in the same commit. **It is not part of
any skill's `eval.md`**: an eval.md says who checks and when; this file
is handed to the spawned checker VERBATIM as its instructions, so it
stays standalone and exact — folding it into a host's eval would put
that host's criteria inside every checker's prompt.)*

Language checking belongs to an independent checker, not to the model
that did the drafting checking its own work (goal 2's checking table).

Spawn a subagent with this file, the rule sources, and the documents. It
did not write the materials and it does not fix them. It checks and
reports. Its verdict table goes in the reply, beside the deterministic
checker's output.

## Inputs

**The documents under check** — any surface written in the candidate's
voice: a tailored résumé, a cover letter, outreach drafts, application
answers. Name each one; verdict rows use those names.

**The rule sources** — the candidate's own files, and the only
authority here. The checker's taste is not a rule.

- `base-resume.md § Claim rules` — struck never-forms, and confirm-tier
  claims
- `voice.md § Never-say list`
- for outreach drafts, `pitch.md § Messages rubric` — the ⚠ WATCH forms

One rule, `search_jargon`, takes its list from this file, not from a
candidate file, so it is always checkable.

## The rules

1. **`struck_form`** — a never-form from § Claim rules must not appear in
   any wording. Verbatim or reworded, a paraphrase making the same claim
   is the same violation. *Severity: fix-before-delivery.*
2. **`never_say`** — the never-say list in `voice.md`, held to that same
   any-wording standard. *Severity: fix-before-delivery.*
3. **`confirm_qualifier`** — a confirm-tier claim may appear only under
   the condition its own § Claim rules entry states. Each entry names its
   qualifier and where the qualifier has to sit. The same claim in other
   words, without its condition, is still a flag. *Severity:
   defend-or-qualify* — the drafting model either attaches the qualifier
   or defends the use. Silence is not a pass.
4. **`reworded_scope`** — when the document has a `## Reworded` block,
   read each `base:` / `tailored:` pair and answer one question: does the
   tailored line carry a noun, a scope, a department, a tool, a quantity,
   or a strength that the base line does not? Vaguer is legal. Stronger
   is not. The worked failure, from career-ops's own documentation:
   "collaborated with team" becomes "stakeholder management across
   engineering, operations, and business" — that invents three
   departments while changing no number, so a metric-diff script waves it
   through. *Severity: fix-before-delivery.*
5. **`watch_form`** — when `pitch.md § Messages rubric` is provided, a
   ⚠ WATCH form must not lead a draft or appear in one, in any wording.
   *Severity: fix-before-delivery.*
6. **`search_jargon`** — Ten's own labels, used as labels, must not
   appear in a document that goes to an employer or a contact: the
   tailored résumé, the cover letter, application answers, and
   outreach drafts. A story file is the candidate's own record and is
   never sent, so this rule has no row for it. The labels, in the
   forms that count:
   - evaluate's verdict tiers written as tiers — "Strong Fit",
     "Investable Stretch", "Long-Shot Stretch", "Weak Fit" in title
     case or beside a score — and a fit score beside a tier or the
     word fit ("Strong Fit — 82/100", "fit 82/100");
   - search's track name, "Track B";
   - the pipeline stage "To Review";
   - the application file's labels: a round count ("6/7 held"), a
     lens verdict — a lens name, then Pass, Revise, or Fail
     ("recruiter Revise") — an audit tier ("ATS-Ready"), and
     "DECISION" in capitals;
   - terms Ten coined, which have no everyday meaning, in any
     capitalization: "investable stretch", "long-shot stretch",
     "shown-but-unnamed", "band call", "spine role", "mandate
     sentence".

   Ordinary English is never this rule's flag, even when it shares a
   word with a label: "a strong fit for this team", "at this stage",
   "on track", "leads a team of 12", "my lane", "the decision to
   migrate", and a metric such as "scored 96/100 in the customer
   survey" all pass. When a word could be either, it is English —
   pass it. The echo exemption applies: the posting's own word,
   quoted, is not jargon. *Severity: fix-before-delivery.*

## What is not a violation

**Exemptions are part of the rules.** A correction or condition that a
rule's own entry states is legal exactly as stated. Flag only what a rule
names — a near-miss that the rule's own correction permits is a pass.

**The rules bind the candidate's voice.** A banned phrase inside an echo
of someone else's words is not the candidate saying it. Two things count
as an echo:

- a double-quoted quotation of a posting's ask or a recipient's own post;
- a **bolded requirement opener in a checklist bullet** — the tailored
  résumé pattern where the posting's requirement leads and the
  candidate's evidence follows the colon ("**4+ years as a Solutions
  Engineer:** Director of Solutions Engineering at ACCESS…"). The bolded
  span is the employer's bar, not a year-count claim about the
  candidate.

**A rule whose source is absent is not checkable — say so.** No
`voice.md` is normal for a new candidate: emit that rule's row with
verdict `pass` and why `"no voice.md — rule not checkable"`. Never invent
a rule, and never guess what the list would have said.

## Output

Return only a JSON object. No fences, no prose before or after.

{"rules": [
  {"rule": "struck_form|never_say|confirm_qualifier|reworded_scope|watch_form|search_jargon",
   "file": "<document name as given>",
   "verdict": "pass|flag",
   "severity": "fix-before-delivery|defend-or-qualify",
   "evidence": "<the EXACT span being flagged, copied from the document; empty for a pass>",
   "why": "<one short clause>"}
]}

- **One row per violation.** Two struck forms in one document are two
  rows.
- **At least one row per rule, per document it applies to** — even when
  the verdict is pass. A rule that was not checked may not be left out,
  and there is no third verdict. An absent source is a pass row whose
  `why` says so.
- Evidence is copied from the **document**, never from the rule.

## What the drafting model does with the table

**`fix-before-delivery` is a hard stop.** Fix it, re-check, then deliver.
Never deliver over one, and never merely argue with it.

**`defend-or-qualify`**: attach the stated qualifier, or defend the use
in the reply next to the table.

Show the table either way — a check that leaves no record didn't happen.

**A reply that is not the JSON table is a VOID check, not a pass.**
Re-spawn the checker once. If it fails again, say the language check
could not run, and do not deliver as though it had.
