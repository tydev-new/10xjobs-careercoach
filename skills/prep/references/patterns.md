# Prep — the craft

Hints for reaching the brief in `../SKILL.md` faster; the standard is
`eval.md`, the file shape `schema.md`. Read § Getting there before
building a brief; the rest by the section you are in.

## The brief — getting there

The order that works, and what each step reuses (check before
generating anything):

| Input | Source, in order |
|---|---|
| JD + competencies + fit verdict | `jd-analysis/<company_key>-<title_key>.md` — reuse its competency extraction and 5-dimension fit verbatim; verify the JD hasn't changed |
| Company culture read | `company/<slug>.md` — apply its staleness rules; refresh via live search if stale |
| Candidate profile | `profile.md` |
| Stories | `storybank.md` + `stories/` — required for story mapping; degrade gracefully without |
| Prior rounds at this company | `prep/` + `practice-log.md` — continuation prep, not a fresh start |
| Banked real questions | `question-bank.md` (practice owns) — the sourcing ladder's top tier |
| Interviewer LinkedIn URLs | optional; live browser research when provided — URLs, not bare names: a name alone can resolve to the wrong person |

0. **Header** — `<Company> — <Role> · round: <type> · date: <date/TBD>`;
   keep it current on re-prep.
1. **Format** — § Formats below; run the Discovery Protocol for
   system-design / case / mixed. Unknown → prep for a behavioral screen
   and say "if you can find out the format, I can sharpen this
   significantly."
2. **Company read** — the company file + a targeted refresh (careers
   page values, last-6-months news — layoffs or funding change
   interview culture). "From their careers page: X", never "this
   company values X" unsourced.
3. **Interviewer intelligence** — `contacts/<company>.md` first
   (outreach's dated hooks; reuse the fresh, never present stale as
   current). For the gaps, research live when a URL is given:
   functional lens + tenure, career path (IC vs mgmt, internal-promo vs
   external-hire shapes what they value), recent posts, shared
   background (natural rapport, not manufactured), style prediction by
   seniority/function (senior eng → depth/"how"; product → "why"/
   prioritization; HR → values; execs → brevity/"so what"; peers →
   collaboration). Profile says vs you infer, every line.
4. **Evaluation criteria** — the top 3 they optimize for (JD
   competencies × format × culture).
5. **Fit + concerns** — the verdict and gap classification from the
   jd-analysis. Frameable gaps → full counter strategies (concern +
   counter + evidence); structural gaps → honest framing + what the
   candidate brings instead. `knowledge.md`: a topic at `credible`
   turns a knowledge concern into a prepared read; an open `gap` gets
   its just-in-time study plan named in the counter. Stretch/weak
   verdicts reshape the brief: concerns prioritize structural gaps;
   story mapping covers frameable ones.
6. **Storybank health** — count (target 8–12 CONFIRMED, flag <6; drafts
   reported separately and never counted), strength distribution (60%+
   at 4+), earned-secret coverage, competency gaps vs THIS role,
   overuse (use-count 3+), freshness. Report; suggest `storybank` for
   critical issues; don't block. A draft that maps as a top pick gets
   confirmed (one question) before the interview does. No storybank →
   map questions to competencies, name the gap pattern per question,
   offer to build one.
7. **Predicted questions (7–10), down the sourcing ladder** — banked
   (a match on company or format outranks everything below; prior
   rounds here go first; `rough` = top priority with a full counter) →
   researched (real searches: `"<company>" interview questions <role>`,
   the role archetype at similar-stage companies when the company is
   too small for intel; state which ran) → generated (§ Question
   patterns below; when the bank holds 3+ entries, weight by the
   candidate's cross-company competency frequency and say what drove
   it — "leadership appeared in 4 of your 5 screens").
8. **Story mapping** — § Portfolio protocol below.
9. **Questions to ask + the day-of sheet** — § The final mile below.

In chat: the day-of cheat sheet + the highest-signal highlights
(format, verdict, top 3 predicted questions with mapped stories, the #1
concern + counter); point at the file for the rest.

