// Tester-owned: docs/design-web-agent.md § 13.2 (the site's model is a
// setting; approved § 13.6) — § 13.5 (vii) readEnv, and the bodies the
// BROWSER sends: the chat request through the real OpenRouter provider
// (createCoachModel) and the web-search request (createWebSearch). Written
// from the spec, not the code.
// Run: node --test tests/web/coach-model-site.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { MissingEnvError, readEnv } from "../../apps/web/src/backend/env.ts";
import { createCoachModel } from "../../apps/web/src/backend/model.ts";
import { createWebSearch } from "../../apps/web/src/backend/web-search.ts";
import { COACH_MODELS } from "../../apps/web/src/backend/coach-model.ts";

const CLAUDE = "anthropic/claude-sonnet-5";
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";
const BASE = { VITE_SUPABASE_URL: "https://proj.supabase.co", VITE_SUPABASE_ANON_KEY: "anon", VITE_SITE_URL: "https://ten.example.com" };

// ------------------------------------------------------------------ (vii) readEnv

test("§ 13.5 (vii): VITE_COACH_MODEL unset, empty or blank -> Claude (a missing setting never changes the model)", () => {
  for (const v of [undefined, "", "   ", "\t\n"]) {
    const env = readEnv({ ...BASE, ...(v === undefined ? {} : { VITE_COACH_MODEL: v }) });
    assert.equal(env.coachModel.id, CLAUDE, JSON.stringify(v));
    assert.equal(env.coachModel.name, "Claude Sonnet 5");
  }
});

test("§ 13.5 (vii): each id, with spaces around it, gives that id; DeepSeek's name carries '(testing)'", () => {
  assert.equal(readEnv({ ...BASE, VITE_COACH_MODEL: `  ${CLAUDE}  ` }).coachModel.id, CLAUDE);
  const ds = readEnv({ ...BASE, VITE_COACH_MODEL: ` ${DEEPSEEK}\n` }).coachModel;
  assert.equal(ds.id, DEEPSEEK);
  assert.equal(ds.name, "DeepSeek V4.1 Flash (testing)");
});

test("§ 13.5 (vii): a typo, a suffix, another case or another model -> the config error naming VITE_COACH_MODEL (never a silent fallback)", () => {
  for (const v of ["deepseek/deepseek-v4.1-flsh", "anthropic/claude-sonnet-5:online", "DeepSeek/deepseek-v4.1-flash", "deepseek/deepseek-v4-pro", "claude"]) {
    assert.throws(
      () => readEnv({ ...BASE, VITE_COACH_MODEL: v }),
      (e: any) => e instanceof MissingEnvError && e.missing.includes("VITE_COACH_MODEL"),
      v,
    );
  }
});

test("§ 13.2: the site's list is exactly the two ids with the § 13.3 names, Claude first", () => {
  assert.deepEqual(COACH_MODELS.map((m) => [m.id, m.name]), [[CLAUDE, "Claude Sonnet 5"], [DEEPSEEK, "DeepSeek V4.1 Flash (testing)"]]);
});

// ------------------------------------------------------------------ what the browser sends

function capture() {
  const bodies: any[] = [];
  const fetchImpl = (async (_url: any, init?: any) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response('data: {"id":"g","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

for (const id of [CLAUDE, DEEPSEEK]) {
  test(`§ 13.2/§ 13.5 (vii): the chat request names ${id} and carries no cache_control (the proxy owns it)`, async () => {
    const { bodies, fetchImpl } = capture();
    const model: any = createCoachModel({ proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy", getAccessToken: async () => "jwt", fetchImpl, modelId: id } as any);
    assert.equal(model.modelId, id, "the LanguageModel's own id (what packages/agent prices by)");
    const r = await model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
    const reader = r.stream.getReader();
    while (!(await reader.read()).done) {}
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].model, id);
    assert.ok(!("cache_control" in bodies[0]), `no top-level cache_control: ${JSON.stringify(bodies[0]).slice(0, 300)}`);
    assert.ok(!JSON.stringify(bodies[0]).includes("cache_control"), "none anywhere in the client's body");
  });

  test(`§ 13.2/§ 13.5 (vii): the web-search request names ${id} and carries no cache_control`, async () => {
    const { bodies, fetchImpl } = capture();
    const search = createWebSearch({ proxyUrl: "https://proj.supabase.co/functions/v1/ten-model-proxy", getAccessToken: async () => "jwt", fetchImpl, defaultUsd: 0.047, modelId: id } as any);
    await search({ query: "acme funding" } as any).catch(() => {});
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].model, id);
    assert.ok(!JSON.stringify(bodies[0]).includes("cache_control"));
  });
}
