// agentTransport(coach, chatId) — the in-tab ChatTransport that runs
// packages/agent's createCoach(deps) in the browser
// (docs/plan-portable-skills-and-web-agent.md step 5b, item 1). This is
// deliberately the ENTIRE diff from mock-transport.ts's shape: both
// implement `ai@7.0.111`'s own `ChatTransport<AppMessage>` (`sendMessages`
// / `reconnectToStream`), and `Coach.stream({ chatId, messages,
// abortSignal })` (design-web-agent.md § 1) already returns exactly the
// `ReadableStream<UIMessageChunk>` `sendMessages` must resolve — so
// swapping `MockChatTransport` for `AgentChatTransport` really is the
// one-line change the plan promised (see src/main.tsx).
//
// Browser-safe: no window/document/localStorage/node:*.
import type { ChatTransport, UIMessageChunk } from "ai";
import type { Coach } from "../../../packages/agent/src/types.ts";
import type { AppMessage } from "./types.ts";

export class AgentChatTransport implements ChatTransport<AppMessage> {
  private readonly coach: Coach;
  private readonly chatId: string;

  constructor(coach: Coach, chatId: string) {
    this.coach = coach;
    this.chatId = chatId;
  }

  async sendMessages(options: {
    messages: AppMessage[];
    abortSignal: AbortSignal | undefined;
  }): Promise<ReadableStream<UIMessageChunk>> {
    return this.coach.stream({
      chatId: this.chatId,
      messages: options.messages,
      abortSignal: options.abortSignal,
    });
  }

  // No saved chat (design-web-agent.md, Decision log: "No saved chat: files
  // are the memory") — there is nothing server-side to reconnect to.
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
