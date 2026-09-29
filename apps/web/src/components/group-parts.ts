// The collapsed "ran ..." line's own grouping (design-web-ui.md § 3):
// consecutive tool-<name> parts in a message collapse into one group.
// Plain .ts (no JSX) — Transcript.tsx re-exports this, so the symbol
// design-web-ui.md § 5.3 names ("groupParts' groups, Transcript.tsx:35,
// exported") still lives there, but Home's activity line (home-reader.ts)
// and this file's own unit test can import it without pulling in React or
// a .tsx file, which Node's native `--test` type-stripping can't parse.
import type { ToolPartLike } from "./ToolRun.tsx";

export type Group =
  | { kind: "tool"; parts: ToolPartLike[] }
  | { kind: "other"; part: Record<string, unknown> };

export function groupParts(parts: Array<Record<string, unknown>>): Group[] {
  const groups: Group[] = [];
  for (const part of parts) {
    const type = part.type as string;
    if (type.startsWith("tool-")) {
      const last = groups[groups.length - 1];
      if (last && last.kind === "tool") {
        last.parts.push(part as unknown as ToolPartLike);
        continue;
      }
      groups.push({ kind: "tool", parts: [part as unknown as ToolPartLike] });
    } else {
      groups.push({ kind: "other", part });
    }
  }
  return groups;
}
