// Builder-owned harness (design-web-ui.md § 5.9 Stage 2's own tester
// checks, item: "the RealChatShell run with a spy conversation store for
// the save count and the restored-gate landing"). Mounts the REAL member
// chat screen — apps/web's RealChatShell (which now mounts Frame
// internally), useChat, Composer, Transcript, Rail, TabBar — on a real
// createCoach + the real OpenRouter provider (createCoachModel), the same
// posture as tests/web/version/harness.tsx. The only stand-ins are the
// ones a member screen needs without Supabase: an in-memory workspace, an
// in-memory gate, a fixed balance, and a SPY ConversationStore (counts
// every save() call; never touches a network).
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
import type { ConversationStore } from "../../../apps/web/src/backend/conversation-store.ts";
import type { AppMessage } from "../../../apps/web/src/types.ts";
import "../../../apps/web/src/styles.css";

const params = new URLSearchParams(location.search);
const chatId = `chat-harness-${Math.random().toString(36).slice(2)}`;
const gate = createInMemoryGate();
const workspace = createInMemoryWorkspaceStore({ "CLAUDE.md": "# guardrails\n" });
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

// The spy conversation store (design-web-ui.md § 5.1, "One frame for both
// builds": "exactly one save per ended turn, whichever page is open").
// `saves` is read by the test through window.__h — never re-derived from
// DOM, so the count is the SAME thing RealChatShell's own onFinish->
// saveConversation path produced, not a guess at it.
const GATE_ID = "gate-harness-1";
let version: string | null = params.get("seedGate") === "1" ? "v0" : null;
const saves: { messages: AppMessage[]; olderDropped: boolean }[] = [];
const store: ConversationStore = {
  async load() {
    return null; // RealApp.tsx's own restore dance isn't under test here — this harness supplies initialMessages/initialVersion directly, the same way RealApp.tsx would after ITS OWN load() (§ 11.6).
  },
  async save(id, messages, olderDropped) {
    saves.push({ messages, olderDropped });
    version = `v${saves.length}`;
    return { chatId: id, messages, olderDropped, version, updatedAt: new Date().toISOString() };
  },
  async readVersion() {
    return version;
  },
};

// ?seedGate=1: the restored-gate landing case (§ 5.1, "Where the app
// opens... the restored conversation has a pending gate"). A message with
// a data-gate part and NO matching data-gate-status is exactly what a
// restored, still-pending gate looks like to latestGateStatuses (packages/
// agent/src/helpers.ts) — the same function Frame's landing rule reads.
const seededMessages: AppMessage[] =
  params.get("seedGate") === "1"
    ? ([
        { id: "u1", role: "user", parts: [{ type: "text", text: "can you evaluate this role?" }], metadata: { origin: "typed" } },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "text", text: "Here's what it would take." },
            {
              type: "data-gate",
              data: {
                gateId: GATE_ID,
                kind: "spend",
                label: "evaluate the role",
                text: "Evaluate the role — about $0.20.",
                textHash: "h",
                gateLine: "Evaluate the role — about $0.20.",
                amountUsd: 0.2,
              },
            },
          ],
        },
      ] as unknown as AppMessage[])
    : [];

(window as any).__h = {
  chatId,
  builtId: BUILT_VERSION_ID,
  pending: () => gate.pending(chatId),
  saves,
  saveCount: () => saves.length,
};

function App() {
  const [theme] = useState<"light" | "dark">("light");
  return (
    <div className="app-root" data-theme={theme}>
      <RealChatShell
        coach={coach}
        workspace={workspace as any}
        balance={balance}
        chatId={chatId}
        initialMessages={seededMessages}
        initialVersion={version}
        conversationStore={store}
        supabaseUrl="http://127.0.0.1:9"
        accessToken={async () => "harness-token"}
        onSignOut={() => {}}
        onDeleted={async () => {}}
        theme={theme}
        coachModel={CLAUDE_COACH_MODEL}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
