// Tester-owned: docs/design-web-agent.md § 9.8 (x) "The chat is never
// poisoned" (amended 7c1b1be, lead ruling 1) and § 9.1 "A chat is never
// left broken". Written from the spec, not the code.
//
// "Take each outcome: continued and succeeded; cut_off from each of
// conditions 1–5; a second cut-off; aborted during the continuation. Add a
// new typed user message to the resulting UI messages and run the next
// turn. Pass when that turn's model request is sent, with no
// MissingToolResultsError and no model_error. Also pass a hand-built
// history with a tool part stuck in input-available (the shape before this
// fix): it must reach the model too."
//
// Every cut-off below holds a FINISHED write_file next to an unfinished one
// (the receipt's shape and the one that poisoned the chat before the fix).
// Real @openrouter/ai-sdk-provider over a stubbed fetch; no network.
// Run: node --test tests/agent/cut-off-never-poisoned.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { danglingToolCalls, sse, stubbedOpenRouter, textReply, toolReply, type SseScript } from "./_openrouter_stub.ts";
import { AI, dataChunks, makeCoach, runTurn, user } from "./_support.ts";

const PARTIAL = '{"path":"evaluations/beta.md","content":"# Beta Corp\\n\\nVerdict: Strong fit because';
const NEXT_REPLY = "NEXT-TURN-REPLY";

/** A cut-off step with a finished and an unfinished write_file. */
const mixedCut = (tag: string, cost = 0.0078125) =>
  sse()
    .text(`Recording both (${tag}).`)
    .toolCall(0, `done_${tag}`, "write_file", { path: `evaluations/alpha-${tag}.md`, content: "# Alpha" })
    .toolCallCutOff(1, `cut_${tag}`, "write_file", PARTIAL)
    .finish("length")
    .usage(cost, 8192);

const errorsOf = (chunks: any[], code?: string) => dataChunks(chunks, "data-error").filter((c) => !code || c.data.code === code);
const BIG = { action: "Evaluate six saved roles", steps: 500, webSearches: 6, items: ["Nimbus Robotics — Analytics Engineer"] };

/** Runs one turn with an abort controller; `abortWhen` sees each UI chunk
 *  and the chunks so far. Returns the chunks and the assembled message. */
async function runTurnAborting(coach: any, chatId: string, messages: any[], abortWhen: (c: any, seen: any[]) => boolean) {
  const ac = new AbortController();
  const stream: ReadableStream = coach.stream({ chatId, messages, abortSignal: ac.signal });
  const chunks: any[] = [];
  const reader = stream.getReader();
  for (;;) {
    let r;
    try {
      r = await reader.read();
    } catch {
      break;
    }
    if (r.done) break;
    chunks.push(r.value);
    if (!ac.signal.aborted && abortWhen(r.value, chunks)) ac.abort();
  }
  const s = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } });
  let message: any = null;
  try {
    for await (const m of (AI as any).readUIMessageStream({ stream: s })) message = m;
  } catch {
    /* an aborted stream may carry an error chunk; keep what assembled */
  }
  return { chunks, message };
}

/** The (x) check: append a typed user message to the resulting UI
 *  messages, run the next turn, and require its model request to be sent,
 *  valid, with no model_error. */
async function assertNextTurnReachesModel(label: string, coach: any, chatId: string, history: any[], m: { requests: any[] }) {
  const before = m.requests.length;
  const next = await runTurn(coach, chatId, [...history, user(`u-next-${label}`, "What got saved, and what's left?")]);
  const errs = errorsOf(next.chunks).map((c) => c.data);
  assert.equal(m.requests.length, before + 1, `${label}: the next turn's model request was sent (its errors: ${JSON.stringify(errs)})`);
  assert.deepEqual(errorsOf(next.chunks, "model_error").map((c) => c.data), [], `${label}: no model_error`);
  assert.deepEqual(danglingToolCalls(m.requests.at(-1)), [], `${label}: every tool_call in the request has its result`);
  assert.ok(next.message?.parts?.some((p: any) => p.type === "text" && p.text.includes(NEXT_REPLY)), `${label}: the model's reply reached the screen`);
  return next;
}

