// Tester-owned harness (not product code) for workspace Stage 3d, the
// Applications page (docs/design-web-ui.md § 5.3 "Applications: the
// materials per role", § 5.2 rules 1, 2, 4, 6, 8, § 5.4, § 5.5; § 5.9
// Stage 3d's exit). Written from the spec, independently of the builder's
// own tests; the shape follows tests/web/stage3a-review/harness.tsx.
//
// Mounts the REAL member screen — RealChatShell, which mounts Frame and
// ApplicationsPage — on a real createCoach and the real OpenRouter provider
// pointed at `${origin}/stub-proxy` (the test counts every hit there). The
// workspace is the REAL in-memory WorkspaceStore from packages/agent,
// wrapped in a spy:
//   - write() and upload() THROW and are counted (§ 5.2 rule 1);
//   - list() and read() are counted; list() hands its files back in REVERSE
//     order and, when the seed names one, with a per-path `updatedAt`
//     (§ 5.3: "Entries are ordered newest change first, by the latest
//     updatedAt among the entry's files") — so the page's own ordering is
//     what's tested, never the store's;
//   - window.__ctl.readFail makes read(<path>) throw a non-missing error,
//     listFail makes list() throw (§ 5.2 rule 6).
//
// The seed comes from `./seed.json`, which the test fulfils per page:
//   { files, seed: "none" | "saved", updatedAt, updatedAtByPath }
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createCoach } from "../../../packages/agent/src/index.ts";
import { createInMemoryGate } from "../../../packages/agent/src/gate.ts";
import { createInMemoryWorkspaceStore } from "../../../packages/agent/src/workspace/in-memory-store.ts";
import { isUploadExt } from "../../../packages/agent/src/workspace/path-rules.ts";
import { WorkspaceError } from "../../../packages/agent/src/types.ts";
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
  updatedAtByPath?: Record<string, string>;
}

declare global {
  interface Window {
    __spy: { writes: string[]; uploads: string[]; reads: string[]; lists: number; saves: number };
    __ctl: { listFail: boolean; readFail: string[]; readMissing: string[] };
    __inner: any;
    __ready: boolean;
  }
}
window.__spy = { writes: [], uploads: [], reads: [], lists: 0, saves: 0 };
window.__ctl = { listFail: false, readFail: [], readMissing: [] };
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
  const byPath = s.updatedAtByPath ?? {};

  const fail = (what: string) => new Error(`stage3d-review: ${what} failed (HTTP 500)`);
  const workspace = {
    list: async (d?: string) => {
      window.__spy.lists++;
      if (window.__ctl.listFail) throw fail("list");
      const files = [...(await inner.list(d))].reverse();
      return files.map((f: any) => (byPath[f.path] ? { ...f, updatedAt: byPath[f.path] } : f));
    },
    read: async (p: string) => {
      window.__spy.reads.push(p);
      if (window.__ctl.readFail.includes(p)) throw fail(`read(${p})`);
      if (window.__ctl.readMissing.includes(p)) throw new WorkspaceError("resource_missing", `${p} does not exist.`);
      return inner.read(p);
    },
    write: (p: string) => {
      window.__spy.writes.push(p);
      throw new Error(`stage3d-review spy: write(${p}) — pages never write (§ 5.2 rule 1)`);
    },
    upload: (p: string) => {
      window.__spy.uploads.push(p);
      throw new Error(`stage3d-review spy: upload(${p}) — pages never write (§ 5.2 rule 1)`);
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
          chatId="chat-stage3d-review"
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
