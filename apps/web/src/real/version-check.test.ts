// Unit tests for design-web-agent.md § 10's detection loop and § 10.3's
// pre-send rule (fake timers via node:test's built-in t.mock.timers,
// stubbed fetch — no jsdom, no browser globals: startVersionMonitor and
// gatedSend are plain, DI'd functions). Run with
// `node --test src/real/version-check.test.ts`.
//
// The React seam (useVersionMonitor, real document/window wiring) is NOT
// re-tested here — it's a thin pass-through to startVersionMonitor, which
// is what's actually exercised.
import assert from "node:assert/strict";
import test from "node:test";
import { gatedSend, POLL_INTERVAL_MS, startVersionMonitor, CHECK_TIMEOUT_MS, type VersionMonitorDeps } from "./version-check.ts";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A stub `fetch` that resolves to whatever `next()` returns each call
 *  (queue semantics — one entry per expected call). */
function queuedFetch(...responses: Array<() => Promise<Response>>): { fetchImpl: typeof fetch; calls: number[] } {
  let i = 0;
  const calls: number[] = [];
  const fetchImpl = (async (..._args: unknown[]) => {
    calls.push(i);
    const next = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Never resolves on its own — only rejects when the request's AbortSignal
 *  fires, exactly like a real in-flight fetch does on abort(). Lets the
 *  2 s § 10.2 timeout be tested with fake timers instead of a real wait. */
function fetchThatOnlyRejectsOnAbort(): typeof fetch {
  return (async (_url: string, opts?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      opts?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  }) as unknown as typeof fetch;
}

/** Flushes pending promise microtasks via a real `setImmediate` (never
 *  faked here — only "setTimeout"/"setInterval" are enabled), so a
 *  multi-hop `await` chain inside checkNow() (fetchImpl -> res.json() ->
 *  ...) is fully settled before the next assertion, no matter how many
 *  microtask turns it takes. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function baseDeps(overrides: Partial<VersionMonitorDeps> = {}): VersionMonitorDeps {
  return {
    builtId: "abc1234-20260924T120000Z",
    isVisible: () => true,
    onWake: () => () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// § 10.2 — what counts as "newer"
// ---------------------------------------------------------------------

test("startVersionMonitor: same id -> not newer", async () => {
  const { fetchImpl } = queuedFetch(async () => jsonResponse(200, { id: "abc1234-20260924T120000Z" }));
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
  const result = await monitor.checkNow();
  assert.equal(result, false);
  assert.equal(monitor.isNewerKnown(), false);
  monitor.stop();
});

test("startVersionMonitor: a different id -> newer (a rollback counts: differs, not higher)", async () => {
  const { fetchImpl } = queuedFetch(async () => jsonResponse(200, { id: "zzz9999-20260101T000000Z" }));
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
  const result = await monitor.checkNow();
  assert.equal(result, true);
  assert.equal(monitor.isNewerKnown(), true);
  monitor.stop();
});

test("startVersionMonitor: non-200 is ignored silently", async () => {
  const { fetchImpl } = queuedFetch(async () => jsonResponse(500, {}));
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
  assert.equal(await monitor.checkNow(), false);
  monitor.stop();
});

test("startVersionMonitor: a network rejection (offline) is ignored silently", async () => {
  const fetchImpl = (async () => {
    throw new TypeError("network error");
  }) as unknown as typeof fetch;
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
  assert.equal(await monitor.checkNow(), false);
  monitor.stop();
});

test("startVersionMonitor: bad JSON is ignored silently", async () => {
  const fetchImpl = (async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  })) as unknown as typeof fetch;
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
  assert.equal(await monitor.checkNow(), false);
  monitor.stop();
});

test("startVersionMonitor: missing or empty id is ignored silently", async () => {
  for (const body of [{}, { id: "" }, { id: 42 }, { id: null }]) {
    const { fetchImpl } = queuedFetch(async () => jsonResponse(200, body));
    const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
    assert.equal(await monitor.checkNow(), false, `body ${JSON.stringify(body)} must not count as newer`);
    monitor.stop();
  }
});

test("startVersionMonitor: a request over 2 s times out and is ignored silently", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const monitor = startVersionMonitor(baseDeps({ fetchImpl: fetchThatOnlyRejectsOnAbort() }));
  const pending = monitor.checkNow();
  t.mock.timers.tick(CHECK_TIMEOUT_MS);
  assert.equal(await pending, false);
  assert.equal(monitor.isNewerKnown(), false);
  monitor.stop();
});

// ---------------------------------------------------------------------
// "Once newer is known, checks stop" (§ 10.2)
// ---------------------------------------------------------------------

test("startVersionMonitor: once newer is known, checkNow makes no further fetch calls", async () => {
  const { fetchImpl, calls } = queuedFetch(async () => jsonResponse(200, { id: "different-id" }));
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
  assert.equal(await monitor.checkNow(), true);
  assert.equal(await monitor.checkNow(), true);
  assert.equal(await monitor.checkNow(), true);
  assert.equal(calls.length, 1, "only the first checkNow should have hit the network");
  monitor.stop();
});

test("startVersionMonitor: onNewer fires exactly once, the moment newer is confirmed", async () => {
  const { fetchImpl } = queuedFetch(async () => jsonResponse(200, { id: "different-id" }));
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));
  let fired = 0;
  monitor.onNewer(() => fired++);
  await monitor.checkNow();
  await monitor.checkNow();
  assert.equal(fired, 1);
  monitor.stop();
});

// ---------------------------------------------------------------------
// § 10.2 "When": visibility regain / focus, every 5 min while visible,
// none while hidden, none once newer is known.
// ---------------------------------------------------------------------

test("startVersionMonitor: onWake triggers a check only while visible", async () => {
  const { fetchImpl, calls } = queuedFetch(async () => jsonResponse(200, { id: "abc1234-20260924T120000Z" }));
  let wake: (() => void) | undefined;
  let visible = false;
  const monitor = startVersionMonitor(
    baseDeps({
      fetchImpl,
      isVisible: () => visible,
      onWake: (cb) => {
        wake = cb;
        return () => {
          wake = undefined;
        };
      },
    }),
  );
  wake?.();
  await flushMicrotasks();
  assert.equal(calls.length, 0, "hidden: no check");

  visible = true;
  wake?.();
  await flushMicrotasks();
  assert.equal(calls.length, 1, "visible: one check");
  monitor.stop();
});

test("startVersionMonitor: polls every 5 minutes while visible, not while hidden", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { fetchImpl, calls } = queuedFetch(async () => jsonResponse(200, { id: "abc1234-20260924T120000Z" }));
  let visible = true;
  const monitor = startVersionMonitor(baseDeps({ fetchImpl, isVisible: () => visible }));

  t.mock.timers.tick(POLL_INTERVAL_MS);
  await flushMicrotasks();
  assert.equal(calls.length, 1);

  visible = false;
  t.mock.timers.tick(POLL_INTERVAL_MS);
  await flushMicrotasks();
  assert.equal(calls.length, 1, "hidden tick must not check");

  visible = true;
  t.mock.timers.tick(POLL_INTERVAL_MS);
  await flushMicrotasks();
  assert.equal(calls.length, 2);
  monitor.stop();
});

test("startVersionMonitor: no further polls once newer is known", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { fetchImpl, calls } = queuedFetch(async () => jsonResponse(200, { id: "different-id" }));
  const monitor = startVersionMonitor(baseDeps({ fetchImpl }));

  t.mock.timers.tick(POLL_INTERVAL_MS);
  await flushMicrotasks();
  assert.equal(calls.length, 1);
  assert.equal(monitor.isNewerKnown(), true);

  t.mock.timers.tick(POLL_INTERVAL_MS);
  await flushMicrotasks();
  assert.equal(calls.length, 1, "no more network calls once newer is known");
  monitor.stop();
});

test("startVersionMonitor: stop() clears the interval and unsubscribes wake", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { fetchImpl, calls } = queuedFetch(async () => jsonResponse(200, { id: "abc1234-20260924T120000Z" }));
  let unsubscribed = false;
  const monitor = startVersionMonitor(
    baseDeps({ fetchImpl, onWake: () => () => (unsubscribed = true) }),
  );
  monitor.stop();
  assert.equal(unsubscribed, true);
  t.mock.timers.tick(POLL_INTERVAL_MS * 3);
  await flushMicrotasks();
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------
// § 10.3 — the pre-send rule (gatedSend)
// ---------------------------------------------------------------------

test("gatedSend: newer known -> blocked, no sendMessage, text restored word for word, marks blocked", async () => {
  const sent: string[] = [];
  const restored: string[] = [];
  let blockedMarked = false;
  const result = await gatedSend("evaluate this offer, please", {
    checkBeforeSend: async () => true,
    sendMessage: (t) => sent.push(t),
    restoreComposerText: (t) => restored.push(t),
    markBlocked: () => (blockedMarked = true),
  });
  assert.equal(result, true);
  assert.deepEqual(sent, [], "no sendMessages call, no proxy request");
  assert.deepEqual(restored, ["evaluate this offer, please"]);
  assert.equal(blockedMarked, true);
});

test("gatedSend: same id (not blocked) -> sends once, normally", async () => {
  const sent: string[] = [];
  const restored: string[] = [];
  let blockedMarked = false;
  const result = await gatedSend("yes", {
    checkBeforeSend: async () => false,
    sendMessage: (t) => sent.push(t),
    restoreComposerText: (t) => restored.push(t),
    markBlocked: () => (blockedMarked = true),
  });
  assert.equal(result, false);
  assert.deepEqual(sent, ["yes"]);
  assert.deepEqual(restored, []);
  assert.equal(blockedMarked, false);
});

test("gatedSend: a failed/timed-out check (resolves false) sends normally", async () => {
  const sent: string[] = [];
  const result = await gatedSend("hello", {
    checkBeforeSend: async () => false, // fetchVersionId's own failure path already collapses to false
    sendMessage: (t) => sent.push(t),
    restoreComposerText: () => {},
    markBlocked: () => {},
  });
  assert.equal(result, false);
  assert.deepEqual(sent, ["hello"]);
});

test("gatedSend: a typed 'yes' at a pending gate, with a newer id known, is not sent", async () => {
  const sent: string[] = [];
  let blockedMarked = false;
  const result = await gatedSend("yes", {
    checkBeforeSend: async () => true,
    sendMessage: (t) => sent.push(t),
    restoreComposerText: () => {},
    markBlocked: () => (blockedMarked = true),
  });
  assert.equal(result, true);
  assert.deepEqual(sent, [], "the gate's approving message must never reach sendMessage/the transport");
  assert.equal(blockedMarked, true);
});
