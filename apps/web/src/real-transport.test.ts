import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentChatTransport } from "./real-transport.ts";
import type { Coach, CoachStreamInput } from "../../../packages/agent/src/types.ts";

function fakeCoach(): { coach: Coach; calls: CoachStreamInput[] } {
  const calls: CoachStreamInput[] = [];
  const coach: Coach = {
    stream(input) {
      calls.push(input);
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "start" } as any);
          controller.enqueue({ type: "finish" } as any);
          controller.close();
        },
      });
    },
  };
  return { coach, calls };
}

test("sendMessages forwards chatId/messages/abortSignal straight to Coach.stream", async () => {
  const { coach, calls } = fakeCoach();
  const transport = new AgentChatTransport(coach, "chat-123");
  const messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }] as any;
  const controller = new AbortController();
  const stream = await transport.sendMessages({ messages, abortSignal: controller.signal });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, "chat-123");
  assert.equal(calls[0].messages, messages);
  assert.equal(calls[0].abortSignal, controller.signal);

  const reader = stream.getReader();
  const chunks: unknown[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  assert.deepEqual(chunks, [{ type: "start" }, { type: "finish" }]);
});

test("reconnectToStream always resolves null (no saved chat)", async () => {
  const { coach } = fakeCoach();
  const transport = new AgentChatTransport(coach, "chat-1");
  assert.equal(await transport.reconnectToStream(), null);
});

test("each call gets the coach's stream directly — no buffering/transform in between", async () => {
  const { coach } = fakeCoach();
  const transport = new AgentChatTransport(coach, "chat-1");
  const s1 = await transport.sendMessages({ messages: [] as any, abortSignal: undefined });
  const s2 = await transport.sendMessages({ messages: [] as any, abortSignal: undefined });
  assert.notEqual(s1, s2); // a fresh stream per turn, not a cached/replayed one
});
