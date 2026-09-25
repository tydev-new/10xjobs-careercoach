// § 11.6 — gate reconciliation on restore ("The row owns gate status...
// before mounting, for each gate whose latest restored status is pending,
// the app reads its own ten_gate_log row and appends the row's status as a
// data-gate-status part. A pending gate whose card is not in the restored
// messages (the cap dropped it) is expired first: no yes without the
// complete thing on screen (rule 7)."). Called once, in RealApp.tsx's
// setup, on the messages just read from ConversationStore.load() and
// validated with validateUIMessages — BEFORE useChat ever mounts (§ 11.6:
// "never mount empty over a saved conversation", and never mount a
// reconciled-wrong one either).
//
// The pure decision (which gateIds need what) is packages/agent's
// `latestGateStatuses`/`gateIdsWithCards` (helpers.ts); this file is only
// the I/O orchestration around them, kept thin and DI'd so it's testable
// with fakes (no real Supabase).
import { gateIdsWithCards, latestGateStatuses } from "../../../../packages/agent/src/helpers.ts";
import type { AppMessage, Gate, GateStatus } from "../../../../packages/agent/src/types.ts";

export interface ReconcileGatesDeps {
  /** The caller's currently-pending gate for this chat, if any (Gate.pending). */
  pending: (chatId: string) => Promise<{ gateId: string } | null>;
  /** Moves a gate off pending (Gate.decide) — used only to expire a
   *  pending row whose card fell out of the restored window. */
  decide: (gateId: string, status: "expired") => Promise<void>;
  /** Reads ONE gate's row status, whatever it is (readGateStatus, gate.ts). */
  readStatus: (gateId: string) => Promise<GateStatus | null>;
}

export function reconcileGatesDepsFromGate(gate: Pick<Gate, "pending" | "decide">, readStatus: (gateId: string) => Promise<GateStatus | null>): ReconcileGatesDeps {
  return {
    pending: (chatId) => gate.pending(chatId),
    decide: (gateId, status) => gate.decide(gateId, status),
    readStatus,
  };
}

/**
 * Returns the messages array to actually mount (possibly with one
 * appended synthetic message carrying fresh `data-gate-status` parts) —
 * never mutates `messages`. Never throws on its own logic; a `readStatus`/
 * `decide` failure propagates (the setup error screen, § 11.6, is the
 * caller's job — same posture as every other setup step in RealApp.tsx).
 */
export async function reconcileGateStatuses(messages: AppMessage[], chatId: string, deps: ReconcileGatesDeps): Promise<AppMessage[]> {
  const withCards = gateIdsWithCards(messages);

  // A pending row whose card the size cap dropped: expired first, so a
  // candidate who never saw the card can't blindly approve it by typing
  // "yes" (rule 7 — the complete thing must be on screen).
  const pendingRow = await deps.pending(chatId);
  if (pendingRow && !withCards.has(pendingRow.gateId)) {
    await deps.decide(pendingRow.gateId, "expired");
  }

  // Every gate whose LATEST status as recorded in the restored messages is
  // "pending" (so its card IS present — that's how latestGateStatuses knew
  // about it) gets a fresh data-gate-status part reflecting the row's real
  // current status: a turn that decided it may never have been saved (a
  // closed tab), so the row — not the messages — owns the truth (§ 3, rule
  // 12).
  const latest = latestGateStatuses(messages);
  const additions: Array<{ gateId: string; status: GateStatus }> = [];
  for (const [gateId, { status }] of latest) {
    if (status !== "pending") continue;
    const trueStatus = await deps.readStatus(gateId);
    if (!trueStatus || trueStatus === status) continue; // still pending, or no row (shouldn't happen) — nothing to add
    additions.push({ gateId, status: trueStatus });
  }
  if (additions.length === 0) return messages;

  // Fix round 2, item 5 / architect ruling (§ 11.6, 2026-09-24): a unique
  // id per reconciliation, `gate-reconcile-${chatId}-${uuid}` — a FIXED id
  // repeated across loads would collide in useChat's own message-id space
  // (two reloads producing two reconciliation messages with the SAME id).
  const reconciled: AppMessage = {
    id: `gate-reconcile-${chatId}-${crypto.randomUUID()}`,
    role: "assistant",
    parts: additions.map((a) => ({ type: "data-gate-status" as const, data: { gateId: a.gateId, status: a.status } })),
  } as AppMessage;
  return [...messages, reconciled];
}
