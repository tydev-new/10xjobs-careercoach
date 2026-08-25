# The build rules — domain-neutral core

*(Extracted verbatim from `../PRINCIPLES.md` Part 2. That file is the
source; `kit/tests/test_kit.py` fails if this copy drifts. A host writes
its own Part 1 — the promises to its user — and adopts this Part 2 as
is.)*

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
