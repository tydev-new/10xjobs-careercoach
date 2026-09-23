// § 7 — "the package re-sends at most windowWords (4000) of history,
// dropping whole older turns first and always keeping the latest user
// message." A 20-turn run whose re-sent history never passes windowWords.
import assert from "node:assert/strict";
import test from "node:test";
import { trimHistoryToWindow } from "../src/window.ts";
import { countWords } from "../src/skills/system-prompt.ts";
import type { AppMessage } from "../src/types.ts";

function turn(i: number, words = 50): AppMessage[] {
  const text = Array.from({ length: words }, (_, w) => `turn${i}word${w}`).join(" ");
  return [
    { id: `u${i}`, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } } as AppMessage,
    { id: `a${i}`, role: "assistant", parts: [{ type: "text", text: `reply ${i}` }] } as AppMessage,
  ];
}

function totalWords(messages: AppMessage[]): number {
  let total = 0;
  for (const m of messages) {
    for (const part of m.parts as any[]) {
      if (part.type === "text") total += countWords(part.text);
    }
  }
  return total;
}

test("trimHistoryToWindow: under the budget keeps everything", () => {
  const messages = [...turn(1, 10), ...turn(2, 10)];
  const kept = trimHistoryToWindow(messages, 4000);
  assert.deepEqual(kept, messages);
});

test("trimHistoryToWindow: always keeps the latest user message, even alone if it's huge", () => {
  const messages = [...turn(1, 10), [{ id: "u2", role: "user", parts: [{ type: "text", text: "x ".repeat(5000).trim() }], metadata: { origin: "typed" } }] as any].flat();
  const kept = trimHistoryToWindow(messages, 100);
  assert.ok(kept.some((m) => m.id === "u2"));
});

test("trimHistoryToWindow: drops WHOLE older turns first, never splits a turn", () => {
  const turns = [turn(1, 50), turn(2, 50), turn(3, 50)];
  const messages = turns.flat();
  const kept = trimHistoryToWindow(messages, 120); // fits only the last turn (~100 words) comfortably
  const keptIds = new Set(kept.map((m) => m.id));
  // turn 3 (the latest) is fully present
  assert.ok(keptIds.has("u3") && keptIds.has("a3"));
  // no turn is half-present: for each dropped turn, BOTH its messages are gone
  for (const t of [turns[0], turns[1]]) {
    const ids = t.map((m) => m.id);
    const present = ids.filter((id) => keptIds.has(id));
    assert.ok(present.length === 0 || present.length === ids.length, `turn split: ${present.join(",")}`);
  }
});

test("trimHistoryToWindow: a 20-turn run's kept history never passes windowWords", () => {
  const windowWords = 4000;
  let messages: AppMessage[] = [];
  for (let i = 1; i <= 20; i++) {
    messages = [...messages, ...turn(i, 80)]; // grows past 4000 words well before turn 20
    const kept = trimHistoryToWindow(messages, windowWords);
    assert.ok(totalWords(kept) <= windowWords, `turn ${i}: ${totalWords(kept)} words`);
    // still keeps the message that was JUST added
    assert.ok(kept.some((m) => m.id === `u${i}`), `turn ${i} dropped its own latest user message`);
  }
});

test("trimHistoryToWindow: preserves original order", () => {
  const messages = [...turn(1, 10), ...turn(2, 10), ...turn(3, 10)];
  const kept = trimHistoryToWindow(messages, 4000);
  assert.deepEqual(kept.map((m) => m.id), messages.map((m) => m.id));
});
