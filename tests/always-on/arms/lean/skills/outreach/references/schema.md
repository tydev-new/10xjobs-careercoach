# Outreach — the file shape

One file, `contacts/<company>.md`, read by five others: the coach's
funnel (status by channel), prep (interviewer intelligence if a lead
lands on a panel), apply (the outreach plan), the checker script, and
the harness judge. Its shape is declared here, not remembered.
`scripts/check_messages.py` is the authority on how a draft is laid out:
**each draft is a blockquote group** (lines starting `>`; blank lines
don't split it), and FAILs scope to the drafts — the rest of the file
legitimately quotes third parties.

## `contacts/<company>.md`

One entry per lead, then the warm paths, then the send log.

- **Per lead** — name · title · role-relationship to the target job
  (`reporting line` / `partner` / `recruiter` / `founder` /
  `reference`) · evidence chain (JD quote → corroborating page →
  currency check) · confidence: `high` / `medium` / `low` ·
  **send channel + fallback** (`connect request` / `InMail` /
  `evidenced email` / `X DM`) — REQUIRED, resolved at find time, never
  assumed at draft time · warm-path note · enrichment hooks, each with
  source + date, and a one-line "best hook" · outreach status.
- **The warm-path pin** — the candidate's one-time answer on the named
  mutuals ("cold path chosen" / the connector's name).
- **Warm paths** — path type `verified mutual` / `inferred overlap`;
  status `drafted` / `sent-by-candidate` / `intro-made` / `declined`.
- **Drafts** — a blockquote group per draft, each followed by its
  **written rubric line**:
  `rubric: specificity ✓ · brevity ✓ · ask ✓ · value ✓ · voice ✓` — an
  unmet item shows ✗ with the tradeoff. A draft written while
  enrichment was blocked is marked `PROVISIONAL: missing <input>`.
- **Send log** — every send and outcome, DATED; status enum
  `drafted` / `sent <date> <channel>` / `replied <date>` /
  `no-response` / `closed`. The enum IS the response-rate denominator.
- **Context** — org-structure facts surfaced along the way (reporting
  layers, named leaders, team geography); they feed prep and the
  reporting-line unknowns, not just the message.

## What this skill reads but never writes

`pitch.md § Messages rubric` — the pinned rubric that decides which
claims lead (PRIMARY opens, ⚠ WATCH never hooks); the script WARNs on
an unpinned rubric.
`base-resume.md` + its § Claim rules — every credential claim in a
message or forwardable blurb traces there. `prep/<company_key>-<title_key>.md`
— panel names and interview context for thank-you notes.
