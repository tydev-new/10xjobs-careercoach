// § 11.6 — gate reconciliation on restore. Own tests (coder-authored).
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileGateStatuses, type ReconcileGatesDeps } from "./reconcile-gates.ts";
import type { AppMessage, GateStatus } from "../../../../packages/agent/src/types.ts";

function msg(id: string, parts: unknown[]): AppMessage {
  return { id, role: "assistant", parts } as AppMessage;
}

function gateCardAndStatus(gateId: string, status: GateStatus): unknown[] {
  return [
    { type: "data-gate", data: { gateId, kind: "spend", label: "x", text: "y", textHash: "sha256:z", gateLine: "z", amountUsd: 1 } },
    { type: "data-gate-status", data: { gateId, status } },
  ];
}

function fakeDeps(opts: { pendingGateId?: string; statuses?: Record<string, GateStatus> }): ReconcileGatesDeps & { decided: string[]; reads: string[] } {
  const decided: string[] = [];
  const reads: string[] = [];
  return {
    decided,
    reads,
    pending: async () => (opts.pendingGateId ? { gateId: opts.pendingGateId } : null),
    decide: async (gateId) => {
      decided.push(gateId);
    },
    readStatus: async (gateId) => {
      reads.push(gateId);
      return opts.statuses?.[gateId] ?? null;
    },
  };
}

test("no pending gates in the messages, no pending row: a no-op, same array reference", async () => {
  const messages = [msg("a1", [{ type: "text", text: "hi" }])];
  const deps = fakeDeps({});
  const out = await reconcileGateStatuses(messages, "chat-1", deps);
  assert.equal(out, messages);
});

test("a pending gate whose row is STILL pending: no change (nothing to reconcile)", async () => {
  const messages = [msg("a1", gateCardAndStatus("g1", "pending"))];
  const deps = fakeDeps({ statuses: { g1: "pending" } });
  const out = await reconcileGateStatuses(messages, "chat-1", deps);
  assert.equal(out, messages);
  assert.deepEqual(deps.decided, []);
});

test("a pending gate whose row was ALREADY approved (decided in an unsaved turn): appends a fresh data-gate-status", async () => {
  const messages = [msg("a1", gateCardAndStatus("g1", "pending"))];
  const deps = fakeDeps({ statuses: { g1: "approved" } });
  const out = await reconcileGateStatuses(messages, "chat-1", deps);
  assert.equal(out.length, 2);
  const added = out[1].parts as any[];
  assert.deepEqual(added, [{ type: "data-gate-status", data: { gateId: "g1", status: "approved" } }]);
  assert.deepEqual(deps.reads, ["g1"]);
  assert.deepEqual(deps.decided, [], "never calls decide for a gate whose card IS present");
});

test("a pending ROW whose card the cap dropped: expired first, no yes without the complete thing on screen", async () => {
  // The card/turn that opened g1 is gone — messages carries nothing about
  // it at all (this is exactly what "the cap dropped it" looks like).
  const messages = [msg("a1", [{ type: "text", text: "unrelated later turn" }])];
  const deps = fakeDeps({ pendingGateId: "g1" });
  const out = await reconcileGateStatuses(messages, "chat-1", deps);
  assert.deepEqual(deps.decided, ["g1"]);
  // Nothing to APPEND for g1 (its card isn't in messages, so
  // latestGateStatuses never finds it) — the expiry alone is the fix.
  assert.equal(out, messages);
});

test("a pending row whose card IS present: not expired (only genuinely dangling ones are)", async () => {
  const messages = [msg("a1", gateCardAndStatus("g1", "pending"))];
  const deps = fakeDeps({ pendingGateId: "g1", statuses: { g1: "pending" } });
  const out = await reconcileGateStatuses(messages, "chat-1", deps);
  assert.deepEqual(deps.decided, []);
  assert.equal(out, messages);
});

test("a gate that is NOT the latest-pending in messages (already shows approved/declined) is left alone", async () => {
  const messages = [msg("a1", [...gateCardAndStatus("g1", "pending"), { type: "data-gate-status", data: { gateId: "g1", status: "declined" } }])];
  const deps = fakeDeps({ statuses: { g1: "declined" } });
  const out = await reconcileGateStatuses(messages, "chat-1", deps);
  assert.equal(out, messages);
  assert.deepEqual(deps.reads, [], "no reconciliation needed — not pending in messages");
});

test("two gates in the same restored history: each reconciled independently", async () => {
  const messages = [msg("a1", gateCardAndStatus("g1", "pending")), msg("a2", gateCardAndStatus("g2", "pending"))];
  const deps = fakeDeps({ statuses: { g1: "approved", g2: "pending" } });
  const out = await reconcileGateStatuses(messages, "chat-1", deps);
  assert.equal(out.length, 3);
  assert.deepEqual((out[2].parts as any[]).map((p) => p.data), [{ gateId: "g1", status: "approved" }]);
});
