// Tester-owned: docs/design-web-agent.md § 11.9 (vi-b) "Reconciliation ×
// § 9.4" (lead ruling, 6276698): "a restored history whose last real
// assistant message carries cut_off (then step_cap, then too_large),
// followed by a reconciliation message: the next turn has that code's note.
// Two loads produce two different reconciliation ids, and no id repeats in
// the messages." Also the ruling's own definition: an assistant message made
// ONLY of data-gate-status parts is skipped; any other part makes it "real".
// The reconciliation messages here are produced by apps/web's real
// reconcileGateStatuses, not hand-written.
// Run: node --test tests/agent/reconcile-vs-notes.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { reconcileGateStatuses } from "../../apps/web/src/real/reconcile-gates.ts";
import { NEXT_TURN_NOTE, STEP_CAP_NOTE } from "./_spec9.ts";
import { TOO_LARGE_NOTE } from "./_spec11.ts";
import { stubbedOpenRouter, systemOf, textReply } from "./_openrouter_stub.ts";
import { makeCoach, runTurn, user } from "./_support.ts";

const NOTES: Record<string, string> = { cut_off: NEXT_TURN_NOTE, step_cap: STEP_CAP_NOTE, too_large: TOO_LARGE_NOTE };
const card = (gateId: string) => ({ type: "data-gate", data: { gateId, kind: "spend", label: "Search", text: "t", textHash: "sha256:" + "0".repeat(64), gateLine: "l", amountUsd: 1.5 } });
const status = (gateId: string, s: string) => ({ type: "data-gate-status", data: { gateId, status: s } });
const err = (code: string) => ({ type: "data-error", data: { code, message: "x", retryable: true } });

/** A saved history: a gate that was pending when saved, and whose last real
 *  assistant message ended with `code`. */
function saved(code: string) {
  return [
    user("u1", "Evaluate all six saved roles"),
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "Here is the cost." }, card("g1"), status("g1", "pending"), err(code)] },
  ] as any[];
}
const rowSays = (s: string) => ({
  pending: async () => null,
  decide: async () => {},
  readStatus: async () => s as any,
});
async function nextSystem(history: any[]) {
  const m = stubbedOpenRouter([textReply("reply")]);
  const { coach } = makeCoach({ model: m.model });
  await runTurn(coach, `vi-b-${Math.random()}`, history);
  return systemOf(m.requests[0]);
}

for (const code of ["cut_off", "step_cap", "too_large"]) {
  test(`(vi-b) a reconciliation message after a ${code} turn: the next turn still has the ${code} note`, async () => {
    const restored = await reconcileGateStatuses(saved(code), "chat-1", rowSays("approved"));
    assert.equal(restored.length, 3, "precondition: reconciliation appended a message");
    const tail = restored.at(-1) as any;
    assert.ok(tail.parts.length > 0 && tail.parts.every((p: any) => p.type === "data-gate-status"), "…made only of data-gate-status parts");
    const sys = await nextSystem([...restored, user("u2", "ok, carry on")]);
    assert.ok(sys.trimEnd().endsWith(NOTES[code]), `${code} note: ${JSON.stringify(sys.slice(-200))}`);
  });
}

test("(vi-b) two loads produce two different reconciliation ids, and no id repeats in the messages", async () => {
  const load1 = await reconcileGateStatuses(saved("cut_off"), "chat-1", rowSays("approved"));
  const load2 = await reconcileGateStatuses(saved("cut_off"), "chat-1", rowSays("approved"));
  assert.notEqual((load1.at(-1) as any).id, (load2.at(-1) as any).id);
  const later = [...load1, user("u2", "next"), { id: "a2", role: "assistant", parts: [{ type: "text", text: "ok" }, card("g2"), status("g2", "pending")] }] as any[];
  const load3 = await reconcileGateStatuses(later, "chat-1", rowSays("approved"));
  const ids = load3.map((m: any) => m.id);
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(ids));
});

test("(vi-b) the skip is only for data-gate-status-only messages: a real message after the stopped turn hides its note (it is 'just before')", async () => {
  const h = [...saved("cut_off"), { id: "a2", role: "assistant", parts: [{ type: "text", text: "A later real reply." }] }, user("u2", "carry on")];
  const sys = await nextSystem(h);
  assert.ok(!sys.includes(NEXT_TURN_NOTE), "a real assistant message in between is the one just before");
});

test("(vi-b) a user message ends the look-back: a stop two turns ago never leaks its note", async () => {
  const h = [...saved("step_cap"), user("u2", "hello"), { id: "a2", role: "assistant", parts: [status("g1", "approved")] }, user("u3", "and now?")];
  const sys = await nextSystem(h);
  assert.ok(!sys.includes(STEP_CAP_NOTE));
});
