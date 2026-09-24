// Step 5b coder's fix (flagged in the hand-back — outside this slice's own
// directory, packages/agent): design-web-ui.md § 2.7 — "message is never
// a UI invention: it's the literal sentence the server sent". A model-call
// failure whose `responseBody` carries `ten-model-proxy`'s own
// `{ error: { code, message } }` JSON (docs/design-web-agent.md § 8) must
// surface THAT message, not the generic ERROR_MESSAGES sentence — and
// with no parseable server message, the generic sentence is unchanged
// (the pre-existing behavior every other test still exercises).
import assert from "node:assert/strict";
import test from "node:test";
import { readUIMessageStream } from "ai";
import { createCoach, ERROR_MESSAGES } from "../src/coach.ts";
import { createInMemoryGate } from "../src/gate.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import type { AppMessage } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function userMsg(id: string, text: string): AppMessage {
  return { id, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } } as AppMessage;
}

async function runAndGetErrors(model: any) {
  const coach = createCoach({
    model,
    workspace: createInMemoryWorkspaceStore(),
    skills: await loadRealSkillBundle(),
    gate: createInMemoryGate(),
    balance: async () => 5,
    fetch: globalThis.fetch,
    clock: { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
  });
  const stream = coach.stream({ chatId: "chat-1", messages: [userMsg("u1", "hi")] });
  const messages: any[] = [];
  for await (const m of readUIMessageStream({ stream })) messages.push(m);
  const last = messages[messages.length - 1];
  return (last?.parts ?? []).filter((p: any) => p.type === "data-error").map((p: any) => p.data);
}

/** Reads the coach's RAW UIMessageChunk stream (not the assembled
 *  UIMessage[] readUIMessageStream produces) — needed to see the
 *  `{ type: "finish" }` chunk itself, which carries no part on the
 *  final message. */
async function rawChunks(stream: ReadableStream<any>) {
  const out: any[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

test("a proxy 402 with a JSON responseBody shows the LITERAL server message, not the generic sentence", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const e: any = new Error("Payment Required");
      e.statusCode = 402;
      e.responseBody = JSON.stringify({
        error: { code: "over_balance", message: "Your beta credit is used up. Ask the person who invited you for more." },
      });
      throw e;
    },
  });
  const errs = await runAndGetErrors(model);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].code, "over_balance");
  assert.equal(errs[0].message, "Your beta credit is used up. Ask the person who invited you for more.");
  assert.notEqual(errs[0].message, ERROR_MESSAGES.over_balance.message);
});

test("a proxy 503 (the beta ceiling) shows ITS OWN message under the same model_error code", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const e: any = new Error("Service Unavailable");
      e.statusCode = 503;
      e.responseBody = JSON.stringify({
        error: { code: "model_error", message: "The beta has reached today's limit. Try again tomorrow." },
      });
      throw e;
    },
  });
  const errs = await runAndGetErrors(model);
  assert.equal(errs[0].code, "model_error");
  assert.equal(errs[0].message, "The beta has reached today's limit. Try again tomorrow.");
});

// § 9.3 (amended 2026-09-24): a cut-off reply is its OWN code, `cut_off`,
// not a `model_error` cause any more — the old § 8 cut-off `model_error`
// sentence this test used to exercise here is retired. The mechanism this
// test proves (any distinct message under the SAME code passes through
// verbatim) still needs a second, still-real 503 model_error cause.
test("a different 503 cause (upstream unavailable) is told apart from the ceiling ONLY by its own message, same code", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const e: any = new Error("Service Unavailable");
      e.statusCode = 503;
      e.responseBody = JSON.stringify({
        error: { code: "model_error", message: "The model is temporarily unavailable. Try again." },
      });
      throw e;
    },
  });
  const errs = await runAndGetErrors(model);
  assert.equal(errs[0].code, "model_error");
  assert.equal(errs[0].message, "The model is temporarily unavailable. Try again.");
});

test("no responseBody at all falls back to the generic ERROR_MESSAGES sentence (pre-existing behavior, unchanged)", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const e: any = new Error("Payment Required");
      e.statusCode = 402;
      throw e;
    },
  });
  const errs = await runAndGetErrors(model);
  assert.equal(errs[0].code, "over_balance");
  assert.equal(errs[0].message, ERROR_MESSAGES.over_balance.message);
});

// Follow-up B(3) (closing drift review of issue #2, 2026-09-24): § 9.2
// says "the coach writes one { type: 'finish' } last of all" — but a turn
// that THROWS reaches the OUTER catch in createCoach's own `execute`
// (not the model-call tap's `onError`, which every other test in this
// file exercises and which never throws — it just writes a data-error
// and lets runTurn finish normally). That outer catch wrote its
// data-error and returned with no finish chunk at all, because runTurn's
// own finish write is its very last statement and never runs when
// something earlier in the turn throws. A gate backend failure
// (`deps.gate.pending`, called unconditionally near the top of every
// turn, before any model call) is a realistic way to reach it.
test("a turn that throws before the model call still ends its stream with exactly one { type: 'finish' } chunk, last of all — not zero", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const model = new MockLanguageModelV4({
    doStream: async () => {
      throw new Error("must not be called — the gate throws before any model call");
    },
  });
  const throwingGate: ReturnType<typeof createInMemoryGate> = {
    ...createInMemoryGate(),
    pending: async () => {
      throw new Error("gate backend unreachable");
    },
  };
  const coach = createCoach({
    model,
    workspace: createInMemoryWorkspaceStore(),
    skills: await loadRealSkillBundle(),
    gate: throwingGate,
    balance: async () => 5,
    fetch: globalThis.fetch,
    clock: { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts: createFakeScriptRunner([]),
  });
  const stream = coach.stream({ chatId: "chat-1", messages: [userMsg("u1", "hi")] });
  const chunks = await rawChunks(stream);

  assert.equal((model as any).doStreamCalls.length, 0, "the throw happens before any model call — proves this is the OUTER catch, not the tap's onError");
  const finishChunks = chunks.filter((c) => c.type === "finish");
  assert.equal(finishChunks.length, 1, "exactly one finish chunk, not zero (the pre-fix gap) and not two");
  assert.equal(chunks[chunks.length - 1].type, "finish", "finish is the LAST chunk, after the data-error");
  assert.ok(
    chunks.some((c) => c.type === "data-error" && c.data.code === "model_error"),
    "the data-error this catch path writes is still there (a plain Error with no statusCode classifies as model_error)",
  );
});

test("a responseBody that isn't the § 8 shape (malformed JSON) also falls back to the generic sentence", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const e: any = new Error("Service Unavailable");
      e.statusCode = 503;
      e.responseBody = "not json";
      throw e;
    },
  });
  const errs = await runAndGetErrors(model);
  assert.equal(errs[0].code, "model_error");
  assert.equal(errs[0].message, ERROR_MESSAGES.model_error.message);
});
