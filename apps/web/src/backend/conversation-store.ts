// A Supabase-backed store for the saved conversation (docs/design-web-
// agent.md § 11.2), over the `ten_conversation_save` RPC (compare-and-swap,
// same shape as supabase-workspace-store.ts's ten_ws_write) plus a plain
// `select` for the initial load (RLS: own row only, like § 3's gate log).
//
// Deliberately raw `fetch` + PostgREST, the same posture as
// supabase-workspace-store.ts / gate.ts (exact PTxxx -> code mapping,
// trivially unit-testable with a fake fetch). Browser-safe: only
// `fetch`/`TextEncoder`. No window/document/localStorage/node:*.
import type { AppMessage } from "../../../../packages/agent/src/types.ts";
import { boundFetch } from "./bound-fetch.ts";

export interface ConversationStoreOptions {
  /** The Supabase project URL, e.g. https://xxxx.supabase.co. */
  url: string;
  /** The anon/publishable key (never a service-role key). */
  anonKey: string;
  /** Returns the current session's access token; called per request. */
  accessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface SavedConversation {
  chatId: string;
  messages: AppMessage[];
  olderDropped: boolean;
  version: string;
  updatedAt: string;
}

/** § 11.2's own error taxonomy, mirrored 1:1 (the RPC's message IS the
 *  code string, same convention as WorkspaceError/ten_ws_write). */
export type ConversationErrorCode = "not_signed_in" | "not_a_member" | "invalid_ref" | "conversation_too_large" | "version_conflict";

export class ConversationError extends Error {
  code: ConversationErrorCode;
  constructor(code: ConversationErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ConversationError";
    this.code = code;
  }
}

const CODES: ReadonlySet<ConversationErrorCode> = new Set([
  "not_signed_in",
  "not_a_member",
  "invalid_ref",
  "conversation_too_large",
  "version_conflict",
]);

interface Internal {
  url: string;
  anonKey: string;
  accessToken: () => Promise<string>;
  fetchImpl: typeof fetch;
}

function messageOf(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in (body as Record<string, unknown>)) {
    const m = (body as Record<string, unknown>).message;
    return typeof m === "string" ? m : null;
  }
  return null;
}

function throwFromRpcError(status: number, body: unknown): never {
  const msg = messageOf(body);
  if (msg && CODES.has(msg as ConversationErrorCode)) {
    throw new ConversationError(msg as ConversationErrorCode, `${msg} (ten_conversation_save, HTTP ${status})`);
  }
  throw new Error(`ten_conversation_save failed: HTTP ${status} ${msg ?? JSON.stringify(body)}`);
}

interface SaveRow {
  chat_id: string;
  version: string;
  older_dropped: boolean;
  updated_at: string;
}

interface SelectRow {
  chat_id: string;
  messages: AppMessage[];
  older_dropped: boolean;
  version: string;
  updated_at: string;
}

export interface ConversationStore {
  /** § 11.6's setup read: the caller's own row, or null if none exists yet
   *  (a brand-new member, or one who has never sent a turn). */
  load(): Promise<SavedConversation | null>;
  /** § 11.2's one write path. `expectedVersion: null` creates (only ever
   *  true for the FIRST save of a chat); otherwise a compare-and-swap
   *  update. Throws ConversationError on a refusal (version_conflict on
   *  ANY "no row changed" outcome, per the RPC's own contract) or a plain
   *  Error on a transport/unexpected failure. */
  save(chatId: string, messages: AppMessage[], olderDropped: boolean, expectedVersion: string | null): Promise<SavedConversation>;
  /** § 11.5's pre-send check: "it reads the row's version" — a lighter
   *  read than load() (no messages payload) for the check that runs before
   *  every send. Null if no row exists yet (never stale against nothing). */
  readVersion(opts?: { fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<string | null>;
}

export function createConversationStore(opts: ConversationStoreOptions): ConversationStore {
  const o: Internal = {
    url: opts.url.replace(/\/+$/, ""),
    anonKey: opts.anonKey,
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl ?? boundFetch(),
  };

  return {
    async load(): Promise<SavedConversation | null> {
      const token = await o.accessToken();
      const query = new URLSearchParams({ select: "chat_id,messages,older_dropped,version,updated_at", limit: "1" });
      const res = await o.fetchImpl(`${o.url}/rest/v1/ten_conversations?${query.toString()}`, {
        headers: { apikey: o.anonKey, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`ten_conversations select failed: HTTP ${res.status} ${await res.text()}`);
      }
      const rows = (await res.json()) as SelectRow[];
      const row = rows[0];
      if (!row) return null;
      return {
        chatId: row.chat_id,
        messages: Array.isArray(row.messages) ? row.messages : [],
        olderDropped: row.older_dropped,
        version: row.version,
        updatedAt: row.updated_at,
      };
    },

    async save(chatId: string, messages: AppMessage[], olderDropped: boolean, expectedVersion: string | null): Promise<SavedConversation> {
      const token = await o.accessToken();
      const res = await o.fetchImpl(`${o.url}/rest/v1/rpc/ten_conversation_save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: o.anonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          p_chat_id: chatId,
          p_messages: messages,
          p_older_dropped: olderDropped,
          p_expected: expectedVersion,
        }),
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
      if (res.status !== 200 && res.status !== 201) {
        throwFromRpcError(res.status, body);
      }
      const row = (Array.isArray(body) ? body[0] : body) as SaveRow | undefined;
      if (!row) {
        throw new Error(`ten_conversation_save returned no row: HTTP ${res.status} ${JSON.stringify(body)}`);
      }
      return { chatId: row.chat_id, messages, olderDropped: row.older_dropped, version: row.version, updatedAt: row.updated_at };
    },

    async readVersion(readOpts): Promise<string | null> {
      const token = await o.accessToken();
      const query = new URLSearchParams({ select: "version", limit: "1" });
      const res = await (readOpts?.fetchImpl ?? o.fetchImpl)(`${o.url}/rest/v1/ten_conversations?${query.toString()}`, {
        headers: { apikey: o.anonKey, Authorization: `Bearer ${token}` },
        signal: readOpts?.signal,
      });
      if (!res.ok) {
        throw new Error(`ten_conversations select (readVersion) failed: HTTP ${res.status} ${await res.text()}`);
      }
      const rows = (await res.json()) as Array<{ version: string }>;
      return rows[0]?.version ?? null;
    },
  };
}
