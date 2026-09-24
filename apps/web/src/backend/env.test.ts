import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultModelProxyUrl, hasTenEnv, MissingEnvError, readEnv } from "./env.ts";

test("readEnv: requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY", () => {
  assert.throws(() => readEnv({}), MissingEnvError);
  try {
    readEnv({});
  } catch (e) {
    assert.ok(e instanceof MissingEnvError);
    assert.deepEqual(e.missing, ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);
  }
});

test("readEnv: derives modelProxyUrl from the Supabase URL when VITE_MODEL_PROXY_URL is unset", () => {
  const env = readEnv({ VITE_SUPABASE_URL: "https://proj.supabase.co", VITE_SUPABASE_ANON_KEY: "anon-key" });
  assert.equal(env.modelProxyUrl, "https://proj.supabase.co/functions/v1/ten-model-proxy");
});

test("readEnv: an explicit VITE_MODEL_PROXY_URL wins over the derived default", () => {
  const env = readEnv({
    VITE_SUPABASE_URL: "https://proj.supabase.co",
    VITE_SUPABASE_ANON_KEY: "anon-key",
    VITE_MODEL_PROXY_URL: "https://custom.example/proxy",
  });
  assert.equal(env.modelProxyUrl, "https://custom.example/proxy");
});

test("readEnv: strips a trailing slash from the Supabase URL", () => {
  const env = readEnv({ VITE_SUPABASE_URL: "https://proj.supabase.co/", VITE_SUPABASE_ANON_KEY: "anon-key" });
  assert.equal(env.supabaseUrl, "https://proj.supabase.co");
  assert.equal(env.modelProxyUrl, "https://proj.supabase.co/functions/v1/ten-model-proxy");
});

test("defaultModelProxyUrl: exact shape", () => {
  assert.equal(defaultModelProxyUrl("https://proj.supabase.co"), "https://proj.supabase.co/functions/v1/ten-model-proxy");
});

test("hasTenEnv: true only once the required vars are present", () => {
  assert.equal(hasTenEnv({}), false);
  assert.equal(hasTenEnv({ VITE_SUPABASE_URL: "https://proj.supabase.co", VITE_SUPABASE_ANON_KEY: "k" }), true);
});
