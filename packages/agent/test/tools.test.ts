// § 4 — unit tests per tool against the in-memory store and a stubbed
// fetch; fetch_job refuses other hosts; a bash write-back then a
// write_file on the same path succeeds; a bash refusal names the file.
import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { CardBuilder } from "../src/cards.ts";
import { VersionTracker } from "../src/tools/version-tracker.ts";
import { createTools, type ToolContext } from "../src/tools/index.ts";
import type { Deps } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function fakeWriter() {
  const written: any[] = [];
  return { written, write: (chunk: any) => written.push(chunk) } as any;
}

async function makeCtx(overrides: Partial<Deps> = {}) {
  const skills = await loadRealSkillBundle();
  const writer = fakeWriter();
  const deps: Deps = {
    model: {} as any,
    workspace: overrides.workspace ?? createInMemoryWorkspaceStore(),
    skills,
    gate: overrides.gate ?? ({ open: async () => {}, decide: async () => {}, pending: async () => null, expireOtherChats: async () => {} } as any),
    balance: overrides.balance ?? (async () => 5),
    fetch: overrides.fetch ?? (globalThis.fetch as any),
    clock: overrides.clock ?? { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts: overrides.scripts ?? createFakeScriptRunner([]),
    limits: overrides.limits,
    webSearch: overrides.webSearch,
    checkLanguage: overrides.checkLanguage,
  };
  const ctx: ToolContext = {
    chatId: "chat-1",
    writer,
    versionTracker: new VersionTracker(),
    cardBuilder: new CardBuilder(),
    turnState: { measuredSteps: [], spentSoFarUsd: 0 },
    gateGrammarMd: skills["skills/coach/references/gate-grammar.md"],
    idFor: () => "gate-1",
  };
  return { deps, ctx, writer, tools: createTools(deps, ctx) };
}

test("read_file: workspace path tracks its version", async () => {
  const workspace = createInMemoryWorkspaceStore({ "plan.md": "Goal: x" });
  const { tools, ctx } = await makeCtx({ workspace });
  const out: any = await (tools.read_file.execute as any)({ path: "plan.md" }, {});
  assert.equal(out.content, "Goal: x");
  assert.ok(ctx.versionTracker.has("plan.md"));
});

test("read_file: a skills/ path reads from the bundle, readOnly true", async () => {
  const { tools } = await makeCtx();
  const out: any = await (tools.read_file.execute as any)({ path: "skills/coach/SKILL.md" }, {});
  assert.equal(out.readOnly, true);
  assert.ok(out.content.includes("Coach"));
});

test("write_file: create (never seen, doesn't exist) succeeds", async () => {
  const { tools } = await makeCtx();
  const out: any = await (tools.write_file.execute as any)({ path: "notes.md", content: "hi" }, {});
  assert.deepEqual(out, { path: "notes.md", written: true });
});

test("write_file: an existing file the chat has never seen returns read_first", async () => {
  const workspace = createInMemoryWorkspaceStore({ "plan.md": "Goal: x" });
  const { tools } = await makeCtx({ workspace });
  const out: any = await (tools.write_file.execute as any)({ path: "plan.md", content: "Goal: y" }, {});
  assert.equal(out.error.code, "read_first");
});

test("write_file: after read_file, a write succeeds and re-write with a stale version conflicts", async () => {
  const workspace = createInMemoryWorkspaceStore({ "plan.md": "Goal: x" });
  const { tools, ctx } = await makeCtx({ workspace });
  await (tools.read_file.execute as any)({ path: "plan.md" }, {});
  const ok: any = await (tools.write_file.execute as any)({ path: "plan.md", content: "Goal: y" }, {});
  assert.equal(ok.written, true);

  // simulate a concurrent external write that the version tracker doesn't know about
  const info = await workspace.read("plan.md");
  await workspace.write("plan.md", "Goal: z (someone else)", info.version);

  ctx.versionTracker.record("plan.md", info.version); // tracker still holds the now-stale version
  const conflict: any = await (tools.write_file.execute as any)({ path: "plan.md", content: "Goal: mine" }, {});
  assert.equal(conflict.error.code, "version_conflict");
  assert.equal(ctx.versionTracker.has("plan.md"), false, "a conflict makes the model re-read");
});

test("write_file: CLAUDE.md and skills/ are refused (not_editable)", async () => {
  const workspace = createInMemoryWorkspaceStore({ "CLAUDE.md": "guardrails" });
  const { tools, ctx } = await makeCtx({ workspace });
  await (tools.read_file.execute as any)({ path: "CLAUDE.md" }, {});
  const out: any = await (tools.write_file.execute as any)({ path: "CLAUDE.md", content: "hacked" }, {});
  assert.equal(out.error.code, "not_editable");
});

test("fetch_job: a supported Greenhouse URL is fetched and saved when saveTo is set", async () => {
  const calls: string[] = [];
  const fetchStub = (async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ title: "Staff PM", company_name: "Acme", location: { name: "Remote (US)" }, content: "<p>Own the roadmap.</p>" }),
    } as any;
  }) as typeof fetch;
  const workspace = createInMemoryWorkspaceStore();
  const { tools } = await makeCtx({ workspace, fetch: fetchStub });
  const out: any = await (tools.fetch_job.execute as any)(
    { url: "https://boards.greenhouse.io/acme/jobs/4102938", saveTo: "jd-inbox/acme.md" },
    {},
  );
  assert.equal(out.board, "greenhouse");
  assert.equal(out.company, "Acme");
  assert.equal(out.title, "Staff PM");
  assert.equal(out.savedTo, "jd-inbox/acme.md");
  assert.equal(calls[0], "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4102938");
  const saved = await workspace.read("jd-inbox/acme.md");
  assert.ok(!saved.binary && saved.content.includes("Own the roadmap."));
});

