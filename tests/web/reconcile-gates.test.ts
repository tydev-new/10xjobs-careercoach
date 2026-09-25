// Tester-owned: docs/design-web-agent.md § 11.6 (gate reconciliation on
// restore; 6641e1a), run on apps/web's reconcileGateStatuses with fakes for
// the gate row reads/decides. The e2e (tests/e2e-real, "conversation") runs
// the same paths through the real RealApp; this pins the contract cheaply.
// Run: node --test tests/web/reconcile-gates.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { reconcileGateStatuses } from "../../apps/web/src/real/reconcile-gates.ts";

const card = (gateId: string) => ({ type: "data-gate", data: { gateId, kind: "spend", label: "Search", text: "t", textHash: "sha256:" + "0".repeat(64), gateLine: "l", amountUsd: 1.5 } });
const status = (gateId: string, s: string) => ({ type: "data-gate-status", data: { gateId, status: s } });
const turn = (i: number, parts: any[]) => [
  { id: `u${i}`, role: "user", parts: [{ type: "text", text: `turn ${i}` }] },
  { id: `a${i}`, role: "assistant", parts: [{ type: "text", text: `reply ${i}` }, ...parts] },
];
function fakes(rows: Record<string, string>, pendingFor?: string) {
  const decided: Array<[string, string]> = [];
  return {
    decided,
    deps: {
      pending: async (_chat: string) => (pendingFor && rows[pendingFor] === "pending" ? { gateId: pendingFor } : null),
      decide: async (gid: string, st: "expired") => {
        decided.push([gid, st]);
        rows[gid] = st;
      },
      readStatus: async (gid: string) => (rows[gid] as any) ?? null,
    },
  };
}
const statusesIn = (msgs: any[]) => msgs.flatMap((m) => m.parts).filter((p: any) => p.type === "data-gate-status").map((p: any) => [p.data.gateId, p.data.status]);

test("§ 11.6: a gate saved pending whose row was approved in an unsaved turn gets the row's status appended (the row owns it)", async () => {
  const msgs = turn(1, [card("g1"), status("g1", "pending")]) as any[];
  const f = fakes({ g1: "approved" });
  const out = await reconcileGateStatuses(msgs, "chat-1", f.deps);
  assert.deepEqual(statusesIn(out).at(-1), ["g1", "approved"]);
  assert.deepEqual(out.slice(0, msgs.length), msgs, "the saved messages are untouched");
  assert.deepEqual(f.decided, []);
});

test("§ 11.6: saved pending and still pending: nothing added", async () => {
  const msgs = turn(1, [card("g1"), status("g1", "pending")]) as any[];
  const f = fakes({ g1: "pending" }, "g1");
  const out = await reconcileGateStatuses(msgs, "chat-1", f.deps);
  assert.deepEqual(out, msgs);
  assert.deepEqual(f.decided, []);
});

test("§ 11.6: a pending row whose card the cap dropped is expired first (rule 7); no status is invented for it", async () => {
  const msgs = turn(9, []) as any[];
  const f = fakes({ gX: "pending" }, "gX");
  const out = await reconcileGateStatuses(msgs, "chat-1", f.deps);
  assert.deepEqual(f.decided, [["gX", "expired"]]);
  assert.deepEqual(out, msgs);
});

test("§ 11.6: a gate already decided in the saved messages is not re-read or changed", async () => {
  const msgs = turn(1, [card("g1"), status("g1", "pending"), status("g1", "declined")]) as any[];
  let reads = 0;
  const f = fakes({ g1: "declined" });
  const out = await reconcileGateStatuses(msgs, "chat-1", { ...f.deps, readStatus: async (g) => { reads++; return f.deps.readStatus(g); } });
  assert.deepEqual(out, msgs);
  assert.equal(reads, 0);
});

test("§ 11.6: message ids stay unique when a second load reconciles again (the transcript keys messages by id)", async () => {
  const f1 = fakes({ g1: "approved" });
  const first = await reconcileGateStatuses(turn(1, [card("g1"), status("g1", "pending")]) as any[], "chat-1", f1.deps);
  const later = [...first, ...turn(2, [card("g2"), status("g2", "pending")])] as any[];
  const f2 = fakes({ g1: "approved", g2: "approved" });
  const second = await reconcileGateStatuses(later, "chat-1", f2.deps);
  const ids = second.map((m: any) => m.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${JSON.stringify(ids)}`);
});
