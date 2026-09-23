// Tester-owned: MockChatTransport against docs/design-web-agent.md § 6.1
// ("Mock replay") and § 3 (the gate). The stream is assembled by the real
// AI SDK (readUIMessageStream), not by hand.
// Run: node --test tests/web/mock-transport.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readUIMessageStream } from "../../apps/web/node_modules/ai/dist/index.js";
import { MockChatTransport } from "../../apps/web/src/mock-transport.ts";

const FIX = (n: string) =>
  JSON.parse(readFileSync(new URL(`../../apps/web/fixtures/${n}.json`, import.meta.url), "utf8"));

async function collect(stream: ReadableStream<any>) {
  const chunks: any[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

async function assemble(chunks: any[]) {
  const s = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } });
  let last: any;
  for await (const m of readUIMessageStream({ stream: s as any })) last = m;
  return last;
}

// A driver that behaves like useChat: keeps the history, appends the
// assistant message the transport streamed.
async function turn(t: MockChatTransport, history: any[], text: string, origin: "typed" | "ui" = "typed") {
  history.push({ id: `u${history.length}`, role: "user", parts: [{ type: "text", text }], metadata: { origin } });
  const chunks = await collect(
    await t.sendMessages({ trigger: "submit-message", chatId: "c", messageId: undefined, messages: history, abortSignal: undefined } as any)
  );
  const msg = await assemble(chunks);
  history.push({ ...msg, role: "assistant" });
  return { chunks, msg };
}

const gateStatuses = (msg: any) => (msg?.parts ?? []).filter((p: any) => p.type === "data-gate-status").map((p: any) => p.data.status);
const textOf = (msg: any) => (msg?.parts ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");

test("§ 6.1: reconnectToStream returns null", async () => {
  const t = new MockChatTransport(FIX("mvp-journey"), { delayMs: 0 });
  assert.equal(await t.reconnectToStream({ chatId: "c" } as any), null);
});

test("§ 6.1: every scripted turn round-trips through the SDK with parts equal to the fixture (all fixtures)", async () => {
  for (const name of ["mvp-journey", "checker-failure", "over-limit-error"]) {
    const fx = FIX(name);
    const t = new MockChatTransport(fx, { delayMs: 0 });
    const history: any[] = [];
    for (let i = 0; i < fx.messages.length; i++) {
      const m = fx.messages[i];
      if (m.role !== "user") continue;
      const text = m.parts.find((p: any) => p.type === "text")?.text ?? "";
      const { msg, chunks } = await turn(t, history, text);
      assert.equal(chunks[0].type, "start", `${name}: first chunk`);
      assert.equal(chunks.at(-1).type, "finish", `${name}: last chunk`);
      const want = fx.messages[i + 1];
      const norm = (p: any) =>
        p.type === "text" ? { type: "text", text: p.text }
        : p.type.startsWith("tool-") ? { type: p.type, state: p.state, input: p.input, output: p.output, errorText: p.errorText }
        : { type: p.type, data: p.data };
      const got = msg.parts.filter((p: any) => p.type !== "step-start").map(norm);
      assert.deepEqual(got, want.parts.map(norm), `${name}: turn ${want.id} parts differ`);
    }
  }
});

test("§ 6.1: chunks are ~150 ms apart by default", async () => {
  const t = new MockChatTransport(FIX("gate-moment"));
  const r = (await t.sendMessages({ trigger: "submit-message", chatId: "c", messageId: undefined,
    messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "x" }], metadata: { origin: "typed" } }], abortSignal: undefined } as any)).getReader();
  const times: number[] = [];
  for (;;) { const { done } = await r.read(); if (done) break; times.push(Date.now()); }
  const gaps = times.slice(1).map((v, i) => v - times[i]).filter((g) => g > 20);
  assert.ok(gaps.length > 0 && gaps.every((g) => g >= 120 && g <= 260), `gaps ${gaps}`);
});

// ---- the gate (gate-moment.json) ------------------------------------
async function openGate() {
  const t = new MockChatTransport(FIX("gate-moment"), { delayMs: 0 });
  const h: any[] = [];
  const { msg } = await turn(t, h, "can you evaluate the 6 roles I saved this week?");
  assert.deepEqual(gateStatuses(msg), ["pending"]);
  return { t, h };
}

