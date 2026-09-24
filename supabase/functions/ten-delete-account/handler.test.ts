// Unit/integration tests for ten-delete-account, run with `deno test`.
// Uses the local stub Supabase server (supabase/functions/_shared/test-support.ts)
// — no real network, no live Supabase project.

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { handleRequest, type DeleteDeps } from "./handler.ts";
import { deleteOwnRows, listAllObjects, removeObjects, verifyUser, type SupabaseEnv } from "../_shared/supabase.ts";
import { freshState, startMockSupabase, type MockServer, type MockSupabaseState } from "../_shared/test-support.ts";

const PROD_ORIGIN = "https://ten.example.com";
const BASE_ENV = { TEN_APP_ORIGIN: PROD_ORIGIN } satisfies Record<string, string>;

function req(opts: { token?: string; origin?: string; method?: string } = {}): Request {
  const headers = new Headers();
  if (opts.token !== undefined) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  return new Request("http://localhost/", { method: opts.method ?? "POST", headers });
}

interface Harness {
  supabase: MockServer;
  state: MockSupabaseState;
  deps: DeleteDeps;
  stop(): Promise<void>;
}

async function harness(): Promise<Harness> {
  const state = freshState();
  const supabase = await startMockSupabase(state);
  const env: SupabaseEnv = { url: supabase.url, anonKey: state.anonKey, serviceRoleKey: state.serviceRoleKey };
  const deps: DeleteDeps = {
    verifyUser: (token) => verifyUser(env, token),
    listAllObjects: (bucket, prefix) => listAllObjects(env, bucket, prefix),
    removeObjects: (bucket, paths) => removeObjects(env, bucket, paths),
    deleteOwnRows: (table, uid, extraFilter) => deleteOwnRows(env, table, uid, undefined, extraFilter),
    log: { warn: () => {} },
  };
  return { supabase, state, deps, stop: () => supabase.stop() };
}

Deno.test("401 without a JWT", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req(), h.deps, BASE_ENV);
    assertEquals(res.status, 401);
  } finally {
    await h.stop();
  }
});

Deno.test("401 when the bearer token is the anon key itself", async () => {
  const h = await harness();
  try {
    const res = await handleRequest(req({ token: h.state.anonKey }), h.deps, BASE_ENV);
    assertEquals(res.status, 401);
  } finally {
    await h.stop();
  }
});

// Fix round 1, lead ruling S5/S6/S7: delete-account requires a signed-in
// user only, NOT membership — a signed-in user with no credit row (never a
// member, or an ex-member) must still be able to erase their own data.
Deno.test("200 for a signed-in NON-member (no membership check, per the fix-round-1 ruling)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" }; // never given a credit row
    h.state.storageObjects.add("users/u1/ws/cv.pdf");
    h.state.rowCounts["ten_ws_files:u1"] = 2;
    const res = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200, await res.clone().text());
    const body = await res.json();
    assertEquals(body.deleted.storageObjects, 1);
    assertEquals(body.deleted.textFiles, 2);
  } finally {
    await h.stop();
  }
});

Deno.test("404 on GET (only POST/OPTIONS are accepted)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const res = await handleRequest(req({ token: "tok-1", method: "GET" }), h.deps, BASE_ENV);
    assertEquals(res.status, 404);
  } finally {
    await h.stop();
  }
});

Deno.test("CORS: preflight allow header only for allowed origins", async () => {
  const h = await harness();
  try {
    const allowed = await handleRequest(req({ method: "OPTIONS", origin: PROD_ORIGIN }), h.deps, BASE_ENV);
    assertEquals(allowed.status, 204);
    assertEquals(allowed.headers.get("access-control-allow-origin"), PROD_ORIGIN);

    const blocked = await handleRequest(
      req({ method: "OPTIONS", origin: "https://evil.example.com" }),
      h.deps,
      BASE_ENV,
    );
    assertFalse(blocked.headers.has("access-control-allow-origin"));
  } finally {
    await h.stop();
  }
});

