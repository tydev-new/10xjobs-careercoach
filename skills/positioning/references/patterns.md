# Positioning — patterns that get you there faster

Guides, not rules. The criteria in `eval.md` decide when you are done;
these are what tends to work on the way.

## Hook theory — why pitches work or die

- **10-20-30 rule**: 10 seconds earn 20 more; 30 seconds earn the
  conversation. Credentials don't create curiosity.
- **Curiosity gap**: attention opens between known and want-to-know.
  *"'I help growth-stage companies stop losing their best engineers'
  creates a gap. 'I'm a VP of Engineering with 15 years of experience'
  closes it."*
- **Stories beat statistics**: ~63% remember stories, ~5% remember
  statistics — a micro-story beats a capability list.
- **Primacy**: a third of hiring managers decide within 90 seconds. The
  opening line IS the pitch.
- **The "arrogant doctor" anti-pattern** (Raskin): never problem → my
  solution → why I'm better. Lead with the shift: *"The old game was
  [X], the new game is [Y], and my career has been about [Y]."*
- **The real competition is "no decision"** (Dunford) — an insight-led
  pitch gives the listener a reason to act, not just approve.
- Delivery: ownership, not recital — it must survive eye contact and
  pace changes; connection over perfection.

## The three layers

1. **Hook** (10s): the curiosity gap.
2. **Context** (+10–20s): the evidence — a micro-story, a metric, an
   earned secret.
3. **Bridge** (+10–20s): connects to the specific role, company, ask.

Iterate each layer with the candidate: "Does this sound like you?"

## Mining — what feeds the pitch, in order

1. **The base résumé.** No base → route to profile to capture one.
2. **The profile** — role, band, targets.
3. **The storybank** — earned secrets from CONFIRMED stories rated 3+.
4. **Narrative-identity themes** — the sharpest edge is the pitch's
   spine.
5. **The existing résumé summary and LinkedIn text**, as consistency
   inputs.
6. **Interview-performance signals**, when they exist — how did the last
   TMAY actually land? Practice's debriefs hold that.

No `voice.md` → ask for ONE real writing sample, routed to profile to
capture; declined → draft anyway and FLAG that voice is uncalibrated.
No storybank, or the offer to build one declined → mine `base-resume.md`
claims directly and SAY the pitch is weaker for it.

**When raw material is thin**, extract with three questions, one at a
time: "What do you do that other [role] candidates at your level don't?"
· who's the audience · "so what does that get them?"

## Deriving and pinning the Messages rubric

No rubric pinned in `pitch.md` → derive it from workspace state and
**render the proposed table IN THE REPLY** for one confirm/edit round —
never route the confirm through file-editing homework; the candidate may
answer in chat OR by editing the file (living files are theirs — re-read
before every touch) — then pin. Never pinned and another skill needs
it → that skill shows the table and asks THEN (the resurface rule).
Present → preserve it verbatim on every rewrite.

## Reading the LinkedIn profile — the input ladder

1. **Live browser first**: open the candidate's public profile URL and
   read it directly — it beats the PDF-export path, which omits the
   banner and the pinned-skill order. Capture: headline · current title+company · skills
   list, pinned top-3, ordering · About · per-role descriptions ·
   photo/banner · Featured · recommendations count/sources · custom URL ·
   Open-to-Work state.
2. **Authwall or partial render** → ask the candidate to open their own
   profile in the shared browser, or paste sections, or upload the PDF
   export. Say plainly which sections you could and couldn't see.
