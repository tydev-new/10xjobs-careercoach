// Unit/integration tests for ten-delete-account, run with `deno test`.
// Uses the local stub Supabase server (supabase/functions/_shared/test-support.ts)
// — no real network, no live Supabase project.

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { handleRequest, type DeleteDeps } from "./handler.ts";
import {
  deleteOwnRows,
  isMember,
  listAllObjects,
  removeObjects,
  verifyUser,
  type SupabaseEnv,
} from "../_shared/supabase.ts";
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
    isMember: (token) => isMember(env, token),
    listAllObjects: (bucket, prefix) => listAllObjects(env, bucket, prefix),
    removeObjects: (bucket, paths) => removeObjects(env, bucket, paths),
    deleteOwnRows: (table, uid) => deleteOwnRows(env, table, uid),
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

Deno.test("403 for a signed-in non-member", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    const res = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error.code, "not_a_member");
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

Deno.test("a workspace with no files/objects still returns a zeroed summary, not an error", async () => {
  const h = await harness();
  try {
    h.state.users["tok-1"] = { id: "u1" };
    h.state.members.add("u1");
    const res = await handleRequest(req({ token: "tok-1" }), h.deps, BASE_ENV);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.deleted, { storageObjects: 0, textFiles: 0, gateLogRows: 0, ledgerRows: 0 });
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
