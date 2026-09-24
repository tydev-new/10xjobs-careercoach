import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseGate } from "./gate.ts";
import type { GateRequest } from "../../../../packages/agent/src/types.ts";

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

const req: GateRequest = {
  gateId: "g1",
  kind: "spend",
  label: "Tailor résumé",
  text: "Tailor résumé\nAcme — Staff PM\nEstimated cost: $0.10 to $0.20.",
  textHash: "sha256:" + "a".repeat(64),
  gateLine: "This costs up to $0.20 — nothing starts until you say yes.",
  amountUsd: 0.2,
};

test("open() calls ten_gate_open with the RPC's own argument names", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: null }));
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await gate.open(req, "chat-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://proj.supabase.co/rest/v1/rpc/ten_gate_open");
  assert.equal(calls[0].headers.authorization, "Bearer jwt");
  assert.equal(calls[0].headers.apikey, "anon");
  assert.deepEqual(calls[0].body, {
    p_id: "g1",
    p_chat: "chat-1",
    p_label: "Tailor résumé",
    p_text_hash: req.textHash,
    p_gate_line: req.gateLine,
    p_amount: 0.2,
  });
});

test("open() surfaces a non-2xx as a thrown error naming the RPC and status", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 403, body: { message: "not_a_member" } }));
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await assert.rejects(() => gate.open(req, "chat-1"), /ten_gate_open failed: HTTP 403/);
});

test("decide() calls ten_gate_decide with status and the typed text", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: true }));
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await gate.decide("g1", "approved", "yes");
  assert.deepEqual(calls[0].body, { p_id: "g1", p_status: "approved", p_typed: "yes" });
});

test("decide() with no typedText sends p_typed: null (a decline/expire has none)", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: true }));
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await gate.decide("g1", "expired");
  assert.deepEqual(calls[0].body, { p_id: "g1", p_status: "expired", p_typed: null });
});

test("pending() reads the latest pending row for the chat via a plain select (RLS: own rows readable)", async () => {
  const { fetchImpl, calls } = makeFetch((call) => {
    assert.match(call.url, /\/rest\/v1\/ten_gate_log\?/);
    assert.match(call.url, /chat_id=eq\.chat-1/);
    assert.match(call.url, /status=eq\.pending/);
    return {
      status: 200,
      body: [
        {
          id: "g1",
          chat_id: "chat-1",
          kind: "spend",
          label: "Tailor résumé",
          text_hash: req.textHash,
          gate_line: req.gateLine,
          amount_usd: "0.2",
          status: "pending",
        },
      ],
    };
  });
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  const found = await gate.pending("chat-1");
  assert.ok(found);
  assert.equal(found?.gateId, "g1");
  assert.equal(found?.amountUsd, 0.2); // numeric string -> number
  assert.equal(found?.gateLine, req.gateLine);
});

test("pending() returns null when no row is open", async () => {
  const { fetchImpl } = makeFetch(() => ({ status: 200, body: [] }));
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  assert.equal(await gate.pending("chat-1"), null);
});

test("expireOtherChats() calls ten_gate_expire_other_chats with p_chat", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: null }));
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await gate.expireOtherChats("chat-2");
  assert.equal(calls[0].url, "https://proj.supabase.co/rest/v1/rpc/ten_gate_expire_other_chats");
  assert.deepEqual(calls[0].body, { p_chat: "chat-2" });
});

test("accessToken() is called fresh per RPC call (a refreshed JWT is used)", async () => {
  let token = "jwt-1";
  const { fetchImpl, calls } = makeFetch(() => ({ status: 200, body: null }));
  const gate = createSupabaseGate({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => token, fetchImpl });
  await gate.open(req, "chat-1");
  token = "jwt-2";
  await gate.expireOtherChats("chat-1");
  assert.equal(calls[0].headers.authorization, "Bearer jwt-1");
  assert.equal(calls[1].headers.authorization, "Bearer jwt-2");
});
