// Tester-owned: follow-ups to issue #2 (owner-approved 2026-09-24; impl
// 8569578). Written from the spec, not the code:
//   - design-web-agent.md § 9.1: "Which parts: every tool-input-start id AND
//     EVERY tool-call id the tap saw in the cut-off step" — a bare
//     tool-call (no tool-input-start) is closed too; "The tap's list starts
//     empty at each step".
//   - § 9.2: "The coach writes one { type: "finish" } last of all" —
//     including when a turn throws (lead's follow-up B(3)).
//   - design-web-ui.md § 2.7 (amended): step_cap opens no gate.
//   - § 9.4 generalized + § 9.8 (xi) (round 2, e78768d): the step_cap next-turn note.
// Run: node --test tests/agent/cut-off-followups.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { NEXT_TURN_NOTE, STEP_CAP_MESSAGE, STEP_CAP_NOTE, TOOL_CLOSE_TEXT } from "./_spec9.ts";
import { sse, stubbedOpenRouter, systemOf, textReply, toolReply } from "./_openrouter_stub.ts";
import { AITEST, dataChunks, makeCoach, recordingGate, runTurn, user } from "./_support.ts";

const USAGE = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const fin = (reason: string) => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage: USAGE, providerMetadata: { openrouter: { usage: { cost: 0.0078125 } } } });
const DONE_INPUT = { path: "evaluations/alpha.md", content: "# Alpha" };

/** A LanguageModelV4 that replays raw provider parts — the only way to get a
 *  bare `tool-call` (the real OpenRouter provider always opens with
 *  tool-input-start). Records every prompt. */
function rawModel(steps: any[][]) {
  const prompts: any[] = [];
  let i = 0;
  const model = new (AITEST as any).MockLanguageModelV4({
    doStream: async (options: any) => {
      prompts.push(options.prompt);
      const chunks = steps[i++] ?? [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "x" }, { type: "text-delta", id: "x", delta: "(exhausted)" }, { type: "text-end", id: "x" }, fin("stop")];
      return { stream: (AITEST as any).simulateReadableStream({ chunks }) };
    },
  });
  return { model, prompts, get used() { return i; } };
}
const bareCall = (id: string, input: unknown, reason: string) => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Writing." }, { type: "text-end", id: "t" },
  { type: "tool-call", toolCallId: id, toolName: "write_file", input: JSON.stringify(input) },
  fin(reason),
];
const textStep = (text: string, reason = "stop") => [
  { type: "stream-start", warnings: [] }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: text }, { type: "text-end", id: "t" }, fin(reason),
];

function countingWorkspaceWrites(coachWorkspace: any) {
  const writes: string[] = [];
  const orig = coachWorkspace.write.bind(coachWorkspace);
  coachWorkspace.write = async (p: string, ...rest: any[]) => { writes.push(p); return orig(p, ...rest); };
  return writes;
}
const errorsOf = (chunks: any[], code?: string) => dataChunks(chunks, "data-error").filter((c) => !code || c.data.code === code);
const toolPart = (message: any, id: string) => (message?.parts ?? []).filter((p: any) => p.type?.startsWith("tool-") && p.toolCallId === id);

// ------------------------------------------------------------------ § 9.1 bare tool-call

test("§ 9.1: a bare tool-call (no tool-input-start) in a length step is closed with the closing text, never runs, and gets its synthesized result", async () => {
  const m = rawModel([bareCall("bare_1", DONE_INPUT, "length"), textStep("Redoing it.")]);
  const { coach, workspace } = makeCoach({ model: m.model });
  const writes = countingWorkspaceWrites(workspace);
  const { chunks, message } = await runTurn(coach, "f-bare", [user("u1", "Evaluate Alpha")]);

  assert.deepEqual(writes, [], "the bare call never ran");
  const p = toolPart(message, "bare_1");
  assert.equal(p.length, 1, "one part for the id");
  assert.equal(p[0].state, "output-error");
  assert.equal(p[0].errorText, TOOL_CLOSE_TEXT);
  const close = chunks.filter((c) => c.type === "tool-input-error" && c.toolCallId === "bare_1");
  assert.equal(close.length, 1, "closed by exactly one tool-input-error");
  assert.deepEqual(close[0].input, {});

  assert.equal(m.used, 2, `the continuation was sent (errors: ${JSON.stringify(errorsOf(chunks).map((c) => c.data))})`);
  const tool = m.prompts[1].filter((x: any) => x.role === "tool").flatMap((x: any) => x.content);
  assert.deepEqual(
    tool.map((r: any) => [r.toolCallId, r.output?.type, r.output?.value]),
    [["bare_1", "error-text", TOOL_CLOSE_TEXT]],
    "one synthesized error-text result for the bare call",
  );
  assert.deepEqual(errorsOf(chunks), []);
});

