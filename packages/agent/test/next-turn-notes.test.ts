// § 9.4 — lead ruling, fix round 2 of the § 11/§ 12 release: "the § 9.4
// next-turn check reads the most recent assistant message before the
// latest user message that has at least one part other than
// data-gate-status; assistant messages consisting only of data-gate-status
// parts are skipped." Own tests (coder-authored, the coder that made this
// exact coach.ts edit) for dataErrorCodesOnMessageBeforeLatestUser.
import assert from "node:assert/strict";
import test from "node:test";
import { dataErrorCodesOnMessageBeforeLatestUser } from "../src/coach.ts";
import type { AppMessage } from "../src/types.ts";

function user(id: string): AppMessage {
  return { id, role: "user", parts: [{ type: "text", text: "go" }], metadata: { origin: "typed" } } as AppMessage;
}

function assistantWithError(id: string, code: string): AppMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: "partial reply" },
      { type: "data-error", data: { code, message: "m", retryable: true } },
    ],
  } as AppMessage;
}

/** § 11.6's reconciliation-on-restore message shape (reconcile-gates.ts,
 *  apps/web): an assistant message carrying ONLY data-gate-status parts. */
function reconcileOnlyMessage(id: string, gateId: string, status: string): AppMessage {
  return { id, role: "assistant", parts: [{ type: "data-gate-status", data: { gateId, status } }] } as AppMessage;
}

test("the plain case: the assistant message right before the latest user message carries the code", () => {
  const messages = [user("u1"), assistantWithError("a1", "cut_off"), user("u2")];
  assert.deepEqual(dataErrorCodesOnMessageBeforeLatestUser(messages), new Set(["cut_off"]));
});

test("no assistant message at all before the latest user message: empty", () => {
  assert.deepEqual(dataErrorCodesOnMessageBeforeLatestUser([user("u1")]), new Set());
});

test("a reconcile-only message between the real cut_off turn and the new user turn: still finds cut_off", () => {
  const messages = [user("u1"), assistantWithError("a1", "cut_off"), reconcileOnlyMessage("g1", "gate-1", "approved"), user("u2")];
  assert.deepEqual(dataErrorCodesOnMessageBeforeLatestUser(messages), new Set(["cut_off"]));
});

test("MULTIPLE consecutive reconcile-only messages are all skipped", () => {
  const messages = [
    user("u1"),
    assistantWithError("a1", "step_cap"),
    reconcileOnlyMessage("g1", "gate-1", "approved"),
    reconcileOnlyMessage("g2", "gate-2", "declined"),
    user("u2"),
  ];
  assert.deepEqual(dataErrorCodesOnMessageBeforeLatestUser(messages), new Set(["step_cap"]));
});

test("a reconcile-only message with nothing real behind it (a user message next): empty, never crosses into the earlier turn", () => {
  const messages = [user("u1"), reconcileOnlyMessage("g1", "gate-1", "approved"), user("u2")];
  assert.deepEqual(dataErrorCodesOnMessageBeforeLatestUser(messages), new Set());
});

test("a mixed message (data-gate-status AND a data-error) is NOT skipped — it has other content", () => {
  const messages: AppMessage[] = [
    user("u1"),
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "data-gate-status", data: { gateId: "g1", status: "approved" } },
        { type: "data-error", data: { code: "cut_off", message: "m", retryable: true } },
      ],
    } as AppMessage,
    user("u2"),
  ];
  assert.deepEqual(dataErrorCodesOnMessageBeforeLatestUser(messages), new Set(["cut_off"]));
});

test("only ONE turn back is ever considered — an older real turn's code is not picked up through a newer, error-free turn", () => {
  const messages = [
    user("u0"),
    assistantWithError("a0", "cut_off"),
    user("u1"),
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "all good" }] } as AppMessage,
    user("u2"),
  ];
  assert.deepEqual(dataErrorCodesOnMessageBeforeLatestUser(messages), new Set());
});
