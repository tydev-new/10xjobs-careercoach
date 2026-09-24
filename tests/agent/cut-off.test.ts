// Tester-owned acceptance suite for issue #2: docs/design-web-agent.md § 9
// (cut-off replies, amended 2026-09-24; fix round 1 amendment 7c1b1be) — § 9.8 items
// (i)–(iv) plus the § 9.2 accounting rules (cost once, step cap and
// allowance across both calls). Written from the spec, not the code.
//
// The model is the REAL @openrouter/ai-sdk-provider 3.1.0 over a stubbed
// fetch streaming OpenRouter SSE (tests/agent/_openrouter_stub.ts), so the
// provider's own `finish_reason: "length"` handling is what's under test —
// the actual root-cause path. In-memory store, recording gate, no network.
//
// Run: node --test tests/agent/cut-off.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import { CONTINUATION_NOTE, CUT_OFF_MESSAGE, NEXT_TURN_NOTE, TOOL_CLOSE_TEXT } from "./_spec9.ts";
import { contentText, danglingToolCalls, lastMessage, sse, stubbedOpenRouter, systemOf, textReply, toolReply } from "./_openrouter_stub.ts";
import { dataChunks, makeCoach, recordingGate, runTurn, user } from "./_support.ts";

// ------------------------------------------------------------------ helpers

const PARTIAL = '{"path":"evaluations/beta.md","content":"# Beta Corp — Senior Analyst\\n\\nVerdict: Strong fit because the role asks for';
const PARTIAL_MARK = "Strong fit because the role asks for";