**Continuation prep** (prior rounds at this company): avoid stories
used in earlier rounds unless asked to go deeper; expect later rounds
to probe what earlier rounds flagged; a debrief on file is mined
("Round 1 pushed back on your team-size claim → expect Round 2 to probe
credibility on scope").

## Portfolio protocol — story mapping, not bare Q→S###

Fit levels and factor priority: `eval.md § Fit levels`.

**Portfolio protocol:**
1. Build the full candidate matrix (stories × questions, all viable fits).
2. Detect conflicts — two questions wanting the same best story.
3. Resolve: story goes to the question with the higher fit need (harder question / fewer alternatives); cascade the loser to its next-best; flag downgrades with bridging guidance.
4. Variety: no story twice in one interview unless unavoidable (then vary the leading angle).
5. Freshness: used in a prior round at this company → downgrade one fit level, flag it.
6. Overuse: use-count 3+ this search → suggest rotating; 5+ → prioritize alternatives.
7. Output: mapping table (question | primary story + fit | backup + fit | notes) + portfolio health (unique stories used, conflicts resolved, strength/freshness/overuse warnings) + gaps with patterns.

**Earned-secret tiebreak:** between equal candidates prefer the stronger earned secret; when the round explicitly prizes differentiation (bar-raiser, innovation-heavy values), treat a strong secret as +1 fit level.

**Gap-handling patterns** (prescribe per gap by NAME — the when-to-use conditions live ONCE in `../../storybank/references/patterns.md`, the authoritative copy): **Adjacent Bridge** (draw the connection from real nearby experience) · **Hypothetical with Self-Awareness** (honest "haven't done it" + approach) · **Reframe to Strength** ("here's what I bring that addresses the same need") · **Growth Narrative** (show what you've already started).
Anti-patterns: never fabricate; never stop at "I haven't done that"; don't over-explain the lack (defensive); don't hide behind "we".

## Formats — different formats need different prep

| Format | Key difference | Weight highest |
|---|---|---|
| Behavioral screen (30–45m) | Breadth: 5–8 questions, short answers, efficiency | Structure + Relevance |
| Deep behavioral (45–60m) | Depth: sustain a story through probing | Substance + Credibility |
| System design / case study | Thinking visible in real time; HIGHLY company-variable — run Discovery below; coach the communication layer, not solution correctness | Structure + Substance (credibility = process rigor) |
| Presentation round | Prepared content + Q&A poise — § Presentation rounds below | Structure + Differentiation |
| Bar raiser / culture fit | Judgment + values vs the company bar | Credibility + Differentiation |
| Hiring manager 1:1 | Fit + vision, less structured, read signals | Relevance + Differentiation |
| Panel | Multiple personas, energy management | All + stamina |
| Technical + behavioral mix | Mode-switching; varies widely — run Discovery | Substance + Structure |

## Format Discovery Protocol (system design / case / mixed formats)

These vary more across companies than any other type — never prescribe, discover. Ask one at a time: what has the recruiter said · whiteboard / take-home+present / live verbal / collaborative · duration + one problem or several · problem in advance or live · solo or collaborative · who conducts it · (mixed) technical/behavioral split — alternating or segmented, one interviewer or handoff. Candidate doesn't know → don't guess; have them ask the recruiter directly ("recruiters almost always answer this"), check Glassdoor format descriptions (directionally accurate), company eng blog. Still unknown → default to verbal walkthrough and say so. **Save discovered format details into the prep file** so mocks and drills don't re-ask. Be explicit that guidance adapts to what they've described, not insider knowledge — the transferable skills (thinking aloud, scoping, tradeoffs) hold regardless.

## The technical-format boundary — name it at the trigger

The coach's value in technical formats is **communication coaching, not domain expertise**. CAN: structure thinking-aloud, scoping/clarifying behavior (jumping to solutions unscoped is penalized everywhere and is highly coachable), narrating tradeoffs, probing-question handling, mode-switching stamina, interpersonal simulation. CANNOT: judge architecture correctness, replicate a specific company's problem complexity, score technical output, teach domain knowledge. Name the boundary at trigger points ("Is my design correct?" → "I can tell you if your reasoning was clear — for correctness, practice with a domain peer"). Don't quietly skip; say where complementary help lives.

## High-signal question patterns (for prediction — from 150+ hiring leaders, Lenny Rachitsky)

Enrich predicted questions beyond standard behavioral categories with these four themes — they can't be gamed with rehearsed answers:
- **Hard stuff**: "biggest flop — what happened, what did you do" (brutal honesty test) · "hardest thing you've done" · "challenging/ambiguous situation" (do they build structure through ambiguity) · "controversial decision" (represent both sides fairly) · "disagree with your manager" (backbone + disagree-and-commit).
- **How they think**: "what does everyone take for granted that's hogwash" (forces genuine opinion) · "unfair secret for team velocity — not something from Medium" · "worked out, but not for the reason you thought" (introspection).
- **Build/ship/impact**: "most significant accomplishment" · "a shipped product NOT cherry-picked" (frameworks, not outcomes) · "what wouldn't exist without your initiative".
- **Who they are**: "what will references say" · "you in three years" (humility) · "great day at work — what do you tell your partner" (intrinsic motivation) · "what question should I have asked you".

## Role-specific frameworks (apply when the target role matches)

**PM roles**: six assessed skills — communication, collaboration, execution, strategy, impact, product sense; ensure story coverage across all six. Ten canonical PM questions (impact/collaboration/ownership/leadership/execution walk-through/strategy/user research/vision/deadline commitment/decision-making — "biggest one-way-door decision" for senior roles). **Product sense** (Meta/Google/Stripe/OpenAI style): 5 steps — product motivation → segmentation (behavioral, not demographic) → problem identification (day-in-the-life journey; needs ≠ problems; severity × frequency) → solution development (multiple approaches, impact vs effort, concrete V1) → V1 articulation tied back to mission; baseline skill = waypointing + assumption-setting; the "leverage check" (pause: does the solution address the actual problem?). **Analytical/metrics**: assumptions + game plan → product rationale → metric framework (ecosystem players, "what's in it for me", North Star Metric + guardrails; a valid NSM = single query, specific timeframe, grows indefinitely, never a ratio/average) → goal-setting (one player, journey backward from NSM, decide without hedging) → tradeoff evaluation (name the crux, decide, say what would change your mind). Differentiator: "a cohesive story about healthy growth", ecosystem-first.

**First rounds / phone screens — MVIP** (Erika Gemzer): (1) **JD mirroring** — two-column table mapping their language to your experience; use THEIR words in the interview. (2) **Memory lane, not question bank** — know 3–5 recent projects in complete detail rather than shallow answers to 100 questions ("overload… can cause you to freeze"). (3) **STAR++** — STAR plus what you learned and how you evolved. (4) Recognize the three question formats: behavioral (~70%), theoretical (~20%), situational (~10%). (5) 45-min budget: 3–5 intros / ~35 their questions / 5–7 YOUR questions — "interviews are often won or lost by the questions you ask at the end."

**Meta-rule**: practice beats study. Push toward the `practice` skill early — don't let the candidate endlessly prepare in theory.

## The final mile

### Questions to ask (5 per round)

**"Questions are strategic tools, not afterthoughts."** Each of the 5 must serve at least one purpose: information gathering · concern mitigation (indirectly demonstrating a strength that addresses a known concern) · differentiation · rapport. For each: the question, its strategic purpose, which round/interviewer it's for, the likely reversal ("they may ask it back"), and a prepared 1–2 sentence response to that reversal.

**Adapt to the round**: recruiter screen (logistics, role clarity — save the strategic ammunition) · hiring manager (team dynamics, priorities) · final/exec (direction, strategic bets) · peer ("what do you wish you'd known before joining?"). Signature move for hiring managers: **reverse a high-signal interviewer question** — ask *"What's the most recent thing that didn't go as planned on the team, and how did the team handle it?"* — conversational symmetry plus a real culture read.

**Avoid** (and say why): answerable from the website/JD · benefits/perks in early rounds · insecurity-revealing ("do you think I'm qualified?") · generic-to-any-company · interviewer-on-the-spot ("what's the worst thing about working here?").

### Concern anticipation

Sequence: ask the candidate what concerns THEY expect → validate the real ones → **generate the rest from real data, never a vacuum** (profile gaps, short tenures, domain switches, seniority mismatch vs this JD, storybank competency holes, weak practice dimensions, narrative transitions needing explanation; a concern already disproven in other loops is weakened — the same concern behind 2+ rejections is confirmed, escalate it) → rank (`eval.md § Concern ranks`).

For every Significant+ concern, prepare **three framings**: the direct question ("why did you leave after 8 months?"), the subtle probe ("tell me about a time things didn't work out" as a proxy), and the follow-up challenge ("but wouldn't that be a risk here too?") — plus the best supporting story. Script the hard moments in **exact words**, not strategy (Alisa Cohn): observable fact + the lesson + forward momentum; don't over-explain; *"I understand that looks unusual on paper. Here's what actually happened, and here's what I learned."* Offer a 3-round mini-drill on the top concern (direct → probe → challenge).

### Day-of confidence (the morning-of session)

Built from **real coaching data, never generic encouragement**. No practice data yet → say so, ground in profile/storybank strengths instead, and note the reel improves once practice history exists.

**Read the candidate's state first** and adapt: confident-but-underprepared (skip the emotion — tactical, direct about gaps) · anxious-about-a-specific-failure (counter the fear with evidence: "8 stories, 5 rated 4+ — you will not freeze") · generalized anxiety (lead with the physical toolkit; reframe anxiety as excitement — physiologically near-identical; *"strive for connection over perfection by daring to be dull"*) · post-rejection (acknowledge it directly; each interview is an experiment you can't fail) · impostor syndrome (evidence audit; the feeling itself signals you're operating above your comfort zone; check sleep).

**The session** (10 minutes, from the brief file):
1. **60-second hype reel** — 4 lines, each grounded in evidence (a real score trend, a strength-5 story, a landed outcome).
2. **Pre-mortem** (high-stakes rounds or on request; otherwise keep it pure boost): the 2–3 likeliest failure modes from the candidate's real patterns, each with a prevention cue — closing with *"You know these risks. Now set them aside and go execute."* Purpose: move failure anxiety from subconscious freeze to conscious action.
3. **Pre-call 3×3** — top 3 concerns + one-line counters, top 3 questions to ask (from the brief — never regenerate); the sheet closes with THE one best question for this interviewer, and — when `negotiation/<company>.md` records a stated number — "already stated $X to <who> on <date>: stay consistent."
4. **One focus cue** for this round.
5. **Warm-up** (stop studying 60–90 minutes before the interview — the last hour adds noise, not signal): read the reel aloud; platform check (video: camera/lighting/background · phone: quiet space + signal); format-specific rep (behavioral: weakest story 60s aloud · presentation: the opening 30s · system design: scope a problem aloud); physical reset; the "I'm also interviewing them" reframe; decide who you are before walking in.

**State toolkit** (pick by profile and time): physiological sigh (two nasal inhales, long exhale — invisible mid-interview) · 4-4-8 breathing (exhale double the inhale) · peripheral-vision softening (usable live) · practice daily for a week beforehand so it's automatic. Meta-goal: **show up with a low heart rate** — calm projects competence.

**Contingencies to rehearse**: bombing an answer (acknowledge, pivot, re-engage — don't spiral) · a question with no story (Adjacent Bridge, out loud once) · back-to-back rounds (5-minute reset, no note review — fresh energy for a fresh audience; but interviewers DO compare notes: comp, timeline, and what-excites-you answers must match across slots).

## Presentation rounds (system design reviews, business cases, portfolio reviews, 90-day plans, demos)

### What evaluators assess

Communication clarity · structured thinking · audience calibration · **time management (going over time is the #1 presentation-round failure mode)** · depth-vs-breadth judgment · Q&A handling · confidence. Coach *process confidence* (trusting preparation — reads natural) over *performance confidence* (acting — reads rehearsed).

### Narrative arcs — map audience to arc; strengthen the candidate's structure before replacing it

**SCR** (situation–complication–resolution: versatile default) · **PARL** (problem–analysis–recommendation–limitations: technical/analytical) · **CCOR** (context–choices–outcome–recommendation: business case) · **HBDL** (headline first — executives decide in the first 30 seconds) · **Duarte's What Is / What Could Be / New Bliss** (alternate reality→possibility to build longing; **the audience is the hero, you're the mentor**) · **Raskin's Strategic Narrative** (name the shift → stakes → the new game → obstacles → your "magic gifts" — replaces the arrogant problem→my-solution→why-mine's-better arc).

### Quantitative rubrics

130–150 wpm (15 min ≈ 2,000–2,250 words; timing check = word count ÷ 140 + 10% pauses) · 1–2 min per content slide · time allocation: context 10–15%, core 40–55%, conclusion 10–15%, **Q&A 25–40% of total** (the classic under-allocation — if the deck fills >75% of the slot, restructure) · slides: one slide one point; title = the takeaway, not a label; one "star moment"; no slides → sketch the whiteboard skeleton.

### Q&A — often weighted MORE than the deck

It tests real understanding vs rehearsal. Predict **10 questions** from: content gaps, controversial choices, depth probes, "what about X" adjacencies, process questions, stress tests — each with why-they'll-ask, answer strategy, and an if-you-don't-know plan. Principles: pause 2–3s; answer the question asked; 30–60s answers; "great question" is a crutch; **"I don't know, but here's how I'd find out" beats fabricating.** Practice 3 unexpected questions at the same energy and pace as the prepared remarks.

### Coaching sequence

1. **Context assembly** — the prompt's exact wording, audience (seniority/function/size), time limit + expected Q&A split, existing material, any company guidance. Know the presentation type's trap (system design: solutioning before constraints; data: missing the "so what"; case: uniform depth).
2. **Arc selection** with rationale.
3. **Content structuring** — per-section time %, cut-first priorities, drafted transitions.
4. **Opening/closing** — the opening must, in <30 seconds: establish why this matters to THIS audience, open a curiosity gap, signal the structure. The closing: THE insight + a direct recommendation, landed with energy — never a trailing "so… that's it."
5. **Q&A prep** — the 10-question table.
6. **Timing calibration**; for high-stakes rounds add constraint versions (5/10/15-minute cuts) and the **irreducible core** — "the 3–5 sentences that must survive at ANY length; the presentation's DNA."
7. **Challenge pass** (on request / high-stakes): assumption audit; blind spots (typically underestimating audience knowledge and overestimating interest in your process); devil's advocate; the single highest-leverage fix.

### Common mistakes to check

Common mistakes to check: starting with background instead of the punchline, too much content, reading slides, no "so what", unpracticed transitions, uniform depth everywhere.

## Proposing a new pattern

When a question pattern, a format read, or a concern framing proves
itself across two real rounds, write it as a dated line at the end of
the brief it came from — name the two rounds. A pattern is never self-adopted; a human promotes it into this file.
