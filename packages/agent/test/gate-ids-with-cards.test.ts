// § 11.6 — gate reconciliation on restore. gateIdsWithCards is the pure
// half of that check (helpers.ts); the I/O half (reading ten_gate_log,
// expiring a dangling pending row) is apps/web/src/real/reconcile-gates.ts,
// outside this slice's own test suite (own unit tests there, with fakes).
import assert from "node:assert/strict";
import test from "node:test";
import { gateIdsWithCards, latestGateStatuses } from "../src/helpers.ts";
import type { AppMessage } from "../src/types.ts";

function msg(role: "user" | "assistant", parts: unknown[]): AppMessage {
  return { id: `${role}-${Math.random()}`, role, parts } as AppMessage;
}

test("gateIdsWithCards: empty for no data-gate parts", () => {
  const messages = [msg("user", [{ type: "text", text: "hi" }])];
  assert.deepEqual(gateIdsWithCards(messages), new Set());
});

test("gateIdsWithCards: collects every gateId with a data-gate card, across messages", () => {
  const messages = [
    msg("assistant", [
      { type: "data-gate", data: { gateId: "g1", kind: "spend", label: "x", text: "y", textHash: "sha256:z", gateLine: "z", amountUsd: 1 } },
      { type: "data-gate-status", data: { gateId: "g1", status: "pending" } },
    ]),
    msg("assistant", [{ type: "data-gate", data: { gateId: "g2", kind: "spend", label: "a", text: "b", textHash: "sha256:c", gateLine: "c", amountUsd: 2 } }]),
  ];
  assert.deepEqual(gateIdsWithCards(messages), new Set(["g1", "g2"]));
});

test("a data-gate-status part ALONE (no data-gate part) does not count as having a card", () => {
  // Models the exact scenario § 11.6 guards: the cap dropped the turn that
  // opened the gate (its data-gate card), but a later message somehow still
  // referenced the id in a status part only.
  const messages = [msg("assistant", [{ type: "data-gate-status", data: { gateId: "g1", status: "pending" } }])];
  assert.deepEqual(gateIdsWithCards(messages), new Set());
  // and it's still found as "latest status pending" by the existing helper
  // — the two helpers are meant to be composed, not merged.
  assert.equal(latestGateStatuses(messages).get("g1")?.status, "pending");
});
