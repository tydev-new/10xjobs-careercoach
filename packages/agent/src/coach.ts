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
  // § 9.3 (amended 2026-09-24): a cut-off that can't be continued (both
  // calls ended on "length", or a § 9.2 precondition failed). The
  // message is fixed, word for word.
  cut_off: {
    message: "My reply got too long and was cut off, so its last step didn't save. Say continue to redo it in smaller pieces.",
    retryable: true,
  },
};

// § 9.1 (amended 2026-09-24, fix round 1 of issue #2): every tool call in
// a cut-off step is closed with this exact `tool-input-error` text — word
// for word — whether or not its input finished; none of them ran
// (`ai@7.0.111` runs no tool on a `length` step). Stale comment fixed
// 2026-09-24: this used to describe the pre-fix-round-1 rule, "a tool
// part a cut-off left open (a `tool-input-start` with no `tool-call` for
// its id)" — that only covered an unfinished call, not a finished one the
// SDK also never ran.
const CUT_OFF_TOOL_ERROR_TEXT = "Cut off at the output limit before it ran. Nothing from it was saved.";

// § 9.2's continuation note (fix round 1, lead rulings — amended
// 2026-09-24, commit 7c1b1be), a USER-role message (never a UIMessage,
// never seen by matchGateReply) appended to the continuation's own
// `messages` — word for word, unwrapped from the doc's blockquote.
const CUT_OFF_CONTINUATION_NOTE =
  "Note from the Ten app, not the candidate: your last reply was cut off at the output limit, so none of the actions in it ran. Every tool call in that reply was cancelled, including any that looked complete, and nothing from it was saved. Redo that reply's work in smaller pieces, one file per write. Actions from your earlier replies did run; check the files before repeating any of them.";

// § 9.4's stateless next-turn note, appended to the system prompt (after
// the gate-pending note, when both apply) when the assistant message just
// before the latest user message carries a `cut_off` data-error part —
// word for word, unwrapped from the doc's blockquote.
const CUT_OFF_NEXT_TURN_NOTE =
  '\n\n---\nYour previous reply in this chat was cut off at the output limit and could not be finished, so part of that work was never saved. Check the files for what is actually there. Tell the candidate plainly what was saved and what wasn\'t (never that nothing was attempted), then do what\'s missing in smaller pieces, one file per write, unless they asked for something else.';

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

// § 9.4: "The check is stateless and runs at the start of each turn. It
// looks at the assistant message just before the latest user message, in
// the history AS SENT, before the window trims it." No stored flag (rule
// 12) — this reads straight off the history the client resent.
function cutOffJustBeforeLatestUser(messages: AppMessage[]): boolean {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex <= 0) return false;
  const prev = messages[lastUserIndex - 1];
  if (prev.role !== "assistant") return false;
  const parts = prev.parts as unknown as Array<{ type: string; data?: { code?: string } }>;
  return parts.some((p) => p.type === "data-error" && p.data?.code === "cut_off");
}

// § 9.2: "drop a trailing assistant message with no content" — an
// AssistantModelMessage whose content is an empty string or an empty
// array (nothing survived the cut off in that step: no text, no
// finished tool call).
function isEmptyAssistantContent(content: unknown): boolean {
  if (typeof content === "string") return content.length === 0;
  if (Array.isArray(content)) return content.length === 0;
  return false;
}

