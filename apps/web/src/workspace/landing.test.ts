// Unit tests for the landing rule (design-web-ui.md § 5.1, "Where the app
// opens"). Run: node --test src/workspace/landing.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { landingPage } from "./landing.ts";
import type { AppMessage } from "../types.ts";

function userMsg(text: string): AppMessage {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] } as unknown as AppMessage;
}

function assistantWithGate(gateId: string, status?: "approved" | "declined" | "expired"): AppMessage {
  const parts: unknown[] = [
    { type: "data-gate", data: { gateId, kind: "spend", label: "do a thing", text: "…", textHash: "h", gateLine: "…", amountUsd: 1 } },
  ];
  if (status) parts.push({ type: "data-gate-status", data: { gateId, status } });
  return { id: "a1", role: "assistant", parts } as unknown as AppMessage;
}

test("no messages at all -> talk (no conversation saved yet)", () => {
  assert.equal(landingPage([]), "talk");
});

test("messages exist, no gate -> home", () => {
  assert.equal(landingPage([userMsg("hi"), userMsg("thanks")]), "home");
});

test("a pending gate beats everything, even with messages present -> talk", () => {
  const messages = [userMsg("can you evaluate this?"), assistantWithGate("g1")];
  assert.equal(landingPage(messages), "talk");
});

test("an approved gate does not force talk -> home (once messages exist)", () => {
  const messages = [userMsg("can you evaluate this?"), assistantWithGate("g1", "approved"), userMsg("thanks")];
  assert.equal(landingPage(messages), "home");
});

test("a declined gate does not force talk -> home", () => {
  const messages = [userMsg("can you evaluate this?"), assistantWithGate("g1", "declined")];
  assert.equal(landingPage(messages), "home");
});

test("an expired gate does not force talk -> home", () => {
  const messages = [userMsg("can you evaluate this?"), assistantWithGate("g1", "expired")];
  assert.equal(landingPage(messages), "home");
});

test("two gates, one still pending -> talk (any pending gate wins)", () => {
  const messages = [assistantWithGate("g1", "approved"), assistantWithGate("g2")];
  assert.equal(landingPage(messages), "talk");
});
