// Tester-owned acceptance tests for docs/design-web-agent.md § 12 (a turn
// that grows too large; owner-approved at 6641e1a) — § 12.3 items (i)–(vi),
// written from the spec, not the code.
//
// The model is the REAL @openrouter/ai-sdk-provider over a stubbed fetch
// (tests/agent/_openrouter_stub.ts). Two views of every request:
//   - `prompts`: the ModelMessage-level prompt the SDK hands the provider —
//     what § 12.1 measures ("UTF-8 bytes of JSON.stringify(messages)",
//     system excluded: it is streamText's separate `system` option);
//   - `requests`: the OpenRouter body the proxy would receive — what its
//     256 KB cap (§ 8) actually checks.
// NOTE: § 12.3 (i)'s "12 steps each reading a 10,000-character file" peaks
// at ~131 KB and never reaches the 160,000-byte trigger (measured), so these
// tests use 22 such steps to exercise the trim.
// Run: node --test tests/agent/turn-too-large.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { CONTINUATION_NOTE, CUT_OFF_MESSAGE, NEXT_TURN_NOTE, STEP_CAP_NOTE } from "./_spec9.ts";
import { stub, TOO_LARGE_MESSAGE, TOO_LARGE_NOTE } from "./_spec11.ts";
import { contentText, proxyTooLarge, sse, stubbedOpenRouter, systemOf, textReply, toolReply } from "./_openrouter_stub.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import { dataChunks, makeCoach, runTurn, user } from "./_support.ts";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).byteLength;
const nonSystem = (prompt: any[]) => prompt.filter((m) => m.role !== "system");
const PROXY_CAP = 256 * 1024;
const TRIGGER = 160_000;

// 10,000 characters with spaces, newlines and quotes (JSON escapes them).
const body = (i: number) => Array.from({ length: 10_000 }, (_, k) => "abcdefghij klmnop\n\"qrstu"[(k * 7 + i) % 24]).join("");
const readSteps = (n: number, from = 1) =>
  Array.from({ length: n }, (_, j) => {
    const i = from + j;
    return sse().text(`Reading role ${i}.`).toolCall(0, `read_${i}`, "read_file", { path: `jd-inbox/r${i}.md` }).finish("tool_calls").usage(0.0001);
  });
const filesFor = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, j) => [`jd-inbox/r${j + 1}.md`, body(j + 1)]));

/** Every tool-result in a prompt, in order: [toolCallId, the output's JSON]. */
function toolResults(prompt: any[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of prompt) if (m.role === "tool") for (const p of m.content) if (p.type === "tool-result") out.push([p.toolCallId, JSON.stringify(p.output)]);
  return out;
}
const stubbedIds = (prompt: any[]) => toolResults(prompt).filter(([, o]) => o.includes("Removed to save space")).map(([id]) => id);
const errorsOf = (chunks: any[], code?: string) => dataChunks(chunks, "data-error").filter((c) => !code || c.data.code === code);
const OPTS = { limits: { maxSteps: 60, spendGateUsd: 100 } };

// An earlier turn whose tool output is long (one "word", so the § 7 window
// keeps it): § 12.1 "never touched: earlier turns".
const EARLIER_LONG = "y".repeat(10_000);
const earlierTurn = () => [
  user("u0", "Read the old notes"),
  {
    id: "a0",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "tool-read_file", toolCallId: "old_read", state: "output-available", input: { path: "notes.md" }, output: { path: "notes.md", content: EARLIER_LONG, readOnly: false } },
      { type: "text", text: "Read them.", state: "done" },
    ],
  },
];

// ------------------------------------------------------------------ (i) trim

test("(i) a 22-read turn: every request's messages stay ≤ 160,000 bytes and every body under the proxy's 256 KB", async () => {
  const m = stubbedOpenRouter([...readSteps(22), textReply("All read.")]);
  const { coach } = makeCoach({ model: m.model, files: filesFor(22), ...OPTS });
  const { chunks } = await runTurn(coach, "t-i", [...earlierTurn(), user("u1", "Read all 22 roles")]);
  assert.equal(m.requests.length, 23);
  assert.deepEqual(errorsOf(chunks), []);
  m.prompts.forEach((p, i) => assert.ok(enc(nonSystem(p)) <= TRIGGER, `request ${i + 1}: ${enc(nonSystem(p))} bytes of messages`));
  m.requests.forEach((r, i) => assert.ok(enc(r) < PROXY_CAP, `request ${i + 1}: body ${enc(r)} bytes`));
  assert.ok(m.prompts.some((p) => stubbedIds(p).length > 0), "the trim actually fired");
});

