// Tester-owned: docs/design-web-agent.md § 11.3 (what is saved) and § 11.4
// (the 900,000-byte cap) — § 11.9 items (iii) and (vii) — plus § 12.1's
// "the stub (shared with § 12)". Written from the spec (6641e1a).
// Run: node --test tests/agent/conversation-save.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { capConversationSize, conversationToSave, prepareConversationForSave, stubFor as convStub } from "../../packages/agent/src/conversation.ts";
import { stubFor as trimStub } from "../../packages/agent/src/turn-trim.ts";
import { STOPPED_TEXT, stub, STUB_TEMPLATE } from "./_spec11.ts";

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).byteLength;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------------ the stub

test("§ 11.3/§ 12.1: both stub builders produce the spec's stub word for word, for every N", () => {
  for (const n of [0, 1, 2001, 10000, 123456789]) {
    assert.equal(convStub(n), stub(n), `conversation.ts, N=${n}`);
    assert.equal(trimStub(n), stub(n), `turn-trim.ts, N=${n}`);
  }
  assert.ok(STUB_TEMPLATE.includes("N characters"));
});

// ------------------------------------------------------------------ (iii) the sanitize table

const LONG = "a".repeat(10_000);
const EXACT = "b".repeat(2_000);
const history = () => [
  {
    id: "u1",
    role: "user",
    metadata: { origin: "typed" },
    parts: [
      { type: "text", text: "Evaluate the Acme role — the posting is attached." },
      { type: "file", mediaType: "application/pdf", filename: "cv.pdf", url: "workspace:documents/cv.pdf" },
      { type: "file", mediaType: "image/png", filename: "x.png", url: "data:image/png;base64,iVBORw0KGgo=" },
      { type: "file", mediaType: "application/pdf", filename: "y.pdf", url: "https://example.com/y.pdf" },
    ],
  },
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "PRIVATE-REASONING", state: "done" },
      { type: "text", text: "Reading the posting now.", state: "done" },
      { type: "tool-read_file", toolCallId: "c1", state: "output-available", input: { path: "jd-inbox/acme.md" }, output: { path: "jd-inbox/acme.md", content: LONG, readOnly: false } },
      { type: "tool-read_file", toolCallId: "c2", state: "output-available", input: { path: "jd-inbox/b.md" }, output: { path: "jd-inbox/b.md", content: EXACT, readOnly: false } },
      { type: "tool-write_file", toolCallId: "c3", state: "output-available", input: { path: "evaluations/acme.md", content: LONG + "!" }, output: { path: "evaluations/acme.md", written: true } },
      { type: "tool-bash", toolCallId: "c4", state: "output-error", input: { command: "python3 x.py" }, errorText: "E".repeat(3_000) },
      { type: "tool-write_file", toolCallId: "c5", state: "input-available", input: { path: "evaluations/b.md", content: LONG } },
      { type: "tool-write_file", toolCallId: "c6", state: "input-streaming", input: { path: "evaluations/c" } },
      { type: "data-card", data: { card: "verdict", props: { company: "Acme", verdict: "Strong fit", note: LONG } } },
      { type: "data-gate", data: { gateId: "g1", kind: "spend", label: "Evaluate six", text: "t", textHash: "sha256:x", gateLine: "Spend up to $1.23?", amountUsd: 1.23 } },
      { type: "data-error", data: { code: "cut_off", message: "m", retryable: true } },
    ],
  },
];

test("(iii) a 10,000-character tool output becomes the stub with N = 10000; 2,000 characters stay", () => {
  const out = conversationToSave(history() as any) as any[];
  const parts = out[1].parts;
  const c1 = parts.find((p: any) => p.toolCallId === "c1");
  assert.equal(c1.output.content, stub(10000));
  assert.equal(c1.output.path, "jd-inbox/acme.md", "short strings in the same output stay");
  assert.equal(c1.output.readOnly, false, "non-strings stay");
  const c2 = parts.find((p: any) => p.toolCallId === "c2");
  assert.equal(c2.output.content, EXACT, "exactly 2,000 characters is not 'over 2,000'");
  const c3 = parts.find((p: any) => p.toolCallId === "c3");
  assert.equal(c3.input.content, stub(10001), "input strings too");
  const c4 = parts.find((p: any) => p.toolCallId === "c4");
  assert.equal(c4.errorText, stub(3000), "errorText too");
});

