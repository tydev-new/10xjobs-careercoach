// Tester-owned harness (not product code): mounts the REAL member chat
// screen — apps/web's RealChatShell, useChat, Composer, VersionNotice, and
// useVersionMonitor with the real document/window wiring — on a real
// createCoach with the real OpenRouter provider (createCoachModel). The
// only stand-ins are the ones § 10.4 names or the member screen needs
// without Supabase: an in-memory workspace, an in-memory gate, a fixed
// balance, and a proxy URL on this origin that the Playwright test routes
// (so every model request is counted, and none leaves the machine).
// /version.json is likewise answered by the test's page.route.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCoach } from "../../../packages/agent/src/index.ts";
import { createInMemoryGate } from "../../../packages/agent/src/gate.ts";
import { createInMemoryWorkspaceStore } from "../../../packages/agent/src/workspace/in-memory-store.ts";
import { createFakeScriptRunner } from "../../../packages/agent/src/tools/fake-script-runner.ts";
import { createCoachModel } from "../../../apps/web/src/backend/model.ts";
import { buildSkillBundle } from "../../../apps/web/src/backend/skills-bundle.ts";
import { RealChatShell } from "../../../apps/web/src/real/RealChatShell.tsx";
import { BUILT_VERSION_ID } from "../../../apps/web/src/real/version-check.ts";
import "../../../apps/web/src/styles.css";

const chatId = `chat-harness-${Math.random().toString(36).slice(2)}`;
const gate = createInMemoryGate();
const workspace = createInMemoryWorkspaceStore({ "CLAUDE.md": "# guardrails\n", "profile.md": "# Profile\n\nHarness persona.\n" });
const model = createCoachModel({ proxyUrl: `${location.origin}/stub-proxy`, getAccessToken: async () => "harness-token" });
const balance = async () => 5;
const coach = createCoach({
  model,
  workspace,
  skills: buildSkillBundle(),
  gate,
  balance,
  fetch: (async () => { throw new Error("no network in the harness"); }) as any,
  clock: { now: () => new Date() },
  scripts: createFakeScriptRunner([]),
} as any);

(window as any).__h = { chatId, builtId: BUILT_VERSION_ID, pending: () => gate.pending(chatId) };

function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  return (
    <RealChatShell
      coach={coach}
      workspace={workspace as any}
      balance={balance}
      chatId={chatId}
      supabaseUrl="http://127.0.0.1:9"
      accessToken={async () => "harness-token"}
      onSignOut={() => {}}
      onDeleted={async () => {}}
      theme={theme}
      onThemeToggle={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
