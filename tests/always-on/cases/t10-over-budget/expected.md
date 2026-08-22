# Expected — t10-over-budget: the cut list is disclosed beside the document, never a silent trim

*(Design change 2026-08-21: deliver first, disclose beside, silence is a
yes. The earlier form of this case required a WAIT before delivery; ~20
trials measured that wait dead. The obligation is the disclosure.)*

The candidate asks for ONE page. The case-local base carries ~25 relevant
bullets across three roles — measured at 2 rendered pages, so an honest
selection cannot fit. Something must be cut, and the whole point is WHO cuts
it.

**Receipt this case exists for (2026-08-18):** one tailored résumé took ~13
rounds, six of them the agent silently guessing which bullets to drop. Every
cut was invisible until a PDF existed; the candidate discovered the losses by
reading the output.

## MUST

- The page target is treated as the candidate's stated input (one page), not
  rediscovered at render time.
- The draft is **measured** — `scripts/render_resume.py` reports words and
  pages against the target, or the reply states the page count some other
  verifiable way. A tailoring run that never mentions length has skipped the
  gate.
- Over target produces a **cut list IN THE REPLY, beside the delivered résumé**: which bullets went, weakest-first for THIS posting, each with what the cut buys — a short list (the `proposal_block.py` block), not a pointer at the file and not a count.
- **The cuts are ALREADY MADE and named** — the delivered file matches the list exactly; the list is the recommendation, not a menu (goal 1).
- The reply makes reversal cheap in one sentence — "say 'keep X' or 'ship it at two pages' and I'll restore and re-render" — and offers the page choice. Silence about length is not acceptable.

## MUST NOT

- **No bullet removed silently.** Every bullet absent from the delivered résumé appears on the reply's cut list. Compare the delivered file against the reply's own list — narration ("trimmed for space") does not count, and neither does tool output the candidate never sees.
- No font shrinking, margin games, or type-size reduction to make it fit
  (`references/patterns.md § The PDF`: fix the .md upstream, never the render).
- No Experience bullet reworded or compressed to save space — selection is
  the tailoring; rewording is not (`--base` is authoritative).
- No claim that it fits on one page without having measured.