// ------------------------------------------------------------------ outcomes

test("(x) continued and succeeded: the next turn reaches the model", async () => {
  const m = stubbedOpenRouter([mixedCut("ok"), textReply("Redone in pieces."), textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h = [user("u1", "Evaluate Alpha and Beta")];
  const t1 = await runTurn(coach, "x-ok", h);
  assert.deepEqual(errorsOf(t1.chunks, "cut_off"), [], "precondition: continued");
  await assertNextTurnReachesModel("continued", coach, "x-ok", [...h, t1.message], m);
});

test("(x) cut_off from condition 1 (a continuation already ran this turn): the next turn reaches the model", async () => {
  // the continuation runs a tool step, then its next step is cut off: no third call.
  const m = stubbedOpenRouter([mixedCut("c1a"), toolReply("list_files", {}), mixedCut("c1b"), textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h = [user("u1", "Evaluate Alpha and Beta")];
  const t1 = await runTurn(coach, "x-c1", h);
  assert.equal(errorsOf(t1.chunks, "cut_off").length, 1, "precondition: cut_off");
  assert.equal(m.requests.length, 3);
  await assertNextTurnReachesModel("condition 1", coach, "x-c1", [...h, t1.message], m);
});

test("(x) cut_off from condition 2 (step cap): the next turn reaches the model", async () => {
  const m = stubbedOpenRouter([toolReply("list_files", {}), mixedCut("c2"), textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model, limits: { maxSteps: 2 } });
  const h = [user("u1", "Evaluate Alpha and Beta")];
  const t1 = await runTurn(coach, "x-c2", h);
  assert.equal(errorsOf(t1.chunks, "cut_off").length, 1, "precondition: cut_off");
  await assertNextTurnReachesModel("condition 2", coach, "x-c2", [...h, t1.message], m);
});

test("(x) cut_off from condition 3 (a gate is pending): the next turn reaches the model", async () => {
  const m = stubbedOpenRouter([toolReply("estimate_cost", BIG), mixedCut("c3"), textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h0 = [user("u1", "evaluate all six")];
  const t0 = await runTurn(coach, "x-c3", h0);
  assert.equal(dataChunks(t0.chunks, "data-gate").length, 1, "precondition: a pending gate");
  const h1 = [...h0, t0.message, user("u2", "which six are these?")];
  const t1 = await runTurn(coach, "x-c3", h1);
  assert.equal(errorsOf(t1.chunks, "cut_off").length, 1, "precondition: cut_off");
  await assertNextTurnReachesModel("condition 3", coach, "x-c3", [...h1, t1.message], m);
});

test("(x) cut_off from condition 4 (allowance): the next turn reaches the model", async () => {
  const m = stubbedOpenRouter([mixedCut("c4", 0.625), textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h = [user("u1", "Evaluate Alpha and Beta")];
  const t1 = await runTurn(coach, "x-c4", h);
  assert.equal(errorsOf(t1.chunks, "cut_off").length, 1, "precondition: cut_off");
  assert.equal(m.requests.length, 1);
  await assertNextTurnReachesModel("condition 4", coach, "x-c4", [...h, t1.message], m);
});

test("(x) cut_off from condition 5 (the turn was aborted): the next turn reaches the model", async () => {
  const m = stubbedOpenRouter([mixedCut("c5"), textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h = [user("u1", "Evaluate Alpha and Beta")];
  const t1 = await runTurnAborting(coach, "x-c5", h, (c) => c.type === "finish-step");
  assert.equal(m.requests.length, 1, "precondition: no continuation after the abort");
  assert.ok(t1.message, "a message assembled");
  await assertNextTurnReachesModel("condition 5 (abort)", coach, "x-c5", [...h, t1.message], m);
});

// Condition 5's other half ("the call didn't end on an error part"): the
// real provider maps an error chunk to finish "error", never "length", so a
// length-plus-error call can't be streamed. The closest real shape — a
// finished call, then an upstream error — leaves a call with no result all
// the same, which is what this requirement is about.
test("(x) condition 5 (an error part after a finished call): the next turn reaches the model", async () => {
  const errored = sse()
    .text("Recording.")
    .toolCall(0, "done_err", "write_file", { path: "evaluations/alpha-err.md", content: "# Alpha" })
    .upstreamError();
  const m = stubbedOpenRouter([errored, textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h = [user("u1", "Evaluate Alpha")];
  const t1 = await runTurn(coach, "x-c5e", h);
  assert.equal(m.requests.length, 1, "precondition: no continuation after an error");
  assert.ok(errorsOf(t1.chunks).length >= 1, "precondition: the error is visible");
  await assertNextTurnReachesModel("condition 5 (error part)", coach, "x-c5e", [...h, t1.message], m);
});

test("(x) a second cut-off: the next turn reaches the model", async () => {
  const m = stubbedOpenRouter([mixedCut("2a"), mixedCut("2b"), textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h = [user("u1", "Evaluate Alpha and Beta")];
  const t1 = await runTurn(coach, "x-2nd", h);
  assert.equal(errorsOf(t1.chunks, "cut_off").length, 1, "precondition: cut_off");
  assert.equal(m.requests.length, 2);
  await assertNextTurnReachesModel("second cut-off", coach, "x-2nd", [...h, t1.message], m);
});

test("(x) aborted during the continuation (mid tool call): the next turn reaches the model", async () => {
  const cont: SseScript = sse()
    .text("Redoing Alpha.")
    .toolCall(0, "cont_done", "write_file", { path: "evaluations/alpha-cont.md", content: "# Alpha" })
    .toolCallCutOff(1, "cont_open", "write_file", PARTIAL)
    .toolDelta(1, ' more words')
    .toolDelta(1, ' and more')
    .finish("tool_calls")
    .usage(0.0078125)
    .slow(15);
  const m = stubbedOpenRouter([mixedCut("ab"), cont, textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  const h = [user("u1", "Evaluate Alpha and Beta")];
  // abort once the continuation's own write_file has started streaming
  const t1 = await runTurnAborting(coach, "x-abort2", h, (c) => c.type === "tool-input-start" && c.toolCallId === "cont_open");
  assert.equal(m.requests.length, 2, "precondition: the continuation was sent, then aborted");
  assert.ok(t1.message, "a message assembled");
  await assertNextTurnReachesModel("aborted continuation", coach, "x-abort2", [...h, t1.message], m);
});

// ------------------------------------------------------------------ hand-built history

test("(x) a hand-built history with a tool part stuck in input-available (the pre-fix shape) reaches the model", async () => {
  const stuck = {
    id: "a-stuck",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "text", text: "Recording both verdicts.", state: "done" },
      { type: "tool-write_file", toolCallId: "call_stuck", state: "input-available", input: { path: "evaluations/alpha.md", content: "# Alpha" } },
      { type: "tool-write_file", toolCallId: "call_err", state: "output-error", input: {}, errorText: "Cut off at the output limit before it ran. Nothing from it was saved." },
      { type: "data-error", data: { code: "model_error", message: "Something went wrong talking to the model.", retryable: true } },
    ],
  };
  const m = stubbedOpenRouter([textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  await assertNextTurnReachesModel("hand-built input-available", coach, "x-hand", [user("u1", "Evaluate Alpha and Beta"), stuck], m);
  assert.ok(!JSON.stringify(m.requests[0]).includes("call_stuck"), "the incomplete call is left out of the request");
});

test("(x) a hand-built history with a tool part stuck in input-streaming reaches the model", async () => {
  const stuck = {
    id: "a-stream",
    role: "assistant",
    parts: [{ type: "tool-write_file", toolCallId: "call_streaming", state: "input-streaming", input: { path: "evaluations/b" } }],
  };
  const m = stubbedOpenRouter([textReply(NEXT_REPLY)]);
  const { coach } = makeCoach({ model: m.model });
  await assertNextTurnReachesModel("hand-built input-streaming", coach, "x-hand2", [user("u1", "go"), stuck], m);
});