test("fetch_job: refuses a URL from a host that isn't one of the four boards", async () => {
  const { tools } = await makeCtx();
  const out: any = await (tools.fetch_job.execute as any)({ url: "https://example.com/careers/123" }, {});
  assert.equal(out.error.code, "unsupported_url");
});

test("fetch_job: a Greenhouse-shaped host but wrong path also refuses", async () => {
  const { tools } = await makeCtx();
  const out: any = await (tools.fetch_job.execute as any)({ url: "https://boards.greenhouse.io/acme/careers" }, {});
  assert.equal(out.error.code, "unsupported_url");
});

test("estimate_cost: under the threshold does not open a gate, but always emits a cost card (M5)", async () => {
  const { tools, writer } = await makeCtx({ limits: { spendGateUsd: 1 } });
  const out: any = await (tools.estimate_cost.execute as any)({ action: "read a file", steps: 1, webSearches: 0 }, {});
  assert.equal(out.needsGate, false);
  assert.deepEqual(
    writer.written.map((w: any) => w.type),
    ["data-card"],
  );
  assert.equal(writer.written[0].data.card, "cost");
});

test("estimate_cost: over the threshold opens a gate and ends with a data-gate + pending status + cost card", async () => {
  const opened: any[] = [];
  const gate = {
    open: async (req: any) => opened.push(req),
    decide: async () => {},
    pending: async () => null,
    expireOtherChats: async () => {},
  };
  const { tools, writer } = await makeCtx({ gate: gate as any, limits: { spendGateUsd: 1 } });
  const out: any = await (tools.estimate_cost.execute as any)(
    { action: "evaluate 6 roles", steps: 500, webSearches: 6, items: ["Acme — Staff PM"] },
    {},
  );
  assert.equal(out.needsGate, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].label, "evaluate 6 roles");
  assert.equal(opened[0].amountUsd, out.highUsd, "amountUsd is the raw highUsd, no drift");
  // L2: the gate LINE's shown dollar amount rounds UP to the cent —
  // never the stored amountUsd/highUsd themselves (kept raw above so
  // "just under/over the threshold" math stays exact elsewhere).
  const roundedUp = Math.ceil(out.highUsd * 100) / 100;
  assert.equal(opened[0].gateLine, `This costs up to $${roundedUp.toFixed(2)} — nothing starts until you say yes.`);
  const kinds = writer.written.map((w: any) => w.type);
  assert.deepEqual(kinds, ["data-gate", "data-gate-status", "data-card"]);
  assert.equal(writer.written[1].data.status, "pending");
  assert.equal(writer.written[2].data.card, "cost");
});

test("estimate_cost: action over 6 words is a tool_error, no gate call", async () => {
  const { tools, writer } = await makeCtx();
  const out: any = await (tools.estimate_cost.execute as any)(
    { action: "one two three four five six seven", steps: 1, webSearches: 0 },
    {},
  );
  assert.equal(out.error.code, "tool_error");
  assert.equal(writer.written.length, 0);
});

