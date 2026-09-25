import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultModelProxyUrl, hasTenEnv, MissingEnvError, readEnv } from "./env.ts";
import { CLAUDE_COACH_MODEL, DEEPSEEK_COACH_MODEL } from "./coach-model.ts";

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

// -------------------------------------------------- § 13.2: VITE_COACH_MODEL ----

test("readEnv: VITE_COACH_MODEL unset or blank -> Claude (never a silent fallback to something else)", () => {
  assert.deepEqual(readEnv(BASE).coachModel, CLAUDE_COACH_MODEL);
  assert.deepEqual(readEnv({ ...BASE, VITE_COACH_MODEL: "" }).coachModel, CLAUDE_COACH_MODEL);
  assert.deepEqual(readEnv({ ...BASE, VITE_COACH_MODEL: "   " }).coachModel, CLAUDE_COACH_MODEL);
});

test("readEnv: VITE_COACH_MODEL set to either exact id (optionally with surrounding spaces) resolves that model", () => {
  assert.deepEqual(readEnv({ ...BASE, VITE_COACH_MODEL: CLAUDE_COACH_MODEL.id }).coachModel, CLAUDE_COACH_MODEL);
  assert.deepEqual(readEnv({ ...BASE, VITE_COACH_MODEL: DEEPSEEK_COACH_MODEL.id }).coachModel, DEEPSEEK_COACH_MODEL);
  assert.deepEqual(readEnv({ ...BASE, VITE_COACH_MODEL: ` ${DEEPSEEK_COACH_MODEL.id} ` }).coachModel, DEEPSEEK_COACH_MODEL);
});

test("readEnv: an unrecognized VITE_COACH_MODEL fails the same way a missing required var does — never a silent fallback", () => {
  for (const bad of ["deepseek/deepseek-v4.1-flsh", "anthropic/claude-sonnet-5:online", "openai/gpt-4o", "DeepSeek/deepseek-v4.1-flash"]) {
    try {
      readEnv({ ...BASE, VITE_COACH_MODEL: bad });
      assert.fail(`expected MissingEnvError for VITE_COACH_MODEL=${bad}`);
    } catch (e) {
      assert.ok(e instanceof MissingEnvError, bad);
      assert.deepEqual((e as InstanceType<typeof MissingEnvError>).missing, ["VITE_COACH_MODEL"], bad);
    }
  }
});

test("readEnv: an unrecognized VITE_COACH_MODEL is reported ALONGSIDE other missing vars, not instead of them", () => {
  try {
    readEnv({ VITE_COACH_MODEL: "not-a-model" });
    assert.fail("expected MissingEnvError");
  } catch (e) {
    assert.ok(e instanceof MissingEnvError);
    assert.deepEqual((e as InstanceType<typeof MissingEnvError>).missing, [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_ANON_KEY",
      "VITE_SITE_URL",
      "VITE_COACH_MODEL",
    ]);
  }
});
