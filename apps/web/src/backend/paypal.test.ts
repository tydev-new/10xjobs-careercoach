import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePaypalOrder, createPaypalOrder } from "./paypal.ts";

test("createPaypalOrder: posts to ten-paypal/create-order with the pack id and the live JWT, returns orderId", async () => {
  let seenUrl = "";
  let seenAuth = "";
  let seenMethod = "";
  let seenBody: unknown;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = typeof input === "string" ? input : String(input);
    seenMethod = init?.method ?? "GET";
    seenAuth = new Headers(init?.headers).get("authorization") ?? "";
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ orderId: "order-1" }), { status: 200 });
  }) as typeof fetch;

  const result = await createPaypalOrder({ url: "https://proj.supabase.co", accessToken: async () => "jwt-1", fetchImpl }, "10");
  assert.equal(seenUrl, "https://proj.supabase.co/functions/v1/ten-paypal/create-order");
  assert.equal(seenMethod, "POST");
  assert.equal(seenAuth, "Bearer jwt-1");
  assert.deepEqual(seenBody, { pack: "10" });
  assert.deepEqual(result, { orderId: "order-1" });
});

test("createPaypalOrder: a non-2xx response throws with the server's own error message", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: { code: "unknown_pack", message: "Unknown credit pack." } }), { status: 400 })) as typeof fetch;
  await assert.rejects(
    () => createPaypalOrder({ url: "https://proj.supabase.co", accessToken: async () => "jwt", fetchImpl }, "10"),
    /Unknown credit pack\./,
  );
});

test("capturePaypalOrder: posts to ten-paypal/capture-order with the orderId, returns the credited breakdown", async () => {
  let seenUrl = "";
  let seenBody: unknown;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = typeof input === "string" ? input : String(input);
    seenBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ status: "credited", grossUsd: "10.00", feeUsd: "0.84", creditedUsd: "9.16" }), { status: 200 });
  }) as typeof fetch;

  const result = await capturePaypalOrder({ url: "https://proj.supabase.co", accessToken: async () => "jwt-1", fetchImpl }, "order-1");
  assert.equal(seenUrl, "https://proj.supabase.co/functions/v1/ten-paypal/capture-order");
  assert.deepEqual(seenBody, { orderId: "order-1" });
  assert.deepEqual(result, { status: "credited", grossUsd: "10.00", feeUsd: "0.84", creditedUsd: "9.16" });
});

test("capturePaypalOrder: pending/declined/window_closed pass through as plain status strings", async () => {
  for (const status of ["pending", "declined", "window_closed"]) {
    const fetchImpl = (async () => new Response(JSON.stringify({ status }), { status: 200 })) as typeof fetch;
    const result = await capturePaypalOrder({ url: "https://proj.supabase.co", accessToken: async () => "jwt", fetchImpl }, "order-1");
    assert.deepEqual(result, { status });
  }
});

test("capturePaypalOrder: strips a trailing slash from the Supabase URL", async () => {
  let seenUrl = "";
  const fetchImpl = (async (input: RequestInfo | URL) => {
    seenUrl = typeof input === "string" ? input : String(input);
    return new Response(JSON.stringify({ status: "pending" }), { status: 200 });
  }) as typeof fetch;
  await capturePaypalOrder({ url: "https://proj.supabase.co/", accessToken: async () => "jwt", fetchImpl }, "order-1");
  assert.equal(seenUrl, "https://proj.supabase.co/functions/v1/ten-paypal/capture-order");
});

test("capturePaypalOrder: a non-2xx response throws with the server's own error message", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: { code: "not_your_order", message: "That payment isn't yours." } }), { status: 403 })) as typeof fetch;
  await assert.rejects(
    () => capturePaypalOrder({ url: "https://proj.supabase.co", accessToken: async () => "jwt", fetchImpl }, "order-1"),
    /isn't yours\./,
  );
});

test("a non-JSON, non-2xx response falls back to a plain HTTP-status message", async () => {
  const fetchImpl = (async () => new Response("gateway timeout", { status: 503 })) as typeof fetch;
  await assert.rejects(
    () => createPaypalOrder({ url: "https://proj.supabase.co", accessToken: async () => "jwt", fetchImpl }, "10"),
    /HTTP 503/,
  );
});
