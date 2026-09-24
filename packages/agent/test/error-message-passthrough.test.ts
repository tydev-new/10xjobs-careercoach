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
