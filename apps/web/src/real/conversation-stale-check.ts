// § 11.5 — "Each tab remembers the version it loaded or last saved. Before
// every send, beside § 10.3's check and under its rules (2 s; a failed
// check never blocks), it reads the row's version. If it differs: not
// sent, no model call, text back in the composer, UI § 1.9's 'not sent'
// line." Pure logic (this file) + a thin React seam
// (RealChatShell.tsx wires it the same way it wires version-check.ts's
// gatedSend, right beside it).
export const CONVERSATION_CHECK_TIMEOUT_MS = 2000;

export interface StaleConversationDeps {
  /** ConversationStore.readVersion, called with a signal so a slow
   *  response can be abandoned at the timeout. */
  readVersion: (opts: { signal: AbortSignal }) => Promise<string | null>;
  /** The version THIS tab last loaded or saved; null before the first
   *  save of a brand-new chat (nothing to be stale against yet). */
  currentVersion: () => string | null;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

/**
 * True iff the row's version now differs from what this tab last knew —
 * i.e. the conversation moved on elsewhere (another tab/device saved a
 * turn this one hasn't seen). Never throws: a timeout, a network failure,
 * or any other error resolves false ("a failed check never blocks" — the
 * send goes through normally, matching § 10.3's version-monitor check).
 * `currentVersion() === null` (a chat that has never saved) never blocks
 * either — there is nothing yet to have fallen behind.
 */
export async function checkConversationStale(deps: StaleConversationDeps): Promise<boolean> {
  const local = deps.currentVersion();
  if (local === null) return false;
  const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout;
  const controller = new AbortController();
  const timer = setTimeoutImpl(() => controller.abort(), CONVERSATION_CHECK_TIMEOUT_MS);
  try {
    const remote = await deps.readVersion({ signal: controller.signal });
    return remote !== null && remote !== local;
  } catch {
    return false;
  } finally {
    clearTimeoutImpl(timer);
  }
}
