// § 11 — Keeping the conversation between sign-ins (docs/design-web-agent.md
// § 11.3, § 11.4). Pure functions only: no window/document/localStorage/
// node:* API, no network call — the app (apps/web) wires these to the
// `ten_conversation_save` RPC (§ 11.2) and the `ten_gate_log` read (§ 11.6).
//
// Two jobs, kept in one file because § 11.3's stub is "shared with § 12"
// (packages/agent's turn-size trimmer, built in parallel by another coder
// in coach.ts): what a saved message array looks like
// (`conversationToSave`), and how it's kept under the 900,000-byte cap
// (`capConversationSize`).
import type { AppMessage } from "./types.ts";

// ---------------------------------------------------------------------
// The stub (§ 11.3, shared with § 12.1's in-turn trimmer). Every tool
// string over this many characters, in a tool part's `input`, `output` or
// `errorText`, is replaced by `stubFor(removedLength)`.
// ---------------------------------------------------------------------

export const STUB_THRESHOLD_CHARS = 2000;

/** § 11.3's stub, word for word, N = the removed string's own length
 *  (JS string length — UTF-16 code units, matching `.length` everywhere
 *  else this codebase measures "characters", e.g. countWords's inputs). */
export function stubFor(removedLength: number): string {
  return `[Removed to save space: ${removedLength} characters. The workspace files hold what was saved; read a file again if you need it.]`;
}

/** § 11.3: "A tool part in any state but output-available/output-error is
 *  saved as output-error, errorText [this text]." Exported so § 12 (and
 *  any test) can match it without re-typing the sentence. */
export const STOPPED_BEFORE_RESULT_TEXT = "Stopped before a result came back. Check the files for what was saved.";

/** Replaces every string LEAF over STUB_THRESHOLD_CHARS with the stub,
 *  walking arrays/objects (mirrors window.ts's `leaves()` walk, which
 *  counts the same shape) — never touching a shorter string, a number, a
 *  boolean, or the surrounding structure/keys. Nullish input passes
 *  through unchanged (a tool part with no input, e.g.). */
function stubLongStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > STUB_THRESHOLD_CHARS ? stubFor(value.length) : value;
  }
  if (Array.isArray(value)) {
    return value.map(stubLongStrings);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stubLongStrings(v);
    return out;
  }
  return value;
}

function isToolPart(part: { type: string }): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

/**
 * § 11.3 — what one message's parts look like once sanitized for saving:
 *
 * 1. Kept word for word: text parts, "step-start", every "data-*" part,
 *    `metadata`, and a `file` part whose `url` starts "workspace:".
 * 2. Dropped: "reasoning" parts and every other `file` part.
 * 3. Tool parts: every string over 2,000 characters in input/output/
 *    errorText becomes the stub; a part in any state but output-available/
 *    output-error is saved as output-error with the fixed errorText.
 */
function sanitizePart(part: Record<string, unknown> & { type: string }): Record<string, unknown> | null {
  if (part.type === "text" || part.type === "step-start" || part.type.startsWith("data-")) {
    return part;
  }
  if (part.type === "reasoning") return null;
  if (part.type === "file") {
    const url = typeof part.url === "string" ? part.url : "";
    return url.startsWith("workspace:") ? part : null;
  }
  if (isToolPart(part)) {
    const state = part.state as string | undefined;
    if (state !== "output-available" && state !== "output-error") {
      // Not finished (or its result never came back) at save time — saved
      // as the fixed output-error, per § 11.3 point 3's second paragraph.
      // toolCallId/type/input (whatever exists) travel unchanged; output
      // is dropped (output-error carries no output), errorText is fixed.
      const { output: _output, errorText: _errorText, ...rest } = part;
      return { ...rest, state: "output-error", input: stubLongStrings(part.input), errorText: STOPPED_BEFORE_RESULT_TEXT };
    }
    const sanitized: Record<string, unknown> = { ...part };
    if ("input" in sanitized) sanitized.input = stubLongStrings(sanitized.input);
    if ("output" in sanitized) sanitized.output = stubLongStrings(sanitized.output);
    if (typeof sanitized.errorText === "string" && sanitized.errorText.length > STUB_THRESHOLD_CHARS) {
      sanitized.errorText = stubFor(sanitized.errorText.length);
    }
    return sanitized;
  }
  // source-url, source-document, custom, reasoning-file, and anything
  // future/unknown: not named as kept in § 11.3's list, so dropped —
  // never silently passed through unsanitized.
  return null;
}

/** § 11.3 — the pure sanitizer. Never mutates its input; every message and
 *  part is a fresh object/array (the caller may hold onto `messages`
 *  itself for React state, e.g.). Message-level `metadata` is kept word
 *  for word (untouched). A message left with zero parts after sanitizing
 *  (e.g. one reasoning part alone) keeps its (now empty) parts array —
 *  the message itself is never dropped, only its parts. */
export function conversationToSave(messages: readonly AppMessage[]): AppMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: (m.parts as Array<Record<string, unknown> & { type: string }>)
      .map(sanitizePart)
      .filter((p): p is Record<string, unknown> => p !== null),
  })) as AppMessage[];
}

// ---------------------------------------------------------------------
// § 11.4 — the 900,000-byte cap: drop the oldest whole turns.
// ---------------------------------------------------------------------

export const CONVERSATION_BYTE_CAP = 900_000;

function byteSize(messages: readonly AppMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).byteLength;
}

/** Groups messages into whole "turns" — a user message plus every
 *  assistant message that follows it, up to the next user message. Any
 *  leading assistant-only messages form their own turn (shouldn't
 *  normally happen; nothing is silently dropped without being counted).
 *  Same grouping rule as window.ts's own `groupIntoTurns` (kept as a
 *  private copy here — window.ts's is not exported — rather than adding a
 *  cross-file dependency for one small, stable helper). */
function groupIntoTurns(messages: readonly AppMessage[]): AppMessage[][] {
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

export interface CapResult {
  messages: AppMessage[];
  /** True iff at least one whole older turn was dropped to fit the cap
   *  (§ 11.4: "setting older_dropped"). Once true for a conversation it
   *  should stay true (the caller ORs this with the row's current flag —
   *  this function only reports whether THIS call dropped anything). */
  droppedAnyTurn: boolean;
}

/**
 * § 11.4 — "the client keeps the sanitized array <= 900,000 bytes (UTF-8
 * of JSON.stringify...), dropping the oldest whole turns." Always keeps at
 * least the newest turn, even if that turn alone is over the cap (nothing
 * else CAN be dropped — the array shrinks no further; the caller still
 * saves it, since "outcomes are files, so none is lost").
 */
export function capConversationSize(messages: readonly AppMessage[], maxBytes = CONVERSATION_BYTE_CAP): CapResult {
  const turns = groupIntoTurns(messages);
  if (byteSize(messages) <= maxBytes || turns.length <= 1) {
    return { messages: messages as AppMessage[], droppedAnyTurn: false };
  }
  let kept = turns;
  let droppedAnyTurn = false;
  while (kept.length > 1 && byteSize(kept.flat()) > maxBytes) {
    kept = kept.slice(1);
    droppedAnyTurn = true;
  }
  return { messages: kept.flat(), droppedAnyTurn };
}

/** Composes § 11.3 then § 11.4 — what the app calls once per ended turn
 *  before saving (`onFinish`). */
export function prepareConversationForSave(
  messages: readonly AppMessage[],
  maxBytes = CONVERSATION_BYTE_CAP,
): CapResult {
  return capConversationSize(conversationToSave(messages), maxBytes);
}
