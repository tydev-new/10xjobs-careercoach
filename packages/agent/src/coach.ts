// § 1 — createCoach(deps): the one loop. streamText with the tools and
// stopWhen: stepCountIs(maxSteps); a headless run reads the same stream
// to the end (bin/run.mjs does exactly this).
import {
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  toUIMessageStream,
  type StopCondition,
  type UIMessageStreamWriter,
} from "ai";
import { CardBuilder } from "./cards.ts";
import { DEFAULT_STEP_COST_MAX_USD, DEFAULT_STEP_COST_MEDIAN_USD, type StepCostSample } from "./estimate-cost.ts";
import { buildGateLine, openGateForChat, roundUpCents, textHashOf } from "./gate.ts";
import { matchGateReply } from "./helpers.ts";
import { buildAlwaysOnSystemPrompt } from "./skills/system-prompt.ts";
import { createTools, type ToolContext, type TurnState } from "./tools/index.ts";
import { VersionTracker } from "./tools/version-tracker.ts";
import { trimHistoryToWindow } from "./window.ts";
import type {
  AppMessage,
  AppMessageMetadata,
  Coach,
  CoachStreamInput,
  Deps,
  ErrorCode,
  GateRequest,
} from "./types.ts";

const DEFAULT_MAX_STEPS = 25;
const DEFAULT_SPEND_GATE_USD = 1.0;
const DEFAULT_WINDOW_WORDS = 4000;

/** § 6.1: "data-error.message is one fixed sentence per code." */
export const ERROR_MESSAGES: Record<ErrorCode, { message: string; retryable: boolean }> = {
  over_balance: { message: "You're out of balance for now.", retryable: false },
  model_error: { message: "Something went wrong talking to the model.", retryable: true },
  tool_error: { message: "Something went wrong running that tool.", retryable: true },
  offline: { message: "You appear to be offline.", retryable: true },
  step_cap: { message: "This turn ran out of steps before finishing.", retryable: true },
};

/** § 3.2's note, added to the system prompt (not a canned USER-FACING
 *  reply — the lead's fix-round-1 ruling: "the fixed line is the MOCK's
 *  behaviour only"). The model answers the candidate's real message; it
 *  just also knows not to spend. */
const GATE_PENDING_NOTE =
  "\n\n---\nA spend gate you opened earlier this chat is still pending: the candidate's last message did not approve it (only an exact typed \"yes\" approves; anything else, including a question, leaves it open). Do not call estimate_cost again or run further tools toward that spend until they say yes — you may still answer what they asked.";

interface ChatState {
  versionTracker: VersionTracker;
  cardBuilder: CardBuilder;
  /** § 4 "so far in this chat" (M6): persists across every turn in this
   *  chat, never reset per turn. */
  chatMeasuredSteps: StepCostSample[];
  /** § 3.1 "at most one gate open per chat": serializes concurrent
   *  gate-opens within this chat (M2) so two tool calls in the SAME step
   *  can't both see "no pending gate" and both open one. */
  gateLock: Promise<void>;
}

function lastUserMessage(messages: AppMessage[]): AppMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