// § 9.2 (amended 2026-09-24, lead rulings 1–2): builds the continuation's
// `messages`, in order — the first call's input messages; its response
// messages (drop a trailing assistant message with no content); right
// after the cut-off step's own assistant message (always the LAST entry
// of `responseMessages` — a cut-off step is always the call's last step,
// § 9.1, and nothing ran, so no tool message ever follows it), one `tool`
// message holding a synthesized `error-text` result for EACH of that
// message's `tool-call` parts (finished calls the SDK never executed —
// unfinished ones never reached `responseMessages` at all, so they need
// nothing); then the note. "The coach never executes tools itself."
function buildContinuationMessages(firstInputMessages: any[], responseMessages: any[]): any[] {
  const rm = [...responseMessages];
  if (rm.length > 0) {
    const last = rm[rm.length - 1];
    if (last.role === "assistant" && isEmptyAssistantContent(last.content)) {
      rm.pop();
    }
  }
  const out: any[] = [...firstInputMessages, ...rm];
  const cutOffStepMessage = rm[rm.length - 1];
  if (cutOffStepMessage?.role === "assistant") {
    const content = Array.isArray(cutOffStepMessage.content) ? cutOffStepMessage.content : [];
    const toolCalls = content.filter((p: any) => p?.type === "tool-call");
    if (toolCalls.length > 0) {
      out.push({
        role: "tool",
        content: toolCalls.map((tc: any) => ({
          type: "tool-result",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: { type: "error-text", value: CUT_OFF_TOOL_ERROR_TEXT },
        })),
      });
    }
  }
  out.push({ role: "user", content: CUT_OFF_CONTINUATION_NOTE });
  return out;
}

// Step 5b coder's fix (flagged in the hand-back): design-web-ui.md § 2.7
// requires `data-error.message` to be "the literal sentence the SERVER
// sent" for over_balance/model_error — the proxy's own § 8 copy
// ("Your beta credit is used up...", "The beta has reached today's
// limit...", "The model is temporarily unavailable. Try again."
// — handler.ts's own MESSAGES) differs BY CAUSE even though the `code`
// doesn't. `classifyError` used to return only the ErrorCode (always the
// generic ERROR_MESSAGES sentence below); it now also extracts the
// proxy's own `{ error: { code, message } }` body — from
// `APICallError.responseBody` (the AI SDK provider's own error shape,
// `@ai-sdk/provider`'s `APICallError`) when present — so a real refusal
// shows its real cause. No change when there's no parseable server
// message: the generic ERROR_MESSAGES sentence stands, exactly as before
// (existing tests asserting a fixed `.message` still pass unmodified).
// Stale comment fixed 2026-09-24: this used to quote a fourth proxy
// message, "The reply was cut off...", that never existed in handler.ts's
// MESSAGES — a cut-off reply is its own code, `cut_off` (§ 9, amended
// 2026-09-24), with a fixed message from ERROR_MESSAGES.cut_off above,
// never routed through this function.
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
function toPullReadableStream<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
  const iterator = iterable[Symbol.asyncIterator]();
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

