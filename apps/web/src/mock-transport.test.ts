// MockChatTransport tests: it replays a fixture positionally, and a gate
// only advances to its approval turn after a real typed "yes" (§ 6.1).
// No DOM here — this is the same code path the browser build runs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MockChatTransport } from "./mock-transport.ts";
import type { AppMessage, Fixture } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(HERE, "..", "fixtures", `${name}.json`), "utf-8"));
}

async function drain(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader();
  const chunks: unknown[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

function userMessage(text: string, origin: "typed" | "ui" = "typed"): AppMessage {
  return {
    id: `u-${Math.random().toString(36).slice(2)}`,
    role: "user",
    metadata: { origin },
    parts: [{ type: "text", text }],
  } as AppMessage;
}

test("MockChatTransport: mvp-journey replays each scripted assistant turn in order", async () => {
  const fixture = loadFixture("mvp-journey");
  const transport = new MockChatTransport(fixture, { delayMs: 0 });
  const history: AppMessage[] = [userMessage("hi, here's my resume")];

  const chunks = await drain(await transport.sendMessages({ messages: history, abortSignal: undefined }));
  const dataCardChunks = chunks.filter((c) => (c as { type: string }).type === "data-card");
  // m2 (the first scripted assistant reply) has no data-card part.
  assert.equal(dataCardChunks.length, 0);
  const textDeltas = chunks.filter((c) => (c as { type: string }).type === "text-delta");
  assert.ok(textDeltas.length > 0, "text should stream in deltas");
  const finish = chunks[chunks.length - 1] as { type: string };
  assert.equal(finish.type, "finish");
});

test("MockChatTransport: gate-moment — the gate only flips to approved after a typed yes", async () => {
  const fixture = loadFixture("gate-moment");
  const transport = new MockChatTransport(fixture, { delayMs: 0 });

  // Turn 1: opens the gate.
  let history: AppMessage[] = [userMessage("can you evaluate the 6 roles I saved this week?")];
  let chunks = await drain(await transport.sendMessages({ messages: history, abortSignal: undefined }));
  const assistant1: AppMessage = {
    id: "a1",
    role: "assistant",
    parts: chunksToParts(chunks),
  } as AppMessage;
  history = [...history, assistant1];
  assert.ok(
    chunks.some((c) => (c as { type: string }).type === "data-gate"),
    "turn 1 opens the gate"
  );
  assert.ok(
    chunks.some(
      (c) =>
        (c as { type: string; data?: { status?: string } }).type === "data-gate-status" &&
        (c as { data: { status: string } }).data.status === "pending"
    )
  );

  // Turn 2: not a "yes" — gate stays pending, no approval.
  history = [...history, userMessage("wait, what if I only did 5 of them instead of 6?")];
  chunks = await drain(await transport.sendMessages({ messages: history, abortSignal: undefined }));
  assert.ok(
    chunks.some(
      (c) =>
        (c as { type: string; data?: { status?: string } }).type === "data-gate-status" &&
        (c as { data: { status: string } }).data.status === "pending"
    ),
    "a non-yes reply leaves the gate pending"
  );
  assert.ok(
    !chunks.some(
      (c) =>
        (c as { type: string; data?: { status?: string } }).type === "data-gate-status" &&
        (c as { data: { status: string } }).data.status === "approved"
    ),
    "a non-yes reply never approves"
  );
  const assistant2: AppMessage = { id: "a2", role: "assistant", parts: chunksToParts(chunks) } as AppMessage;
  history = [...history, assistant2];

  // Turn 3: exact typed "yes" — approves.
  history = [...history, userMessage("yes")];
  chunks = await drain(await transport.sendMessages({ messages: history, abortSignal: undefined }));
  assert.ok(
    chunks.some(
      (c) =>
        (c as { type: string; data?: { status?: string } }).type === "data-gate-status" &&
        (c as { data: { status: string } }).data.status === "approved"
    ),
    "an exact typed yes approves the gate"
  );
});

test("MockChatTransport: a ui-origin yes does not approve a pending gate", async () => {
  const fixture = loadFixture("gate-moment");
  const transport = new MockChatTransport(fixture, { delayMs: 0 });
  let history: AppMessage[] = [userMessage("can you evaluate the 6 roles I saved this week?")];
  let chunks = await drain(await transport.sendMessages({ messages: history, abortSignal: undefined }));
  history = [...history, { id: "a1", role: "assistant", parts: chunksToParts(chunks) } as AppMessage];

  history = [...history, userMessage("yes", "ui")];
  chunks = await drain(await transport.sendMessages({ messages: history, abortSignal: undefined }));
  assert.ok(
    !chunks.some(
      (c) =>
        (c as { type: string; data?: { status?: string } }).type === "data-gate-status" &&
        (c as { data: { status: string } }).data.status === "approved"
    ),
    "a ui-origin yes must not approve"
  );
});

function chunksToParts(chunks: unknown[]): Array<Record<string, unknown>> {
  // Minimal reconstruction of message parts from a chunk stream, enough
  // for latestGateStatuses() to read data-gate/data-gate-status parts back
  // out in these tests.
  const parts: Array<Record<string, unknown>> = [];
  for (const c of chunks as Array<Record<string, unknown>>) {
    if (c.type === "data-gate" || c.type === "data-gate-status" || c.type === "data-card") {
      parts.push({ type: c.type, data: c.data });
    }
  }
  return parts;
}