/** An in-memory store that counts every write per path. */
function countingStore(files: Record<string, string> = {}) {
  const inner: any = createInMemoryWorkspaceStore(files);
  const writes: Record<string, number> = {};
  const store = new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === "write") {
        return async (p: string, ...rest: any[]) => {
          writes[p] = (writes[p] ?? 0) + 1;
          return target.write(p, ...rest);
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { store, writes };
}

const errorsOf = (chunks: any[], code?: string) => dataChunks(chunks, "data-error").filter((c) => !code || c.data.code === code);
const count = (chunks: any[], type: string) => chunks.filter((c) => c.type === type).length;
const toolParts = (message: any, id?: string) => (message?.parts ?? []).filter((p: any) => p.type?.startsWith("tool-") && (!id || p.toolCallId === id));
const noteRequests = (reqs: any[]) => reqs.filter((r) => { const l = lastMessage(r); return l.role === "user" && contentText(l.content) === CONTINUATION_NOTE; });

function assertValidRequests(reqs: any[]) {
  reqs.forEach((r, i) => assert.deepEqual(danglingToolCalls(r), [], `request #${i + 1} carries a tool_call with no tool result`));
}

/** One stop: one `start`, one `finish`, and `finish` is the last chunk (§ 9.2
 *  "The coach writes one { type: "finish" } last"). */
function assertOneMessage(chunks: any[], message: any) {
  assert.equal(count(chunks, "start"), 1, "exactly one start chunk");
  assert.equal(count(chunks, "finish"), 1, "exactly one finish chunk");
  assert.equal(message?.role, "assistant");
}
function assertFinishLast(chunks: any[]) {
  assert.equal(chunks.at(-1)?.type, "finish", `§ 9.2: finish is written last; tail was ${JSON.stringify(chunks.slice(-3).map((c) => c.type + (c.data?.code ? ":" + c.data.code : "")))}`);
}

// ------------------------------------------------------------------ (i) one continuation, then success

test("(i) a write_file cut off mid-string: exactly one note-carrying request, the continuation's tool runs, one message, part closed with the closing text, no cut_off", async () => {
  const m = stubbedOpenRouter([
    sse().text("Writing the Beta Corp verdict now.").toolCallCutOff(0, "call_cut", "write_file", PARTIAL).finish("length").usage(0.05, 8192),
    toolReply("write_file", { path: "evaluations/beta.md", content: "# Beta Corp\n\nVerdict: strong fit." }, 0.02, "call_retry"),
    textReply("Saved the Beta Corp verdict.", 0.01),
  ]);
  const { store, writes } = countingStore();
  const { coach } = makeCoach({ model: m.model, workspace: store });
  const { chunks, message } = await runTurn(coach, "c-i", [user("u1", "Evaluate the Beta Corp role")]);

  // exactly one continuation — the only request carrying the note is the 2nd.
  assert.equal(m.requests.length, 3, "call 1 (cut off) + the continuation's two steps (tool, then stop)");
  const notes = noteRequests(m.requests);
  assert.equal(notes.length, 1, "exactly one continuation request ends with the note");
  assert.equal(m.requests.indexOf(notes[0]), 1, "the continuation is the 2nd request");

  const [r1, r2] = m.requests;
  assert.equal(systemOf(r2), systemOf(r1), "same system prompt (cache reuse)");
  assert.notDeepEqual(r2.messages, r1.messages, "the continuation differs from the first request (never the identical request)");
  assert.equal(lastMessage(r2).role, "user");
  assert.equal(contentText(lastMessage(r2).content), CONTINUATION_NOTE, "ends with the § 9.2 note, word for word");
  // messages, in order: the first call's input messages, then its response.
  assert.deepEqual(r2.messages.slice(0, r1.messages.length), r1.messages, "starts with the first call's input messages");
  const between = r2.messages.slice(r1.messages.length, -1);
  assert.ok(between.some((x: any) => x.role === "assistant" && contentText(x.content).includes("Writing the Beta Corp verdict now.")), "then its response messages");
  assert.ok(!JSON.stringify(r2).includes(PARTIAL_MARK), "the partial arguments are never re-sent");
  assert.equal(r2.model, r1.model, "same model");
  assert.deepEqual(r2.tools, r1.tools, "same tools");
  assertValidRequests(m.requests);

  // the continuation's tool ran.
  assert.equal(writes["evaluations/beta.md"], 1, "the continuation's write_file ran exactly once");

  // one assistant message on screen.
  assertOneMessage(chunks, message);
  assertFinishLast(chunks);

  // the dangling part: one part for its id, output-error, § 9.1 text, input {}.
  const cut = toolParts(message, "call_cut");
  assert.equal(cut.length, 1, "one part per call id (the late tool-input-error updated the open part)");
  assert.equal(cut[0].state, "output-error");
  assert.equal(cut[0].errorText, TOOL_CLOSE_TEXT);
  // § 9.1 names the CHUNK: tool-input-error with input: {}. (ai@7.0.111's
  // UI processor stores a non-dynamic tool's error input as `rawInput`.)
  const closeChunks = chunks.filter((c) => c.type === "tool-input-error" && c.toolCallId === "call_cut");
  assert.equal(closeChunks.length, 1, "closed by exactly one tool-input-error chunk");
  assert.deepEqual(closeChunks[0].input, {}, "closed with input: {}");
  assert.equal(closeChunks[0].errorText, TOOL_CLOSE_TEXT);
  assert.deepEqual(cut[0].input ?? cut[0].rawInput, {});
  assert.equal(toolParts(message, "call_retry")[0]?.state, "output-available");

  assert.deepEqual(errorsOf(chunks), [], "no data-error at all (no cut_off)");
});

test("(i) variant: a text-only cut-off gets exactly two requests and no cut_off", async () => {
  const m = stubbedOpenRouter([
    sse().text("Here is the long analysis of all four roles. Role one: the team").finish("length").usage(0.04, 8192),
    textReply("Short version: role one fits, the rest are a stretch.", 0.01),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const { chunks, message } = await runTurn(coach, "c-i-text", [user("u1", "Compare the four roles")]);
  assert.equal(m.requests.length, 2);
  assert.equal(contentText(lastMessage(m.requests[1]).content), CONTINUATION_NOTE);
  assert.equal(systemOf(m.requests[1]), systemOf(m.requests[0]));
  assertValidRequests(m.requests);
  assertOneMessage(chunks, message);
  assertFinishLast(chunks);
  assert.deepEqual(errorsOf(chunks), []);
});

test("(i) variant: a cut-off holding nothing but the unfinished call sends no empty assistant message", async () => {
  const m = stubbedOpenRouter([
    sse().toolCallCutOff(0, "call_cut", "write_file", PARTIAL).finish("length").usage(0.04, 8192),
    textReply("Done in smaller pieces.", 0.01),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const { chunks, message } = await runTurn(coach, "c-i-empty", [user("u1", "Evaluate Beta")]);
  assert.equal(m.requests.length, 2);
  const r2 = m.requests[1];
  const empties = r2.messages.filter((x: any) => x.role === "assistant" && !contentText(x.content) && !(x.tool_calls?.length));
  assert.deepEqual(empties, [], "§ 9.2: a trailing assistant message with no content is dropped");
  assert.equal(contentText(lastMessage(r2).content), CONTINUATION_NOTE);
  assertOneMessage(chunks, message);
  assert.equal(toolParts(message, "call_cut")[0]?.errorText, TOOL_CLOSE_TEXT);
  assert.deepEqual(errorsOf(chunks), []);
});

// § 9.8(i) variant (amended 7c1b1be, lead ruling 1): "A cut-off step
// holding a finished and an unfinished write_file. Pass when: neither runs,
// and the store is unchanged; both UI parts end output-error with the
// closing text; the note-carrying request holds one synthesized error-text
// result, for the finished call; it is sent with no MissingToolResultsError."
// This is the receipt's own shape: the final batch write of several
// verdicts, the last one cut off.

const DONE_INPUT = { path: "evaluations/alpha.md", content: "# Alpha\n\nVerdict: apply." };

/** The note-carrying request's view of the cut-off step: the assistant
 *  message holding `callId`, and the tool messages right after it. */
function synthesizedResults(req: any, callId: string) {
  const msgs: any[] = req.messages;
  const ai = msgs.findIndex((x) => x.role === "assistant" && (x.tool_calls ?? []).some((tc: any) => tc.id === callId));
  assert.ok(ai >= 0, `the cut-off step's assistant message (with ${callId}) is in the request`);
  const tools: any[] = [];
  let j = ai + 1;
  while (j < msgs.length && msgs[j].role === "tool") tools.push(msgs[j++]);
  return { assistant: msgs[ai], tools, next: msgs[j], nextIndex: j };
}

test("(i) variant: a cut-off step with a finished AND an unfinished write_file — neither runs, both close with the closing text, one synthesized error-text result, the continuation is sent", async () => {
  const m = stubbedOpenRouter([
    sse()
      .text("Recording both verdicts.")
      .toolCall(0, "call_done", "write_file", DONE_INPUT)
      .toolCallCutOff(1, "call_cut", "write_file", PARTIAL)
      .finish("length")
      .usage(0.05, 8192),
    textReply("Neither saved; redoing Alpha, then Beta, one file per write.", 0.01),
  ]);
  const { store, writes } = countingStore();
  const { coach } = makeCoach({ model: m.model, workspace: store });
  const { chunks, message } = await runTurn(coach, "c-i-mid", [user("u1", "Evaluate Alpha and Beta")]);
  const errs = errorsOf(chunks).map((c) => c.data);

  // neither runs; the store is unchanged.
  assert.deepEqual(writes, {}, "no write at all — not even the finished call");
  const listed = (await store.list()).map((f: any) => f.path).filter((p: string) => !p.startsWith("skills/"));
  assert.deepEqual(listed, [], "store unchanged");

  // both UI parts end output-error with the closing text (one part per id).
  for (const id of ["call_done", "call_cut"]) {
    const p = toolParts(message, id);
    assert.equal(p.length, 1, `${id}: one part`);
    assert.equal(p[0].state, "output-error", `${id}: output-error`);
    assert.equal(p[0].errorText, TOOL_CLOSE_TEXT, `${id}: the closing text`);
    const close = chunks.filter((c) => c.type === "tool-input-error" && c.toolCallId === id);
    assert.equal(close.length, 1, `${id}: closed by exactly one tool-input-error chunk`);
    assert.deepEqual(close[0].input, {}, `${id}: closed with input: {}`);
  }

  // it is sent (no MissingToolResultsError), exactly once, text-only reply -> 2 requests.
  assert.equal(m.requests.length, 2, `the continuation was sent (errors: ${JSON.stringify(errs)})`);
  const notes = noteRequests(m.requests);
  assert.equal(notes.length, 1, "exactly one note-carrying request");
  const r2 = notes[0];
  assert.equal(systemOf(r2), systemOf(m.requests[0]));
  assertValidRequests(m.requests);

  // one synthesized error-text result, for the finished call, right after its
  // assistant message, followed by the note.
  const s = synthesizedResults(r2, "call_done");
  assert.deepEqual(s.assistant.tool_calls.map((tc: any) => tc.id), ["call_done"], "only the finished call reached the response messages");
  assert.deepEqual(JSON.parse(s.assistant.tool_calls[0].function.arguments), DONE_INPUT, "the finished call keeps its own input");
  assert.deepEqual(s.tools.map((t: any) => [t.tool_call_id, t.content]), [["call_done", TOOL_CLOSE_TEXT]], "one synthesized error-text result, for the finished call");
  assert.equal(s.nextIndex, r2.messages.length - 1, "the note follows the synthesized result directly");
  assert.equal(contentText(s.next.content), CONTINUATION_NOTE);
  assert.ok(!JSON.stringify(r2).includes("call_cut"), "the unfinished call never reached the request");
  assert.ok(!JSON.stringify(r2).includes(PARTIAL_MARK), "nor its partial arguments");

  assertOneMessage(chunks, message);
  assertFinishLast(chunks);
  assert.deepEqual(errs, [], "no error (no model_error, no cut_off)");
});

test("(i) variant: a cut-off step whose ONLY tool call finished — it does not run, closes with the closing text, gets one synthesized result, and the continuation is sent", async () => {
  const m = stubbedOpenRouter([
    sse().toolCall(0, "call_done", "write_file", DONE_INPUT).finish("length").usage(0.05, 8192),
    textReply("Not saved; redoing it.", 0.01),
  ]);
  const { store, writes } = countingStore();
  const { coach } = makeCoach({ model: m.model, workspace: store });
  const { chunks, message } = await runTurn(coach, "c-i-edge", [user("u1", "Evaluate Alpha")]);
  assert.deepEqual(writes, {}, "the finished call did not run");
  const p = toolParts(message, "call_done");
  assert.equal(p.length, 1);
  assert.equal(p[0].state, "output-error");
  assert.equal(p[0].errorText, TOOL_CLOSE_TEXT);
  assert.equal(noteRequests(m.requests).length, 1, `the continuation was sent (errors: ${JSON.stringify(errorsOf(chunks).map((c) => c.data))})`);
  assert.equal(m.requests.length, 2);
  const s = synthesizedResults(m.requests[1], "call_done");
  assert.deepEqual(s.tools.map((t: any) => [t.tool_call_id, t.content]), [["call_done", TOOL_CLOSE_TEXT]]);
  assertValidRequests(m.requests);
  assertFinishLast(chunks);
  assert.deepEqual(errorsOf(chunks), []);
});

test("(i) variant: three finished calls + one cut off (the receipt's batch write) — none runs, three synthesized results in call order", async () => {
  const inputs = ["a", "b", "c"].map((k) => ({ path: `evaluations/${k}.md`, content: `# ${k}` }));
  const script = sse().text("Writing all four verdicts.");
  inputs.forEach((inp, i) => script.toolCall(i, `call_${i}`, "write_file", inp));
  script.toolCallCutOff(3, "call_3", "write_file", PARTIAL).finish("length").usage(0.3, 8192);
  const m = stubbedOpenRouter([script, textReply("Redoing one at a time.", 0.01)]);
  const { store, writes } = countingStore();
  const { coach } = makeCoach({ model: m.model, workspace: store });
  const { chunks, message } = await runTurn(coach, "c-i-batch", [user("u1", "Evaluate all four")]);
  assert.deepEqual(writes, {});
  for (const id of ["call_0", "call_1", "call_2", "call_3"]) {
    const p = toolParts(message, id);
    assert.equal(p.length, 1, id);
    assert.equal(p[0].errorText, TOOL_CLOSE_TEXT, id);
  }
  assert.equal(m.requests.length, 2);
  const s = synthesizedResults(m.requests[1], "call_0");
  assert.deepEqual(s.tools.map((t: any) => [t.tool_call_id, t.content]), [0, 1, 2].map((i) => [`call_${i}`, TOOL_CLOSE_TEXT]));
  assertValidRequests(m.requests);
  assert.deepEqual(errorsOf(chunks), []);
});

// (the next-turn check after these shapes lives in cut-off-never-poisoned.test.ts, § 9.8 (x))

// ------------------------------------------------------------------ (ii) cut off twice

test("(ii) the continuation's first reply also ends on length: exactly two requests, one cut_off (fixed message, retryable), finish after it", async () => {
  const m = stubbedOpenRouter([
    sse().text("Writing.").toolCallCutOff(0, "call_1", "write_file", PARTIAL).finish("length").usage(0.04, 8192),
    sse().text("Retrying smaller.").toolCallCutOff(0, "call_2", "write_file", PARTIAL).finish("length").usage(0.04, 8192),
    textReply("MUST NOT BE REQUESTED"),
  ]);
  const rg = recordingGate();
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const { chunks, message } = await runTurn(coach, "c-ii", [user("u1", "Evaluate all four")]);
  assert.equal(m.requests.length, 2, "never a third call");
  const cut = errorsOf(chunks, "cut_off");
  assert.equal(cut.length, 1);
  assert.deepEqual(cut[0].data, { code: "cut_off", message: CUT_OFF_MESSAGE, retryable: true });
  assert.equal(errorsOf(chunks).length, 1, "no other error");
  assertOneMessage(chunks, message);
  const cutAt = chunks.findIndex((c) => c.type === "data-error" && c.data.code === "cut_off");
  const finAt = chunks.findIndex((c) => c.type === "finish");
  assert.ok(finAt > cutAt, "finish comes after the cut_off error");
  assertFinishLast(chunks);
  for (const id of ["call_1", "call_2"]) {
    const p = toolParts(message, id);
    assert.equal(p.length, 1, `${id}: one part`);
    assert.equal(p[0].errorText, TOOL_CLOSE_TEXT, `${id}: closed with the closing text`);
  }
  assert.ok(message.parts.some((p: any) => p.type === "data-error" && p.data.code === "cut_off"), "the cut_off part is in the assembled message");
  assert.deepEqual(rg.events.filter((e) => e.op !== "expireOtherChats"), [], "no gate open/decide");
});

test("(ii) text-only twice: finish is still the last chunk, after the cut_off", async () => {
  const m = stubbedOpenRouter([
    sse().text("a").finish("length").usage(0.04, 8192),
    sse().text("b").finish("length").usage(0.04, 8192),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const { chunks } = await runTurn(coach, "c-ii-last", [user("u1", "go")]);
  assert.equal(errorsOf(chunks, "cut_off").length, 1);
  assertFinishLast(chunks);
});

// ------------------------------------------------------------------ (iii) continuation blocked

const cutStep = (cost: number) => sse().text("Long batch write.").toolCallCutOff(0, `call_${cost}`, "write_file", PARTIAL).finish("length").usage(cost, 8192);

// Costs are exact binary fractions, so the sums compare exactly. The
// projected next step is § 4's (the chat's highest measured step cost).

test("(iii)(a) spent + projected passes the allowance: no second request, one cut_off, no gate", async () => {
  // spent 0.625 + projected 0.625 = 1.25 > $1.00 allowance.
  const m = stubbedOpenRouter([cutStep(0.625), textReply("MUST NOT BE REQUESTED")]);
  const rg = recordingGate();
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const { chunks } = await runTurn(coach, "c-iii-a", [user("u1", "Evaluate")]);
  assert.equal(m.requests.length, 1, "no continuation (this also fails if the cut-off step's cost went uncounted)");
  assert.equal(errorsOf(chunks, "cut_off").length, 1);
  assert.deepEqual(dataChunks(chunks, "data-gate"), [], "an allowance stop here opens no gate (§ 9.3)");
  assert.deepEqual(rg.events.filter((e) => e.op === "open" || e.op === "decide"), []);
});

test("(iii)(a) boundary: spent + projected within the allowance continues (fails if the cut-off step is counted twice)", async () => {
  // counted once: 0.375 + 0.375 = 0.75 <= 1.00; counted twice: 1.125 > 1.00.
  const m = stubbedOpenRouter([cutStep(0.375), textReply("ok", 0.0078125)]);
  const { coach } = makeCoach({ model: m.model });
  const { chunks } = await runTurn(coach, "c-iii-a2", [user("u1", "Evaluate")]);
  assert.equal(m.requests.length, 2);
  assert.deepEqual(errorsOf(chunks), []);
});

test("(iii)(b) the cut-off step is step maxSteps: no second request, one cut_off, no step_cap", async () => {
  const m = stubbedOpenRouter([
    toolReply("list_files", {}, 0.0078125),
    cutStep(0.0078125),
    textReply("MUST NOT BE REQUESTED"),
  ]);
  const { coach } = makeCoach({ model: m.model, limits: { maxSteps: 2 } });
  const { chunks } = await runTurn(coach, "c-iii-b", [user("u1", "Evaluate")]);
  assert.equal(m.requests.length, 2);
  assert.equal(errorsOf(chunks, "cut_off").length, 1);
  assert.deepEqual(errorsOf(chunks, "step_cap"), [], "no step_cap is written");
});

test("(iii)(b) counterpart: one step to spare lets the continuation run", async () => {
  const m = stubbedOpenRouter([toolReply("list_files", {}, 0.0078125), cutStep(0.0078125), textReply("ok", 0.0078125)]);
  const { coach } = makeCoach({ model: m.model, limits: { maxSteps: 3 } });
  const { chunks } = await runTurn(coach, "c-iii-b2", [user("u1", "Evaluate")]);
  assert.equal(m.requests.length, 3);
  assert.deepEqual(errorsOf(chunks), []);
});

const BIG = { action: "Evaluate six saved roles", steps: 500, webSearches: 6, items: ["Nimbus Robotics — Analytics Engineer"] };

test("(iii)(c) a gate is pending: no second request, one cut_off, the gate stays pending, and this path never opens/decides/expires a gate", async () => {
  const m = stubbedOpenRouter([
    toolReply("estimate_cost", BIG, 0.0078125),
    cutStep(0.0078125),
    textReply("MUST NOT BE REQUESTED"),
  ]);
  const rg = recordingGate();
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "c-iii-c", [user("u1", "evaluate all six")]);
  const gate = dataChunks(t1.chunks, "data-gate")[0]?.data;
  assert.ok(gate, "turn 1 opened a spend gate");
  assert.equal(m.requests.length, 1);

  const evBefore = rg.events.length;
  const t2 = await runTurn(coach, "c-iii-c", [user("u1", "evaluate all six"), t1.message, user("u2", "which six are these?")]);
  assert.equal(m.requests.length, 2, "turn 2 made one model call and no continuation");
  assert.equal(errorsOf(t2.chunks, "cut_off").length, 1);
  assert.deepEqual(rg.events.slice(evBefore), [], "no open, decide or expire from this path");
  assert.equal(rg.rows.get(gate.gateId)?.status, "pending", "the gate stays pending");
  assert.notEqual(await rg.gate.pending("c-iii-c"), null);
});

// ------------------------------------------------------------------ § 9.2 accounting across both calls

test("§ 9.2 cost once, across both calls: the cut-off step counts exactly once in the chat (next turn's estimate_cost)", async () => {
  // turn 1: list_files 0.125, then a cut-off step 0.625 -> 0.75 + 0.625 > 1: blocked.
  // chat steps afterwards must be exactly {0.125, 0.625}: highest = 0.625
  // (missing -> 0.125), median < 0.625 (a duplicate 0.625 -> median 0.625).
  const m = stubbedOpenRouter([
    toolReply("list_files", {}, 0.125),
    cutStep(0.625),
    toolReply("estimate_cost", { action: "Evaluate one role", steps: 1, webSearches: 0 }, 0.0078125),
    textReply("That one costs little.", 0.0078125),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "c-cost", [user("u1", "Evaluate")]);
  assert.equal(errorsOf(t1.chunks, "cut_off").length, 1);
  assert.equal(m.requests.length, 2);
  await runTurn(coach, "c-cost", [user("u1", "Evaluate"), t1.message, user("u2", "what would one more cost?")]);
  const toolMsg = m.requests[3].messages.filter((x: any) => x.role === "tool").at(-1);
  const out = JSON.parse(contentText(toolMsg.content));
  assert.equal(out.highUsd, 0.625, `highest step cost so far in the chat (got ${JSON.stringify(out)})`);
  assert.ok(out.lowUsd < 0.625, `median below the max: the cut-off step was counted once (got ${JSON.stringify(out)})`);
});

test("§ 9.2 the last step of a call is counted too (the named 'today the last step goes uncounted' gap)", async () => {
  // turn 1 is ONE text step costing 0.5 (a call's last step, no tool call).
  const m = stubbedOpenRouter([
    textReply("Here is my read of the market.", 0.5),
    toolReply("estimate_cost", { action: "Evaluate one role", steps: 1, webSearches: 0 }, 0.0078125),
    textReply("ok", 0.0078125),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "c-last", [user("u1", "How is the market?")]);
  await runTurn(coach, "c-last", [user("u1", "How is the market?"), t1.message, user("u2", "cost of one eval?")]);
  const toolMsg = m.requests[2].messages.filter((x: any) => x.role === "tool").at(-1);
  const out = JSON.parse(contentText(toolMsg.content));
  assert.equal(out.highUsd, 0.5, `the text step's measured cost is in the chat (got ${JSON.stringify(out)})`);
});

test("§ 9.2 the allowance spans both calls: the continuation's gate amount = spent (each step once, cut-off step included) + projected", async () => {
  // allowance 2.00. Steps: list 0.125 | cut 0.25 | continuation: list 0.25, list 1.0.
  // after the last: spent 1.625 + projected 1.0 = 2.625 > 2 -> gate $2.63.
  // cut-off counted twice -> $2.88; not counted -> $2.38.
  const m = stubbedOpenRouter([
    toolReply("list_files", {}, 0.125),
    cutStep(0.25),
    toolReply("list_files", {}, 0.25),
    toolReply("list_files", {}, 1.0),
    textReply("MUST NOT BE REQUESTED"),
  ]);
  const rg = recordingGate();
  const { coach } = makeCoach({ model: m.model, gate: rg.gate, limits: { spendGateUsd: 2 } });
  const { chunks } = await runTurn(coach, "c-allow", [user("u1", "Evaluate")]);
  assert.equal(m.requests.length, 4, "the continuation stopped at the allowance, before a 5th request");
  assert.equal(noteRequests(m.requests).length, 1);
  const gates = dataChunks(chunks, "data-gate");
  assert.equal(gates.length, 1, "the continuation's loop opened the allowance gate (never bypassed)");
  assert.equal(gates[0].data.amountUsd, 2.63);
  assert.equal(errorsOf(chunks, "cut_off").length, 0);
});

test("§ 9.2 the step cap counts both calls: 2 steps in call 1 + 2 in the continuation = maxSteps 4, then step_cap", async () => {
  const m = stubbedOpenRouter([
    toolReply("list_files", {}, 0.0078125),
    cutStep(0.0078125),
    toolReply("list_files", {}, 0.0078125),
    toolReply("list_files", {}, 0.0078125),
    textReply("MUST NOT BE REQUESTED"),
  ]);
  const { coach } = makeCoach({ model: m.model, limits: { maxSteps: 4 } });
  const { chunks } = await runTurn(coach, "c-cap", [user("u1", "Evaluate")]);
  assert.equal(m.requests.length, 4, "no step past maxSteps across both calls");
  assert.equal(errorsOf(chunks, "step_cap").length, 1);
});

test("§ 9.2(5) an aborted turn never continues", async () => {
  const ac = new AbortController();
  const m = stubbedOpenRouter([cutStep(0.0078125), textReply("MUST NOT BE REQUESTED")]);
  const { coach } = makeCoach({ model: m.model });
  const stream: ReadableStream = coach.stream({ chatId: "c-abort", messages: [user("u1", "go")], abortSignal: ac.signal });
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((value as any).type === "finish-step") ac.abort();
  }
  assert.equal(m.requests.length, 1);
});

// ------------------------------------------------------------------ (iv) the next turn

const cutOffAssistant = (id: string, text = "Writing all four verdicts.") => ({
  id,
  role: "assistant",
  parts: [
    { type: "text", text },
    { type: "data-error", data: { code: "cut_off", message: CUT_OFF_MESSAGE, retryable: true } },
  ],
});
const plainAssistant = (id: string, text = "Here is the plan.") => ({ id, role: "assistant", parts: [{ type: "text", text }] });

async function systemFor(history: any[], opts: any = {}) {
  const m = stubbedOpenRouter([textReply("reply")]);
  const { coach } = makeCoach({ model: m.model, ...opts });
  await runTurn(coach, `c-iv-${Math.random()}`, history);
  return { system: m.requests[0] ? systemOf(m.requests[0]) : null, req: m.requests[0] };
}

test("(iv) a cut_off part on the last assistant message: the system prompt ends with the § 9.4 note, word for word", async () => {
  const { system } = await systemFor([user("u1", "Evaluate all four"), cutOffAssistant("a1"), user("u2", "continue")]);
  assert.ok(system!.trimEnd().endsWith(NEXT_TURN_NOTE), `system tail: ${JSON.stringify(system!.slice(-400))}`);
});

test("(iv) no cut_off part: no note", async () => {
  const { system } = await systemFor([user("u1", "Evaluate all four"), plainAssistant("a1"), user("u2", "continue")]);
  assert.ok(!system!.includes(NEXT_TURN_NOTE));
  assert.ok(!/cut off at the output limit/i.test(system!));
});

test("(iv) a cut_off on an OLDER assistant message (not the one just before the latest user message): no note", async () => {
  const { system } = await systemFor([user("u1", "a"), cutOffAssistant("a1"), user("u2", "b"), plainAssistant("a2"), user("u3", "c")]);
  assert.ok(!system!.includes(NEXT_TURN_NOTE));
});

test("(iv) the cut-off turn is outside windowWords: the note is still there (checked before the window trims)", async () => {
  const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  const { system, req } = await systemFor([user("u1", "Evaluate all four"), cutOffAssistant("a1", long), user("u2", "continue")], { limits: { windowWords: 50 } });
  assert.ok(!JSON.stringify(req.messages).includes("word399"), "precondition: the window really dropped the cut-off turn");
  assert.ok(system!.trimEnd().endsWith(NEXT_TURN_NOTE));
});

test("(iv) gate pending + a non-yes/no reply + a cut_off: the cut-off note comes after the gate-pending note, last", async () => {
  const m = stubbedOpenRouter([toolReply("estimate_cost", BIG, 0.0078125), textReply("baseline"), textReply("both")]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "c-iv-both", [user("u1", "evaluate all six")]);
  assert.equal(dataChunks(t1.chunks, "data-gate").length, 1);
  const withCut = { ...t1.message, parts: [...t1.message.parts, { type: "data-error", data: { code: "cut_off", message: CUT_OFF_MESSAGE, retryable: true } }] };
  await runTurn(coach, "c-iv-both", [user("u1", "evaluate all six"), withCut, user("u2", "which six?")]);
  const sys = systemOf(m.requests[1]);
  const base = systemOf(m.requests[0]);
  assert.ok(sys.trimEnd().endsWith(NEXT_TURN_NOTE), "cut-off note last");
  const middle = sys.slice(base.length, sys.lastIndexOf(NEXT_TURN_NOTE));
  assert.ok(sys.startsWith(base), "same base prompt");
  assert.ok(/pending/i.test(middle), `the gate-pending note sits before the cut-off note (middle: ${JSON.stringify(middle)})`);
});

test("(iv) a declined gate: no model call, even with a cut_off on the last assistant message", async () => {
  const m = stubbedOpenRouter([toolReply("estimate_cost", BIG, 0.0078125), textReply("MUST NOT BE REQUESTED")]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "c-iv-decl", [user("u1", "evaluate all six")]);
  const withCut = { ...t1.message, parts: [...t1.message.parts, { type: "data-error", data: { code: "cut_off", message: CUT_OFF_MESSAGE, retryable: true } }] };
  const t2 = await runTurn(coach, "c-iv-decl", [user("u1", "evaluate all six"), withCut, user("u2", "no")]);
  assert.equal(m.requests.length, 1, "no model call on the declining turn");
  assert.ok(dataChunks(t2.chunks, "data-gate-status").some((c) => c.data.status === "declined"));
});

test("(iv) end to end: a real cut_off turn's assembled message, resent, triggers the note; the next turn's request is valid", async () => {
  const m = stubbedOpenRouter([
    sse().text("a").toolCallCutOff(0, "call_1", "write_file", PARTIAL).finish("length").usage(0.04, 8192),
    sse().text("b").toolCallCutOff(0, "call_2", "write_file", PARTIAL).finish("length").usage(0.04, 8192),
    textReply("Beta was not saved; redoing it now."),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "c-iv-e2e", [user("u1", "Evaluate")]);
  assert.equal(errorsOf(t1.chunks, "cut_off").length, 1);
  await runTurn(coach, "c-iv-e2e", [user("u1", "Evaluate"), t1.message, user("u2", "continue")]);
  const r3 = m.requests[2];
  assert.ok(systemOf(r3).trimEnd().endsWith(NEXT_TURN_NOTE));
  assertValidRequests(m.requests);
  assert.ok(!JSON.stringify(r3).includes(PARTIAL_MARK), "§ 9.1: later turns carry a small call-and-error pair, not the partial arguments");
  const errs = r3.messages.filter((x: any) => x.role === "tool").map((x: any) => contentText(x.content));
  assert.ok(errs.some((e: string) => e.includes(TOOL_CLOSE_TEXT)), `the closed call's error reaches the model (tool msgs: ${JSON.stringify(errs)})`);
});
