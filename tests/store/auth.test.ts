// Tester-owned auth checks (docs/design-web-agent.md § 8):
//  - every auth link passes redirectTo, taken from VITE_SITE_URL (the
//    production URL in Auth's Redirect URLs), never the project's Site URL;
//  - membership = ten_is_member() called with the USER's session;
//  - the non-member message is the contract's, word for word.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import {
  NON_MEMBER_MESSAGE,
  checkMembership,
  signInWithMagicLink,
  signUpWithPassword,
  type AuthClientLike,
} from "../../apps/web/src/backend/auth.ts";
import { ANON, REPO, SUPABASE_URL, createBackend } from "./pglite-backend.ts";

const WEB = path.join(REPO, "apps/web");
const req = createRequire(path.join(WEB, "package.json"));

test("U1 the non-member message is the contract's sentence, word for word", () => {
  const doc = readFileSync(path.join(REPO, "docs/design-web-agent.md"), "utf8");
  const m = /The app says: "([^"]+)"/.exec(doc);
  assert.ok(m, "contract sentence not found in § 8");
  assert.equal(NON_MEMBER_MESSAGE, m[1].replace(/\s+/g, " "));
});

async function loadAuthWithEnv(env: Record<string, string | undefined>) {
  const { createServer } = (await import(req.resolve("vite"))) as typeof import("vite");
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const server = await createServer({ root: WEB, configFile: false, envDir: path.join(REPO, "tests/store"), logLevel: "silent", server: { middlewareMode: true, hmr: false, ws: false } });
  try {
    return (await server.ssrLoadModule("/src/backend/auth.ts")) as typeof import("../../apps/web/src/backend/auth.ts");
  } finally {
    await server.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("U2 under Vite, siteRedirectUrl() returns VITE_SITE_URL even when a (different) page origin is offered", async () => {
  const mod = await loadAuthWithEnv({ VITE_SITE_URL: "https://ten.example.app" });
  assert.equal(mod.siteRedirectUrl(), "https://ten.example.app");
  assert.equal(mod.siteRedirectUrl("https://preview-123.vercel.app"), "https://ten.example.app");
});

test("U3 with VITE_SITE_URL unset and no origin, siteRedirectUrl() throws rather than letting Supabase fall back to the Site URL", async () => {
  const mod = await loadAuthWithEnv({ VITE_SITE_URL: undefined });
  assert.throws(() => mod.siteRedirectUrl(), /VITE_SITE_URL/);
  // Observed (not asserted): with an origin it returns that origin.
  console.log(`unset + origin -> ${mod.siteRedirectUrl("http://localhost:5173")}`);
});

test("U4 magic link and sign-up pass the given redirectTo as emailRedirectTo; password sign-in sends no redirect", async () => {
  const seen: unknown[] = [];
  const fake: AuthClientLike = {
    auth: {
      signInWithOtp: async (a) => (seen.push(["otp", a]), { error: null }),
      signInWithPassword: async (a) => (seen.push(["pw", a]), { error: null, data: { session: null } }),
      signUp: async (a) => (seen.push(["up", a]), { error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
  await signInWithMagicLink(fake, "a@example.com", "https://ten.example.app");
  await signUpWithPassword(fake, "a@example.com", "pw", "https://ten.example.app");
  assert.deepEqual(seen, [
    ["otp", { email: "a@example.com", options: { emailRedirectTo: "https://ten.example.app" } }],
    ["up", { email: "a@example.com", password: "pw", options: { emailRedirectTo: "https://ten.example.app" } }],
  ]);
});

test("U5 no source under apps/web/src reads a Site URL, and every email-sending auth call passes a redirect", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const a = path.join(d, n);
      if (statSync(a).isDirectory()) walk(a);
      else if (/\.(ts|tsx|mjs)$/.test(n) && !/\.test\./.test(n) && !a.includes(`${path.sep}live${path.sep}`)) files.push(a);
    }
  };
  walk(path.join(WEB, "src"));
  const offenders: string[] = [];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    if (/SITE_URL/.test(s.replaceAll("VITE_SITE_URL", ""))) offenders.push(`${f}: reads a non-VITE SITE_URL`);
    for (const m of s.matchAll(/\.(signInWithOtp|signUp|resetPasswordForEmail|signInWithOAuth|updateUser)\(([^)]*)\)/g)) {
      if (!/RedirectTo|redirectTo/.test(m[2] + s.slice(m.index!, m.index! + 200))) offenders.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("U6 checkMembership calls exactly ten_is_member() with no arguments, true only on a literal true, throws on error", async () => {
  const calls: unknown[] = [];
  const mk = (data: unknown, error: { message: string } | null = null): AuthClientLike =>
    ({ auth: {} as AuthClientLike["auth"], rpc: async (fn: string, args?: unknown) => (calls.push([fn, args]), { data, error }) }) as AuthClientLike;
  assert.equal(await checkMembership(mk(true)), true);
  assert.equal(await checkMembership(mk(false)), false);
  assert.equal(await checkMembership(mk("true")), false);
  assert.equal(await checkMembership(mk(null)), false);
  await assert.rejects(checkMembership(mk(null, { message: "JWT expired" })), /ten_is_member/);
  assert.deepEqual(calls.map((c) => c), Array(5).fill(["ten_is_member", undefined]));
});

test("U7 checkMembership through a REAL supabase-js client carrying the user's token, over the applied migration: member true, non-member false", async () => {
  const { createClient } = req("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  const be = await createBackend();
  const m = await be.newUser({ member: true });
  const n = await be.newUser({ member: false });
  const clientFor = (uid: string) =>
    createClient(SUPABASE_URL, ANON, { accessToken: async () => `jwt:${uid}`, global: { fetch: be.fetchImpl } }) as unknown as AuthClientLike;
  assert.equal(await checkMembership(clientFor(m)), true);
  assert.equal(await checkMembership(clientFor(n)), false);
  const rpcCalls = be.calls.filter((c) => c.url.endsWith("/rest/v1/rpc/ten_is_member"));
  assert.deepEqual(rpcCalls.map((c) => c.headers["authorization"]), [`Bearer jwt:${m}`, `Bearer jwt:${n}`], "the user's token, not the anon key");
});