test("§ 9.1: a bare tool-call that RAN in an earlier step is not closed when a later step is cut off (the list starts empty at each step)", async () => {
  const m = rawModel([bareCall("bare_early", DONE_INPUT, "tool-calls"), textStep("then a long reply", "length"), textStep("continued")]);
  const { coach, workspace } = makeCoach({ model: m.model });
  const writes = countingWorkspaceWrites(workspace);
  const { chunks, message } = await runTurn(coach, "f-bare-early", [user("u1", "Evaluate Alpha")]);
  assert.deepEqual(writes, ["evaluations/alpha.md"], "the earlier bare call ran once");
  const p = toolPart(message, "bare_early");
  assert.equal(p.length, 1);
  assert.equal(p[0].state, "output-available", "not re-closed as cut off");
  assert.deepEqual(chunks.filter((c) => c.type === "tool-input-error"), [], "nothing to close in a text-only cut-off step");
  assert.equal(m.used, 3);
  const results = m.prompts[2].filter((x: any) => x.role === "tool").flatMap((x: any) => x.content);
  assert.deepEqual(results.map((r: any) => [r.toolCallId, r.output?.type]), [["bare_early", "json"]], "its real result only — no synthesized one");
});

// ------------------------------------------------------------------ § 9.2 finish on throw

/** A gate whose `pending()` throws on the Nth call (1-based). */
function throwingGate(nth: number) {
  const inner = createInMemoryGate();
  let n = 0;
  return {
    ...inner,
    open: inner.open.bind(inner),
    decide: inner.decide.bind(inner),
    expireOtherChats: inner.expireOtherChats.bind(inner),
    async pending(chatId: string) {
      n++;
      if (n === nth) throw new Error("gate store unavailable (injected)");
      return inner.pending(chatId);
    },
  };
}
function assertOneFinishLast(chunks: any[], label: string) {
  const types = chunks.map((c) => c.type + (c.data?.code ? ":" + c.data.code : ""));
  assert.equal(chunks.filter((c) => c.type === "finish").length, 1, `${label}: exactly one finish (${JSON.stringify(types)})`);
  assert.equal(chunks.at(-1)?.type, "finish", `${label}: finish is last (${JSON.stringify(types.slice(-3))})`);
  assert.ok(chunks.filter((c) => c.type === "start").length <= 1, `${label}: at most one start`);
}

test("§ 9.2: a turn that throws BEFORE any model call writes its error, then exactly one finish, last", async () => {
  const m = stubbedOpenRouter([textReply("MUST NOT BE REQUESTED")]);
  const { coach } = makeCoach({ model: m.model, gate: throwingGate(1) });
  const { chunks } = await runTurn(coach, "f-throw-0", [user("u1", "hi")]);
  assert.equal(m.requests.length, 0);
  assert.equal(errorsOf(chunks).length, 1, "the throw is shown as one data-error");
  assertOneFinishLast(chunks, "throw at turn start");
});

test("§ 9.2: a turn that throws AFTER a call streamed (checking the continuation's preconditions) writes exactly one finish, last", async () => {
  // text-only cut-off: the stop condition never runs, so pending() #2 is the precondition check.
  const m = stubbedOpenRouter([sse().text("A long reply that").finish("length").usage(0.01, 8192), textReply("MUST NOT BE REQUESTED")]);
  const { coach } = makeCoach({ model: m.model, gate: throwingGate(2) });
  const { chunks, message } = await runTurn(coach, "f-throw-1", [user("u1", "go")]);
  assert.equal(m.requests.length, 1, "no continuation after the throw");
  assert.equal(chunks.filter((c) => c.type === "start").length, 1);
  assert.ok(errorsOf(chunks).length >= 1, "the throw is visible");
  assertOneFinishLast(chunks, "throw after streaming");
  assert.ok(message, "one message assembled");
});

test("§ 9.2: a throw inside the stop condition mid-turn still ends with exactly one finish, last", async () => {
  // step 1 is a tool step, so the stop condition runs; pending() #2 is inside it.
  const m = stubbedOpenRouter([toolReply("list_files", {}), textReply("MUST NOT BE REQUESTED")]);
  const { coach } = makeCoach({ model: m.model, gate: throwingGate(2) });
  const { chunks } = await runTurn(coach, "f-throw-2", [user("u1", "go")]);
  assert.ok(errorsOf(chunks).length >= 1, "the throw is visible");
  assertOneFinishLast(chunks, "throw in stopWhen");
});

