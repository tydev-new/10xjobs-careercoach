// "Ask Ten about this" (design-web-ui.md § 5.4): "opens Talk to Ten and
// puts a draft in the composer: `About <label>: `, where <label> is
// 'Company — Title' for a role, or the path for a file. The draft is one
// line, capped at 120 characters (a longer label is cut to fit)."
// Pure — no window/document/localStorage/Node-only API.
const PREFIX = "About ";
const SUFFIX = ": ";
const MAX_LEN = 120;

/** Builds the exact draft string for a given label (a file's path, or a
 *  role's "Company — Title"). Only the LABEL is cut when the whole line
 *  would exceed 120 characters — "About " and ": " always stay whole, so
 *  the draft is never mistaken for the gate's own exact `yes` (proved by
 *  `matchGateReply`, agent-helpers.test.ts pattern; every draft starts
 *  with "About ", which alone rules out a bare "yes" match).
 *
 *  N4 (Stage 3a review): the cut is by CODE POINT, never by raw UTF-16
 *  index. A label with a character outside the BMP (an emoji in an
 *  uploaded file's own name) is two UTF-16 units; `.slice()` on a plain
 *  index can land between them, leaving a lone surrogate — not valid
 *  text, and not what a candidate typed. `for...of` walks whole code
 *  points one at a time; each is added to the cut only as a whole unit,
 *  so the running UTF-16-unit count (still what the 120-character budget
 *  counts, unchanged) never stops mid-pair. */
export function buildAskTenDraft(label: string): string {
  const budget = MAX_LEN - PREFIX.length - SUFFIX.length;
  let cutLabel = label;
  if (label.length > budget) {
    let units = 0;
    let end = 0;
    for (const codePoint of label) {
      const nextUnits = units + codePoint.length;
      if (nextUnits > budget) break;
      units = nextUnits;
      end += codePoint.length;
    }
    cutLabel = label.slice(0, end);
  }
  return `${PREFIX}${cutLabel}${SUFFIX}`;
}
