// MockChatTransport — replays a fixture's scripted assistant messages as
// UIMessageChunk streams (ai@7.0.111's own ChatTransport interface,
// verified against the installed package's .d.ts — sendMessages /
// reconnectToStream). No window/document/localStorage/Node-only API: this
// file runs the same in the browser and under `node --test`.
import type { ChatTransport, UIMessageChunk } from "ai";
import { latestGateStatuses, matchGateReply } from "./agent-helpers.ts";
import type { AppMessage, Fixture, MessageOrigin } from "./types.ts";

const DEFAULT_DELAY_MS = 150;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function extractUserText(message: AppMessage | undefined): string {
  if (!message) return "";
  const textPart = message.parts.find((p) => p.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return textPart?.text ?? "";
}

function splitIntoChunks(text: string, wordsPerChunk = 5): string[] {
  const words = text.split(/(\s+)/); // keep whitespace so words rejoin cleanly
  const chunks: string[] = [];
  let current = "";
  let count = 0;
  for (const w of words) {
    current += w;
    if (w.trim() !== "") count++;
    if (count >= wordsPerChunk) {
      chunks.push(current);
      current = "";
      count = 0;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

/**
 * Converts one scripted assistant AppMessage into a delayed stream of
 * UIMessageChunk, in order: text streamed as deltas, tool parts through
 * input-available -> output-available/output-error, data-* parts emitted
 * whole (§ 6.1 "Mock replay").
 */
async function* scriptedChunks(
  message: AppMessage,
  delayMs: number,
  abortSignal?: AbortSignal
): AsyncGenerator<UIMessageChunk> {
  yield { type: "start", messageId: message.id } as UIMessageChunk;

  for (const part of message.parts as Array<Record<string, unknown>>) {
    const type = part.type as string;

    if (type === "text") {
      const id = `${message.id}-text-${Math.random().toString(36).slice(2)}`;
      yield { type: "text-start", id } as UIMessageChunk;
      for (const delta of splitIntoChunks(part.text as string)) {
        await sleep(delayMs, abortSignal);
        yield { type: "text-delta", id, delta } as UIMessageChunk;
      }
      yield { type: "text-end", id } as UIMessageChunk;
      continue;
    }

    if (type.startsWith("tool-")) {
      const toolName = type.slice("tool-".length);
      const toolCallId = (part.toolCallId as string) ?? `${message.id}-${toolName}`;
      await sleep(delayMs, abortSignal);
      yield { type: "tool-input-start", toolCallId, toolName } as UIMessageChunk;
      await sleep(delayMs, abortSignal);
      yield {
        type: "tool-input-available",
        toolCallId,
        toolName,
        input: part.input,
      } as UIMessageChunk;
      await sleep(delayMs, abortSignal);
      if (part.state === "output-error") {
        yield {
          type: "tool-output-error",
          toolCallId,
          errorText: (part.errorText as string) ?? "error",
        } as UIMessageChunk;
      } else {
        yield {
          type: "tool-output-available",
          toolCallId,
          output: part.output,
        } as UIMessageChunk;
      }
      continue;
    }

    if (type.startsWith("data-")) {
      await sleep(delayMs, abortSignal);
      yield { type, data: part.data } as UIMessageChunk;
      continue;
    }
    // Unknown/unsupported part kinds in a fixture are skipped rather than
    // guessed at.
  }

  yield { type: "finish" } as UIMessageChunk;
}

async function* fallbackChunks(
  gateId: string,
  delayMs: number,
  abortSignal?: AbortSignal
): AsyncGenerator<UIMessageChunk> {
  yield { type: "start" } as UIMessageChunk;
  await sleep(delayMs, abortSignal);
  yield {
    type: "data-gate-status",
    data: { gateId, status: "pending" },
  } as UIMessageChunk;
  const id = `fallback-${Math.random().toString(36).slice(2)}`;
  yield { type: "text-start", id } as UIMessageChunk;
  await sleep(delayMs, abortSignal);
  yield {
    type: "text-delta",
    id,
    delta: "Not approved — type yes to go ahead.",
  } as UIMessageChunk;
  yield { type: "text-end", id } as UIMessageChunk;
  yield { type: "finish" } as UIMessageChunk;
}

async function* declineChunks(
  gateId: string,
  delayMs: number,
  abortSignal?: AbortSignal
): AsyncGenerator<UIMessageChunk> {
  yield { type: "start" } as UIMessageChunk;
  await sleep(delayMs, abortSignal);
  yield {
    type: "data-gate-status",
    data: { gateId, status: "declined" },
  } as UIMessageChunk;
  const id = `decline-${Math.random().toString(36).slice(2)}`;
  yield { type: "text-start", id } as UIMessageChunk;
  await sleep(delayMs, abortSignal);
  yield { type: "text-delta", id, delta: "Declined — nothing started." } as UIMessageChunk;
  yield { type: "text-end", id } as UIMessageChunk;
  yield { type: "finish" } as UIMessageChunk;
}

/**
 * N2: a gate's status leaves "pending" exactly once. Once a gate has been
 * declined (or approved/expired), a later reply that would otherwise
 * text-match the fixture's own approval turn must NOT replay it — that
 * would re-emit a status for an already-resolved gate. This is the
 * off-script fallback for that case: one plain line, the fixed-line style,
 * built only from facts already on screen (the gate's own `label`, word
 * for word) — no invented facts, and no data-gate-status part (nothing
 * new happened to the gate).
 */
async function* alreadyResolvedChunks(
  label: string,
  delayMs: number,
  abortSignal?: AbortSignal
): AsyncGenerator<UIMessageChunk> {
  yield { type: "start" } as UIMessageChunk;
  const id = `resolved-${Math.random().toString(36).slice(2)}`;
  yield { type: "text-start", id } as UIMessageChunk;
  await sleep(delayMs, abortSignal);
  yield {
    type: "text-delta",
    id,
    delta: `"${label}" was declined — ask again and I'll estimate it fresh.`,
  } as UIMessageChunk;
  yield { type: "text-end", id } as UIMessageChunk;
  yield { type: "finish" } as UIMessageChunk;
}

function streamFromGenerator(gen: AsyncGenerator<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await gen.return?.(undefined as unknown as UIMessageChunk);
    },
  });
}

export interface MockChatTransportOptions {
  delayMs?: number;
}

function messageOrigin(m: AppMessage | undefined): MessageOrigin {
  return ((m?.metadata as { origin?: MessageOrigin } | undefined)?.origin as MessageOrigin) ?? "ui";
}

/**
 * mockTransport(fixture) — docs/design-web-agent.md § 6.1's "Mock replay",
 * in full:
 *
 * - Outside a pending gate: content-addressed replay. A reply's text is
 *   looked up against the fixture's own remaining user messages (in order,
 *   never rewinding past what's already been consumed) — a match replays
 *   that scripted turn.
 * - At a pending gate:
 *     1. A reply that equals the fixture's own NEXT scripted user message
 *        (the very next one after the gate opened, not a free search)
 *        replays that scripted turn verbatim — e.g. gate-moment.json's
 *        `m3` replays `m4`, its richer non-approval content, not a canned
 *        line.
 *     2. A typed exact "yes" (matchGateReply "approve") jumps straight to
 *        the turn after the fixture's OWN scripted "yes" — found by
 *        searching the fixture, not by counting turns, so it lands
 *        correctly no matter how many off-script replies came first (no
 *        counters that drift).
 *     3. "no"/"don't"/"cancel"/"stop" (matchGateReply "decline") declines.
 *     4. Anything else — including text that doesn't match the one next
 *        scripted line — gets the one fixed pending line and does not
 *        move the read position.
 * - A gate's status leaves "pending" exactly once (§ 3): once a gate has
 *   resolved (declined, here — approved/expired the same way), a later
 *   reply is never allowed to replay that gate's own resolution turn
 *   again (which would silently re-emit a status). It's treated as an
 *   ordinary off-script message instead (`alreadyResolvedChunks`).
 */
export class MockChatTransport implements ChatTransport<AppMessage> {
  private readonly fixtureMessages: AppMessage[];
  private readonly delayMs: number;
  // Index into fixtureMessages: the next position content-addressed replay
  // searches from. Only moves forward, and only on an actual match — never
  // a "turns consumed so far" counter.
  private searchFrom = 0;

  // A plain field assignment (not a TS constructor parameter property) —
  // Node's strip-only TypeScript mode (`node --test`, no build step)
  // doesn't support parameter properties, and this file has to run there
  // unmodified for the unit tests, same as in the Vite bundle.
  constructor(fixture: Fixture, options: MockChatTransportOptions = {}) {
    this.fixtureMessages = fixture.messages;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  }

  /** The fixture's own next assistant reply to `text`, searching forward
   *  from `fromIndex` only (never matches an earlier, already-passed line
   *  out of order). */
  private findReplyTo(text: string, fromIndex: number): { index: number; reply: AppMessage } | null {
    for (let i = fromIndex; i < this.fixtureMessages.length - 1; i++) {
      const m = this.fixtureMessages[i];
      if (m.role !== "user") continue;
      if (extractUserText(m) !== text) continue;
      const reply = this.fixtureMessages[i + 1];
      if (reply?.role === "assistant") return { index: i, reply };
    }
    return null;
  }

  /** The ONE next scripted user message from `fromIndex` (not a free
   *  search) — § 6.1's "the fixture's next scripted user message". */
  private nextScriptedUser(fromIndex: number): { index: number; text: string } | null {
    for (let i = fromIndex; i < this.fixtureMessages.length; i++) {
      const m = this.fixtureMessages[i];
      if (m.role === "user") return { index: i, text: extractUserText(m) };
    }
    return null;
  }

  /** Fallback when the reply doesn't match any remaining scripted user
   *  line: the next unconsumed assistant turn, positionally — so an
   *  off-script reply outside a gate still gets a real (delayed) reply
   *  instead of a silent empty turn. */
  private nextAssistant(fromIndex: number): { index: number; reply: AppMessage } | null {
    for (let i = fromIndex; i < this.fixtureMessages.length; i++) {
      if (this.fixtureMessages[i].role === "assistant") {
        return { index: i, reply: this.fixtureMessages[i] };
      }
    }
    return null;
  }

  /** The fixture's own scripted "yes" (a typed message matchGateReply
   *  would itself call "approve") and the assistant turn right after it —
   *  searched fresh every time, so it's found no matter how many off-script
   *  replies happened first. */
  private findScriptedApproval(): { index: number; reply: AppMessage } | null {
    for (let i = 0; i < this.fixtureMessages.length - 1; i++) {
      const m = this.fixtureMessages[i];
      if (m.role !== "user") continue;
      if (matchGateReply(extractUserText(m), messageOrigin(m)) !== "approve") continue;
      const reply = this.fixtureMessages[i + 1];
      if (reply?.role === "assistant") return { index: i, reply };
    }
    return null;
  }

  /** N2: does `reply` carry a status for a gate that's already left
   *  "pending" in this conversation (per `resolvedGateIds`)? Replaying it
   *  would re-emit / contradict that gate's one resolution. */
  private touchesResolvedGate(reply: AppMessage, resolvedGateIds: Set<string>): boolean {
    return (reply.parts as Array<Record<string, unknown>>).some(
      (p) => p.type === "data-gate-status" && resolvedGateIds.has((p.data as { gateId: string }).gateId)
    );
  }

  async sendMessages(options: {
    messages: AppMessage[];
    abortSignal: AbortSignal | undefined;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal } = options;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = extractUserText(lastUser);
    const origin = messageOrigin(lastUser);

    const gates = latestGateStatuses(messages);
    const pendingGateId = [...gates.entries()].find(([, v]) => v.status === "pending")?.[0];
    const resolvedGateIds = new Set(
      [...gates.entries()].filter(([, v]) => v.status !== "pending").map(([id]) => id)
    );

    if (pendingGateId) {
      // 1. The fixture's own NEXT scripted user message (not a free
      // search) — a match replays that scripted turn, e.g. m3 -> m4.
      const next = this.nextScriptedUser(this.searchFrom);
      if (next && next.text === text) {
        const reply = this.fixtureMessages[next.index + 1];
        if (reply?.role === "assistant") {
          this.searchFrom = next.index + 1;
          return streamFromGenerator(scriptedChunks(reply, this.delayMs, abortSignal));
        }
      }

      const result = matchGateReply(text, origin);
      if (result === "approve") {
        // 2. Jump to the turn after the fixture's own scripted "yes",
        // wherever it is.
        const found = this.findScriptedApproval();
        if (found) {
          this.searchFrom = found.index + 1;
          return streamFromGenerator(scriptedChunks(found.reply, this.delayMs, abortSignal));
        }
        // No scripted "yes" in this fixture (shouldn't happen for a real
        // gate fixture) — fall through to the fixed line rather than
        // silently doing nothing.
      } else if (result === "decline") {
        // 3. Decline. Does not move `searchFrom`.
        return streamFromGenerator(declineChunks(pendingGateId, this.delayMs, abortSignal));
      }
      // 4. Off-script: the ONE fixed pending line. Does not move
      // `searchFrom`.
      return streamFromGenerator(fallbackChunks(pendingGateId, this.delayMs, abortSignal));
    }

    const found = this.findReplyTo(text, this.searchFrom) ?? this.nextAssistant(this.searchFrom);
    if (found && this.touchesResolvedGate(found.reply, resolvedGateIds)) {
      // N2: this exact candidate would replay an already-resolved gate's
      // own resolution turn (e.g. "yes" text-matching a scripted approval
      // whose gate was since declined) — never allowed. Treat as an
      // ordinary off-script message about that resolved gate instead.
      const blockedGateId = (found.reply.parts as Array<Record<string, unknown>>)
        .filter((p) => p.type === "data-gate-status")
        .map((p) => (p.data as { gateId: string }).gateId)
        .find((id) => resolvedGateIds.has(id));
      const gatePart = messages
        .flatMap((m) => m.parts as Array<Record<string, unknown>>)
        .find((p) => p.type === "data-gate" && (p.data as { gateId: string }).gateId === blockedGateId);
      const label = (gatePart?.data as { label?: string } | undefined)?.label ?? "that";
      return streamFromGenerator(alreadyResolvedChunks(label, this.delayMs, abortSignal));
    }
    if (!found) {
      return streamFromGenerator(
        (async function* () {
          yield { type: "start" } as UIMessageChunk;
          yield { type: "finish" } as UIMessageChunk;
        })()
      );
    }
    this.searchFrom = found.index + 1;
    return streamFromGenerator(scriptedChunks(found.reply, this.delayMs, abortSignal));
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
