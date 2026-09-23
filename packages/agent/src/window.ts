// § 7 — "the package re-sends at most windowWords (4000) of history,
// dropping whole older turns first and always keeping the latest user
// message."
import { countWords } from "./skills/system-prompt.ts";
import type { AppMessage } from "./types.ts";

/** Every string leaf of a value, so a tool's JSON input/output is
 *  counted by its actual CONTENT — not inflated by property names,
 *  punctuation, or numbers turning into extra "words" the way a raw
 *  JSON.stringify would. This mirrors what actually reaches the model
 *  (roughly): the string values are what `convertToModelMessages` turns
 *  into real content; keys and structure aren't sent as prose. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) leaves(x, out);
  return out;
}

function messageWords(m: AppMessage): number {
  let words = 0;
  for (const part of m.parts as Array<{ type: string; text?: string }>) {
    if (part.type === "text" && typeof part.text === "string") {
      words += countWords(part.text);
    } else if ("input" in (part as any) || "output" in (part as any)) {
      words += countWords(leaves((part as any).input).join(" ")) + countWords(leaves((part as any).output).join(" "));
    }
  }
  return words;
}

/** Groups messages into whole "turns" — a user message plus every
 *  assistant message that follows it, up to the next user message. Any
 *  leading assistant-only messages (shouldn't normally happen) form their
 *  own turn so nothing is silently dropped without being counted. */
function groupIntoTurns(messages: AppMessage[]): AppMessage[][] {
  const turns: AppMessage[][] = [];
  for (const m of messages) {
    if (m.role === "user" || turns.length === 0) {
      turns.push([m]);
    } else {
      turns[turns.length - 1].push(m);
    }
  }
  return turns;
}

/**
 * Drops whole older turns until the total is at or under windowWords,
 * always keeping the latest user message (and everything in its turn).
 * Returns the kept messages in original order.
 */
export function trimHistoryToWindow(messages: AppMessage[], windowWords: number): AppMessage[] {
  const turns = groupIntoTurns(messages);
  if (turns.length === 0) return [];
  const lastTurn = turns[turns.length - 1];
  const kept: AppMessage[][] = [lastTurn];
  let total = lastTurn.reduce((sum, m) => sum + messageWords(m), 0);
  for (let i = turns.length - 2; i >= 0; i--) {
    const turnWords = turns[i].reduce((sum, m) => sum + messageWords(m), 0);
    if (total + turnWords > windowWords) break;
    kept.unshift(turns[i]);
    total += turnWords;
  }
  return kept.flat();
}
