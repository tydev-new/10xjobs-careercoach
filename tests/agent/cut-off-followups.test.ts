// Tester-owned: follow-ups to issue #2 (owner-approved 2026-09-24; impl
// 8569578). Written from the spec, not the code:
//   - design-web-agent.md § 9.1: "Which parts: every tool-input-start id AND
//     EVERY tool-call id the tap saw in the cut-off step" — a bare
//     tool-call (no tool-input-start) is closed too; "The tap's list starts
//     empty at each step".
//   - § 9.2: "The coach writes one { type: "finish" } last of all" —
//     including when a turn throws (lead's follow-up B(3)).
//   - design-web-ui.md § 2.7 (amended): step_cap opens no gate.
// Run: node --test tests/agent/cut-off-followups.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { TOOL_CLOSE_TEXT } from "./_spec9.ts";
import { sse, stubbedOpenRouter, textReply, toolReply } from "./_openrouter_stub.ts";
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
  assert.deepEqual(cap[0].data, { code: "step_cap", message: "This turn ran out of steps before finishing.", retryable: true });
  assert.deepEqual(dataChunks(t1.chunks, "data-gate"), [], "no gate card");
  assert.deepEqual(rg.events.filter((e) => e.op === "open"), [], "no gate logged");
  assert.equal(await rg.gate.pending("f-cap"), null, "nothing pending");

  const t2 = await runTurn(coach, "f-cap", [...h, t1.message, user("u2", "keep going")]);
  assert.equal(m.requests.length, 4, "'keep going' reached the model (no gate intercepted it)");
  assert.deepEqual(dataChunks(t2.chunks, "data-gate-status"), []);
});

// The copy's claim, measured (finding for the lead, not in the spec's test
// plan): "Send another message to pick up where it left off." After a
// step_cap on a realistic run (four ~1,200-word JDs), the window drops the
// whole capped turn and nothing notes that it stopped — the next request
// holds only the system prompt and "keep going". Kept as TODO so it reports
// without failing the suite until the lead rules.
test("step_cap: the next turn's request still carries the capped turn's work (or a note) — the copy says it will 'pick up where it left off'", { todo: "finding: window drops the capped turn; no step_cap note (§ 9.4 has one for cut_off only)" }, async () => {
  const jd = (n: number) => `# Role ${n}\n\n` + Array.from({ length: 1200 }, (_, i) => `requirement${n}_${i}`).join(" ");
  const files: Record<string, string> = {};
  for (let n = 1; n <= 4; n++) files[`jd-inbox/role-${n}.md`] = jd(n);
  const script: any[] = [toolReply("load_skill", { name: "evaluate" })];
  for (let n = 1; n <= 4; n++) script.push(toolReply("read_file", { path: `jd-inbox/role-${n}.md` }));
  while (script.length < 25) script.push(toolReply("list_files", {}));
  script.push(textReply("NEXT"));
  const m = stubbedOpenRouter(script);
  const { coach } = makeCoach({ model: m.model, files });
  const h = [user("u1", "Evaluate the four roles in jd-inbox")];
  const t1 = await runTurn(coach, "f-cap-window", h);
  assert.equal(errorsOf(t1.chunks, "step_cap").length, 1, "precondition: step_cap");
  await runTurn(coach, "f-cap-window", [...h, t1.message, user("u2", "keep going")]);
  const r = JSON.stringify(m.requests.at(-1));
  assert.ok(r.includes("Evaluate the four roles") || /ran out of steps|step.?cap/i.test(r), "the next request knows what it was doing, or that it was stopped");
});