test("bash: a write-back, then a write_file on the SAME path, succeeds", async () => {
  const workspace = createInMemoryWorkspaceStore({ "jobs.md": "# Pipeline\n" });
  const scripts = createFakeScriptRunner([
    {
      name: "record_verdict.py",
      run: () => ({
        result: { stdout: "recorded", stderr: "", exitCode: 0 },
        changedFiles: { "jobs.md": "# Pipeline\n\n### Acme — Staff PM\n- Verdict: strong\n" },
      }),
    },
  ]);
  const { tools, ctx } = await makeCtx({ workspace, scripts });
  const bashOut: any = await (tools.bash.execute as any)(
    { command: "python3 evaluate/scripts/record_verdict.py --company Acme --title \"Staff PM\" --verdict strong" },
    {},
  );
  assert.equal(bashOut.exitCode, 0);
  assert.deepEqual(bashOut.changed, ["jobs.md"]);
  assert.ok(ctx.versionTracker.has("jobs.md"));

  const writeOut: any = await (tools.write_file.execute as any)({ path: "jobs.md", content: "# Pipeline\n\nedited\n" }, {});
  assert.deepEqual(writeOut, { path: "jobs.md", written: true });
});

test("bash: a refused write-back (skills/) fails the command with exit 1 and names the file", async () => {
  const workspace = createInMemoryWorkspaceStore();
  const scripts = createFakeScriptRunner([
    {
      name: "evil.py",
      run: () => ({
        result: { stdout: "", stderr: "", exitCode: 0 },
        changedFiles: { "skills/apply/SKILL.md": "hacked" },
      }),
    },
  ]);
  const { tools } = await makeCtx({ workspace, scripts });
  const out: any = await (tools.bash.execute as any)({ command: "python3 evil.py" }, {});
  assert.equal(out.exitCode, 1);
  assert.ok(out.stderr.includes("skills/apply/SKILL.md"), out.stderr);
});

test("bash: an unrecognized command exits 127 with 'not available in the web app: <name>'", async () => {
  const { tools } = await makeCtx();
  const out: any = await (tools.bash.execute as any)({ command: "python3 skills/no/such/script.py" }, {});
  assert.equal(out.exitCode, 127);
  assert.match(out.stderr, /not available in the web app: script\.py/);
});

test("load_skill: returns SKILL.md with its bundle path", async () => {
  const { tools } = await makeCtx();
  const out: any = await (tools.load_skill.execute as any)({ name: "apply" }, {});
  assert.equal(out.path, "skills/apply/SKILL.md");
  assert.ok(out.content.startsWith("---"));
});

test("check_language: uses deps.checkLanguage when injected (test/production seam)", async () => {
  const calls: any[] = [];
  const checkLanguage = async (input: any) => {
    calls.push(input);
    return { report: "clean", usd: 0.015 };
  };
  const { tools } = await makeCtx({ checkLanguage } as any);
  const out: any = await (tools.check_language.execute as any)({ files: ["applications/r.md"] }, {});
  assert.deepEqual(out, { report: "clean", usd: 0.015 });
  assert.deepEqual(calls[0], { files: ["applications/r.md"] });
});

test("check_language: default is a FRESH-CONTEXT model call using only language-check.md + the files, no chat history", async () => {
  const { MockLanguageModelV4, simulateReadableStream } = await import("ai/test");
  const calls: any[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: (async (options: any) => {
      calls.push(options);
      return {
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
        content: [{ type: "text", text: "clean, no hazards found" }],
        warnings: [],
      };
    }) as any,
  });
  const workspace = createInMemoryWorkspaceStore({ "applications/r.md": "I led the migration." });
  const { deps, ctx } = await makeCtx({ workspace });
  (deps as any).model = model;
  const tools = createTools(deps, ctx);
  const out: any = await (tools.check_language.execute as any)({ files: ["applications/r.md"] }, {});
  assert.equal(out.report, "clean, no hazards found");
  assert.equal(calls.length, 1, "exactly one fresh model call, no multi-turn context");
  assert.equal(calls[0].prompt[0].role, "system");
  assert.ok(calls[0].prompt[0].content.includes("Never-say"), "the system message is language-check.md's own instructions");
  assert.ok(calls[0].prompt[1].content[0].text.includes("I led the migration."));
});