test("(i) stubs land oldest step first; the last 2 steps, user messages, model text, earlier turns and the system prompt are byte-identical", async () => {
  const m = stubbedOpenRouter([...readSteps(22), textReply("All read.")]);
  const { coach } = makeCoach({ model: m.model, files: filesFor(22), ...OPTS });
  await runTurn(coach, "t-i2", [...earlierTurn(), user("u1", "Read all 22 roles")]);
  const sys0 = systemOf(m.requests[0]);
  m.prompts.forEach((p, idx) => {
    const n = idx; // steps already taken before this request
    const ids = stubbedIds(p);
    const expected = Array.from({ length: ids.length }, (_, k) => `read_${k + 1}`);
    assert.deepEqual(ids, expected, `request ${idx + 1}: stubs are a prefix from the oldest step`);
    assert.ok(ids.length <= Math.max(0, n - 2), `request ${idx + 1}: the last 2 steps are never stubbed`);
    // the stub, word for word, for the 10,000-character content
    for (const [id, out] of toolResults(p)) {
      if (id === "old_read") {
        assert.ok(out.includes(EARLIER_LONG), `request ${idx + 1}: the earlier turn is never touched`);
        continue;
      }
      const i = Number(id.split("_")[1]);
      if (ids.includes(id)) {
        assert.ok(out.includes(JSON.stringify(stub(10_000)).slice(1, -1)), `request ${idx + 1}: ${id} carries the § 11.3 stub for N = 10000`);
        assert.ok(out.includes(`jd-inbox/r${i}.md`), `request ${idx + 1}: ${id} keeps its short strings`);
      } else {
        assert.ok(out.includes(JSON.stringify(body(i)).slice(1, -1)), `request ${idx + 1}: ${id} is untouched`);
      }
    }
    const text = JSON.stringify(p);
    for (let i = 1; i <= n; i++) assert.ok(text.includes(`Reading role ${i}.`), `request ${idx + 1}: model text of step ${i} kept`);
    assert.ok(text.includes("Read all 22 roles") && text.includes("Read the old notes"), `request ${idx + 1}: user messages kept`);
    assert.equal(systemOf(m.requests[idx]), sys0, `request ${idx + 1}: the system prompt is identical`);
  });
});

test("(i) the last 2 steps are never stubbed — even when they alone are over budget, the request goes as it is (§ 12.1)", async () => {
  const huge = (i: number) => "Z".repeat(90_000) + String(i);
  const files: Record<string, string> = { "jd-inbox/small.md": "short", "jd-inbox/h1.md": huge(1), "jd-inbox/h2.md": huge(2) };
  const m = stubbedOpenRouter([
    toolReply("read_file", { path: "jd-inbox/small.md" }, 0.0001, "s1"),
    toolReply("read_file", { path: "jd-inbox/h1.md" }, 0.0001, "h1"),
    toolReply("read_file", { path: "jd-inbox/h2.md" }, 0.0001, "h2"),
    textReply("done"),
  ]);
  const { coach } = makeCoach({ model: m.model, files, ...OPTS });
  await runTurn(coach, "t-i-last2", [user("u1", "Read them")]);
  const last = m.prompts.at(-1)!;
  assert.ok(enc(nonSystem(last)) > TRIGGER, "precondition: over the trigger");
  const outs = Object.fromEntries(toolResults(last));
  assert.ok(outs.h1.includes(huge(1)) && outs.h2.includes(huge(2)), "the last 2 steps go as they are");
  assert.ok(!outs.h1.includes("Removed to save space") && !outs.h2.includes("Removed to save space"));
});

// ------------------------------------------------------------------ (ii) and (iii)

test("(ii) under budget: no override — every request is the plain history, nothing stubbed", async () => {
  const m = stubbedOpenRouter([...readSteps(5), textReply("ok")]);
  const { coach } = makeCoach({ model: m.model, files: filesFor(5), ...OPTS });
  await runTurn(coach, "t-ii", [user("u1", "Read five")]);
  for (const p of m.prompts) assert.deepEqual(stubbedIds(p), []);
  for (let i = 1; i < m.prompts.length; i++) {
    const prev = nonSystem(m.prompts[i - 1]);
    assert.deepEqual(nonSystem(m.prompts[i]).slice(0, prev.length), prev, `request ${i + 1} extends request ${i}`);
  }
});