// ------------------------------------------------------------------ step_cap opens no gate

test("design-web-ui § 2.7 (amended): a step_cap stop writes step_cap and opens no gate; the next typed message goes straight to the model", async () => {
  const m = stubbedOpenRouter([toolReply("list_files", {}), toolReply("list_files", {}), toolReply("list_files", {}), textReply("MUST NOT BE REQUESTED"), textReply("NEXT-TURN")]);
  const rg = recordingGate();
  const { coach } = makeCoach({ model: m.model, gate: rg.gate, limits: { maxSteps: 3 } });
  const h = [user("u1", "Evaluate the four roles")];
  const t1 = await runTurn(coach, "f-cap", h);
  assert.equal(m.requests.length, 3, "stopped at maxSteps");
  const cap = errorsOf(t1.chunks, "step_cap");
  assert.equal(cap.length, 1);
  assert.deepEqual(cap[0].data, { code: "step_cap", message: STEP_CAP_MESSAGE, retryable: true });
  assert.deepEqual(dataChunks(t1.chunks, "data-gate"), [], "no gate card");
  assert.deepEqual(rg.events.filter((e) => e.op === "open"), [], "no gate logged");
  assert.equal(await rg.gate.pending("f-cap"), null, "nothing pending");

  const t2 = await runTurn(coach, "f-cap", [...h, t1.message, user("u2", "keep going")]);
  assert.equal(m.requests.length, 4, "'keep going' reached the model (no gate intercepted it)");
  assert.deepEqual(dataChunks(t2.chunks, "data-gate-status"), []);
});

// ------------------------------------------------------------------ § 9.8 (xi) the next turn after a step cap
// design-web-agent.md § 9.4 (generalized 2026-09-24, round 2) and § 9.8 (xi).
// Notes are read from the doc (_spec9.ts), never from the code.

const GATE_BIG = { action: "Evaluate six saved roles", steps: 500, webSearches: 6, items: ["Nimbus Robotics — Analytics Engineer"] };
const errPart = (code: string, message = "x") => ({ type: "data-error", data: { code, message, retryable: true } });
const asst = (id: string, parts: any[]) => ({ id, role: "assistant", parts: [{ type: "text", text: "Working on it." }, ...parts] });
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

async function systemAfter(history: any[], opts: any = {}) {
  const m = stubbedOpenRouter([textReply("reply")]);
  const { coach } = makeCoach({ model: m.model, ...opts });
  await runTurn(coach, `xi-${Math.random()}`, history);
  return { m, system: m.requests[0] ? systemOf(m.requests[0]) : null };
}

test("(xi) a step_cap part on the last assistant message: the system prompt ends with the § 9.4 step_cap note, word for word", async () => {
  const { system } = await systemAfter([user("u1", "Evaluate all four"), asst("a1", [errPart("step_cap", STEP_CAP_MESSAGE)]), user("u2", "continue")]);
  assert.ok(system!.trimEnd().endsWith(STEP_CAP_NOTE), `tail: ${JSON.stringify(system!.slice(-300))}`);
  assert.equal(count(system!, STEP_CAP_NOTE), 1);
  assert.ok(!system!.includes(NEXT_TURN_NOTE), "no cut_off note");
});

test("(xi) a step_cap part only on an OLDER assistant message: no note", async () => {
  const { system } = await systemAfter([user("u1", "a"), asst("a1", [errPart("step_cap")]), user("u2", "b"), asst("a2", []), user("u3", "c")]);
  assert.ok(!system!.includes(STEP_CAP_NOTE));
});

test("(xi) no data-error at all, or another code (model_error): no note", async () => {
  for (const parts of [[], [errPart("model_error")], [errPart("tool_error")]]) {
    const { system } = await systemAfter([user("u1", "a"), asst("a1", parts), user("u2", "b")]);
    assert.ok(!system!.includes(STEP_CAP_NOTE), JSON.stringify(parts));
    assert.ok(!system!.includes(NEXT_TURN_NOTE), JSON.stringify(parts));
  }
});

test("(xi) the same code twice on one message: its note once", async () => {
  const { system } = await systemAfter([user("u1", "a"), asst("a1", [errPart("step_cap"), errPart("step_cap")]), user("u2", "b")]);
  assert.equal(count(system!, STEP_CAP_NOTE), 1);
});

