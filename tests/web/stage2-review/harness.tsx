// Tester-owned harness (not product code) for workspace Stage 2, "the
// frame" (docs/design-web-ui.md § 5.1, § 5.2 rules 1-2, § 5.9 Stage 2's
// tester checks). Written independently of the builder's
// tests/web/stage2/harness.tsx.
//
// Mounts the REAL member screen — RealChatShell, which mounts Frame (rail,
// header, pages, tab bar) — on a real createCoach and the real OpenRouter
// provider (createCoachModel), the posture of tests/web/version/harness.tsx.
// Stand-ins, all spies that never touch a network:
//   - workspace: an in-memory store whose write() and upload() THROW and
//     are counted (§ 5.2 rule 1: "a spy store whose write and upload
//     throw; zero calls"); list()/read() are counted too;
//   - conversation store: counts every save() (§ 5.1: "exactly one save
//     per ended turn, whichever page is open");
//   - the model proxy is `${origin}/stub-proxy`; the test fulfils (and
//     counts) it with Playwright, with whatever delay it needs.
//
//   ?seed=none   no saved conversation (first run)
//   ?seed=saved  a restored conversation with no gate
//   ?seed=gate   a restored conversation whose gate is still pending
//
// Counters are on window.__spy.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCoach } from "../../../packages/agent/src/index.ts";
import { createInMemoryGate } from "../../../packages/agent/src/gate.ts";
import { createInMemoryWorkspaceStore } from "../../../packages/agent/src/workspace/in-memory-store.ts";
import { createFakeScriptRunner } from "../../../packages/agent/src/tools/fake-script-runner.ts";
import { createCoachModel } from "../../../apps/web/src/backend/model.ts";
import { CLAUDE_COACH_MODEL } from "../../../apps/web/src/backend/coach-model.ts";
import { buildSkillBundle } from "../../../apps/web/src/backend/skills-bundle.ts";
import { RealChatShell } from "../../../apps/web/src/real/RealChatShell.tsx";
import { BUILT_VERSION_ID } from "../../../apps/web/src/real/version-check.ts";
import type { AppMessage } from "../../../apps/web/src/types.ts";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "../../../apps/web/src/styles.css";

declare global {
  interface Window {
    __spy: { writes: string[]; uploads: string[]; reads: string[]; lists: string[]; saves: number; savedLengths: number[] };
  }
}
window.__spy = { writes: [], uploads: [], reads: [], lists: [], saves: 0, savedLengths: [] };
// the id /version.json must echo for "no newer version" (the test reads it)
(window as any).__builtId = BUILT_VERSION_ID;

const seed = new URLSearchParams(location.search).get("seed") ?? "none";
const chatId = "chat-stage2-review";
const gate = createInMemoryGate();
const inner = createInMemoryWorkspaceStore({ "CLAUDE.md": "# guardrails\n", "profile.md": "# Profile\n\nReview persona.\n" });
const workspace = {
  list: (d?: string) => (window.__spy.lists.push(d ?? ""), inner.list(d)),
  read: (p: string) => (window.__spy.reads.push(p), inner.read(p)),
  write: (p: string) => {
    window.__spy.writes.push(p);
    throw new Error(`stage2-review spy: write(${p}) — pages never write (§ 5.2 rule 1)`);
  },
  upload: (p: string) => {
    window.__spy.uploads.push(p);
    throw new Error(`stage2-review spy: upload(${p}) — pages never write (§ 5.2 rule 1)`);
  },
};
let version: string | null = seed === "none" ? null : "v0";
const conversationStore = {
  load: async () => null,
  save: async (id: string, messages: AppMessage[], olderDropped: boolean) => {
    window.__spy.saves++;
    window.__spy.savedLengths.push(messages.length);
    version = `v${window.__spy.saves}`;
    return { chatId: id, messages, olderDropped, version, updatedAt: new Date().toISOString() };
  },
  readVersion: async () => version,
};

const user = (id: string, text: string): AppMessage => ({ id, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } }) as AppMessage;
const saved: AppMessage[] = [
  user("u1", "hi, I'm looking for staff PM roles"),
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "Got it. Paste a posting whenever you have one." }] } as AppMessage,
];
const GATE = "gate-stage2-review";
const withGate: AppMessage[] = [
  user("u1", "can you evaluate the 6 roles I saved?"),
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "text", text: "Here's what that would take." },
      { type: "data-gate", data: { gateId: GATE, kind: "spend", label: "evaluate 6 saved roles", text: "evaluate 6 saved roles\nEstimated cost: $0.50–$0.70.", textHash: "h", gateLine: "This costs up to $0.70 — nothing starts until you say yes.", amountUsd: 0.7 } },
      { type: "data-gate-status", data: { gateId: GATE, status: "pending" } },
    ],
  } as AppMessage,
];
const initialMessages = seed === "saved" ? saved : seed === "gate" ? withGate : [];

const model = createCoachModel({ proxyUrl: `${location.origin}/stub-proxy`, getAccessToken: async () => "harness-token" });
const balance = async () => 5;
const coach = createCoach({
  model,
  workspace,
  skills: buildSkillBundle(),
  gate,
  balance,
  fetch: (async () => {
    throw new Error("no network in the harness");
  }) as any,
  clock: { now: () => new Date() },
  scripts: createFakeScriptRunner([]),
} as any);

const stubAuth = {
  auth: new Proxy({}, { get: () => () => new Promise(() => {}) }),
  rpc: () => new Promise(() => {}),
} as any;

function Shell() {
  const [out, setOut] = useState(false);
  if (out) return <p>signed out</p>;
  return (
    <div className="app-root" data-theme="light">
      <RealChatShell
        coach={coach}
        workspace={workspace as any}
        balance={balance}
        chatId={chatId}
        initialMessages={initialMessages}
        initialVersion={seed === "none" ? null : "v0"}
        conversationStore={conversationStore as any}
        supabaseUrl="http://127.0.0.1:9"
        accessToken={async () => "harness-token"}
        authClient={stubAuth}
        userEmail="member@example.com"
        onSignOut={() => setOut(true)}
        onDeleted={async () => {}}
        theme="light"
        coachModel={CLAUDE_COACH_MODEL}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
