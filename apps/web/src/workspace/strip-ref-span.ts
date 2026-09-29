// The plan item's own rendering rule (design-web-ui.md § 5.3, "The plan
// item"; a coder call, reported to the lead — the spec says the ref's
// chip "opens the viewer, as before" but says nothing about the ref's
// OWN backticked span still sitting in the visible text beside it). A
// real plan.md line can read "...so I can help you decide (`jobs.md`)":
// showing that span twice — once as raw markdown backticks in prose, once
// as the chip — puts a syntax character in front of the candidate (rule
// 18, plain voice) and doubles the same fact (rule 12). The reader
// (`readPlanBoard`/`parsePlanTodo`) is UNCHANGED: `item.text` still holds
// the line word for word, backticks included — the exact rule 11 receipt
// § 6.2 requires. This function only touches what the PLAN ITEM COMPONENT
// shows, stripping exactly the one backtick span that IS `ref` (never any
// other backtick span on the line, such as a quoted word like `keep`),
// then collapsing the double space the removal can leave.
export function stripRefSpan(text: string, ref: string | undefined): string {
  if (!ref) return text;
  const marker = "`" + ref + "`";
  const idx = text.indexOf(marker);
  if (idx === -1) return text;
  let before = text.slice(0, idx);
  let after = text.slice(idx + marker.length);
  // The fixtures' own common form, "...(`ref`)" — drop the now-empty
  // parens the removal itself leaves, not just the backtick span (an
  // empty "()" reads worse than the plain sentence without it).
  if (before.endsWith("(") && after.startsWith(")")) {
    before = before.slice(0, -1);
    after = after.slice(1);
  }
  return (before + after).replace(/[ \t]{2,}/g, " ").trim();
}