const FIXED = "Not approved — type yes to go ahead."; // § 6.1, word for word
const GM = FIX("gate-moment");
const partsOf = (msg: any) => (msg?.parts ?? []).filter((p: any) => p.type !== "step-start").map((p: any) =>
  p.type === "text" ? { type: "text", text: p.text }
  : p.type.startsWith("tool-") ? { type: p.type, input: p.input, output: p.output }
  : { type: p.type, data: p.data });
const scripted = (id: string) => partsOf(GM.messages.find((m: any) => m.id === id));
const M3 = GM.messages.find((m: any) => m.id === "m3").parts[0].text;

// § 6.1 (current): "a reply equal to the fixture's next scripted user message replays that scripted turn"
test("§ 6.1: the scripted non-yes reply at the gate replays its scripted turn (m4)", async () => {
  const { t, h } = await openGate();
  const { msg } = await turn(t, h, M3);
  assert.deepEqual(partsOf(msg), scripted("m4"));
  assert.ok(!textOf(msg).includes(FIXED));
});

// "... only an off-script reply gets a fixed pending status and one line, and does not advance the script"
test("§ 6.1: off-script reply at the gate -> fixed pending + the one fixed line", async () => {
  const { t, h } = await openGate();
  const { msg } = await turn(t, h, "hmm, let me think");
  assert.deepEqual(gateStatuses(msg), ["pending"]);
  assert.equal(textOf(msg), FIXED);
});
test("§ 6.1: off-script reply does not advance — the scripted reply after it still replays m4", async () => {
  const { t, h } = await openGate();
  await turn(t, h, "hmm, let me think");
  const { msg } = await turn(t, h, M3);
  assert.deepEqual(partsOf(msg), scripted("m4"));
});

// "a typed exact yes ... jumps to the turn after the fixture's scripted yes"
test("§ 6.1: typed yes IMMEDIATELY at the open gate jumps to m6 (approved)", async () => {
  const { t, h } = await openGate();
  const { msg } = await turn(t, h, "yes");
  assert.deepEqual(partsOf(msg), scripted("m6"));
  assert.deepEqual(gateStatuses(msg), ["approved"]);
});
for (const y of [" YES ", "Yes.", "yes!"]) {
  test(`§ 6.1: typed ${JSON.stringify(y)} at the gate approves`, async () => {
    const { t, h } = await openGate();
    const { msg } = await turn(t, h, y);
    assert.deepEqual(gateStatuses(msg), ["approved"]);
  });
}
test("§ 6.1: scripted path (m3, then typed yes) approves via m6", async () => {
  const { t, h } = await openGate();
  await turn(t, h, M3);
  const { msg } = await turn(t, h, "yes");
  assert.deepEqual(partsOf(msg), scripted("m6"));
});
test("§ 6.1: two off-script replies, then typed yes, still approves", async () => {
  const { t, h } = await openGate();
  await turn(t, h, "hmm");
  await turn(t, h, "let me think");
  const { msg } = await turn(t, h, "yes");
  assert.deepEqual(gateStatuses(msg), ["approved"], `text: ${textOf(msg)}`);
});
for (const y of ["yes please", "yes!!", "y", "sure"]) {
  test(`§ 3: ${JSON.stringify(y)} at the gate does not approve`, async () => {
    const { t, h } = await openGate();
    const { msg } = await turn(t, h, y);
    assert.ok(!gateStatuses(msg).includes("approved"));
  });
}
test("§ 3: ui-origin yes at an open gate does not approve", async () => {
  const { t, h } = await openGate();
  const { msg } = await turn(t, h, "yes", "ui");
  assert.ok(!gateStatuses(msg).includes("approved"));
});

// "decline emits data-gate-status: declined"
for (const w of ["no", "cancel", "stop", "don't"]) {
  test(`§ 6.1/§ 3.3: exact ${JSON.stringify(w)} at an open gate declines it`, async () => {
    const { t, h } = await openGate();
    const { msg } = await turn(t, h, w);
    assert.deepEqual(gateStatuses(msg), ["declined"]);
    assert.equal(textOf(msg), "Declined — nothing started."); // § 6.1, word for word
  });
}
test("§ 3: after a decline, a later yes does not approve (the gate is closed)", async () => {
  const { t, h } = await openGate();
  await turn(t, h, "no");
  const { msg } = await turn(t, h, "yes");
  assert.ok(!gateStatuses(msg).includes("approved"), `statuses ${JSON.stringify(gateStatuses(msg))}`);
});