test("(iii) between two trims, each request's messages begin with the previous request's (trims are rare, the cache prefix holds)", async () => {
  const m = stubbedOpenRouter([...readSteps(22), textReply("All read.")]);
  const { coach } = makeCoach({ model: m.model, files: filesFor(22), ...OPTS });
  await runTurn(coach, "t-iii", [user("u1", "Read all 22 roles")]);
  let trims = 0;
  for (let i = 1; i < m.prompts.length; i++) {
    const prev = nonSystem(m.prompts[i - 1]);
    const cur = nonSystem(m.prompts[i]);
    if (stubbedIds(m.prompts[i]).length === stubbedIds(m.prompts[i - 1]).length) {
      assert.deepEqual(cur.slice(0, prev.length), prev, `request ${i + 1} begins with request ${i}`);
    } else {
      trims++;
    }
  }
  assert.ok(trims >= 1 && trims <= 3, `trims are rare (${trims} over 23 requests)`);
});

// ------------------------------------------------------------------ (iv) continuation

test("(iv) a cut-off after a trim: the continuation also stays ≤ 160,000 bytes and carries the § 9.2 note", async () => {
  const m = stubbedOpenRouter([...readSteps(17), sse().text("Now writing the summary of all").finish("length").usage(0.0001, 8192), textReply("Summary, in pieces.")]);
  const { coach } = makeCoach({ model: m.model, files: filesFor(17), ...OPTS });
  const { chunks } = await runTurn(coach, "t-iv", [user("u1", "Read and summarize 17 roles")]);
  assert.equal(m.requests.length, 19);
  assert.deepEqual(errorsOf(chunks), [], "continued, no error");
  const cont = m.prompts.at(-1)!;
  assert.ok(enc(nonSystem(cont)) <= TRIGGER, `continuation messages ${enc(nonSystem(cont))} bytes`);
  assert.ok(enc(m.requests.at(-1)) < PROXY_CAP);
  const last = nonSystem(cont).at(-1);
  assert.equal(last.role, "user");
  assert.equal(contentText(last.content.map ? last.content : [{ text: last.content }]), CONTINUATION_NOTE, "the note is never trimmed");
  assert.ok(stubbedIds(cont).length > 0, "the continuation was trimmed too");
});

// ------------------------------------------------------------------ (v) refusal

test("(v) a proxy 413 at step 4: one too_large with the fixed message, no model_error, no further request, finish last, steps 1–3's files saved", async () => {
  const writes = [1, 2, 3].map((i) => toolReply("write_file", { path: `evaluations/r${i}.md`, content: `# Role ${i}\n\nVerdict.` }, 0.0001, `w${i}`));
  const m = stubbedOpenRouter([...writes, proxyTooLarge(), textReply("MUST NOT BE REQUESTED")]);
  const workspace = createInMemoryWorkspaceStore({});
  const { coach } = makeCoach({ model: m.model, workspace, ...OPTS });
  const { chunks, message } = await runTurn(coach, "t-v", [user("u1", "Evaluate the three roles")]);
  assert.equal(m.requests.length, 4, "no further request after the 413");
  const tl = errorsOf(chunks, "too_large");
  assert.equal(tl.length, 1);
  assert.deepEqual(tl[0].data, { code: "too_large", message: TOO_LARGE_MESSAGE, retryable: true });
  assert.deepEqual(errorsOf(chunks, "model_error"), [], "never a model_error");
  assert.equal(errorsOf(chunks).length, 1, "and nothing else");
  assert.equal(chunks.at(-1)?.type, "finish", "finish comes last");
  for (const i of [1, 2, 3]) assert.ok((await workspace.read(`evaluations/r${i}.md`)).content.includes(`Role ${i}`), `step ${i}'s file saved`);
  assert.ok(message.parts.some((p: any) => p.type === "data-error" && p.data.code === "too_large"));
});

