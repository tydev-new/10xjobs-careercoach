// Detects a newer deployed build while this tab is open
// (design-web-agent.md § 10, design-web-ui.md § 1.8). apps/web-only, member
// chat screen only (RealChatShell.tsx wires this up) — NOT packages/agent.
//
// Split into a pure, DI'd monitor (this file, testable under plain
// `node --test` with fake timers and a stubbed fetch — no jsdom needed) and
// a thin React hook (useVersionMonitor, bottom of this file) that supplies
// the real browser bits (document/window/fetch) — same shape as auth.ts's
// AuthClientLike split.
import { useEffect, useRef, useState } from "react";
import { boundFetch } from "../backend/bound-fetch.ts";

/** § 10.2: 2 s timeout on the /version.json fetch. */
export const CHECK_TIMEOUT_MS = 2000;
/** § 10.2: "every 5 minutes while visible". */
export const POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface VersionMonitorDeps {
  /** The id this tab was built with (§ 10.1) — never re-read, so "newer"
   *  always means "differs from what THIS load booted with". */
  builtId: string;
  /** Defaults to a bound `fetch` (bound-fetch.ts: a bare `fetch` reference
   *  throws "Illegal invocation" in real browsers). Overridden in tests. */
  fetchImpl?: typeof fetch;
  /** `document.visibilityState === "visible"` — read fresh each poll tick,
   *  not cached, so a poll that fires while hidden is a no-op (§ 10.4 iv). */
  isVisible: () => boolean;
  /** Subscribes to "the tab became visible, or the window gained focus" —
   *  fires on EITHER (§ 10.2's "visibility regain / window focus"). Returns
   *  an unsubscribe function. */
  onWake: (cb: () => void) => () => void;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

export interface VersionMonitor {
  /** True once a differing, non-empty id has been confirmed. Checks stop
   *  for good once this is true (§ 10.2: "once newer is known, checks
   *  stop"). */
  isNewerKnown: () => boolean;
  /** Runs one check now (a no-op network-wise if already known). Resolves
   *  to `isNewerKnown()` AFTER the check. Never throws: § 10.2 says every
   *  error/timeout/non-200/bad-JSON/missing-id is ignored silently. */
  checkNow: () => Promise<boolean>;
  /** Fires at most once, the moment newer becomes known. */
  onNewer: (cb: () => void) => () => void;
  /** Unsubscribes every listener and clears the poll interval (unmount). */
  stop: () => void;
}

/** One fetch of /version.json, 2 s timeout, `cache: "no-store"` (§ 10.1's
 *  "no header config... the client fetches with cache: 'no-store'"). Returns
 *  the id string, or undefined for ANY failure — never throws. */
async function fetchVersionId(fetchImpl: typeof fetch): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetchImpl("/version.json", { cache: "no-store", signal: controller.signal });
    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    const id = (data as { id?: unknown } | null)?.id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Starts the § 10.2 detection loop: one check on start (the caller fires
 *  this on mount), then on wake (visibility regain / focus) and every 5 min
 *  while visible, until newer is known. */
export function startVersionMonitor(deps: VersionMonitorDeps): VersionMonitor {
  const fetchImpl = deps.fetchImpl ?? boundFetch();
  const setIntervalImpl = deps.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = deps.clearIntervalImpl ?? clearInterval;

  let newerKnown = false;
  const newerListeners = new Set<() => void>();
  let inFlight: Promise<boolean> | undefined;

  const checkNow = (): Promise<boolean> => {
    if (newerKnown) return Promise.resolve(true);
    // Coalesce overlapping calls (e.g. a poll tick lands mid pre-send
    // check) into the one in-flight request rather than firing two.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const id = await fetchVersionId(fetchImpl);
      if (id !== undefined && id !== deps.builtId) {
        newerKnown = true;
        for (const cb of newerListeners) cb();
      }
      inFlight = undefined;
      return newerKnown;
    })();
    return inFlight;
  };

  const unsubWake = deps.onWake(() => {
    if (!newerKnown && deps.isVisible()) void checkNow();
  });

  const interval = setIntervalImpl(() => {
    if (!newerKnown && deps.isVisible()) void checkNow();
  }, POLL_INTERVAL_MS);

  return {
    isNewerKnown: () => newerKnown,
    checkNow,
    onNewer: (cb) => {
      newerListeners.add(cb);
      return () => newerListeners.delete(cb);
    },
    stop: () => {
      unsubWake();
      clearIntervalImpl(interval);
      newerListeners.clear();
    },
  };
}

