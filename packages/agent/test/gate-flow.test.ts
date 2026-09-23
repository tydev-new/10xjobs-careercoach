// § 3 — the gate test the plan's step 4 exit criteria names: "no send,
// submit, or spend happens without a logged typed yes." Exercised through
// the FULL coach loop (not just the tool unit), with a real
// createInMemoryGate log as the source of truth.
import assert from "node:assert/strict";
import test from "node:test";
import { readUIMessageStream } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { createCoach } from "../src/coach.ts";
import { createInMemoryGate } from "../src/gate.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import type { AppMessage } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function userMsg(id: string, text: string, origin: "typed" | "ui" = "typed"): AppMessage {
  return { id, role: "user", parts: [{ type: "text", text }], metadata: { origin } } as AppMessage;
}

/** A model that ALWAYS tries to call estimate_cost with a big enough run
 *  to need a gate, then (if allowed to continue) calls bash — used to
 *  prove that a SPENDING tool call never runs on a turn after a gate
 *  opened without approval. */
function bigRunModel(spendCalled: { count: number }) {
  const estimateStep = {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: "c1", toolName: "estimate_cost" },
        {
          type: "tool-input-delta",
          id: "c1",
          delta: JSON.stringify({ action: "evaluate 6 roles", steps: 500, webSearches: 6, items: ["Acme"] }),
        },
        { type: "tool-input-end", id: "c1" },
        {
          type: "tool-call",
          toolCallId: "c1",
          toolName: "estimate_cost",
          input: JSON.stringify({ action: "evaluate 6 roles", steps: 500, webSearches: 6, items: ["Acme"] }),
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
      ],
    }),
  };
  return new MockLanguageModelV4({
    doStream: (async () => {
      // any call after the first (i.e. the loop was NOT stopped by the
      // gate) would call bash — recorded so the test can assert it never
      // happens.
      spendCalled.count += 1;
      return estimateStep;
    }) as any, // loosely-typed mock chunk script (matches spike 1's own pattern); runtime-verified, not structurally typed against LanguageModelV4StreamPart.
  });
}

