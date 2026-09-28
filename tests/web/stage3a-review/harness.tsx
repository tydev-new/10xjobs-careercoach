// Tester-owned harness (not product code) for workspace Stage 3a, the
// Documents page (docs/design-web-ui.md § 5.3 "Documents: every file",
// § 5.2 rules 1, 2, 6 and 8, § 5.4 "Ask Ten about this", § 5.5 phone;
// § 5.9 Stage 3a's exit). Written from the spec, independently of the
// builder's own apps/web/src/workspace/documents.test.ts.
//
// Mounts the REAL member screen — RealChatShell, which mounts Frame and
// DocumentsPage — on a real createCoach and the real OpenRouter provider
// pointed at `${origin}/stub-proxy` (the test counts every hit there with
// Playwright). The workspace is the REAL in-memory WorkspaceStore from
// packages/agent (createInMemoryWorkspaceStore) wrapped in a spy:
//   - write() and upload() THROW and are counted (§ 5.2 rule 1);
//   - list() and read() are counted; list() hands its files back in
//     REVERSE order, so the page's own "sorted by path" is what's tested,
//     never the store's;
//   - window.__ctl.listFail / readFail make list() / read(<path>) throw a
//     non-missing error (§ 5.2 rule 6), toggled by the test at run time.
// A seeded `.pdf` / `.docx` goes in through the inner store's own upload()
// (never the spy's), so the store's own read() returns `binary: true` —
// the same shape the production Supabase store's readBinary() returns for
// an upload extension (supabase-workspace-store.ts `readOne`).
//
// The seed comes from `./seed.json`, which the test fulfils per page:
//   { files: {path: content}, seed: "none" | "saved", updatedAt: ISO }
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCoach } from "../../../packages/agent/src/index.ts";
import { createInMemoryGate } from "../../../packages/agent/src/gate.ts";
import { createInMemoryWorkspaceStore } from "../../../packages/agent/src/workspace/in-memory-store.ts";
import { isUploadExt } from "../../../packages/agent/src/workspace/path-rules.ts";
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

interface Seed {
  files: Record<string, string>;
  seed?: "none" | "saved";
  updatedAt?: string;
}

declare global {
  interface Window {
    __spy: { writes: string[]; uploads: string[]; reads: string[]; lists: number; saves: number };
    __ctl: { listFail: boolean; readFail: string[] };
    __inner: any;
    __ready: boolean;
  }
}
window.__spy = { writes: [], uploads: [], reads: [], lists: 0, saves: 0 };
window.__ctl = { listFail: false, readFail: [] };
(window as any).__builtId = BUILT_VERSION_ID;

async function main() {
  const s: Seed = await (await fetch("./seed.json")).json();
  const at = s.updatedAt ?? "2026-09-22T03:30:00.000Z";
  const clock = { now: () => new Date(at) };
  const text: Record<string, string> = {};
  const bin: [string, string][] = [];
  for (const [p, c] of Object.entries(s.files)) (isUploadExt(p) ? bin.push([p, c]) : (text[p] = c));
  const inner = createInMemoryWorkspaceStore(text, clock);
  for (const [p, c] of bin) await inner.upload(p, new TextEncoder().encode(c));
  window.__inner = inner;

  const fail = (what: string) => {
    const e = new Error(`stage3a-review: ${what} failed (HTTP 500)`);
    return e;
  };
  const workspace = {
    list: async (d?: string) => {
      window.__spy.lists++;
      if (window.__ctl.listFail) throw fail("list");
      return [...(await inner.list(d))].reverse();
    },
    read: async (p: string) => {
      window.__spy.reads.push(p);
      if (window.__ctl.readFail.includes(p)) throw fail(`read(${p})`);
      return inner.read(p);
    },
    write: (p: string) => {
      window.__spy.writes.push(p);
      throw new Error(`stage3a-review spy: write(${p}) — pages never write (§ 5.2 rule 1)`);
    },
    upload: (p: string) => {
      window.__spy.uploads.push(p);
      throw new Error(`stage3a-review spy: upload(${p}) — pages never write (§ 5.2 rule 1)`);
    },
  };

  let version: string | null = s.seed === "saved" ? "v0" : null;
  const conversationStore = {
    load: async () => null,
    save: async (id: string, messages: AppMessage[], olderDropped: boolean) => {
      window.__spy.saves++;
      version = `v${window.__spy.saves}`;
      return { chatId: id, messages, olderDropped, version, updatedAt: new Date().toISOString() };
    },
    readVersion: async () => version,
  };
  const user = (id: string, t: string): AppMessage => ({ id, role: "user", parts: [{ type: "text", text: t }], metadata: { origin: "typed" } }) as AppMessage;
  const saved: AppMessage[] = [
    user("u1", "hi, I'm looking for staff PM roles"),
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "Got it. Paste a posting whenever you have one." }] } as AppMessage,
  ];

  const model = createCoachModel({ proxyUrl: `${location.origin}/stub-proxy`, getAccessToken: async () => "harness-token" });
  const balance = async () => 5;
  const coach = createCoach({
    model,
    workspace,
    skills: buildSkillBundle(),
    gate: createInMemoryGate(),
    balance,
    fetch: (async () => {
      throw new Error("no network in the harness");
    }) as any,
    clock: { now: () => new Date() },
    scripts: createFakeScriptRunner([]),
  } as any);
  const stubAuth = { auth: new Proxy({}, { get: () => () => new Promise(() => {}) }), rpc: () => new Promise(() => {}) } as any;

  function Shell() {
    const [out, setOut] = useState(false);
    if (out) return <p>signed out</p>;
    return (
      <div className="app-root" data-theme="light">
        <RealChatShell
          coach={coach}
          workspace={workspace as any}
          balance={balance}
          chatId="chat-stage3a-review"
          initialMessages={s.seed === "saved" ? saved : []}
          initialVersion={s.seed === "saved" ? "v0" : null}
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
  window.__ready = true;
}
void main();