test("(iii) text, step-start, every data-* part, metadata and workspace: file parts are kept word for word", () => {
  const input = history();
  const out = conversationToSave(input as any) as any[];
  assert.deepEqual(out[0].metadata, { origin: "typed" });
  assert.deepEqual(out[0].parts.filter((p: any) => p.type === "text"), input[0].parts.filter((p: any) => p.type === "text"));
  assert.deepEqual(out[0].parts.filter((p: any) => p.type === "file"), [input[0].parts[1]], "only the workspace: file part");
  const keptTypes = ["step-start", "text", "data-card", "data-gate", "data-error"];
  for (const t of keptTypes) {
    assert.deepEqual(out[1].parts.filter((p: any) => p.type === t), input[1].parts.filter((p: any) => p.type === t), t);
  }
  const card = out[1].parts.find((p: any) => p.type === "data-card");
  assert.equal(card.data.props.note, LONG, "a data-* part is kept word for word, even a long string in it");
});

test("(iii) reasoning parts and data:/remote file parts are dropped", () => {
  const out = conversationToSave(history() as any) as any[];
  assert.ok(!JSON.stringify(out).includes("PRIVATE-REASONING"));
  assert.equal(out[1].parts.filter((p: any) => p.type === "reasoning").length, 0);
  assert.ok(!JSON.stringify(out).includes("data:image/png"));
  assert.ok(!JSON.stringify(out).includes("https://example.com/y.pdf"));
});

test("(iii) input-available / input-streaming tool parts are saved as output-error with the § 11.3 text", () => {
  const out = conversationToSave(history() as any) as any[];
  for (const id of ["c5", "c6"]) {
    const p = out[1].parts.find((x: any) => x.toolCallId === id);
    assert.equal(p.state, "output-error", id);
    assert.equal(p.errorText, STOPPED_TEXT, id);
    assert.ok(!("output" in p) || p.output === undefined, id);
  }
  const c5 = out[1].parts.find((x: any) => x.toolCallId === "c5");
  assert.equal(c5.input.content, stub(10000), "its long input is stubbed too");
});

test("(iii) the function is pure: its input is not mutated", () => {
  const input = history();
  const before = clone(input);
  conversationToSave(input as any);
  assert.deepEqual(input, before);
});

test("(iii) a saved array round-trips through the sanitizer unchanged (idempotent)", () => {
  const once = conversationToSave(history() as any);
  assert.deepEqual(conversationToSave(once as any), once);
});

// ------------------------------------------------------------------ (vii) the cap

function turn(i: number, size: number) {
  return [
    { id: `u${i}`, role: "user", parts: [{ type: "text", text: `turn ${i}` }] },
    { id: `a${i}`, role: "assistant", parts: [{ type: "text", text: `reply ${i} ` + "x".repeat(size) }] },
  ];
}

test("(vii) over 900,000 bytes drops the OLDEST whole turns only, and reports it", () => {
  const msgs = Array.from({ length: 10 }, (_, i) => turn(i, 120_000)).flat();
  assert.ok(bytes(msgs) > 900_000);
  const r = capConversationSize(msgs as any);
  assert.ok(bytes(r.messages) <= 900_000, `${bytes(r.messages)} bytes`);
  assert.equal(r.droppedAnyTurn, true);
  const ids = (r.messages as any[]).map((m) => m.id);
  const firstKept = Number(ids[0].slice(1));
  assert.deepEqual(ids, msgs.slice(firstKept * 2).map((m: any) => m.id), "a contiguous newest suffix of whole turns");
  assert.equal(ids[0][0], "u", "starts on a user message (whole turns)");
  assert.ok(!capConversationSize(r.messages as any).droppedAnyTurn, "and it stays under once capped");
  const noMore = Array.from({ length: 10 }, (_, i) => turn(i, 120_000)).flat().slice((firstKept - 1) * 2);
  assert.ok(bytes(noMore) > 900_000, "it dropped no more than needed");
});

test("(vii) at or under 900,000 bytes nothing is dropped", () => {
  const msgs = Array.from({ length: 3 }, (_, i) => turn(i, 1000)).flat();
  const r = capConversationSize(msgs as any);
  assert.equal(r.droppedAnyTurn, false);
  assert.deepEqual(r.messages, msgs);
});

test("(vii) the cap measures the SANITIZED array (a long read that the stub shrinks never costs a turn)", () => {
  const big = { id: "a0", role: "assistant", parts: [{ type: "tool-read_file", toolCallId: "r", state: "output-available", input: { path: "p" }, output: { content: "z".repeat(950_000) } }] };
  const msgs = [{ id: "u0", role: "user", parts: [{ type: "text", text: "read it" }] }, big, ...turn(1, 10)];
  const r = prepareConversationForSave(msgs as any);
  assert.equal(r.droppedAnyTurn, false);
  assert.equal((r.messages as any[]).length, 4);
});