function textOf(m: AppMessage): string {
  return (m.parts as Array<{ type: string; text?: string }>)
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function originOf(m: AppMessage): "typed" | "ui" {
  return (m.metadata as AppMessageMetadata | undefined)?.origin ?? "ui";
}

// Step 5b coder's fix (flagged in the hand-back): design-web-ui.md § 2.7
// requires `data-error.message` to be "the literal sentence the SERVER
// sent" for over_balance/model_error — the proxy's own § 8 copy
// ("Your beta credit is used up...", "The beta has reached today's
// limit...", "The reply was cut off...") differs BY CAUSE even though the
// `code` doesn't. `classifyError` used to return only the ErrorCode
// (always the generic ERROR_MESSAGES sentence below); it now also
// extracts the proxy's own `{ error: { code, message } }` body — from
// `APICallError.responseBody` (the AI SDK provider's own error shape,
// `@ai-sdk/provider`'s `APICallError`) when present — so a real refusal
// shows its real cause. No change when there's no parseable server
// message: the generic ERROR_MESSAGES sentence stands, exactly as before
// (existing tests asserting a fixed `.message` still pass unmodified).
function serverMessageFrom(error: unknown): string | undefined {
  const responseBody = (error as any)?.responseBody;
  if (typeof responseBody !== "string") return undefined;
  try {
    const parsed = JSON.parse(responseBody);
    const message = parsed?.error?.message;
    return typeof message === "string" ? message : undefined;
  } catch {
    return undefined;
  }
}

function classifyError(error: unknown): { code: ErrorCode; serverMessage?: string } {
  const status =
    (error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.response?.status;
  const serverMessage = serverMessageFrom(error);
  if (status === 402) return { code: "over_balance", serverMessage };
  const message = String((error as any)?.message ?? error ?? "");
  if (/\b402\b/.test(message)) return { code: "over_balance", serverMessage };
  if (/network|fetch failed|ECONNREFUSED|offline/i.test(message)) return { code: "offline", serverMessage };
  // Every other proxy-originated HTTP failure (401/403/413/503, § 8) is
  // shown as model_error, distinguished only by ITS OWN message text
  // (design-web-ui.md § 2.7) — there's no dedicated ErrorCode for each.
  return { code: "model_error", serverMessage };
}

// § 2 Uploads: "The package turns that part into one text line ('The
// candidate attached `documents/<name>`.'). The bytes are never sent to
// the model." (H4, fix round 1) — convertToModelMessages would otherwise
// embed a real `file` content part (and its bytes/url) verbatim.
function workspacePathOf(part: { url?: string; filename?: string }): string {
  const url = part.url ?? "";
  const m = /^workspace:(.+)$/.exec(url);
  return m ? m[1] : (part.filename ?? url);
}

function stripWorkspaceFileParts(messages: AppMessage[]): AppMessage[] {
  return messages.map((m) => {
    if (m.role !== "user") return m;
    const parts = m.parts as unknown as Array<{ type: string; [k: string]: unknown }>;
    if (!parts.some((p) => p.type === "file")) return m;
    const nextParts = parts.map((p) =>
      p.type === "file"
        ? { type: "text", text: `The candidate attached \`${workspacePathOf(p as any)}\`.` }
        : p,
    );
    return { ...m, parts: nextParts } as AppMessage;
  });
}

// M4 (fix round 1): a model-call error (e.g. a 402) surfaces as a normal
// `{ type: "error", error }` PART of `streamText`'s `fullStream` — it does
// NOT reject/throw. `toUIMessageStream` converts that part into a generic
// `{ type: "error", errorText: "An error occurred." }` UI chunk, which
// loses the classifiable detail (statusCode etc.) before it ever reaches
// us. So the tap runs BEFORE that conversion, on the raw fullStream part,
// where `error` still carries the real shape.
// Step 5b coder's fix (flagged in the hand-back, outside this slice's own
// directory): `ReadableStream.from(asyncIterable)` is missing from the
// installed TypeScript's `lib.dom.d.ts` (no static `.from` on the
// `ReadableStream` constructor type at all, in ANY lib combination this
// repo tried — see the hand-back), which broke `apps/web`'s own
// `tsc -b --noEmit` the moment its real-agent wiring (step 5b) pulled this
// file into a browser (DOM-lib) TypeScript program for the first time;
// packages/agent's OWN tsconfig has no DOM lib, so this compiled fine
// there and the gap was invisible until now. A manual pull-based
// ReadableStream construction is the fix — not just a typing workaround:
// it also avoids depending on `ReadableStream.from` (a newer Streams API
// addition) being present in every runtime this package ships to,
// matching § 1's own "runs in the browser and on a server" bar. Same
// async generator, same yielded values, same order.
function tapErrorParts(stream: AsyncIterable<any>, onError: (error: unknown) => void): ReadableStream<any> {
  async function* gen() {
    for await (const part of stream) {
      if (part?.type === "error") onError(part.error);
      yield part;
    }
  }
  const iterator = gen();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

export function createCoach(deps: Deps): Coach {
  const chats = new Map<string, ChatState>();
  const maxSteps = deps.limits?.maxSteps ?? DEFAULT_MAX_STEPS;
  const spendGateUsd = deps.limits?.spendGateUsd ?? DEFAULT_SPEND_GATE_USD;
  const windowWords = deps.limits?.windowWords ?? DEFAULT_WINDOW_WORDS;
  const gateGrammarMd = deps.skills["skills/coach/references/gate-grammar.md"] ?? "";
  const systemPrompt = buildAlwaysOnSystemPrompt(deps.skills);

  function chatStateFor(chatId: string): { state: ChatState; isFirstTurn: boolean } {
    let state = chats.get(chatId);
    const isFirstTurn = !state;
    if (!state) {
      state = {
        versionTracker: new VersionTracker(),
        cardBuilder: new CardBuilder(),
        chatMeasuredSteps: [],
        gateLock: Promise.resolve(),
      };
      chats.set(chatId, state);
    }
    return { state, isFirstTurn };
  }

  return {
    stream(input: CoachStreamInput): ReadableStream<import("ai").UIMessageChunk> {
      const { chatId, messages } = input;
      const { state, isFirstTurn } = chatStateFor(chatId);

      return createUIMessageStream<AppMessage>({
        execute: async ({ writer }) => {
          try {
            await runTurn({ deps, chatId, messages, writer, state, isFirstTurn, maxSteps, spendGateUsd, windowWords, gateGrammarMd, systemPrompt: systemPrompt.text, abortSignal: input.abortSignal });
          } catch (error) {
            deps.logger?.error({ event: "coach.turn_failed", chatId, error: String((error as any)?.message ?? error) });
            const { code, serverMessage } = classifyError(error);
            const { message, retryable } = ERROR_MESSAGES[code];
            writer.write({ type: "data-error", data: { code, message: serverMessage ?? message, retryable } });
          }
        },
      });
    },
  };
}

interface RunTurnArgs {
  deps: Deps;
  chatId: string;
  messages: AppMessage[];
  writer: UIMessageStreamWriter<AppMessage>;
  state: ChatState;
  isFirstTurn: boolean;
  maxSteps: number;
  spendGateUsd: number;
  windowWords: number;
  gateGrammarMd: string;
  systemPrompt: string;
  abortSignal?: AbortSignal;
}

/** Serializes gate-opening for one chat (M2): concurrent callers queue
 *  behind whichever is already running the read-then-act sequence. */
function withGateLock(state: ChatState, fn: () => Promise<void>): Promise<void> {
  const run = state.gateLock.then(fn, fn);
  state.gateLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runTurn(args: RunTurnArgs): Promise<void> {
  const { deps, chatId, messages: rawMessages, writer, state, isFirstTurn, maxSteps, spendGateUsd, windowWords, gateGrammarMd, systemPrompt, abortSignal } = args;
  const messages = stripWorkspaceFileParts(rawMessages);

  // § 3: "On a chat's first turn, the package expires every `pending` row
  // from older chats."
  if (isFirstTurn) {
    await deps.gate.expireOtherChats(chatId);
  }

  const openGate = (req: GateRequest) => withGateLock(state, () => openGateForChat(deps, chatId, req, writer));

  // § 3: matchGateReply runs in code, before the model sees the message.
  const pendingGate = await deps.gate.pending(chatId);
  const latestUser = lastUserMessage(messages);
  let approvedAmountUsd: number | undefined;
  let systemNote = "";

  if (pendingGate && latestUser) {
    const text = textOf(latestUser);
    const origin = originOf(latestUser);
    const reply = matchGateReply(text, origin);
    if (reply === "approve") {
      await deps.gate.decide(pendingGate.gateId, "approved", text);
      writer.write({ type: "data-gate-status", data: { gateId: pendingGate.gateId, status: "approved" } });
      approvedAmountUsd = pendingGate.amountUsd;
      // falls through — the turn continues, the model resumes from the files.
    } else if (reply === "decline") {
      await deps.gate.decide(pendingGate.gateId, "declined", text);
      writer.write({ type: "data-gate-status", data: { gateId: pendingGate.gateId, status: "declined" } });
      writer.write({ type: "text-start", id: "declined" } as any);
      writer.write({ type: "text-delta", id: "declined", delta: "Declined — nothing started." } as any);
      writer.write({ type: "text-end", id: "declined" } as any);
      return; // no model call — nothing was spent.
    } else {
      // "none": leaves the gate open; the part is re-emitted with no write.
      writer.write({ type: "data-gate-status", data: { gateId: pendingGate.gateId, status: "pending" } });
      // § 3.2 (fix round 1, lead ruling): a reply that isn't yes/no goes
      // to the MODEL with a note it isn't approved — the model may
      // answer questions. The fixed "Not approved" line is the MOCK
      // transport's own behaviour (§ 6.1), not this package's. But a
      // reply that is ITSELF just a mis-fired approval/decline attempt
      // (the exact yes/no word, wrong origin or no origin at all — e.g.
      // a UI-origin "yes", where there is no approve button, § 3 point
      // 4) is not real content: nothing to answer, so it never reaches
      // the model, and nothing is spent.
      const wouldHaveMatched = matchGateReply(text, "typed");
      if (wouldHaveMatched === "approve" || wouldHaveMatched === "decline") {
        return; // a same-word attempt from the wrong origin — no model call.
      }
      systemNote = GATE_PENDING_NOTE;
      // falls through — the model gets this turn, per § 3.2.
    }
  }

  const windowed = trimHistoryToWindow(messages, windowWords);

  const turnState: TurnState = {
    measuredSteps: [],
    spentSoFarUsd: 0,
    lastHighUsd: undefined,
    gateId: undefined,
  };
  const allowanceUsd = approvedAmountUsd ?? spendGateUsd;

  const ctx: ToolContext = {
    chatId,
    writer,
    versionTracker: state.versionTracker,
    cardBuilder: state.cardBuilder,
    turnState,
    chatMeasuredSteps: state.chatMeasuredSteps,
    gateGrammarMd,
    idFor: () => crypto.randomUUID(),
    openGate,
  };
  const tools = createTools(deps, ctx);
  // `tools` passed so tool RESULTS in history convert faithfully (a
  // dropped/mis-shaped tool-result would silently shrink what the
  // window-word accounting and the real request both see).
  const modelMessages = await convertToModelMessages(windowed as any, { tools: tools as any });

  /** § 4's "allowance" projection for the NEXT step's cost (H1/M6, fix
   *  round 1): this chat's own measured steps so far (persisted, worst
   *  case — "gate BEFORE a step that would exceed it" has to assume the
   *  next step could cost as much as the costliest one seen), else the
   *  most recent estimate_cost's upper bound, else a labelled dated
   *  constant as the last resort. Never a constant when real data exists. */
  function projectedNextStepUsd(): number {
    if (state.chatMeasuredSteps.length > 0) {
      return Math.max(...state.chatMeasuredSteps.map((s) => s.usd));
    }
    if (turnState.lastHighUsd !== undefined) return turnState.lastHighUsd;
    return DEFAULT_STEP_COST_MAX_USD;
  }

  // ONE combined stop condition (not an array) so its side effects — the
  // step_cap error, the mid-run allowance gate — run in a fixed order and
  // exactly once per step boundary, with no risk of the SDK evaluating
  // several independent conditions' side effects on the same step.
  const stop: StopCondition<typeof tools, any> = async ({ steps }) => {
    // 1. the hard step cap.
    if (steps.length >= maxSteps) {
      const { message, retryable } = ERROR_MESSAGES.step_cap;
      writer.write({ type: "data-error", data: { code: "step_cap", message, retryable } });
      return true;
    }
    // 2. estimate_cost (or a tool's own reported cost) already pushed
    //    this chat over — a gate may already be pending, opened by the
    //    tool itself this step (§ 3: "code opens the spend gate and ends
    //    the turn").
    if ((await deps.gate.pending(chatId)) !== null) return true;

    // 3. § 4's "allowance": each turn may spend spendGateUsd (or the
    //    amount of a gate approved by the message that started the
    //    turn). After each step the loop adds up the MEASURED cost
    //    (H1: real step costs, never a constant, decide whether the
    //    NEXT step fits); if it would pass the allowance, it stops
    //    BEFORE that step and opens a gate for spent-so-far + the
    //    projected next step.
    const last = steps[steps.length - 1];
    if (last) {
      const measuredUsd =
        (last as any).providerMetadata?.openrouter?.usage?.cost ?? DEFAULT_STEP_COST_MEDIAN_USD;
      const sample: StepCostSample = { usd: measuredUsd };
      turnState.measuredSteps.push(sample);
      state.chatMeasuredSteps.push(sample);
      turnState.spentSoFarUsd += measuredUsd;
    }
    const nextStepCost = projectedNextStepUsd();
    if (turnState.spentSoFarUsd + nextStepCost <= allowanceUsd) return false;

    const amountUsd = roundUpCents(turnState.spentSoFarUsd + nextStepCost);
    const gateId = crypto.randomUUID();
    const text = `Continue this run\nSpent so far this turn: $${turnState.spentSoFarUsd.toFixed(4)}`;
    const req: GateRequest = {
      gateId,
      kind: "spend",
      label: "Continue this run",
      text,
      textHash: await textHashOf(text),
      gateLine: buildGateLine(gateGrammarMd, amountUsd),
      amountUsd,
    };
    await openGate(req);
    return true;
  };

  const result = streamText({
    model: deps.model,
    system: systemPrompt + systemNote,
    messages: modelMessages,
    tools,
    stopWhen: stop,
    abortSignal,
  });

  const tapped = tapErrorParts(result.fullStream, (error) => {
    const { code, serverMessage } = classifyError(error);
    const { message, retryable } = ERROR_MESSAGES[code];
    writer.write({ type: "data-error", data: { code, message: serverMessage ?? message, retryable } });
  });

  await writer.merge(toUIMessageStream({ stream: tapped, tools }) as any);
}
