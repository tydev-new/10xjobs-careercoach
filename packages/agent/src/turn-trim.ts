// § 12.1 — "a turn that grows too large" (design-web-agent.md, amended
// 2026-09-24). Trims the CURRENT turn's own steps, in place inside a
// `prepareStep` callback wired onto both `streamText` calls (the first and
// § 9.2's continuation, coach.ts).
//
// Measure: UTF-8 bytes of `JSON.stringify(messages)`. Trigger: over 160,000.
// Target: down to 120,000. What: this turn's OWN steps (an assistant
// message plus its tool message), oldest first, except the last 2 — never
// the system prompt (not part of `messages` at all — it's `streamText`'s
// own `system` option), never a user-role message, never text the model
// wrote, never an earlier turn. "This turn" starts at `turnStartIndex`
// (the length of the first call's own `messages` — the windowed history
// plus the candidate's latest message — identical on both calls: the
// continuation's own messages are built by PREFIXING that exact array,
// coach.ts's `buildContinuationMessages`), so everything before it is
// off-limits by construction, with no need to inspect message content to
// find the boundary.
//
// Fix round 2 (lead ruling, NIT 7): the stub, its 2,000-character
// threshold, and the recursive walker are § 11.3's — owned by
// conversation.ts — and shared with § 12.1 here, not re-implemented. No
// import cycle: conversation.ts imports only from types.ts.
import { stubFor, stubLongStrings } from "./conversation.ts";
// Re-exported: existing callers (this package's own turn-trim tests, and
// the independent tester's tests/agent/conversation-save.test.ts) import
// `stubFor` from THIS file's path — kept working unchanged, even though
// the implementation now lives in conversation.ts alone.
export { stubFor };

export const TRIM_TRIGGER_BYTES = 160_000;
export const TRIM_TARGET_BYTES = 120_000;

/** UTF-8 byte length of `JSON.stringify(value)` — the same measure the
 *  proxy's own 256 KB check tracks (§ 12.1). */
export function messagesByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

interface StepGroup {
  /** Indices into `messages` belonging to this one step: an assistant
   *  message, plus any tool-role message(s) immediately following it. */
  indices: number[];
}

/** Groups `messages[turnStartIndex..]` into steps. A user-role message
 *  (§ 9.2's continuation note, the only kind that can appear here — the
 *  candidate's OWN latest message is always before `turnStartIndex`) is
 *  never touched and never part of a group — it's skipped over, kept in
 *  place. */
function identifyStepGroups(messages: readonly unknown[], turnStartIndex: number): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = turnStartIndex;
  while (i < messages.length) {
    const m = messages[i] as { role?: string } | undefined;
    if (!m || m.role === "user") {
      i++;
      continue;
    }
    if (m.role === "assistant") {
      const indices = [i];
      let j = i + 1;
      while ((messages[j] as { role?: string } | undefined)?.role === "tool") {
        indices.push(j);
        j++;
      }
      groups.push({ indices });
      i = j;
      continue;
    }
    // An orphan tool-role message (shouldn't occur — every tool message
    // this package builds directly follows an assistant message) is still
    // its own group, never silently skipped.
    groups.push({ indices: [i] });
    i++;
  }
  return groups;
}

/** Stubs long strings inside one step's tool-call `input`s and tool-result
 *  `output`s only — never a `text`/`reasoning` part (the model's own
 *  prose, never touched). Returns a new `messages` array when anything
 *  changed, else the same reference. */
function stubGroup(messages: readonly unknown[], indices: readonly number[]): { messages: unknown[]; changed: boolean } {
  let anyChanged = false;
  const next = messages.slice();
  for (const idx of indices) {
    const msg = next[idx] as { content?: unknown } | undefined;
    if (!msg || !Array.isArray(msg.content)) continue;
    let msgChanged = false;
    const newContent = (msg.content as Array<Record<string, unknown>>).map((part) => {
      if (part?.type === "tool-call") {
        const r = stubLongStrings(part.input);
        if (r.changed) {
          msgChanged = true;
          return { ...part, input: r.value };
        }
        return part;
      }
      if (part?.type === "tool-result") {
        const r = stubLongStrings(part.output);
        if (r.changed) {
          msgChanged = true;
          return { ...part, output: r.value };
        }
        return part;
      }
      return part; // text, reasoning, ... — the model's own words, never touched.
    });
    if (msgChanged) {
      next[idx] = { ...msg, content: newContent };
      anyChanged = true;
    }
  }
  return { messages: next, changed: anyChanged };
}

/**
 * § 12.1: called from `prepareStep` on both calls. `messages` is the
 * step's own `Array<ModelMessage>` (the SDK's `prepareStep` argument);
 * `turnStartIndex` marks where "this turn's steps" begin (see the header
 * comment above — the same value on both calls).
 *
 * Under the 160,000-byte trigger: no change (`trimmed: false` — the caller
 * returns `{}`, no `messages` override, so the prompt cache stays warm).
 * Over it: stubs this turn's own steps, OLDEST first, skipping the last 2
 * groups (never touched — "the next step most likely needs" them), one
 * step at a time, re-measuring after each, stopping as soon as the total
 * is at or under 120,000. If the never-touched remainder (everything
 * before `turnStartIndex`, a user-role message, and the last 2 groups)
 * alone is still over budget once every eligible step is stubbed, the
 * result is returned as-is — "the request goes as it is" (§ 12.2 handles
 * the proxy's refusal, not this function).
 */
export function trimTurnStepsForBudget(
  messages: readonly unknown[],
  turnStartIndex: number,
): { messages: unknown[]; trimmed: boolean } {
  const mutable = messages as unknown[];
  if (messagesByteLength(mutable) <= TRIM_TRIGGER_BYTES) {
    return { messages: mutable, trimmed: false };
  }
  const groups = identifyStepGroups(mutable, turnStartIndex);
  const eligible = groups.slice(0, Math.max(0, groups.length - 2));

  let current = mutable;
  let trimmed = false;
  for (const group of eligible) {
    const result = stubGroup(current, group.indices);
    if (result.changed) {
      current = result.messages;
      trimmed = true;
    }
    if (messagesByteLength(current) <= TRIM_TARGET_BYTES) break;
  }
  return { messages: current, trimmed };
}