// ---------------------------------------------------------------------
// gatedSend — § 10.3's "no turn starts on replaced code" rule, pulled out
// of RealChatShell.tsx as a small pure function (no React, no useChat, no
// attachment plumbing) so it's directly unit-testable. RealChatShell.tsx's
// own send() is a thin wrapper around this that supplies the real
// sendMessage/composer callbacks.
// ---------------------------------------------------------------------

export interface GatedSendDeps {
  /** The pre-send check (§ 10.3): resolves true iff a newer build is known
   *  (now, or already) — blocks the send. */
  checkBeforeSend: () => Promise<boolean>;
  /** Called ONLY when not blocked — the real sendMessage/transport call. */
  sendMessage: (text: string) => void;
  /** Blocked only: puts the text back in the composer, word for word. */
  restoreComposerText: (text: string) => void;
  /** Blocked only: switches the notice to its "not sent" copy. */
  markBlocked: () => void;
}

/** True iff the send was blocked (§ 10.3). Never calls `sendMessage` when
 *  blocked: "no sendMessages call, no proxy request" — the caller's
 *  `sendMessage` IS the transport call, so simply not invoking it is the
 *  whole guarantee. */
export async function gatedSend(text: string, deps: GatedSendDeps): Promise<boolean> {
  const blocked = await deps.checkBeforeSend();
  if (blocked) {
    deps.restoreComposerText(text);
    deps.markBlocked();
    return true;
  }
  deps.sendMessage(text);
  return false;
}

// ---------------------------------------------------------------------
// useVersionMonitor — the React seam (RealChatShell.tsx, member chat
// screen only). Wires startVersionMonitor to the real browser globals;
// the pure logic above is what's actually under test.
// ---------------------------------------------------------------------

export interface UseVersionMonitorResult {
  /** True once a newer build is known — the caller shows the § 1.8 notice
   *  and blocks sends. */
  newerVersionKnown: boolean;
  /** Runs the pre-send check (§ 10.3): every send, gate `yes` included.
   *  Resolves true iff a newer build is known after the check (blocks the
   *  send); a failed/timed-out check resolves false (sends normally). */
  checkBeforeSend: () => Promise<boolean>;
}

/** The built-in id this load booted with. `typeof __TEN_VERSION__` guards
 *  `node --test` (no Vite `define` pass there) — see vite-env.d.ts. */
export const BUILT_VERSION_ID: string = typeof __TEN_VERSION__ !== "undefined" ? __TEN_VERSION__ : "dev";

export function useVersionMonitor(builtId: string = BUILT_VERSION_ID): UseVersionMonitorResult {
  const [newerVersionKnown, setNewerVersionKnown] = useState(false);
  const monitorRef = useRef<VersionMonitor | undefined>(undefined);

  useEffect(() => {
    const monitor = startVersionMonitor({
      builtId,
      isVisible: () => document.visibilityState === "visible",
      onWake: (cb) => {
        const onVisibility = () => {
          if (document.visibilityState === "visible") cb();
        };
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", cb);
        return () => {
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("focus", cb);
        };
      },
    });
    monitorRef.current = monitor;
    const unsubNewer = monitor.onNewer(() => setNewerVersionKnown(true));
    void monitor.checkNow(); // § 10.2: "on mount"
    return () => {
      unsubNewer();
      monitor.stop();
      monitorRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builtId]);

  return {
    newerVersionKnown,
    checkBeforeSend: async () => {
      const monitor = monitorRef.current;
      if (!monitor) return false;
      return monitor.checkNow();
    },
  };
}