test("gate: estimate_cost over threshold ends the turn — no further step runs, gate log has a pending row", async () => {
  const calls = { count: 0 };
  const gate = createInMemoryGate();
  const coach = createCoach({
    model: bigRunModel(calls),
    workspace: createInMemoryWorkspaceStore(),
    skills: await loadRealSkillBundle(),
    gate,
    balance: async () => 5,
    fetch: globalThis.fetch,
    clock: { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
  });

  const stream = coach.stream({ chatId: "chat-1", messages: [userMsg("u1", "evaluate my 6 saved roles")] });
  const messages: any[] = [];
  for await (const m of readUIMessageStream({ stream })) messages.push(m);

  assert.equal(calls.count, 1, "the model was called exactly once this turn — the loop stopped after the gate opened");
  const last = messages[messages.length - 1];
  const gatePart = last.parts.find((p: any) => p.type === "data-gate");
  assert.ok(gatePart, "a data-gate part was emitted");
  const pending = await gate.pending("chat-1");
  assert.ok(pending, "the gate log has a pending row");
  assert.equal(pending!.gateId, gatePart.data.gateId);
});

test("gate: a typed 'yes' approves and logs it, then the turn resumes (spend now allowed)", async () => {
  const calls = { count: 0 };
  const gate = createInMemoryGate();
  const workspace = createInMemoryWorkspaceStore();
  const coach = createCoach({
    model: bigRunModel(calls),
    workspace,
    skills: await loadRealSkillBundle(),
    gate,
    balance: async () => 5,
    fetch: globalThis.fetch,
    clock: { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
  });

  // turn 1: opens the gate
  const s1 = coach.stream({ chatId: "chat-2", messages: [userMsg("u1", "evaluate my 6 saved roles")] });
  const m1: any[] = [];
  for await (const m of readUIMessageStream({ stream: s1 })) m1.push(m);
  const gateId = m1[m1.length - 1].parts.find((p: any) => p.type === "data-gate").data.gateId;
  assert.equal(calls.count, 1);

  // turn 2: a genuine (non yes/no-shaped) reply — § 3.2 (lead ruling,
  // fix round 1): the gate stays open, but the model DOES get this turn
  // (it may answer the candidate's question) — the fixed "Not approved"
  // line is the MOCK transport's own behaviour, not this package's. The
  // loop still stops after that one step since the gate is still
  // pending, so no further spend happens.
  const s2off = coach.stream({
    chatId: "chat-2",
    messages: [userMsg("u1", "evaluate my 6 saved roles"), userMsg("u2", "hmm, let me think", "typed")],
  });
  const m2: any[] = [];
  for await (const m of readUIMessageStream({ stream: s2off })) m2.push(m);
  assert.equal(calls.count, 2, "a genuine off-topic reply calls the model exactly once, then the loop stops");
  assert.equal((await gate.pending("chat-2"))!.gateId, gateId, "still pending");

  // turn 3: a UI-origin "yes" (no approve button, § 3 point 4) is a
  // same-word approval ATTEMPT from the wrong origin, not real content —
  // it does NOT approve, and does NOT call the model either.
  const s2ui = coach.stream({
    chatId: "chat-2",
    messages: [userMsg("u1", "evaluate my 6 saved roles"), userMsg("u2", "yes", "ui")],
  });
  const m2ui: any[] = [];
  for await (const m of readUIMessageStream({ stream: s2ui })) m2ui.push(m);
  assert.equal(calls.count, 2, "a ui-origin yes never calls the model either");
  assert.ok(await gate.pending("chat-2"), "still pending after a ui-origin yes");

  // turn 4: the real typed "yes" approves and logs it.
  const s3 = coach.stream({
    chatId: "chat-2",
    messages: [userMsg("u1", "evaluate my 6 saved roles"), userMsg("u2", "yes", "typed")],
  });
  const m3: any[] = [];
  for await (const m of readUIMessageStream({ stream: s3 })) m3.push(m);
  assert.equal(calls.count, 3, "the typed yes resumed the turn — the model ran again");
  assert.equal(await gate.pending("chat-2"), null, "no longer pending");
  const statusPart = m3[m3.length - 1].parts.find((p: any) => p.type === "data-gate-status" && p.data.gateId === gateId);
  assert.equal(statusPart.data.status, "approved");
});

test("gate: an exact 'no' declines and logs it — the model is never called, and a later 'yes' does not revive it", async () => {
  const calls = { count: 0 };
  const gate = createInMemoryGate();
  const coach = createCoach({
    model: bigRunModel(calls),
    workspace: createInMemoryWorkspaceStore(),
    skills: await loadRealSkillBundle(),
    gate,
    balance: async () => 5,
    fetch: globalThis.fetch,
    clock: { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
  });

  const s1 = coach.stream({ chatId: "chat-3", messages: [userMsg("u1", "evaluate my 6 saved roles")] });
  for await (const _ of readUIMessageStream({ stream: s1 })) void 0;
  assert.equal(calls.count, 1);

  const s2 = coach.stream({
    chatId: "chat-3",
    messages: [userMsg("u1", "evaluate my 6 saved roles"), userMsg("u2", "no", "typed")],
  });
  const m2: any[] = [];
  for await (const m of readUIMessageStream({ stream: s2 })) m2.push(m);
  assert.equal(calls.count, 1, "declining never calls the model");
  const declined = m2[m2.length - 1].parts.find((p: any) => p.type === "data-gate-status");
  assert.equal(declined.data.status, "declined");

  const s3 = coach.stream({
    chatId: "chat-3",
    messages: [userMsg("u1", "evaluate my 6 saved roles"), userMsg("u2", "no", "typed"), userMsg("u3", "yes", "typed")],
  });
  for await (const _ of readUIMessageStream({ stream: s3 })) void 0;
  assert.equal(calls.count, 2, "a later message DOES call the model — but as an ORDINARY message, not a gate approval");
  const pending = await gate.pending("chat-3");
  assert.equal(pending, null, "the declined gate never comes back");
});

test("gate: a new chat's first turn expires an older chat's pending gate", async () => {
  const calls = { count: 0 };
  const gate = createInMemoryGate();
  const coach = createCoach({
    model: bigRunModel(calls),
    workspace: createInMemoryWorkspaceStore(),
    skills: await loadRealSkillBundle(),
    gate,
    balance: async () => 5,
    fetch: globalThis.fetch,
    clock: { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
  });
  const s1 = coach.stream({ chatId: "chat-old", messages: [userMsg("u1", "evaluate my 6 saved roles")] });
  for await (const _ of readUIMessageStream({ stream: s1 })) void 0;
  assert.ok(await gate.pending("chat-old"));

  const s2 = coach.stream({ chatId: "chat-new", messages: [userMsg("u1", "hi")] });
  for await (const _ of readUIMessageStream({ stream: s2 })) void 0;
  assert.equal(await gate.pending("chat-old"), null, "chat-old's gate expired when chat-new's first turn ran");
});