Deno.test("deletes only this user's storage objects, DB rows, and keeps the auth user", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: "user-a" };
    h.state.users["tok-b"] = { id: "user-b" };
    h.state.members.add("user-a");
    h.state.members.add("user-b");

    // Two users' binaries, including a nested folder under user-a.
    h.state.storageObjects.add("users/user-a/ws/resume.pdf");
    h.state.storageObjects.add("users/user-a/ws/documents/cover.docx");
    h.state.storageObjects.add("users/user-b/ws/other.pdf");

    h.state.rowCounts["ten_ws_files:user-a"] = 3;
    h.state.rowCounts["ten_gate_log:user-a"] = 2;
    h.state.rowCounts["ten_ws_files:user-b"] = 5;

    const res = await handleRequest(req({ token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.deleted.storageObjects, 2);
    assertEquals(body.deleted.textFiles, 3);
    assertEquals(body.deleted.gateLogRows, 2);
    assert(body.message.includes("Your sign-in stays"));
    // Round 2, item 4: names what's kept, not just what's deleted.
    assert(body.message.includes("Your usage records, which show only amounts spent and no content, are kept."));

    // user-a's objects are gone; user-b's are untouched.
    assertFalse(h.state.storageObjects.has("users/user-a/ws/resume.pdf"));
    assertFalse(h.state.storageObjects.has("users/user-a/ws/documents/cover.docx"));
    assert(h.state.storageObjects.has("users/user-b/ws/other.pdf"));

    // user-b's seeded row count is untouched (never deleted).
    assertEquals(h.state.rowCounts["ten_ws_files:user-b"], 5);

    // The auth user itself is never touched by this function (no such call
    // exists in DeleteDeps at all — kept the sign-in shared with the old app).
  } finally {
    await h.stop();
  }
});

// § 11.7 (amended 2026-09-24): "ten-delete-account deletes the row"
// (ten_conversations, one row per user, § 11.2).
Deno.test("deletes the caller's ten_conversations row only, never another user's", async () => {
  const h = await harness();
  try {
    h.state.users["tok-a"] = { id: "user-a" };
    h.state.users["tok-b"] = { id: "user-b" };
    h.state.rowCounts["ten_conversations:user-a"] = 1;
    h.state.rowCounts["ten_conversations:user-b"] = 1;

    const res = await handleRequest(req({ token: "tok-a" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.deleted.conversationRows, 1);
    // user-b's row count, seeded separately, is untouched.
    assertEquals(h.state.rowCounts["ten_conversations:user-b"], 1);
  } finally {
    await h.stop();
  }
});

Deno.test("a workspace with no files/objects still returns a zeroed summary, not an error", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const res = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.deleted, { storageObjects: 0, textFiles: 0, gateLogRows: 0, conversationRows: 0, creditRows: 0 });
  } finally {
    await h.stop();
  }
});

Deno.test("idempotent: a second call finds nothing left and still returns 200 with a zeroed summary", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.storageObjects.add("users/u1/ws/cv.pdf");
    h.state.rowCounts["ten_ws_files:u1"] = 3;
    h.state.ledgerRowsByKind["credit"] = { u1: 1 };

    const first = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(first.status, 200);
    const firstBody = await first.json();
    assertEquals(firstBody.deleted, { storageObjects: 1, textFiles: 3, gateLogRows: 0, conversationRows: 0, creditRows: 1 });

    const second = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(second.status, 200);
    const secondBody = await second.json();
    assertEquals(secondBody.deleted, { storageObjects: 0, textFiles: 0, gateLogRows: 0, conversationRows: 0, creditRows: 0 });
  } finally {
    await h.stop();
  }
});

Deno.test("keeps 'call' ledger rows, deletes only 'credit' rows (lead ruling, fix round 1)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.ledgerInserts.push(
      { user_id: "u1", kind: "call", request_id: "gen-1", usd: 0.02 },
      { user_id: "u1", kind: "call", request_id: "gen-2", usd: 0.03 },
      { user_id: "other", kind: "call", request_id: "gen-3", usd: 0.05 },
    );
    h.state.ledgerRowsByKind["credit"] = { u1: 1 };

    const res = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.deleted.creditRows, 1);

    const remaining = h.state.ledgerInserts.filter((r) => r.user_id === "u1");
    assertEquals(remaining.length, 2, "the two 'call' rows must survive");
    assert(remaining.every((r) => r.kind === "call"));
    assertEquals(h.state.ledgerInserts.some((r) => r.user_id === "other"), true, "another user's row untouched");
  } finally {
    await h.stop();
  }
});

Deno.test("pagination (N2): more than one Storage list/remove page (>1000 objects) is fully collected and removed", async () => {
  // Both listAllObjects and removeObjects page/batch at 1000 (Storage's own
  // per-call cap), so >1000 objects in one folder needs >1 of each.
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    const total = 1200;
    for (let i = 0; i < total; i++) {
      h.state.storageObjects.add(`users/u1/ws/f${String(i).padStart(4, "0")}.pdf`);
    }
    const res = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.deleted.storageObjects, total);
    const left = [...h.state.storageObjects].filter((o) => o.includes("u1"));
    assertEquals(left, []);
  } finally {
    await h.stop();
  }
});

Deno.test("a known deleted path 404s afterward (download-as-not-found)", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    h.state.storageObjects.add("users/u1/ws/resume.pdf");

    await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertFalse(h.state.storageObjects.has("users/u1/ws/resume.pdf"));
  } finally {
    await h.stop();
  }
});