3. **A section absent from the rendered page is UNSEEN, never
   "missing"** (earned 2026-07-19 — the server can omit whole sections
   from this surface while the candidate's own browser shows them). The definitive check before giving up:
   search the raw source (`document.documentElement.innerHTML`) for a
   phrase the section would contain — absent there too means no
   technique recovers it; fall back to paste or the
   complete PDF export (More → Save to PDF).

Lazy-loaded sections (skills, recommendations, Featured): scroll or
click into each before reporting.

## LinkedIn — where the effort goes

Recruiter search mechanics, top-down:

1. **Headline** — highest keyword weight, first thing seen, 220 chars.
2. **Current title** — second-highest search weight (fix "Ninja"-type
   titles with a searchable equivalent).
3. **Skills** — the ONLY filterable field in Recruiter search; top-3
   pinned; order by target-role relevance; ~10 recommended.
4. Experience descriptions (full-text searched in full Recruiter only) ·
   5. About (searched, lower weight) · 6. Photo+banner · 7. Open to
   Work · 8. Featured · 9. Recommendations · 10. custom URL.

Recruiter Lite matches title+headline+skills only — the top three ARE
discoverability. Algorithm facts: comments ≈ 15× likes; document
carousels 3–6× engagement; external links ≈ −60% reach; the first 60–90
minutes decide a post's distribution.

## Auditing each section — rewrites, not flags

- **Headline**: keywords + differentiation + seniority signal; must echo
  the pitch's positioning.
- **Title**: searchable.
- **Skills**: pinned top-3, target-ordered, top-10 list.
- **About**: first 3 lines are above the fold — the hook (align with the
  ~300-char LinkedIn variant); natural keywords; narrative over list; an
  earned secret; shape = what I do + what makes me different + what I'm
  seeking.
- **Experience**: accomplishment-oriented, quantified, recent 2–3 roles
  fleshed out. The most recent role's description is a full content
  surface. Draft it in three passes — generate, critique, revise — in **LinkedIn surface-mode**:
  - first person is allowed;
  - prose plus short labeled bullets, at most 3 sub-points per group;
  - the product is framed in third person — the readers are recruiters,
    not its users;
  - the résumé's 2-line cap does not apply;
  - vendor names go in one stack line; the bullets carry decisions and
    outcomes;
  - the altitude is the architectural bet and its result, not lifecycle
    mechanics.

  Expect the candidate's own iteration to beat generated drafts — the
  three-pass pipeline's job is angles, critique, and the grounding gate
  (every claim traced to the base before it ships).
- **Photo/banner** · **Featured** (2–3 concrete artifacts from the
  storybank) · **Recommendations** (3+ baseline; who to ask and how) ·
  **URL / completeness / Open-to-Work**.

Audit depths: Quick (headline+title+skills+About, top-3 fixes) ·
Standard (all sections + content-strategy overview) · Deep (+ the
positioning-consistency check with per-surface rewrites, + the
challenge pass).

## Content strategy — timeline-gated

Interviews ≤2 weeks out → **skip entirely and say why**; prep beats posting. 2–6
weeks → at most 1 post/week. 6+ weeks → 2–3/week: insight posts from
earned secrets, document carousels, thoughtful commentary; **comments on
target-company posts beat original posting**; never "excited to
announce," external links in the post body, or desperation signals.
Deliver 3 concrete post ideas mined from the storybank.

## LinkedIn editor mechanics — hard-won; verify, don't assume

- Programmatic fills **flatten paragraph breaks** in the
  About/description editors — after any fill, verify the newline count;
  restore via DOM injection + input event. Never save a wall of text.
- **Modal state is volatile** — navigation or a pane resize wipes an
  unsaved form. Stage, verify, save in one pass; re-read the form before Save if anything intervened.
- **Company must be selected from the typeahead** (logo row) — plain
  text does NOT bind the company page even spelled identically.
- Keep **"Notify network" OFF** for discreet searches — check it every
  modal; it defaults on in some flows.
- The experience form embeds its own **Profile headline** field — leave
  it untouched, or it silently overwrites the curated headline.
- After every save: confirm the toast AND read the live section back.
  The save gate (stage → candidate approves → save → verify) is
  per-change; approval for one never extends to the next.

## Antipatterns

- Auditing the first search hit instead of running the identity gate — a
  well-rendered wrong profile passes every downstream check.
- A polished pitch in coach-speak — their words beat polished
  coach-speak, and the pitch is the most analogy-tempted artifact in the
  system.

## Proposing a new pattern

If a round shows something works, say so with the evidence from
`pitch-history.md` and let the candidate or the builder decide. A
pattern is never self-adopted; a proposed one lands in the candidate's
workspace, not in this file.
