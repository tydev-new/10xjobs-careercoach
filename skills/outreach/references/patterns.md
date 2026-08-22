# Outreach — the craft

Technique, not rules: how to find the right person, learn what they
care about, find who can introduce you, and write something only the
candidate could say. Rules live in `../SKILL.md`; the standard in
`eval.md`; the file shape in `schema.md`. Read the section for the
step you are on.

## Finding contacts

**Mine the JD first** — the highest-evidence source. The jd-analysis
often names the reporting line ("reports to the VP of…" — frequently
NOT the org you'd guess), partner roles, sometimes a recruiter. Also
open the posting's **LinkedIn job page** when one exists: the "Meet the
hiring team" card names the recruiter or hiring manager outright, and
its posted/reposted date is freshness intel the ATS date can miss
(2026-07-18: the card was hidden, but the page showed a repost 3 days
earlier — which changed the urgency read).

**Founders tier (startups).** At roughly ≤150 people, the founder-CEO
and the most role-relevant co-founder are legitimate targets even when
neither is the HM — founders read their own inboxes at that size, and
a senior hire is a founder-level decision. They ride INSIDE the ≤6-lead
cap and get the same evidence chain. Above that size: founders only
when the posting or evidence chain names them.

**Logged-in LinkedIn first** when the candidate's session is reachable
— it outranks every other source (2026-07-18: four web queries + TheOrg
produced a stale title and no recruiter; two logged-in searches
produced the named recruiter, their current title, and warm paths).
Read-only, always.

- The two queries that do the work: **(1)** people search filtered to
  the company + the org's role keyword ("forward deployed") — finds the
  team, its leaders, and the recruiter; **(2)** name search on a known
  lead — verifies their CURRENT self-declared title.
- Record the mutual connections shown on every result — the warm-path
  check happens for free, per lead, at find time.
- "Who does X know at this company?": the connections-of filter +
  company filter. Run connections-of WITHOUT the company filter first,
  so an empty filtered result provably means "no connections there"
  rather than "their connections aren't browsable".
- Note send mechanics per lead while you're there: follow-primary
  profiles hide Connect under the More menu; no Premium means no
  InMail.

**Search angles (priority order, ≤4 queries):** the exact
reporting-line title · named partner titles · `<company> <org> role
hiring manager` · `<company> <org> recruiter`. ≤2 widen rounds (title synonyms, drop the org token), then the
org-chart step, then present what you have.

**Evidence sources, in order:**

1. Browser first — the target's public profile and the company's
   people/team pages. Authwalled → the search snippet IS the data.
2. **TheOrg** (`theorg.com/org/<company>`) — public org charts name the
   reporting line when LinkedIn is authwalled; titles run approximate
   or stale (self-marked "Unverified"), so corroborate before ranking.
3. First-party corroboration (≤3 fetches): hire announcements, /team
   pages, conference bios.

A hiring-post poster is
the top evidence tier — they self-declare as the hiring manager; record
the post URL + date; a post older than ~3 weeks demotes to `medium`.

**Confidence per lead:** `high` = a fresh hiring post by the person,
matches the JD reporting line, or corroborated on a first-party page or
their own current profile · `medium` = consistent but uncorroborated ·
`low` = currency unverified. Drop anything both low-confidence and
evidence-thin. Departed → drop, or keep at `low` with a note. An email
pattern-guess (first.last@) may be noted, flagged unverified — the
frameworks don't need it.

**The warm-path check** — cross the candidate's own history (shared
past employers/schools in `profile.md`, prior `contacts/`, and with
their OK their email history) before ranking: warm → lukewarm (alumni
overlap, public hiring posts) → cold. A contact who can't introduce can
still vouch — record reference-value contacts as `reference`
(2026-07-18: a co-founder with zero connections at the target was
worthless as a path, decisive as a reference).

## Enrichment — recent public signals

Turn a name + title into 2–4 **personalization hooks**: things this
person has said or done recently that a message can genuinely engage
with. ~10–15 minutes per contact, capped. In value order: LinkedIn
activity (posts, articles, comments — note dates) · company /
engineering blog authorship · conference talks, podcasts, webinars
(`"<name>" <company> talk OR podcast OR conference` — a talk is the
richest hook; they chose the topic) · public X/Twitter · GitHub /
publications when relevant.

- **Identity gate** — the same-name hazard: an artifact binds to this
  lead ONLY with an identity link (it names the company/role, or its
  author URL matches the lead's profile URL). No link → a miss, never a
  maybe.
- Date every item — lead with the freshest; a 2-year-old post is
  background. Cite each item's source in the record.
- Distinguish **their words** (quotable, engageable) from **facts about
  them** (context only). The best hooks are their words.
- 2–4 solid hooks beat a dossier; stop when one genuine paragraph is
  possible. Nothing found → say so; a company-level hook from
  `company/<slug>.md` is fine, framed as company-level.

## The warm intro

**Access ladder:** logged-in LinkedIn via the candidate's browser (read
the target's mutual-connections list; ONE search pass per company, ≤5
mutual candidates, human-paced — aggressive crawling risks the
CANDIDATE's account) → candidate-assisted (they open the profile and
read you the mutuals) → inference from shared history (`profile.md`,
`base-resume.md` past companies + years, schools → *likely-overlap*,
**always labeled inferred**).