// § 9.1 (amended 2026-09-24, "Every tool call in a cut-off step is treated
// as not run, whether or not its input finished, because none of them
// ran"): watches one call's raw `fullStream`, alongside the existing M4
// error tap (unchanged — still runs on the RAW part, before
// `toUIMessageStream` swallows the classifiable detail), for every tool
// call id seen in the CURRENT step (reset at each `start-step` — a step's
// own ids only, never an earlier, already-executed step's). The moment
// that step's `finish-step` reports `finishReason: "length"`, EVERY one of
// those ids — a finished call and an unfinished one alike, ai@7.0.111 ran
// neither — is closed with a direct `tool-input-error` UI chunk (§ 9.1's
// exact closing text), not something `toUIMessageStream` can derive from
// the raw stream alone (there's no such raw `TextStreamPart`).
//
// Follow-up B(1) (closing drift review of issue #2, 2026-09-24): § 9.1
// says "the tap's list" is "every `tool-input-start` id and every
// `tool-call` id the tap saw in the cut-off step" — a finished call has
// both, an unfinished one has only the first. The tap used to record only
// `tool-input-start`; a provider that emits a bare `tool-call` with no
// preceding `tool-input-start` for a step (e.g. a call whose input never
// streamed in pieces) would then close nothing for it. Both part types
// write into the same id-keyed map, so a call seen via both stays a
// single entry (dedup) and the reset-per-step behavior is unchanged.
function tapCutOffAndErrors(
  stream: AsyncIterable<any>,
  onError: (error: unknown) => void,
  onCutOffToolPart: (toolCallId: string, toolName: string) => void,
): ReadableStream<any> {
  async function* gen() {
    let stepToolIds = new Map<string, string>(); // toolCallId -> toolName, this step only.
    for await (const part of stream) {
      if (part?.type === "error") {
        onError(part.error);
      } else if (part?.type === "start-step") {
        stepToolIds = new Map();
      } else if (part?.type === "tool-input-start") {
        stepToolIds.set(part.id, part.toolName);
      } else if (part?.type === "tool-call") {
        stepToolIds.set(part.toolCallId, part.toolName);
      } else if (part?.type === "finish-step" && part.finishReason === "length") {
        for (const [toolCallId, toolName] of stepToolIds) onCutOffToolPart(toolCallId, toolName);
        stepToolIds = new Map();
      }
      yield part;
    }
  }
  return toPullReadableStream(gen());
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
            // Follow-up B(3) (closing drift review of issue #2, 2026-09-24):
            // § 9.2 says one { type: "finish" } is always written last, but
            // runTurn's own finish write is its very last statement — a
            // throw anywhere before it (caught here) used to leave the
            // stream with a data-error and no finish at all. This is the
            // only other place a turn's UI stream ends, so it's mutually
            // exclusive with runTurn's own finish write: at most one
            // "finish" is ever written per turn, still last of all.
            writer.write({ type: "finish" } as any);
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

  // § 9.4: checked on `messages` — the history AS SENT — before the
  // window trims it (a multi-JD turn's tool results can push `windowWords`
  // past exactly the cut-off turn). After the gate-pending note, when both
  // apply.
  if (cutOffJustBeforeLatestUser(messages)) {
    systemNote += CUT_OFF_NEXT_TURN_NOTE;
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
  // § 9.1 "A chat is never left broken" (amended 2026-09-24): the closing
  // above keeps a NEW cut-off from ever leaving a part `input-available`,
  // but this is the belt-and-suspenders for any OLDER history that still
  // holds one (a cut-off before this fix shipped, an abort, a closed tab)
  // — `ignoreIncompleteToolCalls: true` drops a tool part with no result
  // from the request instead of failing it with `MissingToolResultsError`.
  const modelMessages = await convertToModelMessages(windowed as any, { tools: tools as any, ignoreIncompleteToolCalls: true });

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

  // § 9.2: "every step's cost is added exactly once" — one recorder
  // shared by both calls' stop conditions AND the post-call catch-up
  // below, so nothing here decides cost on its own.
  function recordStepCost(step: { providerMetadata?: any }): void {
    const measuredUsd = step.providerMetadata?.openrouter?.usage?.cost ?? DEFAULT_STEP_COST_MEDIAN_USD;
    const sample: StepCostSample = { usd: measuredUsd };
    turnState.measuredSteps.push(sample);
    state.chatMeasuredSteps.push(sample);
    turnState.spentSoFarUsd += measuredUsd;
  }

  // ONE combined stop condition per call (not an array) so its side
  // effects — the step_cap error, the mid-run allowance gate — run in a
  // fixed order and exactly once per step boundary, with no risk of the
  // SDK evaluating several independent conditions' side effects on the
  // same step. `baseStepCount` is the number of steps already spent in
  // an EARLIER call this turn (0 for the first call, the first call's own
  // step count for the § 9.2 continuation) — § 9.2 precondition 2: "fewer
  // than maxSteps steps are used, counting both calls (the continuation's
  // stop condition uses the turn's total)".
  //
  // § 9.1 (amended 2026-09-24): "A cut-off step is always its call's last
  // step, because the loop ends there... The stop condition never runs on
  // a cut-off step and gets no new check" — ai@7.0.111 only calls this at
  // all when the step it just ran has a client tool call to decide
  // whether to continue past, and a `length` step never has one that
  // actually ran (see the hand-back). So cut-off detection lives entirely
  // in the post-call read below, not here. Returns both the condition
  // itself and how many of ITS OWN steps it recorded — a text-only step
  // (a call's own last, ordinary step, § 9.2's own named gap) also never
  // reaches this, which the post-call catch-up below fixes too.
  function makeStop(baseStepCount: number): { stop: StopCondition<typeof tools, any>; recordedCount: () => number } {
    let recordedThisCall = 0;
    const stop: StopCondition<typeof tools, any> = async ({ steps }) => {
      const last = steps[steps.length - 1];
      if (last && steps.length > recordedThisCall) {
        recordStepCost(last as any);
        recordedThisCall = steps.length;
      }

      // 1. the hard step cap, counting steps used in EARLIER calls too.
      if (baseStepCount + steps.length >= maxSteps) {
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
    return { stop, recordedCount: () => recordedThisCall };
  }

  interface CallOutcome {
    steps: readonly any[];
    cutOff: boolean;
    hadError: boolean;
    responseMessages: any[];
  }

  // Runs ONE streamText call to completion and merges its UI stream —
  // § 9.2's "one assistant message on screen": every call's stream is
  // merged with `sendFinish: false`, and the coach itself writes the ONE
  // `{ type: "finish" }` once both calls (or just the first) are done.
  async function runOneCall(callMessages: unknown, baseStepCount: number, sendStart: boolean): Promise<CallOutcome> {
    const { stop, recordedCount } = makeStop(baseStepCount);
    const result = streamText({
      model: deps.model,
      // § 9.2: "The system prompt stays the same, so the continuation can
      // reuse the prompt cache." Byte-identical on both calls: computed
      // once, above, never touched again after the first call starts.
      system: systemPrompt + systemNote,
      messages: callMessages as any,
      tools,
      stopWhen: stop,
      abortSignal,
      // Fix round 1, item 5 (flagged, outside this slice's own directory):
      // ONE proxy call per step. The AI SDK's default `maxRetries: 2`
      // auto-retries any APICallError with `isRetryable === true`, and the
      // installed @openrouter/ai-sdk-provider's own default for that is
      // "statusCode is 408/409/429/>=500" — ten-model-proxy's own
      // deliberate refusals (over_balance 402, not_a_member 403, 413) are
      // already outside that set and were never retried, but its 503
      // (model_error — both the beta ceiling AND a genuinely-down upstream
      // share this one status, § 8) IS >= 500, so the SDK silently retried
      // a single refused turn 2-3 times against the proxy before ever
      // reaching this package's own error handling. A raw network failure
      // (fetch() itself throwing — offline, DNS, connection reset) is
      // NEVER auto-retried by the SDK's default `shouldRetry` either way
      // (it only fires for an APICallError/GatewayError instance, not a
      // bare thrown error) — so `maxRetries: 0` costs nothing for "genuine
      // network errors"; there was no SDK-level retry safety net for them
      // to begin with. The candidate's own retry (typing again; the
      // `retryable: true` flag on the resulting data-error) is the actual
      // recovery path, same as it already is for every other error code.
      // § 9.2: "the identical request is never re-sent (`maxRetries: 0`
      // stays)".
      maxRetries: 0,
    });

    // Fix round 2, item 7: a refused first call (e.g. `recordedSteps.length
    // === 0`, § 8's own 402/503 refusals) makes streamText's OWN internal
    // deferred promises (finishReason/rawFinishReason/totalUsage/steps/
    // responseMessages — see @ai-sdk/provider-utils' own
    // rejectResultPromises) reject with a NoOutputGeneratedError. Reading
    // + settling them here (never throwing, never awaited by anything
    // that matters) gives every one of them a handler, independent of
    // whether this call actually finishes.
    void Promise.allSettled([result.steps, result.totalUsage, result.finishReason, result.responseMessages]);

    let hadError = false;
    const tapped = tapCutOffAndErrors(
      result.fullStream,
      (error) => {
        hadError = true;
        const { code, serverMessage } = classifyError(error);
        const { message, retryable } = ERROR_MESSAGES[code];
        writer.write({ type: "data-error", data: { code, message: serverMessage ?? message, retryable } });
      },
      (toolCallId, toolName) => {
        writer.write({
          type: "tool-input-error",
          toolCallId,
          toolName,
          input: {},
          errorText: CUT_OFF_TOOL_ERROR_TEXT,
        } as any);
      },
    );

    // § 9.2: "Every call's UI stream is merged with sendFinish: false, and
    // every call after the first also has sendStart: false." Read to the
    // end HERE (not fire-and-forget via `writer.merge`) — § 9.2's own "the
    // coach reads the first call's tapped stream to its end. It then
    // reads result.responseMessages ... and result.steps" needs those
    // promises settled before this function returns, which only happens
    // once `result.fullStream` (piped through `tapped`) is fully drained.
    const uiStream = toUIMessageStream({ stream: tapped, tools, sendStart, sendFinish: false });
    const reader = (uiStream as ReadableStream<any>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
    }

    // A refused call (e.g. the proxy's own 402/503, § 8) already got its
    // `data-error` from the tap's `onError` above — `result.steps` and
    // `result.responseMessages` then reject with a `NoOutputGeneratedError`
    // (fix round 2, item 7's own note). Falling back to `[]` here avoids
    // a SECOND, duplicate `data-error` from the outer catch in
    // `createCoach` (which only fires on a THROWN error, not a handled
    // stream part).
    const allSteps = await Promise.resolve(result.steps).catch(() => [] as any[]);
    // § 9.2: "The stop condition records the steps it sees. After each
    // call, the coach records any it didn't (at most the last)." — this
    // also fixes § 9.2's named gap: "today the last step of every call
    // goes uncounted" (a text-only or fully-dropped-tool-call cut-off
    // step never reaches `stop()` at all, see `makeStop`'s own note).
    if (allSteps.length > recordedCount()) {
      recordStepCost(allSteps[allSteps.length - 1] as any);
    }
    const lastStep = allSteps[allSteps.length - 1] as any;
    const cutOff = lastStep?.finishReason === "length";
    const responseMessages = (await Promise.resolve(result.responseMessages).catch(() => [] as any[])) as any[];
    return { steps: allSteps, cutOff, hadError, responseMessages };
  }

  const call1 = await runOneCall(modelMessages, 0, true);
  let finalCutOff = call1.cutOff;

  if (call1.cutOff) {
    // § 9.2's five preconditions, checked in the order named there.
    const preconditionsOk =
      // 1. no continuation has run this turn (there is only ever one
      //    attempt in this function — see "no third call" below).
      // 2. fewer than maxSteps steps are used, counting both calls.
      call1.steps.length < maxSteps &&
      // 3. no gate is pending for the chat.
      (await deps.gate.pending(chatId)) === null &&
      // 4. spent-so-far plus the projected next step is within the
      //    turn's allowance.
      turnState.spentSoFarUsd + projectedNextStepUsd() <= allowanceUsd &&
      // 5. the turn wasn't aborted, and the call didn't end on an
      //    `error` part.
      !abortSignal?.aborted &&
      !call1.hadError;

    if (preconditionsOk) {
      // § 9.2: messages, in order — the first call's input messages; its
      // response messages (drop a trailing assistant message with no
      // content); right after the cut-off step's own assistant message,
      // one synthesized-error tool message per its tool-call parts; then
      // the note, word for word (`buildContinuationMessages`, above).
      const continuationMessages = buildContinuationMessages(modelMessages as any[], call1.responseMessages);
      // "There is never a third call" — this is the ONLY continuation
      // attempt this function ever makes, whatever call 2 itself ends on.
      const call2 = await runOneCall(continuationMessages, call1.steps.length, false);
      finalCutOff = call2.cutOff;
    }
    // preconditions failing (or a second cut-off) both fall through to
    // the same visible § 9.3 `cut_off` below — no continuation, no gate.
  }

  if (finalCutOff) {
    // § 9.3: "A cut-off that can't be continued writes data-error
    // { code: 'cut_off', ... }. That covers any of 1–5 failing, including
    // a second cut-off in the turn. There is never a third call." Gates
    // are untouched by this path (no open/decide/expire above).
    const { message, retryable } = ERROR_MESSAGES.cut_off;
    writer.write({ type: "data-error", data: { code: "cut_off", message, retryable } });
  }

  // § 9.2 (amended 2026-09-24): "The coach writes one { type: 'finish' }
  // last of all, after any cut_off error." No apps/web code reads that
  // chunk's fields.
  writer.write({ type: "finish" } as any);
}