test("(v) a 413 in the continuation call is too_large too (§ 12.2 'in either call'); no model_error, finish last", async () => {
  const m = stubbedOpenRouter([sse().text("A long reply").finish("length").usage(0.0001, 8192), proxyTooLarge(), textReply("MUST NOT BE REQUESTED")]);
  const { coach } = makeCoach({ model: m.model, ...OPTS });
  const { chunks } = await runTurn(coach, "t-v2", [user("u1", "go")]);
  assert.equal(m.requests.length, 2);
  assert.equal(errorsOf(chunks, "too_large").length, 1);
  assert.deepEqual(errorsOf(chunks, "model_error"), []);
  assert.equal(chunks.at(-1)?.type, "finish");
});

test("(v) the 413's own body code alone (another status) is too_large too", async () => {
  const { HttpReply } = await import("./_openrouter_stub.ts");
  const m = stubbedOpenRouter([new HttpReply(400, { error: { code: "too_large", message: "Request too large." } })]);
  const { coach } = makeCoach({ model: m.model, ...OPTS });
  const { chunks } = await runTurn(coach, "t-v3", [user("u1", "go")]);
  assert.deepEqual(errorsOf(chunks).map((c) => c.data.code), ["too_large"]);
});

// ------------------------------------------------------------------ (vi) the next turn

const errPart = (code: string) => ({ type: "data-error", data: { code, message: "x", retryable: true } });
async function systemAfter(history: any[], opts: any = {}) {
  const m = stubbedOpenRouter([textReply("reply")]);
  const { coach } = makeCoach({ model: m.model, ...opts });
  await runTurn(coach, `t-vi-${Math.random()}`, history);
  return systemOf(m.requests[0]);
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("(vi) a too_large part on the last assistant message: the system prompt ends with the § 12.2 note, word for word", async () => {
  const sys = await systemAfter([user("u1", "a"), { id: "a1", role: "assistant", parts: [errPart("too_large")] }, user("u2", "continue")]);
  assert.ok(sys.trimEnd().endsWith(TOO_LARGE_NOTE), JSON.stringify(sys.slice(-300)));
  assert.equal(count(sys, TOO_LARGE_NOTE), 1);
});

test("(vi) all three codes (any part order): cut_off, step_cap, too_large — each once, in that order", async () => {
  for (const order of [["too_large", "cut_off", "step_cap"], ["step_cap", "too_large", "cut_off"]]) {
    const sys = await systemAfter([user("u1", "a"), { id: "a1", role: "assistant", parts: order.map(errPart) }, user("u2", "b")]);
    const i = [NEXT_TURN_NOTE, STEP_CAP_NOTE, TOO_LARGE_NOTE].map((n) => sys.indexOf(n));
    assert.ok(i[0] >= 0 && i[0] < i[1] && i[1] < i[2], `order for ${order}: ${i}`);
    for (const n of [NEXT_TURN_NOTE, STEP_CAP_NOTE, TOO_LARGE_NOTE]) assert.equal(count(sys, n), 1);
  }
});

test("(vi) a real too_large turn outside the window: the note is still there on the next turn", async () => {
  const writes = [1, 2, 3].map((i) => toolReply("read_file", { path: `jd-inbox/r${i}.md` }, 0.0001, `r${i}`));
  const m = stubbedOpenRouter([...writes, proxyTooLarge(), textReply("next")]);
  const { coach } = makeCoach({ model: m.model, files: filesFor(3), limits: { ...OPTS.limits, windowWords: 200 } });
  const h = [user("u1", "Read three roles")];
  const t1 = await runTurn(coach, "t-vi3", h);
  assert.equal(errorsOf(t1.chunks, "too_large").length, 1, "precondition");
  await runTurn(coach, "t-vi3", [...h, t1.message, user("u2", "continue")]);
  const r = m.requests.at(-1);
  assert.ok(!JSON.stringify(r.messages).includes("Read three roles"), "precondition: the window dropped the long turn");
  assert.ok(systemOf(r).trimEnd().endsWith(TOO_LARGE_NOTE));
});

test("(vii, agent side) too_large is its own code with its own fixed message (the ERROR_MESSAGES table)", async () => {
  const { ERROR_MESSAGES } = await import("../../packages/agent/src/coach.ts");
  assert.deepEqual((ERROR_MESSAGES as any).too_large, { message: TOO_LARGE_MESSAGE, retryable: true });
  assert.notEqual(TOO_LARGE_MESSAGE, CUT_OFF_MESSAGE);
});