**Ranking:** strength of the candidate's relationship beats seniority
of the mutual — ask, "of these, who actually knows your work?" Then
relevance (a mutual who worked WITH the target > merely connected). One
good path beats three weak ones; a weak-tie ask can burn the option —
flag low-confidence paths instead of recommending them.

**The intro request** — double-opt-in, drafted for the candidate to
send to the MUTUAL: make declining easy ("no worries at all if this
isn't a comfortable ask") · make forwarding effortless — a
self-contained **forwardable blurb** (2–3 sentences: who the candidate
is, the one-line positioning hook, why this person/company, from
`pitch.md` + the target's hooks) · one clear, small ask (a 20-minute
conversation, not a job). Ask-size proportional to relationship depth;
refresh a cold relationship before asking; don't ask a connector with a
complicated relationship to the target.

## Channels — stats set expectations (the limits are in `eval.md § Channel limits`)

| Channel | Response/acceptance | Notes |
|---|---|---|
| Warm intro | 3–5× cold conversion | double opt-in; spends the connector's capital |
| Connection request + follow-up | ~45% accept, ~39% positive reply | highest cold-path conversion |
| LinkedIn InMail | 10–25%; under the limit = +22% response | the subject is half the open rate |
| Cold email | 3–5% baseline; top quartile 15–25% | plain text; every word over the limit costs response probability |
| Informational ask | 25–33% | never ask for a job in it; same-day thank-you |

Personalization ≈ 6× response. Hierarchy: warm intro > connection +
follow-up > personalized InMail > researched cold email > generic
(don't send generic). *"Find one thing about this person that shows you
did your homework… This is the difference between 5% and 25% response
rates."*

## The ten frameworks (slot templates)

1. **Connection request**: shared context → why them → ask to
   *connect*, not meet. Acceptance is the goal; the meeting comes later.
2. **InMail**: subject → hook (why THEM) → one-sentence positioning →
   bounded 15–20-min ask → easy-out close. Create a reason for
   conversation; don't pitch.
3. **Cold email**: hook that earns the next sentence →
   positioning (not credentials) → one bounded ask → easy out. Subject:
   specific beats clever.
4. **Warm-intro request** → § The warm intro.
5. **Informational ask**: why them → who you are → what you're honestly
   exploring → 15–20 min → easy out. Prepare 3–5 questions; same-day
   thank-you naming one takeaway you're acting on.
6. **Recruiter reply** (within 24h): genuine enthusiasm → positioning
   hook → **ask the comp range before investing time** → specific
   availability. "Generic enthusiasm is invisible."
7. **Follow-up**: reference the original → add NEW value (an article, an
   insight — never "just following up") → restate the ask in one
   sentence.
8. **Post-meeting follow-up** (same day): specific thank →
   callback to something THEY said → one takeaway you're acting on →
   reciprocal value → door open.
9. **Referral request** (only after the relationship warrants it):
   acknowledge the relationship → specific role → 2–3-sentence fit →
   "would you feel comfortable referring me?" → provide materials →
   easy out. Declined → don't push.
10. **Hiring-post response** — the poster asked; answer them within the
    post's week. DM preferred (comment only when the post invites public
    replies): reference THEIR post specifically → one-breath fit against
    the role AS THEY DESCRIBED IT → "worth 15 minutes?" → no unrequested
    attachments. Connection-request length if not connected,
    InMail-short otherwise. A 3-week-old post gets the standard cold
    framework.

**Thank-you notes** (post-interview): same day within 2–4 hours (never
past 24h); inside its limit; a **specific callback** to the conversation —
a moment, a question that sparked a thought — never a recap. Panel
names and context from `prep/<company_key>-<title_key>.md`; the
callback from the candidate's account. Multiple interviewers → separate
drafts, different callbacks, varied tone (they compare notes).

## Hooks

From `pitch.md`'s positioning + **earned secrets** (storybank, CONFIRMED
stories scored 4+, fresh for this recipient): the secret creates a
curiosity gap — the recipient wants the story behind the claim, which is
exactly the conversation the candidate wants. Enrichment hooks (their
recent post/talk) open; positioning hooks close. Blurbs get forwarded
verbatim inside target companies, so an inflated claim travels farthest
exactly where it costs most.

## Cadence

Follow-up 1 at 2–5 days (brief, new value) · FU2 at 4–7 days (briefer,
different channel) · FU3 recruiter-context only, 7+ days, final.

## When the numbers say it's not the words

Campaign phasing for a big push: warm → warm-cold (alumni) →
researched cold → nurture. An isolated candidate: suggest a peer
job-search council (3–5 seekers, weekly) — accountability beats
anxiety.

## Proposing a new pattern

When a query, a framework variant, or a hook source proves itself on
two real contacts, write it as a dated line in the contacts file's
context section — name the two leads. A pattern is never self-adopted;
a human promotes it into this file.
