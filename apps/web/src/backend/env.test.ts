import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultModelProxyUrl, hasTenEnv, MissingEnvError, readEnv } from "./env.ts";

const BASE = { VITE_SUPABASE_URL: "https://proj.supabase.co", VITE_SUPABASE_ANON_KEY: "anon-key", VITE_SITE_URL: "https://ten.example.com" };

test("readEnv: requires VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_SITE_URL (fix round 1, item 6)", () => {
  assert.throws(() => readEnv({}), MissingEnvError);
  try {
    readEnv({});
  } catch (e) {
    assert.ok(e instanceof MissingEnvError);
    assert.deepEqual(e.missing, ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_SITE_URL"]);
  }
});

test("readEnv: VITE_SITE_URL alone missing is reported by itself", () => {
  try {
    readEnv({ VITE_SUPABASE_URL: BASE.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: BASE.VITE_SUPABASE_ANON_KEY });
    assert.fail("expected MissingEnvError");
  } catch (e) {
    assert.ok(e instanceof MissingEnvError);
    assert.deepEqual(e.missing, ["VITE_SITE_URL"]);
  }
});

test("readEnv: returns siteUrl unchanged, and derives modelProxyUrl from the Supabase URL when VITE_MODEL_PROXY_URL is unset", () => {
  const env = readEnv(BASE);
  assert.equal(env.siteUrl, "https://ten.example.com");
  assert.equal(env.modelProxyUrl, "https://proj.supabase.co/functions/v1/ten-model-proxy");
});

test("readEnv: an explicit VITE_MODEL_PROXY_URL wins over the derived default", () => {
  const env = readEnv({ ...BASE, VITE_MODEL_PROXY_URL: "https://custom.example/proxy" });
  assert.equal(env.modelProxyUrl, "https://custom.example/proxy");
});

test("readEnv: strips a trailing slash from the Supabase URL", () => {
  const env = readEnv({ ...BASE, VITE_SUPABASE_URL: "https://proj.supabase.co/" });
  assert.equal(env.supabaseUrl, "https://proj.supabase.co");
  assert.equal(env.modelProxyUrl, "https://proj.supabase.co/functions/v1/ten-model-proxy");
});

test("defaultModelProxyUrl: exact shape", () => {
  assert.equal(defaultModelProxyUrl("https://proj.supabase.co"), "https://proj.supabase.co/functions/v1/ten-model-proxy");
});

test("hasTenEnv: true only once every required var is present; never throws", () => {
  assert.equal(hasTenEnv({}), false);
  assert.equal(hasTenEnv({ VITE_SUPABASE_URL: "https://proj.supabase.co", VITE_SUPABASE_ANON_KEY: "k" }), false);
  assert.equal(hasTenEnv(BASE), true);
});
