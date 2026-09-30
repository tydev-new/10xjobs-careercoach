// The collapsed "ran ..." line's own summary text (design-web-ui.md § 3):
// groups consecutive tool-<name> parts, repeats collapse to a count.
// Plain .ts (no JSX) — ToolRun.tsx re-exports `summarize` and
// `ToolPartLike`, so design-web-ui.md § 5.3's "the same summary text"
// still comes from one place, but Home's activity line (home-reader.ts)
// and this file's own unit test can import it without a .tsx file in the
// graph, which Node's native `--test` type-stripping can't parse.
export interface ToolPartLike {
  type: string; // "tool-<name>"
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  state?: string;
}

export function toolName(type: string): string {
  return type.startsWith("tool-") ? type.slice(5) : type;
}

export function displayName(name: string): string {
  return name.replace(/_/g, " ");
}

// Home's activity line (design-web-ui.md § 5.3, 3c) reuses this exact
// function, so the two places read one grammar.
export function summarize(parts: ToolPartLike[]): string {
  const labels: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const name = toolName(parts[i].type);
    let count = 1;
    while (i + count < parts.length && toolName(parts[i + count].type) === name) count++;
    labels.push(count > 1 ? `${displayName(name)} ×${count}` : displayName(name));
    i += count;
  }
  return labels.join(" · ");
}

/** design-web-ui.md § 5.3, "The activity line": the WHOLE collapsed line,
 *  "ran " prefix included — the one place its words are written. Talk to
 *  Ten's ToolRun and Home's activity line both show exactly this string
 *  and add no words of their own. */
export function activityLine(parts: ToolPartLike[]): string {
  return `ran ${summarize(parts)}`;
}