test("(xi) a hand-built message carrying both codes: each note once, cut_off first, step_cap last", async () => {
  for (const order of [["step_cap", "cut_off"], ["cut_off", "step_cap"]]) {
    const { system } = await systemAfter([user("u1", "a"), asst("a1", order.map((c) => errPart(c))), user("u2", "b")]);
    assert.equal(count(system!, NEXT_TURN_NOTE), 1, `cut_off note once (${order})`);
    assert.equal(count(system!, STEP_CAP_NOTE), 1, `step_cap note once (${order})`);
    assert.ok(system!.indexOf(NEXT_TURN_NOTE) < system!.indexOf(STEP_CAP_NOTE), `cut_off first, whatever the part order (${order})`);
    assert.ok(system!.trimEnd().endsWith(STEP_CAP_NOTE));
  }
});

test("(xi) with a pending gate and both codes: gate-pending note, then cut_off, then step_cap", async () => {
  const m = stubbedOpenRouter([toolReply("estimate_cost", GATE_BIG), textReply("baseline"), textReply("both")]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "xi-gate", [user("u1", "evaluate all six")]);
  assert.equal(dataChunks(t1.chunks, "data-gate").length, 1, "precondition: a pending gate");
  const withBoth = { ...t1.message, parts: [...t1.message.parts, errPart("step_cap"), errPart("cut_off")] };
  await runTurn(coach, "xi-gate", [user("u1", "evaluate all six"), withBoth, user("u2", "which six?")]);
  const base = systemOf(m.requests[0]);
  const sys = systemOf(m.requests[1]);
  assert.ok(sys.startsWith(base));
  const gateAt = sys.search(/pending/i);
  assert.ok(gateAt > base.length - 1, "the gate-pending note is present after the base prompt");
  assert.ok(gateAt < sys.indexOf(NEXT_TURN_NOTE) && sys.indexOf(NEXT_TURN_NOTE) < sys.indexOf(STEP_CAP_NOTE), "gate, cut_off, step_cap");
});

test("(xi) a declined gate reply: no model call, even with a step_cap on the last assistant message", async () => {
  const m = stubbedOpenRouter([toolReply("estimate_cost", GATE_BIG), textReply("MUST NOT BE REQUESTED")]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "xi-decl", [user("u1", "evaluate all six")]);
  const withCap = { ...t1.message, parts: [...t1.message.parts, errPart("step_cap")] };
  const t2 = await runTurn(coach, "xi-decl", [user("u1", "evaluate all six"), withCap, user("u2", "no")]);
  assert.equal(m.requests.length, 1, "no model call on the declining turn");
  assert.ok(dataChunks(t2.chunks, "data-gate-status").some((c) => c.data.status === "declined"));
});

// The measured case (§ 9.4, "Measured 2026-09-24"): a REAL capped turn —
// 25 steps over four 1,200-word JDs — then "keep going". The window drops
// the whole capped turn; the note must still be there.
test("(xi) a real 25-step capped turn over four 1,200-word JDs: the window drops it, and the step_cap note is still there", async () => {
  const jd = (n: number) => `# Role ${n}\n\n` + Array.from({ length: 1200 }, (_, i) => `requirement${n}_${i}`).join(" ");
  const files: Record<string, string> = {};
  for (let n = 1; n <= 4; n++) files[`jd-inbox/role-${n}.md`] = jd(n);
  const script: any[] = [toolReply("load_skill", { name: "evaluate" })];
  for (let n = 1; n <= 4; n++) script.push(toolReply("read_file", { path: `jd-inbox/role-${n}.md` }));
  while (script.length < 25) script.push(toolReply("list_files", {}));
  script.push(textReply("NEXT"));
  const m = stubbedOpenRouter(script);
  const { coach } = makeCoach({ model: m.model, files }); // default maxSteps (25) and windowWords (4,000)
  const h = [user("u1", "Evaluate the four roles in jd-inbox")];
  const t1 = await runTurn(coach, "xi-window", h);
  assert.equal(m.requests.length, 25, "precondition: 25 steps");
  const cap = errorsOf(t1.chunks, "step_cap");
  assert.equal(cap.length, 1, "precondition: step_cap");
  assert.equal(cap[0].data.message, STEP_CAP_MESSAGE, "§ 6.1: the fixed message");
  assert.ok(t1.message.parts.some((p: any) => p.type === "data-error" && p.data.code === "step_cap"), "the part is in the assembled message the client resends");

  await runTurn(coach, "xi-window", [...h, t1.message, user("u2", "keep going")]);
  const r = m.requests.at(-1);
  const nonSystem = r.messages.filter((x: any) => x.role !== "system");
  assert.deepEqual(nonSystem.map((x: any) => x.role), ["user"], "the capped turn's messages are gone from the request");
  assert.ok(!JSON.stringify(r).includes("Evaluate the four roles"), "the candidate's original request was dropped too");
  assert.ok(systemOf(r).trimEnd().endsWith(STEP_CAP_NOTE), "the step_cap note is still there");
});
