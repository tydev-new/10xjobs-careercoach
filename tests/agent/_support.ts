// Tester-owned support for tests/agent/*.test.ts (plan step 4, independent
// of packages/agent/test/). Derived from docs/design-web-agent.md, not
// from the coder's tests. Run:  node --test tests/agent/
//
// `ai` is resolved from packages/agent/node_modules (same file the package
// itself resolves, so one module instance), mirroring tests/web's pattern.
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as AI from "../../packages/agent/node_modules/ai/dist/index.js";
import * as AITEST from "../../packages/agent/node_modules/ai/dist/test/index.js";
import { createCoach } from "../../packages/agent/src/coach.ts";
import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { createFakeScriptRunner } from "../../packages/agent/src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";

export { AI, AITEST };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");
export const AGENT = path.join(REPO, "packages/agent");

/** The real skills/ tree as a SkillBundle, read by THIS file (not the
 *  package's own disk reader), so a bug in that reader can't hide here. */
export function realBundle(): Record<string, string> {
  const out: Record<string, string> = {};
  const root = path.join(REPO, "skills");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[path.relative(REPO, abs).split(path.sep).join("/")] = readFileSync(abs, "utf8");
    }
  };
  walk(root);
  return out;
}

export function tmp(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// ---------------------------------------------------------------- messages

export function user(id: string, text: string, origin: "typed" | "ui" | null = "typed"): any {
  const m: any = { id, role: "user", parts: [{ type: "text", text }] };
  if (origin) m.metadata = { origin };
  return m;
}

export function assistantText(id: string, text: string): any {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

// ---------------------------------------------------------------- mock model
// AI SDK 7 / LanguageModelV4: finishReason is { unified, raw } and usage is
// nested (docs/spikes/spike-1-browser-loop.md § Surprises).

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

export type StepOpts = { costUsd?: number };

function finish(reason: "tool-calls" | "stop", o: StepOpts = {}) {
  const f: any = { type: "finish", finishReason: { unified: reason, raw: reason }, usage: USAGE };
  if (o.costUsd !== undefined) f.providerMetadata = { openrouter: { usage: { cost: o.costUsd } } };
  return f;
}

export function toolStep(calls: Array<{ name: string; input: unknown; id?: string }>, o: StepOpts = {}): any[] {
  const chunks: any[] = [{ type: "stream-start", warnings: [] }];
  calls.forEach((c, i) => {
    const id = c.id ?? `call-${Math.random().toString(36).slice(2)}-${i}`;
    const input = JSON.stringify(c.input);
    chunks.push(
      { type: "tool-input-start", id, toolName: c.name },
      { type: "tool-input-delta", id, delta: input },
      { type: "tool-input-end", id },
      { type: "tool-call", toolCallId: id, toolName: c.name, input },
    );
  });
  chunks.push(finish("tool-calls", o));
  return chunks;
}

export function textStep(text: string, o: StepOpts = {}): any[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    finish("stop", o),
  ];
}

/** A scripted model. Each doStream call consumes the next step; running
 *  past the script returns a plain text step. Records every prompt. */
export function scriptedModel(steps: any[][], onCall?: (options: any) => void) {
  const calls: any[] = [];
  let i = 0;
  const model = new (AITEST as any).MockLanguageModelV4({
    doStream: async (options: any) => {
      calls.push(options);
      onCall?.(options);
      const chunks = i < steps.length ? steps[i] : textStep("(script exhausted)");
      i++;
      return { stream: (AITEST as any).simulateReadableStream({ chunks }) };
    },
  });
  return { model, calls, get used() { return i; } };
}

// ---------------------------------------------------------------- recording gate

export interface GateEvent { op: string; args: any[] }

/** Wraps the package's own in-memory gate_log and records every call, so a
 *  test can prove what was LOGGED, not what the stream narrated. */
export function recordingGate(inner = createInMemoryGate()) {
  const events: GateEvent[] = [];
  const rows = new Map<string, { req: any; chatId: string; status: string; typedText?: string }>();
  const gate = {
    async open(req: any, chatId: string) {
      events.push({ op: "open", args: [req, chatId] });
      rows.set(req.gateId, { req, chatId, status: "pending" });
      return inner.open(req, chatId);
    },
    async decide(gateId: string, status: any, typedText?: string) {
      events.push({ op: "decide", args: [gateId, status, typedText] });
      const r = rows.get(gateId);
      if (r && r.status === "pending") { r.status = status; r.typedText = typedText; }
      return inner.decide(gateId, status, typedText);
    },
    async pending(chatId: string) {
      return inner.pending(chatId);
    },
    async expireOtherChats(chatId: string) {
      events.push({ op: "expireOtherChats", args: [chatId] });
      for (const r of rows.values()) if (r.chatId !== chatId && r.status === "pending") r.status = "expired";
      return inner.expireOtherChats(chatId);
    },
  };
  return { gate, events, rows };
}

// ---------------------------------------------------------------- coach

export function makeCoach(o: {
  model: any;
  files?: Record<string, string>;
  workspace?: any;
  gate?: any;
  skills?: Record<string, string>;
  scripts?: any;
  limits?: any;
  balance?: number;
  webSearch?: any;
}) {
  const workspace = o.workspace ?? createInMemoryWorkspaceStore(o.files ?? {});
  const coach = createCoach({
    model: o.model,
    workspace,
    skills: o.skills ?? realBundle(),
    gate: o.gate ?? createInMemoryGate(),
    balance: async () => o.balance ?? 5,
    fetch: (async () => { throw new Error("no network in tests"); }) as any,
    clock: { now: () => new Date("2026-09-23T12:00:00Z") },
    scripts: o.scripts ?? createFakeScriptRunner([]),
    webSearch: o.webSearch,
    limits: o.limits,
  } as any);
  return { coach, workspace };
}

/** Runs one turn; returns every raw UI chunk plus the final assembled message. */
export async function runTurn(coach: any, chatId: string, messages: any[]) {
  const stream: ReadableStream = coach.stream({ chatId, messages });
  const [a, b] = stream.tee();
  const chunks: any[] = [];
  const reader = a.getReader();
  const collect = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  let last: any = null;
  for await (const m of (AI as any).readUIMessageStream({ stream: b })) last = m;
  await collect;
  return { chunks, message: last };
}

export const dataChunks = (chunks: any[], type: string) => chunks.filter((c) => c.type === type);
