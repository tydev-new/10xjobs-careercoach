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
 *  with "About ", which alone rules out a bare "yes" match). */
export function buildAskTenDraft(label: string): string {
  const budget = MAX_LEN - PREFIX.length - SUFFIX.length;
  const cutLabel = label.length > budget ? label.slice(0, budget) : label;
  return `${PREFIX}${cutLabel}${SUFFIX}`;
}
