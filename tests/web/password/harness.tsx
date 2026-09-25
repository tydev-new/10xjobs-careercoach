// Tester-owned harness (not product code) for C § 16 / ui § 1.10.
//
//   ?mode=app (default)  the REAL RealApp (sign-in, recovery screen,
//                        membership check, not-a-member), with
//                        `@supabase/supabase-js` aliased to ./fake-supabase.ts
//                        at build time, so auth.ts's own createTenAuthClient
//                        returns the scripted fake.
//   ?mode=shell          the REAL member chat screen (RealChatShell, Header
//                        and its ⋯ menu, SetPasswordDialog) on a real
//                        createCoach, as tests/web/version/harness.tsx does,
//                        with the same fake as its authClient. The workspace
//                        and the conversation store are recording wrappers
//                        (C § 16.4 item 7: "the conversation save and
//                        workspace writes").
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCoach } from "../../../packages/agent/src/index.ts";
import { createInMemoryGate } from "../../../packages/agent/src/gate.ts";
import { createInMemoryWorkspaceStore } from "../../../packages/agent/src/workspace/in-memory-store.ts";
import { createFakeScriptRunner } from "../../../packages/agent/src/tools/fake-script-runner.ts";
import { createCoachModel } from "../../../apps/web/src/backend/model.ts";
import { buildSkillBundle } from "../../../apps/web/src/backend/skills-bundle.ts";
import { CLAUDE_COACH_MODEL } from "../../../apps/web/src/backend/coach-model.ts";
import { RealApp } from "../../../apps/web/src/real/RealApp.tsx";
import { RealChatShell } from "../../../apps/web/src/real/RealChatShell.tsx";
import { createClient } from "./fake-supabase.ts";
import "../../../apps/web/src/styles.css";

declare global {
  interface Window {
    __leak: Record<string, string[]>;
  }
}
window.__leak ??= {};
const leak = (k: string, v: unknown) => {
  (window.__leak[k] ??= []).push(typeof v === "string" ? v : JSON.stringify(v));
};

const mode = new URLSearchParams(location.search).get("mode") ?? "app";
const root = createRoot(document.getElementById("root")!);

if (mode === "shell") {
  const chatId = "chat-password-harness";
  const gate = createInMemoryGate();
  const inner = createInMemoryWorkspaceStore({ "CLAUDE.md": "# guardrails\n", "profile.md": "# Profile\n\nHarness persona.\n" });
  const workspace = {
    list: (d?: string) => inner.list(d),
    read: (p: string) => inner.read(p),
    write: (p: string, c: string, v: string | null) => (leak("workspace", [p, c]), inner.write(p, c, v)),
    upload: (p: string, b: Uint8Array) => (leak("workspace", [p, new TextDecoder().decode(b)]), inner.upload(p, b)),
  };
  const conversationStore = {
    load: async () => null,
    save: async (id: string, messages: unknown, olderDropped: boolean, expected: string | null) => {
      leak("conversation", [id, messages, olderDropped, expected]);
      return { chatId: id, messages, olderDropped, version: "v1", updatedAt: new Date().toISOString() };
    },
    readVersion: async () => null,
  };
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
  const authClient = createClient("http://127.0.0.1:9", "anon");
  const email = window.__cfg?.email ?? "member@example.com";
  function Shell() {
    const [signedOut, setSignedOut] = useState(false);
    if (signedOut) return <p className="harness-signed-out">signed out</p>;
    return (
      <div className="app-root" data-theme="light">
        <RealChatShell
          coach={coach}
          workspace={workspace as any}
          balance={balance}
          chatId={chatId}
          initialMessages={[]}
          conversationStore={conversationStore as any}
          supabaseUrl="http://127.0.0.1:9"
          accessToken={async () => "harness-token"}
          authClient={authClient}
          userEmail={email}
          onSignOut={() => setSignedOut(true)}
          onDeleted={async () => {}}
          theme="light"
          coachModel={CLAUDE_COACH_MODEL}
        />
      </div>
    );
  }
  root.render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
} else {
  const env = {
    supabaseUrl: "http://127.0.0.1:9",
    supabaseAnonKey: "anon",
    modelProxyUrl: "http://127.0.0.1:9/functions/v1/ten-model-proxy",
    siteUrl: String(import.meta.env.VITE_SITE_URL ?? ""),
    coachModel: CLAUDE_COACH_MODEL,
  };
  root.render(
    <StrictMode>
      <RealApp env={env} theme="light" />
    </StrictMode>,
  );
}
