// § 3 — gate line rendering, textHash, and the in-memory gate log.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildGateLine, createInMemoryGate, textHashOf } from "../src/gate.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const GATE_GRAMMAR_MD = readFileSync(
  path.join(REPO_ROOT, "skills/coach/references/gate-grammar.md"),
  "utf8",
);

test("buildGateLine: word for word from the bundled gate-grammar.md, amount filled to two decimals", () => {
  const line = buildGateLine(GATE_GRAMMAR_MD, 1.2);
  assert.equal(line, "This costs up to $1.20 — nothing starts until you say yes.");
});

test("buildGateLine: fails loudly when the bundle has no spend line", () => {
  assert.throws(() => buildGateLine("no gate lines here", 1), /spend line/);
});

test("textHashOf: sha256:<hex> of the text as shown", async () => {
  const hash = await textHashOf("hello");
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  // deterministic
  assert.equal(await textHashOf("hello"), hash);
  assert.notEqual(await textHashOf("hello "), hash);
});

test("gate: pending() returns the open gate for a chat, and stays open until decided", async () => {
  const gate = createInMemoryGate();
  const req1 = {
    gateId: "g1",
    kind: "spend" as const,
    label: "evaluate 6 roles",
    text: "evaluate 6 roles\n...",
    textHash: await textHashOf("x"),
    gateLine: "This costs up to $1.20 — nothing starts until you say yes.",
    amountUsd: 1.2,
  };
  await gate.open(req1, "chat-a");
  assert.deepEqual(await gate.pending("chat-a"), req1);
  // a different, unrelated chat sees no gate
  assert.equal(await gate.pending("chat-other"), null);
});

test("gate: expireOtherChats(chatId) expires pending rows belonging to OTHER chats, not chatId's own", async () => {
  const gate = createInMemoryGate();
  const reqA = {
    gateId: "gA",
    kind: "spend" as const,
    label: "a",
    text: "a",
    textHash: await textHashOf("a"),
    gateLine: "This costs up to $1.00 — nothing starts until you say yes.",
    amountUsd: 1,
  };
  const reqB = { ...reqA, gateId: "gB", label: "b", text: "b", textHash: await textHashOf("b") };
  await gate.open(reqA, "chat-a");
  await gate.open(reqB, "chat-b");
  await gate.expireOtherChats("chat-b");
  assert.equal(await gate.pending("chat-a"), null, "chat-a's older gate is expired");
  assert.deepEqual(await gate.pending("chat-b"), reqB, "chat-b's own gate is untouched");
});

test("gate: a new chat's first turn expires every pending row from older chats", async () => {
  const gate = createInMemoryGate();
  const req = {
    gateId: "g1",
    kind: "spend" as const,
    label: "evaluate",
    text: "x",
    textHash: await textHashOf("x"),
    gateLine: "This costs up to $1.00 — nothing starts until you say yes.",
    amountUsd: 1,
  };
  await gate.open(req, "chat-old");
  assert.equal(await gate.pending("chat-old"), req);
  await gate.expireOtherChats("chat-new");
  assert.equal(await gate.pending("chat-old"), null);
});

test("gate: status has one owner — decide() moves status off pending exactly once", async () => {
  const gate = createInMemoryGate();
  const req = {
    gateId: "g1",
    kind: "spend" as const,
    label: "x",
    text: "x",
    textHash: await textHashOf("x"),
    gateLine: "This costs up to $1.00 — nothing starts until you say yes.",
    amountUsd: 1,
  };
  await gate.open(req, "chat-a");
  await gate.decide("g1", "approved", "yes");
  assert.equal(await gate.pending("chat-a"), null);
  // a second decide() call is a no-op (status already moved off pending)
  await gate.decide("g1", "declined");
  assert.equal(await gate.pending("chat-a"), null);
});
