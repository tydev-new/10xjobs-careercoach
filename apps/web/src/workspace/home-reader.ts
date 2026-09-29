// Home's own readers (design-web-ui.md § 5.3, "Ten's last reply" and "The
// minutes sum"): pure functions over what the frame already holds
// (`messages`, the raw chat status) or what readPlanBoard already
// returned — never a second read of the conversation or a second parser
// of plan.md (rule 12). No window/document/localStorage/Node-only API.
import { budgetMinutesPerDay, splitPlanMinutes, type PlanBoardItem, type PlanBoardSection } from "../../../../packages/agent/src/plan-board.ts";
// Transcript.tsx/ToolRun.tsx re-export these two (design-web-ui.md § 5.3:
// "groupParts' groups (Transcript.tsx:35, exported)"); imported from their
// plain-.ts homes directly so this file (and its own unit test) never
// pulls a .tsx/JSX file into the graph.
import { groupParts, type Group } from "../components/group-parts.ts";
import { summarize } from "../components/tool-run-summary.ts";
import type { AppMessage } from "../types.ts";

/** The raw value `useChat()` returns as `status` — never the derived
 *  5-state avatar Status (design-web-ui.md § 1.3), which can't tell a
 *  clean "ready" turn end from an "error" one apart (both collapse to the
 *  avatar's "done"). design-web-ui.md § 5.2 rule 1: "Pages ... receive
 *  only messages and status" — this IS that "status". */
export type ChatRawStatus = "submitted" | "streaming" | "ready" | "error";

export interface LastReply {
  quote: string;
  activityLines: string[];
}

interface TextPart {
  type: "text";
  text: string;
}

function isTextPart(part: unknown): part is TextPart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function isNonWhitespace(text: string): boolean {
  return text.trim() !== "";
}

const QUOTE_LIMIT = 280;

/** design-web-ui.md § 5.3, "The quote": trim, then cut at 280 code
 *  points — at the last whitespace at or before the 280th code point, or
 *  at the 280th code point itself when there is none — and mark the cut
 *  with "…". Code POINTS (not UTF-16 units), so an astral character never
 *  splits in half. */
export function cutQuote(raw: string): string {
  const trimmed = raw.trim();
  const cps = Array.from(trimmed);
  if (cps.length <= QUOTE_LIMIT) return trimmed;
  let cutAt = -1;
  for (let i = QUOTE_LIMIT - 1; i >= 0; i--) {
    if (/\s/.test(cps[i])) {
      cutAt = i;
      break;
    }
  }
  const kept = cutAt === -1 ? cps.slice(0, QUOTE_LIMIT) : cps.slice(0, cutAt);
  return kept.join("") + "…";
}

/** design-web-ui.md § 5.3, "The activity line": the whole collapsed
 *  "ran ..." line (§ 3) Talk to Ten would show for each tool group in
 *  this message, prefix included, in order — reusing `groupParts`
 *  (Transcript.tsx) and `summarize` (ToolRun.tsx) so the two places can
 *  never disagree about what one line says. Home adds no words of its
 *  own; a message with no tool parts contributes no line. */
export function activityLinesFor(message: AppMessage): string[] {
  const groups = groupParts(message.parts as Array<Record<string, unknown>>);
  const lines: string[] = [];
  for (const group of groups) {
    if ((group as Group).kind === "tool") {
      lines.push(`ran ${summarize((group as Extract<Group, { kind: "tool" }>).parts)}`);
    }
  }
  return lines;
}

/** design-web-ui.md § 5.3, "Ten's last reply": which message qualifies
 *  (the latest assistant message with a non-whitespace text part, when no
 *  user message comes after it), and when none does. */
export function lastReply(messages: AppMessage[], chatStatus: ChatRawStatus): LastReply | undefined {
  // "a turn is running" or "the chat status is error" — never shown
  // either way (§ 5.2 rule 4's working line takes the running case).
  if (chatStatus !== "ready") return undefined;

  let candidateIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const parts = message.parts as unknown[];
    if (parts.some((p) => isTextPart(p) && isNonWhitespace(p.text))) {
      candidateIndex = i;
      break;
    }
  }
  if (candidateIndex === -1) return undefined; // no message qualifies

  for (let j = candidateIndex + 1; j < messages.length; j++) {
    if (messages[j].role === "user") return undefined; // a user message comes after
  }

  const candidate = messages[candidateIndex];
  const parts = candidate.parts as Array<Record<string, unknown>>;
  if (parts.some((p) => p.type === "data-error")) return undefined;

  let quoteText: string | undefined;
  for (const p of parts) {
    if (isTextPart(p) && isNonWhitespace(p.text)) quoteText = p.text;
  }
  if (quoteText === undefined) return undefined;

  return { quote: cutQuote(quoteText), activityLines: activityLinesFor(candidate) };
}

// ---------------------------------------------------------------------
// The minutes sum (design-web-ui.md § 5.3, "The minutes sum"; C § 18.1).
// ---------------------------------------------------------------------

export interface MinutesSum {
  n: number; // the To do items' own minutes, summed
  m: number; // the budget's minutes per day
}

/** Shows only when To do has at least one item and no unreadable lines,
 *  every item carries minutes (C § 18.1's strict form), and the budget
 *  line gives minutes per day. No partial sum, ever (rule 8). */
export function minutesSum(toDo: PlanBoardSection | undefined, budgetLine: string | undefined): MinutesSum | undefined {
  if (!toDo || toDo.items.length === 0 || toDo.unreadable.length > 0) return undefined;
  const m = budgetMinutesPerDay(budgetLine);
  if (m === undefined) return undefined;
  let n = 0;
  for (const item of toDo.items as PlanBoardItem[]) {
    const split = splitPlanMinutes(item.text);
    if (!split) return undefined;
    n += split.minutes;
  }
  return { n, m };
}
