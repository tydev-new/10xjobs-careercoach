import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteBetaAccount } from "./delete-account.ts";

test("posts to /functions/v1/ten-delete-account with the live JWT and returns the summary", async () => {
  let seenUrl = "";
  let seenAuth = "";
  let seenMethod = "";
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = typeof input === "string" ? input : String(input);
    seenMethod = init?.method ?? "GET";
    seenAuth = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        message: "This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited. Your usage records, which show only amounts spent and no content, are kept.",
        deleted: { storageObjects: 2, textFiles: 5, gateLogRows: 1, creditRows: 1 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const summary = await deleteBetaAccount({ url: "https://proj.supabase.co", accessToken: async () => "jwt-1", fetchImpl });
  assert.equal(seenUrl, "https://proj.supabase.co/functions/v1/ten-delete-account");
  assert.equal(seenMethod, "POST");
  assert.equal(seenAuth, "Bearer jwt-1");
  assert.equal(summary.deleted.textFiles, 5);
  assert.match(summary.message, /Unused credit is forfeited/);
});

test("a non-2xx response throws with the server's own error message", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: { code: "not_signed_in", message: "Sign in required." } }), { status: 401 })) as typeof fetch;
  await assert.rejects(
    () => deleteBetaAccount({ url: "https://proj.supabase.co", accessToken: async () => "jwt", fetchImpl }),
    /Sign in required\./,
  );
});
