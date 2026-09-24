// A Supabase-backed Gate (docs/design-web-agent.md § 3) over the
// `ten_gate_open` / `ten_gate_decide` / `ten_gate_expire_other_chats` RPCs,
// plus a plain `select` (RLS: "own rows readable") for `pending(chatId)` —
// there is no dedicated "read the pending gate" RPC; § 3's own read policy
// is exactly this.
//
// Deliberately raw `fetch` + PostgREST, the same posture as
// supabase-workspace-store.ts (not `@supabase/supabase-js`, so a refusal's
// exact PTxxx status is visible to the caller and the module stays
// trivially unit-testable with a fake `fetch`). Browser-safe: only
// `fetch`/`URL`. No window/document/localStorage/node:*.
import type { Gate, GateRequest } from "../../../../packages/agent/src/types.ts";

export interface SupabaseGateOptions {
  /** The Supabase project URL, e.g. https://xxxx.supabase.co. */
  url: string;
  /** The anon/publishable key (never a service-role key). */
  anonKey: string;
  /** Returns the current session's access token; called per request. */
  accessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface GateLogRow {
  id: string;
  chat_id: string;
  kind: string;
  label: string;
  text_hash: string;
  gate_line: string;
  amount_usd: number;
  status: string;
}

function toGateRequest(row: GateLogRow): GateRequest {
  return {
    gateId: row.id,
    kind: "spend",
    label: row.label,
    // § 3's GateRequest.text is the FULL text shown at open time (action +
    // items + the cost line); the row only stores label/text_hash/gate_line
    // (the migration's own comment: lengths are capped so the row can't
    // store bulk data). A re-derived pending() read can rebuild gateLine
    // and label exactly, but not the original multi-line `text` — callers
    // needing the full text (the gate card at open time) already have it
    // from the `data-gate` chunk this package itself wrote; `pending()` is
    // used by coach.ts only for `matchGateReply`'s bookkeeping (gateId,
    // amountUsd), which don't depend on `text`. Reconstructed here as the
    // label alone so the field is never empty/misleading.
    text: row.label,
    textHash: row.text_hash,
    gateLine: row.gate_line,
    amountUsd: Number(row.amount_usd),
  };
}

async function rpc(o: Required<SupabaseGateOptions>, fnName: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const token = await o.accessToken();
  const res = await o.fetchImpl(`${o.url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: o.anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

function messageOf(body: unknown): string {
  if (body && typeof body === "object" && "message" in (body as Record<string, unknown>)) {
    const m = (body as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  return typeof body === "string" ? body : JSON.stringify(body);
}

export function createSupabaseGate(opts: SupabaseGateOptions): Gate {
  const o: Required<SupabaseGateOptions> = {
    url: opts.url.replace(/\/+$/, ""),
    anonKey: opts.anonKey,
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl ?? fetch,
  };

  return {
    async open(req: GateRequest, chatId: string): Promise<void> {
      const { status, body } = await rpc(o, "ten_gate_open", {
        p_id: req.gateId,
        p_chat: chatId,
        p_label: req.label,
        p_text_hash: req.textHash,
        p_gate_line: req.gateLine,
        p_amount: req.amountUsd,
      });
      if (status !== 200 && status !== 204) {
        throw new Error(`ten_gate_open failed: HTTP ${status} ${messageOf(body)}`);
      }
    },

    async decide(gateId: string, status: "approved" | "declined" | "expired", typedText?: string): Promise<void> {
      const { status: httpStatus, body } = await rpc(o, "ten_gate_decide", {
        p_id: gateId,
        p_status: status,
        p_typed: typedText ?? null,
      });
      if (httpStatus !== 200 && httpStatus !== 204) {
        throw new Error(`ten_gate_decide failed: HTTP ${httpStatus} ${messageOf(body)}`);
      }
    },

    async pending(chatId: string): Promise<GateRequest | null> {
      const token = await o.accessToken();
      const query = new URLSearchParams({
        select: "id,chat_id,kind,label,text_hash,gate_line,amount_usd,status",
        chat_id: `eq.${chatId}`,
        status: "eq.pending",
        order: "created_at.desc",
        limit: "1",
      });
      const res = await o.fetchImpl(`${o.url}/rest/v1/ten_gate_log?${query.toString()}`, {
        headers: { apikey: o.anonKey, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`ten_gate_log select failed: HTTP ${res.status} ${await res.text()}`);
      }
      const rows = (await res.json()) as GateLogRow[];
      const row = rows[0];
      return row ? toGateRequest(row) : null;
    },

    async expireOtherChats(chatId: string): Promise<void> {
      const { status, body } = await rpc(o, "ten_gate_expire_other_chats", { p_chat: chatId });
      if (status !== 200 && status !== 204) {
        throw new Error(`ten_gate_expire_other_chats failed: HTTP ${status} ${messageOf(body)}`);
      }
    },
  };
}
