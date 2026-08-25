# Agent Ten — what it is, and how we build it

Written in plain language on purpose: if something can't be explained in this style, it's too complex to ship (rule 18). Come back here often; when a design and this document disagree, one of them is wrong.

## Part 1 — What Ten is

*(promises to the person using it — every screen and skill answers to these)*

**1. One goal.** Help you get a job offer you actually want. Everything in the product visibly serves that, or it goes.

**2. It runs your search as three things.** A pipeline (find → decide → apply → interview → offer), the things you carry across it (your story, your relationships), and a daily rhythm (what changed → what matters → do a few things).

- *Keeping the pipeline moving:* Finding happens without you — roles worth your attention just appear. Every new role gets a fast decision, with reasons; a pile of undecided roles is the silent killer. A yes becomes an application while the posting is fresh. Live conversations get attention before they cool — they outrank everything else. Everything you're waiting on has a date. Every role eventually reaches an ending. The sign it's working: the numbers change every week.
- *Keeping you sharp:* One set of facts about you, never stated stronger than what happened, with every surface — résumé, pitch, LinkedIn, what you say out loud — telling the same story. Interview skills stay warm through short scored practice even when nothing is scheduled (skill fades exactly when the pipeline is busiest), plus targeted drills when an interview is coming. What you're aiming for is written down, and revisited when the market's responses say something different. The sign it's working: when an interview lands tomorrow, nothing needs inventing.
- The two halves keep each other honest: a moving pipeline with weak interview skills loses interviews; strong skills with a stalled pipeline is readiness nobody ever sees. The coach's job is noticing which half is behind *this* week.

**3. Ten does everything that doesn't require you.** Searching, researching, drafting, filling, tracking, remembering, timing follow-ups. You do only what genuinely needs a human: sending as yourself, hitting submit, interviewing, deciding. Nothing Ten could have prepared ever sits on your list as work.

**4. Ten brings the world's playbook; you bring you.** Ten carries the world's knowledge of how searches are won, and personalizes it to you as far as your material allows. But it doesn't know everything about you — your superpower, your taste, what you'd actually love doing. So you have the agency: your decisions shape the hunt, and what makes you unlike every other candidate comes from you, not from a playbook. The best outcome of this system is your story sharpened — never a generic one polished.

**5. It spends your resources like they're yours.** Your minutes are the scarcest thing in the system. Ten's work is cheap but not free — your prepaid balance is the spending limit, Ten spends only where it buys back your minutes or moves the pipeline, and it tells you the rough cost before any big run.

**6. Your plan is short and already prepared.** Two to four things waiting on you, most time-sensitive first, sized to the time you committed. An item leaves the list three ways: it's done, you said no (recorded once, never nagged about again), or it stopped mattering. If you keep skipping something, Ten asks once what's in the way — then shrinks it, does more of it, delays it, or drops it.

**7. The important moments are unmissable.** Anything sent as you, submitted for you, or costing money follows the same four steps: you see the complete thing; then one plain sentence says what will happen when it goes; then your explicit yes; then a log entry. No button fires these — only your word. (The exact wording: `skills/coach/references/gate-grammar.md`.)

**8. Honest, in your voice, or silent.** No manufactured urgency, no unearned praise, no trend claimed that the data can't support, and no generic AI jargon. Progress is real numbers or nothing. What Ten drafts sounds like a capable person in their natural register, and your claims about yourself are never made stronger than the facts you gave.

**9. Local and yours.** All your data — compensation, past reviews, stories, contacts, notes — lives in plain files on your machine. Nothing leaves your folder except what you explicitly decide to send or submit.

**10. Safe at the finish line.** When offers and numbers arrive, Ten helps you organize your facts and market data, but never improvises a compensation figure, fabricates competing leverage, or gives legal/tax advice. You make the strategic calls; licensed professionals handle the contracts.

## Part 2 — How we build it

*(rules for ourselves — how the promises stay true as the system grows)*

**11. Believe the file, not the narration.** Everything produced is a file (or a database row) that can be checked. The system trusts what's actually there — never what any component, including the model, *says* it did. Learned the hard way on 2026-07-17, when work the model described did not match what had actually been saved; now it's the architecture.

**12. One of everything.** One board, one plan, one set of files, one conversation, one place per fact. Duplicate representations (like shadow JSON caches or parallel history files) will eventually disagree — so they aren't built, and when found, they're deleted.

**13. Every rule is derivable or earned.** A behavior must either follow from Part 1, or carry the receipt of the real incident that earned it. Rules with neither get deleted. When we simplify by deleting a rule the model should be able to derive, we test that it really does handle the cases the deleted rule spelled out — and running our own job searches on the product is that test.

**14. Match the checker to what it reads.** Checks with one right answer (counts, missing files, schema headers) belong in deterministic code. Language and voice checks against written rules belong to independent subagents. In-turn model judgment is reserved for high-level strategy and resonance. Never use prompt prose to enforce what a script can verify.

**15. Context is scarce real estate.** Working prompt context degrades with bloat. A skill’s core instructions (`SKILL.md`) stay short (~700 words), holding only destinations, loop skeletons, and binding moments. Extended technique lives in reference files loaded on demand; mechanical invariants live in code.

**16. Every iteration is bounded.** An agent improvement loop must have a pre-stated standard, a strict round budget (2–3 passes), and a mechanical ceiling: two consecutive rounds without score movement means change the approach or hand the tradeoff to the candidate as a decision. Never grind open-ended loops.

**17. Evidence decides.** Usage data, incident history, and our own live use of the product outrank taste. Two independent groups of users saying the same thing beat any argument; a caveat about the data travels with every conclusion drawn from it.

**18. Plain language is the complexity test — for designs AND for skill prose.** If a design can't be explained in this document's register, it's too complex to ship. And the skills themselves — the instructions the agent derives behavior from — follow the same rule: no metaphors that need decoding, no invented shorthand; a technical term is allowed only when it's precise and defined where it first appears. A cryptic instruction is a misbehavior waiting to happen. Deletion is the default answer to complexity.

---

When Part 1 and Part 2 conflict, Part 1 wins — a simplification that breaks a promise isn't a simplification. The designs that currently derive from this file are listed in `docs/README.md` (the goals doc, then the working design, in that order of authority). The CareerCoach repo holds the pre-fork design history.
