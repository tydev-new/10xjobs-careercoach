// § 11.2/§ 11.6 — ConversationStore. Own tests (coder-authored, this slice).
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationError, createConversationStore } from "./conversation-store.ts";
import type { AppMessage } from "../../../../packages/agent/src/types.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(responder: (call: Call) => { status: number; body: unknown }): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const headers: Record<string, string> = {};
    if (init?.headers) new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call: Call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    const { status, body: respBody } = responder(call);
    return new Response(JSON.stringify(respBody), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const MSGS: AppMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] } as AppMessage];

test("load() returns null when no row exists", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 200, body: [] }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  assert.equal(await store.load(), null);
});

test("load() reads the caller's own row (RLS: own row only, plain select)", async () => {
  const { fetchImpl, calls } = makeFetch((call) => {
    assert.match(call.url, /\/rest\/v1\/ten_conversations\?/);
    assert.match(call.url, /select=chat_id%2Cmessages%2Colder_dropped%2Cversion%2Cupdated_at/);
    return { status: 200, body: [{ chat_id: "chat-1", messages: MSGS, older_dropped: true, version: "v1", updated_at: "2026-09-24T00:00:00Z" }] };
  });
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  const row = await store.load();
  assert.deepEqual(row, { chatId: "chat-1", messages: MSGS, olderDropped: true, version: "v1", updatedAt: "2026-09-24T00:00:00Z" });
  assert.equal(calls[0].headers.authorization, "Bearer jwt");
});

test("load() defends against a non-array messages column (never crash the setup screen)", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 200, body: [{ chat_id: "chat-1", messages: null, older_dropped: false, version: "v1", updated_at: "t" }] }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  const row = await store.load();
  assert.deepEqual(row?.messages, []);
});

test("save() with expectedVersion null calls the RPC with p_expected: null (first save / create)", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: [{ chat_id: "chat-1", version: "v1", older_dropped: false, updated_at: "t" }] }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  const result = await store.save("chat-1", MSGS, false, null);
  assert.equal(calls[0].url, "https://proj.supabase.co/rest/v1/rpc/ten_conversation_save");
  assert.deepEqual(calls[0].body, { p_chat_id: "chat-1", p_messages: MSGS, p_older_dropped: false, p_expected: null });
  assert.deepEqual(result, { chatId: "chat-1", messages: MSGS, olderDropped: false, version: "v1", updatedAt: "t" });
});

test("save() with an expectedVersion sends it as p_expected (compare-and-swap)", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: [{ chat_id: "chat-1", version: "v2", older_dropped: true, updated_at: "t" }] }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await store.save("chat-1", MSGS, true, "v1");
  assert.deepEqual(calls[0].body, { p_chat_id: "chat-1", p_messages: MSGS, p_older_dropped: true, p_expected: "v1" });
});

test("save() throws ConversationError('version_conflict') on the RPC's PT409", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 409, body: { message: "version_conflict" } }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await assert.rejects(
    () => store.save("chat-1", MSGS, false, "stale"),
    (e: unknown) => e instanceof ConversationError && e.code === "version_conflict",
  );
});

test("save() throws ConversationError('conversation_too_large') on the RPC's PT413", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 413, body: { message: "conversation_too_large" } }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await assert.rejects(
    () => store.save("chat-1", MSGS, false, "v1"),
    (e: unknown) => e instanceof ConversationError && e.code === "conversation_too_large",
  );
});

test("save() surfaces an unrecognized failure as a plain Error naming the status", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 500, body: { message: "boom" } }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await assert.rejects(() => store.save("chat-1", MSGS, false, null), /ten_conversation_save failed: HTTP 500/);
});

test("readVersion() reads just the version column", async () => {
  const { fetchImpl, calls } = makeFetch((call) => {
    assert.match(call.url, /select=version/);
    return { status: 200, body: [{ version: "v9" }] };
  });
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  assert.equal(await store.readVersion(), "v9");
});

test("readVersion() returns null when no row exists", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 200, body: [] }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  assert.equal(await store.readVersion(), null);
});

test("accessToken() is called fresh per request", async () => {
  let token = "jwt-1";
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: [] }));
  const store = createConversationStore({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => token, fetchImpl });
  await store.load();
  token = "jwt-2";
  await store.load();
  assert.equal(calls[0].headers.authorization, "Bearer jwt-1");
  assert.equal(calls[1].headers.authorization, "Bearer jwt-2");
});
