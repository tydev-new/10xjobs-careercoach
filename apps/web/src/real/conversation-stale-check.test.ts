// § 11.5 — the pre-send "another tab moved on" check. Own tests
// (coder-authored, mirrors version-check.test.ts's DI'd/fake-timer style —
// no jsdom, no browser globals).
import assert from "node:assert/strict";
import test from "node:test";
import { checkConversationStale, CONVERSATION_CHECK_TIMEOUT_MS } from "./conversation-stale-check.ts";

test("same version: not stale", async () => {
  const stale = await checkConversationStale({ readVersion: async () => "v1", currentVersion: () => "v1" });
  assert.equal(stale, false);
});

test("a differing remote version: stale", async () => {
  const stale = await checkConversationStale({ readVersion: async () => "v2", currentVersion: () => "v1" });
  assert.equal(stale, true);
});

test("currentVersion() null (never saved yet): never stale, readVersion is not even called", async () => {
  let called = false;
  const stale = await checkConversationStale({
    readVersion: async () => {
      called = true;
      return "v1";
    },
    currentVersion: () => null,
  });
  assert.equal(stale, false);
  assert.equal(called, false);
});

test("remote null (row vanished somehow): never stale", async () => {
  const stale = await checkConversationStale({ readVersion: async () => null, currentVersion: () => "v1" });
  assert.equal(stale, false);
});

test("a thrown/rejected read: never blocks (resolves false)", async () => {
  const stale = await checkConversationStale({
    readVersion: async () => {
      throw new Error("network down");
    },
    currentVersion: () => "v1",
  });
  assert.equal(stale, false);
});

test("a read past the timeout is aborted and treated as not stale", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const readVersion = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string | null>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const promise = checkConversationStale({ readVersion, currentVersion: () => "v1" });
  t.mock.timers.tick(CONVERSATION_CHECK_TIMEOUT_MS);
  return promise.then((stale) => assert.equal(stale, false));
});

test("the abort signal fires only after the timeout, not immediately", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let aborted = false;
  const readVersion = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string | null>((resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
      // resolves on its own well before the timeout, if never aborted
      setTimeout(() => resolve("v1"), 10);
    });
  const promise = checkConversationStale({ readVersion, currentVersion: () => "v1" });
  t.mock.timers.tick(10);
  return promise.then((stale) => {
    assert.equal(aborted, false, "resolved before the 2 s timeout fired");
    assert.equal(stale, false);
  });
});
