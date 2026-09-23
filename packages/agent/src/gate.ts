// § 3 — Gate protocol. sha256 via the WebCrypto `crypto.subtle` global
// (available in both the browser and Node — no node:crypto import).
import type { UIMessageStreamWriter } from "ai";
import type { AppMessage, Deps, Gate, GateRequest, GateStatus } from "./types.ts";

/** Rounds a USD amount UP to the cent (lead ruling, fix round 1, L2): a
 *  gate must never show or charge less than the true estimate. Float-safe
 *  (fix round 2): a plain `Math.ceil(usd * 100) / 100` bumps an
 *  already-exact amount like $1.10 up to $1.11, because `1.10 * 100` is
 *  `110.00000000000001` in IEEE754 — rounding first to microdollar
 *  precision (1e6) clears that noise before the cent-level ceil. */
export function roundUpCents(usd: number): number {
  return Math.ceil(Math.round(usd * 1e6) / 1e4) / 100;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function textHashOf(text: string): Promise<string> {
  return `sha256:${await sha256Hex(text)}`;
}

/**
 * gate-grammar.md's own spend line, word for word:
 * "This costs up to $<amount> — nothing starts until you say yes."
 * Reads the line from the bundle (never hardcoded twice) so a change to
 * the shared gate-grammar text is a one-file edit that this package picks
 * up automatically. Fails loudly (per § 3) if the bundle carries no spend
 * line to match against.
 */
const SPEND_LINE_RE = /This costs up to \$<amount> — nothing starts until you say yes\./;

export function findSpendLineTemplate(gateGrammarMd: string): string {
  const lines = gateGrammarMd.split("\n");
  const found = lines.find((l) => SPEND_LINE_RE.test(l));
  if (!found) {
    throw new Error(
      "gate-grammar.md has no spend line matching " +
        '"This costs up to $<amount> — nothing starts until you say yes." — the tool fails loudly per § 3.',
    );
  }
  return found;
}

/** Extracts just the quoted spend sentence out of gate-grammar.md's bullet
 *  line ('   - Spends: "This costs up to $<amount> — ..."'), then fills
 *  in the amount. This is what estimate_cost (§ 3) actually calls.
 *  `amountUsd` is the RAW figure (e.g. `req.amountUsd`, which stays
 *  exactly the tool's own `highUsd` — no drift between the two); the
 *  line's own displayed dollar amount is rounded UP to the cent (L2, fix
 *  round 1: a gate must never understate what it may cost). */
export function buildGateLine(gateGrammarMd: string, amountUsd: number): string {
  const bulletLine = findSpendLineTemplate(gateGrammarMd);
  const match = bulletLine.match(/"([^"]*This costs up to \$<amount>[^"]*)"/);
  const sentence = match ? match[1] : bulletLine.trim();
  return sentence.replace(/\$<amount>/, `$${roundUpCents(amountUsd).toFixed(2)}`);
}

interface GateRow {
  req: GateRequest;
  chatId: string;
  status: GateStatus;
  typedText?: string;
  createdAt: number;
  decidedAt?: number;
}

/**
 * An in-memory `gate_log` (§ 3's table, minus the database): one row per
 * gate, status has one owner (this store), and a new chat expires every
 * `pending` row from older chats. Good enough for headless Node tests and
 * the bin/run.mjs runner; a Supabase-backed Gate implements the same
 * interface for the real app (step 2/5b, out of this package).
 */
export function createInMemoryGate(): Gate {
  const rows = new Map<string, GateRow>();

  return {
    async open(req: GateRequest, chatId: string): Promise<void> {
      rows.set(req.gateId, { req, chatId, status: "pending", createdAt: Date.now() });
    },

    async decide(
      gateId: string,
      status: "approved" | "declined" | "expired",
      typedText?: string,
    ): Promise<void> {
      const row = rows.get(gateId);
      if (!row) return;
      // "a database function moves `status` off `pending` exactly once"
      if (row.status !== "pending") return;
      row.status = status;
      row.typedText = typedText;
      row.decidedAt = Date.now();
    },

    async pending(chatId: string): Promise<GateRequest | null> {
      let latest: GateRow | null = null;
      for (const row of rows.values()) {
        if (row.chatId !== chatId || row.status !== "pending") continue;
        if (!latest || row.createdAt > latest.createdAt) latest = row;
      }
      return latest ? latest.req : null;
    },

    async expireOtherChats(chatId: string): Promise<void> {
      for (const row of rows.values()) {
        if (row.chatId !== chatId && row.status === "pending") {
          row.status = "expired";
          row.decidedAt = Date.now();
        }
      }
    },
  };
}

/**
 * § 3.1: "at most one gate open per chat — a new gate expires the old
 * one." Any tool that opens a gate (estimate_cost, the mid-run allowance
 * stop) calls this instead of `deps.gate.open` directly, so the
 * invariant holds no matter which of them fires, and even when the SAME
 * step calls estimate_cost twice (M2, fix round 1): the caller is
 * expected to serialize concurrent calls for one chat (coach.ts does,
 * via a per-chat lock) so the read-then-act below isn't itself racy.
 */
export async function openGateForChat(
  deps: Pick<Deps, "gate">,
  chatId: string,
  req: GateRequest,
  writer: UIMessageStreamWriter<AppMessage>,
): Promise<void> {
  const existing = await deps.gate.pending(chatId);
  if (existing && existing.gateId !== req.gateId) {
    await deps.gate.decide(existing.gateId, "expired");
    writer.write({ type: "data-gate-status", data: { gateId: existing.gateId, status: "expired" } });
  }
  await deps.gate.open(req, chatId);
  writer.write({ type: "data-gate", data: req });
  writer.write({ type: "data-gate-status", data: { gateId: req.gateId, status: "pending" } });
}
