import assert from "node:assert/strict";
import { test } from "node:test";
import { createBalanceFn } from "./balance.ts";

function makeFetch(respond: (url: string, headers: Record<string, string>) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const headers: Record<string, string> = {};
    if (init?.headers) new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    return respond(url, headers);
  }) as typeof fetch;
}

test("balance() posts to rpc/ten_balance with no arguments and the live JWT", async () => {
  let seenUrl = "";
  let seenAuth = "";
  const fetchImpl = makeFetch((url, headers) => {
    seenUrl = url;
    seenAuth = headers.authorization;
    return new Response("4.2", { status: 200 });
  });
  const balance = createBalanceFn({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt-abc", fetchImpl });
  const n = await balance();
  assert.equal(seenUrl, "https://proj.supabase.co/rest/v1/rpc/ten_balance");
  assert.equal(seenAuth, "Bearer jwt-abc");
  assert.equal(n, 4.2);
});

test("balance() rejects on a non-2xx response", async () => {
  const fetchImpl = makeFetch(() => new Response(JSON.stringify({ message: "not_a_member" }), { status: 403 }));
  const balance = createBalanceFn({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await assert.rejects(() => balance(), /ten_balance\(\) failed: HTTP 403/);
});

test("balance() rejects on a non-numeric body rather than silently coercing to NaN", async () => {
  const fetchImpl = makeFetch(() => new Response(JSON.stringify({ oops: true }), { status: 200 }));
  const balance = createBalanceFn({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  await assert.rejects(() => balance(), /non-numeric/);
});

test("balance() reads a negative balance as-is (the UI chip, not this function, clamps to $0.00)", async () => {
  const fetchImpl = makeFetch(() => new Response("-0.5", { status: 200 }));
  const balance = createBalanceFn({ url: "https://proj.supabase.co", anonKey: "anon", accessToken: async () => "jwt", fetchImpl });
  assert.equal(await balance(), -0.5);
});
