// Tester-owned (S2, design-web-search.md § 4.1, § 4.2, § 4.7, § 4.8, § 9 S2
// "Tester checks"). Derived from the spec, not from the coder's tests.
// Every board answer is a stub; no live network call.
//
// Run: node --test tests/agent/search-s2.test.ts
import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { CardBuilder, VersionTracker, createTools } from "../../packages/agent/src/index.ts";
import { createCoach } from "../../packages/agent/src/coach.ts";
import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { createFakeScriptRunner } from "../../packages/agent/src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import * as jm from "../../skills/search/scripts/lib/jobs-md.mjs";
import { dataChunks, realBundle, recordingGate, runTurn, scriptedModel, textStep, toolStep, user } from "./_support.ts";

// ------------------------------------------------------------------ helpers

const NOW = new Date("2026-09-28T12:00:00Z");
const BUNDLE = realBundle();

function json(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null) },
    json: async () => body,
  };
}

/** A fetch stub keyed by exact-prefix; records every (url, init). */
function stubFetch(routes: Array<[string, (url: string, init: any) => any]>) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    for (const [prefix, make] of routes) if (url.startsWith(prefix)) return make(url, init);
    throw new TypeError(`unstubbed fetch: ${url}`);
  };
  return { fn, calls };
}

function toolsFor(store: any, fetchFn: any, o: { estimated?: boolean; approved?: boolean; now?: Date } = {}) {
  const ctx: any = {
    chatId: "c1",
    writer: { write: () => {}, merge: () => {} },
    versionTracker: new VersionTracker(),
    cardBuilder: new CardBuilder(),
    turnState: { measuredSteps: [], spentSoFarUsd: 0, estimateCostRanThisTurn: o.estimated ?? true },
    gateGrammarMd: BUNDLE["skills/coach/references/gate-grammar.md"],
    idFor: () => crypto.randomUUID(),
    turnStartedByApprovedGate: o.approved ?? false,
  };
  const deps: any = {
    workspace: store,
    skills: BUNDLE,
    gate: createInMemoryGate(),
    balance: async () => 5,
    fetch: fetchFn,
    clock: { now: () => o.now ?? NOW },
    scripts: createFakeScriptRunner([]),
  };
  const tools: any = createTools(deps, ctx);
  return { tools, ctx, call: (n: string, input: any) => tools[n].execute(input, { toolCallId: "x", messages: [] }) };
}

async function readText(store: any, p: string): Promise<string> {
  const r = await store.read(p);
  assert.ok(!r.binary);
  return r.content;
}

async function rowsOf(text: string): Promise<any[]> {
  const io = { exists: async () => true, readFile: async () => text };
  return jm.load(io as any, "");
}

function jobsMd(sections: Record<string, string[][]>): string {
  // sections: { "To Review": [["Acme — Engineer", "- URL: x", ...], ...] }
  const out = ["# Pipeline", "", "**Active: 0** · dismissed: 0 · updated 2026-09-01", ""];
  for (const [name, rows] of Object.entries(sections)) {
    out.push(`## ${name}`, "");
    for (const [head, ...fields] of rows) out.push(`### ${head}`, ...fields, "");
  }
  return out.join("\n");
}

const GH_API = "https://boards-api.greenhouse.io/v1/boards/";
const ghJob = (id: number, title: string, extra: any = {}) => ({
  id,
  title,
  location: { name: "Berlin" },
  absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
  company_name: "Acme, Inc.",
  first_published: "2026-09-20T10:00:00-04:00",
  content: "&lt;p&gt;Build &amp; ship&lt;/p&gt;",
  ...extra,
});

// ================================================================== § 4.8 B5 — input checks, one per rule, no fetch

const LB_OK = { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }] };
const AR_OK = { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/1", company: "Acme" }] };
const long = "x".repeat(101);

const BAD_INPUTS: Array<[string, "list_board" | "add_roles", any]> = [
  ["boards 0", "list_board", { boards: [] }],
  ["boards 11", "list_board", { boards: Array.from({ length: 11 }, (_, i) => ({ url: `https://boards.greenhouse.io/c${i}`, company: `C${i}` })) }],
  ["boards missing", "list_board", {}],
  ["boards not array", "list_board", { boards: "https://boards.greenhouse.io/acme" }],
  ["titleWords 13", "list_board", { ...LB_OK, titleWords: Array.from({ length: 13 }, (_, i) => `w${i}`) }],
  ["title word of 5 words", "list_board", { ...LB_OK, titleWords: ["a b c d e"] }],
  ["title word not a string", "list_board", { ...LB_OK, titleWords: [42] }],
  ["postedWithinDays 0", "list_board", { ...LB_OK, postedWithinDays: 0 }],
  ["postedWithinDays 366", "list_board", { ...LB_OK, postedWithinDays: 366 }],
  ["postedWithinDays 1.5", "list_board", { ...LB_OK, postedWithinDays: 1.5 }],
  ["postedWithinDays string", "list_board", { ...LB_OK, postedWithinDays: "30" }],
  ["company empty", "list_board", { boards: [{ url: "https://boards.greenhouse.io/acme", company: "" }] }],
  ["company 101 chars", "list_board", { boards: [{ url: "https://boards.greenhouse.io/acme", company: long }] }],
  ["company not a string", "list_board", { boards: [{ url: "https://boards.greenhouse.io/acme", company: 7 }] }],
  ["url not a string", "list_board", { boards: [{ url: 7, company: "Acme" }] }],
  ["unknown top-level key", "list_board", { ...LB_OK, limit: 5 }],
  ["unknown board key", "list_board", { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme", title: "x" }] }],
  ["roles 0", "add_roles", { roles: [] }],
  ["roles 21", "add_roles", { roles: Array.from({ length: 21 }, (_, i) => ({ posting: `https://boards.greenhouse.io/acme/jobs/${i}`, company: "Acme" })) }],
  ["posting not a string", "add_roles", { roles: [{ posting: 1, company: "Acme" }] }],
  ["role company empty", "add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/1", company: "  " }] }],
  ["role company 101 chars", "add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/1", company: long }] }],
  ["role title key (the model may not type a title)", "add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/1", company: "Acme", title: "Made Up" }] }],
  ["role url/location keys", "add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/1", company: "Acme", location: "Mars" }] }],
  ["unknown top-level key (add)", "add_roles", { ...AR_OK, stage: "Offer" }],
];

for (const [name, tool, input] of BAD_INPUTS) {
  test(`§ 4.8 B5: ${tool} ${name} → tool_error, no fetch, nothing written`, async () => {
    const store = createInMemoryWorkspaceStore();
    const f = stubFetch([]);
    const { call } = toolsFor(store, f.fn);
    const out = await call(tool, input);
    assert.equal(out?.error?.code, "tool_error", JSON.stringify(out));
    assert.equal(typeof out.error.message, "string");
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await store.list(), []);
  });
}

test("§ 4.8 B5 control: the valid boundary inputs pass the checks (10 boards, 12 words of 4 words, days 1 and 365, company 100 chars)", async () => {
  const f = stubFetch([[GH_API, () => json({ jobs: [] })]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const boards = Array.from({ length: 10 }, (_, i) => ({ url: `https://boards.greenhouse.io/c${i}`, company: i === 0 ? "y".repeat(100) : `C${i}` }));
  for (const days of [1, 365]) {
    const out = await call("list_board", { boards, titleWords: Array.from({ length: 12 }, () => "a b c d"), postedWithinDays: days });
    assert.ok(!("error" in out), JSON.stringify(out));
    assert.equal(out.boards.length, 10);
  }
});

// ================================================================== § 4.7 M8 — estimate first

test("§ 4.7: list_board and add_roles refuse estimate_first before an estimate, with no fetch; go through after estimate_cost ran this turn", async () => {
  const store = createInMemoryWorkspaceStore();
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "Engineer")] })], [GH_API + "acme/jobs/1", () => json(ghJob(1, "Engineer"))]]);
  const { call } = toolsFor(store, f.fn, { estimated: false });
  for (const [t, input] of [["list_board", LB_OK], ["add_roles", AR_OK]] as const) {
    const out = await call(t, input);
    assert.deepEqual(out, { error: { code: "estimate_first", message: "Call estimate_cost for this run first." } });
  }
  assert.equal(f.calls.length, 0);
  const est = await call("estimate_cost", { action: "Read one board", steps: 3, webSearches: 0, items: ["Acme board"] });
  assert.ok(!("error" in est), JSON.stringify(est));
  const lb = await call("list_board", LB_OK);
  assert.equal(lb.boards[0].status, "ok");
  const ar = await call("add_roles", AR_OK);
  assert.equal(ar.added.length, 1, JSON.stringify(ar));
});

// ------------------------------------------------------------------ coach-level helpers

function coachWith(o: { model: any; fetch: any; files?: Record<string, string>; gate?: any }) {
  const workspace = createInMemoryWorkspaceStore(o.files ?? {});
  const coach = createCoach({
    model: o.model,
    workspace,
    skills: BUNDLE,
    gate: o.gate ?? createInMemoryGate(),
    balance: async () => 5,
    fetch: o.fetch,
    clock: { now: () => NOW },
    scripts: createFakeScriptRunner([]),
  } as any);
  return { coach, workspace };
}

function toolResultsIn(prompt: any[], toolName: string): any[] {
  const out: any[] = [];
  for (const m of prompt) {
    if (m.role !== "tool") continue;
    for (const p of m.content) if (p.type === "tool-result" && p.toolName === toolName) out.push(p);
  }
  return out;
}

test("§ 4.7: a turn started by a typed yes that approved a gate goes straight through (no estimate_cost that turn)", async () => {
  const BIG = { action: "Search 20 boards", steps: 500, webSearches: 4, items: ["Acme board"] };
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "Engineer")] })]]);
  const m = scriptedModel([
    toolStep([{ name: "estimate_cost", input: BIG }]),
    // turn 2 (after the typed yes): list_board with no estimate this turn
    toolStep([{ name: "list_board", input: LB_OK, id: "lb-1" }]),
    textStep("read it"),
  ]);
  const rg = recordingGate();
  const { coach } = coachWith({ model: m.model, fetch: f.fn, gate: rg.gate });
  const t1 = await runTurn(coach, "c1", [user("u1", "run the search")]);
  assert.equal(dataChunks(t1.chunks, "data-gate").length, 1, "the high estimate opened a gate");
  const t2 = await runTurn(coach, "c1", [user("u1", "run the search"), t1.message, user("u2", "yes")]);
  const lbPart = t2.message.parts.find((p: any) => p.type === "tool-list_board");
  assert.ok(lbPart, "list_board ran in turn 2");
  assert.ok(!("error" in lbPart.output), JSON.stringify(lbPart.output));
  assert.equal(lbPart.output.boards[0].status, "ok");
});

test("§ 4.7: the estimate is per turn — an estimate in turn 1 does not unlock list_board in a later plain turn", async () => {
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "Engineer")] })]]);
  const m = scriptedModel([
    toolStep([{ name: "estimate_cost", input: { action: "Read one board", steps: 3, webSearches: 0 } }]),
    toolStep([{ name: "list_board", input: LB_OK }]),
    textStep("done"),
    toolStep([{ name: "list_board", input: LB_OK }]),
    textStep("done again"),
  ]);
  const { coach } = coachWith({ model: m.model, fetch: f.fn });
  const t1 = await runTurn(coach, "c1", [user("u1", "read acme")]);
  const p1 = t1.message.parts.find((p: any) => p.type === "tool-list_board");
  assert.equal(p1.output.boards[0].status, "ok");
  const t2 = await runTurn(coach, "c1", [user("u1", "read acme"), t1.message, user("u2", "again please")]);
  const p2 = t2.message.parts.find((p: any) => p.type === "tool-list_board");
  assert.equal(p2.output?.error?.code, "estimate_first", JSON.stringify(p2.output));
});

// ================================================================== § 4.1 M3 — the model reads the compact form, turn 2 included

test("§ 4.1 M3 (the named S2 test): the model's prompt carries list_board's compact text, not JSON — later in the turn AND replayed in turn 2", async () => {
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "Forward Deployed Engineer"), ghJob(2, "Recruiter")] })]]);
  const m = scriptedModel([
    toolStep([{ name: "estimate_cost", input: { action: "Read one board", steps: 3, webSearches: 0 } }]),
    toolStep([{ name: "list_board", input: { ...LB_OK, titleWords: ["engineer"] } }]),
    textStep("one match"),
    textStep("turn two answer"),
  ]);
  const { coach } = coachWith({ model: m.model, fetch: f.fn });
  const t1 = await runTurn(coach, "c1", [user("u1", "read acme")]);
  // The UI message keeps the full output (for the card and the "ran" line).
  const ui = t1.message.parts.find((p: any) => p.type === "tool-list_board");
  assert.equal(ui.output.boards[0].matched, 1);
  assert.equal(typeof ui.output.requestsLeftThisTurn, "number");

  const check = (prompt: any[], where: string) => {
    const results = toolResultsIn(prompt, "list_board");
    assert.equal(results.length, 1, `${where}: one list_board result in the prompt`);
    const o = results[0].output;
    assert.equal(o.type, "text", `${where}: the model got ${o.type}, want text`);
    // Lead ruling, 2026-09-28 (S2 review): M3's compact line now carries
    // `board name <boardName>` (the model is told to check it) — updated
    // here per the coordinator's explicit go-ahead for this one test.
    assert.ok(o.value.includes("Acme · board name Acme, Inc. · ok · 2 postings · 1 match · 0 already on the list · showing 1"), `${where}: ${o.value}`);
    assert.ok(o.value.includes("https://job-boards.greenhouse.io/acme/jobs/1 | Forward Deployed Engineer | Berlin | 2026-09-20"), `${where}: ${o.value}`);
    assert.ok(!o.value.includes("requestsLeftThisTurn") && !o.value.trim().startsWith("{"), `${where}: JSON leaked`);
  };
  check(m.calls[2].prompt, "turn 1, step 3");
  await runTurn(coach, "c1", [user("u1", "read acme"), t1.message, user("u2", "thanks")]);
  check(m.calls[3].prompt, "turn 2 (replayed history)");
});

test("§ 4.1 M3: a partial read's compact line says 'read 300 of N'", async () => {
  const SR = "https://api.smartrecruiters.com/v1/companies/bigco/postings";
  const f = stubFetch([[SR, (url) => {
    const off = Number(new URL(url).searchParams.get("offset"));
    return json({ totalFound: 1200, content: Array.from({ length: 100 }, (_, i) => ({ id: String(700000 + off + i), name: `Role ${off + i}`, company: { name: "BigCo", identifier: "bigco" }, location: { city: "Austin" }, releasedDate: "2026-09-20T00:00:00Z" })) });
  }]]);
  const { tools, call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const out = await call("list_board", { boards: [{ url: "https://jobs.smartrecruiters.com/bigco", company: "BigCo" }] });
  const text = tools.list_board.toModelOutput({ output: out, toolCallId: "x", input: {} }).value;
  assert.ok(/BigCo · ok · 1200 postings · 300 match .*read 300 of 1200/.test(text), text);
});

// ================================================================== § 4.1 — filters, dedupe, caps, SR, gone, failure statuses (web path)

test("§ 4.1: the word-filter table through list_board (hyphen, comma, slash, case, 'eng' ≠ 'engineer', multi-word phrase)", async () => {
  const titles = ["Forward-Deployed Engineer", "VP, Engineering", "Data/ML Lead", "SENIOR ENGINEER", "Engineering Manager", "Eng Lead", "Sales Engineer II"];
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: titles.map((t, i) => ghJob(i + 1, t)) })]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const run = async (words: string[]) => (await call("list_board", { ...LB_OK, titleWords: words })).boards[0].postings.map((p: any) => p.title).sort();
  assert.deepEqual(await run(["deployed"]), ["Forward-Deployed Engineer"]);
  assert.deepEqual(await run(["vp engineering"]), ["VP, Engineering"]);
  assert.deepEqual(await run(["ml"]), ["Data/ML Lead"]);
  assert.deepEqual(await run(["engineer"]), ["Forward-Deployed Engineer", "SENIOR ENGINEER", "Sales Engineer II"]);
  assert.deepEqual(await run(["eng"]), ["Eng Lead"]);
  assert.deepEqual(await run(["forward deployed"]), ["Forward-Deployed Engineer"]);
  assert.equal((await run([])).length, titles.length, "no words keeps every title");
});

test("§ 4.1: posting age — only a KNOWN date older than the limit is dropped (missing and unparseable dates kept)", async () => {
  const jobs = [ghJob(1, "Old", { first_published: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }), ghJob(2, "New", { first_published: "2026-09-27T00:00:00Z" }), ghJob(3, "Undated", { first_published: null, updated_at: null })];
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs })]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const b = (await call("list_board", { ...LB_OK, postedWithinDays: 30 })).boards[0];
  assert.deepEqual(b.postings.map((p: any) => p.title).sort(), ["New", "Undated"]);
  assert.equal(b.matched, 2);
  assert.equal(b.total, 3);
});

test("§ 4.1: dedupe by link (hosted or application), by key, and a dismissed row — counted in alreadyInJobList, not shown", async () => {
  const md = jobsMd({
    "To Review": [["Acme — Old Title Of Job 1", "- URL: https://job-boards.greenhouse.io/acme/jobs/1"]],
    Dismissed: [["Acme Inc — Data Analyst", "- URL: https://elsewhere.example/x", "- Was: To Review"]],
  });
  const jobs = [ghJob(1, "Retitled Job 1"), ghJob(2, "Data Analyst"), ghJob(3, "Fresh Role")];
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs })]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore({ "jobs.md": md }), f.fn);
  const b = (await call("list_board", LB_OK)).boards[0];
  assert.equal(b.matched, 3);
  assert.equal(b.alreadyInJobList, 2);
  assert.deepEqual(b.postings.map((p: any) => p.title), ["Fresh Role"]);
});

test("§ 4.1: 'a posting whose link (the hosted address OR the board's application link) … matches any row' — a row saved with the Lever apply link is already on the list, and is not gone", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const hosted = `https://jobs.lever.co/leverco/${id}`;
  const md = jobsMd({ "To Review": [["Leverco — Old Title", `- URL: ${hosted}/apply`]] });
  const f = stubFetch([["https://api.lever.co/v0/postings/leverco", () => json([{ id, text: "Renamed Role", categories: { location: "NYC" }, hostedUrl: hosted, applyUrl: `${hosted}/apply`, createdAt: Date.parse("2026-09-20T00:00:00Z"), descriptionPlain: "x" }])]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore({ "jobs.md": md }), f.fn);
  const b = (await call("list_board", { boards: [{ url: "https://jobs.lever.co/leverco", company: "Leverco" }] })).boards[0];
  assert.equal(b.alreadyInJobList, 1, JSON.stringify(b));
  assert.deepEqual(b.gone, []);
});

test("§ 4.1: caps — 40 per board, 120 per call across boards, `matched` intact", async () => {
  const f = stubFetch([[GH_API, (url) => {
    const slug = url.slice(GH_API.length).split("/")[0];
    return json({ jobs: Array.from({ length: 50 }, (_, i) => ({ ...ghJob(i + 1, `${slug} Role ${i}`), absolute_url: `https://boards.greenhouse.io/${slug}/jobs/${i + 1}` })) });
  }]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const boards = ["a1", "a2", "a3", "a4"].map((s) => ({ url: `https://boards.greenhouse.io/${s}`, company: s.toUpperCase() }));
  const out = await call("list_board", { boards });
  assert.deepEqual(out.boards.map((b: any) => b.matched), [50, 50, 50, 50]);
  assert.deepEqual(out.boards.map((b: any) => b.shown), [40, 40, 40, 0]);
  assert.deepEqual(out.boards.map((b: any) => b.postings.length), [40, 40, 40, 0]);
});

test("§ 4.1 / S2 tester check: SmartRecruiters unknown company (200, totalFound 0) is `empty`, never ok", async () => {
  const f = stubFetch([["https://api.smartrecruiters.com/v1/companies/nosuchco/postings", () => json({ offset: 0, limit: 100, totalFound: 0, content: [] })]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const b = (await call("list_board", { boards: [{ url: "https://jobs.smartrecruiters.com/nosuchco", company: "NoSuchCo" }] })).boards[0];
  assert.equal(b.status, "empty");
  assert.equal(b.total, 0);
  assert.equal(b.read, 0);
  assert.deepEqual(b.postings, []);
});

test("§ 4.1 / S2 tester check: SmartRecruiters 3 pages max → read 300 of 1200, and a partial read yields no `gone` at all", async () => {
  const SR = "https://api.smartrecruiters.com/v1/companies/bigco/postings";
  const f = stubFetch([[SR, (url) => {
    const off = Number(new URL(url).searchParams.get("offset"));
    return json({ totalFound: 1200, content: Array.from({ length: 100 }, (_, i) => ({ id: String(700000 + off + i), name: `Role ${off + i}`, company: { name: "BigCo", identifier: "bigco" }, location: { city: "Austin" } })) });
  }]]);
  const md = jobsMd({ "To Review": [["BigCo — A Role Not On The First 300", "- URL: https://jobs.smartrecruiters.com/bigco/1"]] });
  const { call } = toolsFor(createInMemoryWorkspaceStore({ "jobs.md": md }), f.fn);
  const out = await call("list_board", { boards: [{ url: "https://jobs.smartrecruiters.com/bigco", company: "BigCo" }] });
  const b = out.boards[0];
  assert.equal(f.calls.length, 3);
  assert.equal(b.status, "ok");
  assert.equal(b.total, 1200);
  assert.equal(b.read, 300);
  assert.deepEqual(b.gone, []);
  assert.equal(out.requestsLeftThisTurn, 57);
});

test("§ 4.1 gone: a same-company To Review row missing from a full read is gone; present-by-link under a retitle is not; other company, moved and dismissed rows never", async () => {
  const md = jobsMd({
    "To Review": [
      ["Acme — Vanished Role", "- URL: https://job-boards.greenhouse.io/acme/jobs/99"],
      ["ACME Inc. — Old Name", "- URL: https://job-boards.greenhouse.io/acme/jobs/1"],
      ["Beta Corp — Vanished Too", "- URL: https://job-boards.greenhouse.io/beta/jobs/5"],
    ],
    Interested: [["Acme — Candidate Moved This", "- URL: https://job-boards.greenhouse.io/acme/jobs/98", "- Was: To Review"]],
    Dismissed: [["Acme — Dismissed One", "- URL: https://job-boards.greenhouse.io/acme/jobs/97", "- Was: To Review"]],
  });
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "New Name For Job 1")] })]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore({ "jobs.md": md }), f.fn);
  const b = (await call("list_board", { ...LB_OK, titleWords: ["nothing-matches-this"] })).boards[0];
  assert.equal(b.matched, 0, "gone is computed on the full list, not the filtered one");
  assert.deepEqual(b.gone, [{ company: "Acme", title: "Vanished Role" }]);
});

test("§ 4.1 / § 4.8: every failure status through list_board, none throws — not_found, error (500), error (HTML), error (redirect), unsupported_url", async () => {
  const html = { ok: true, status: 200, headers: { get: () => "text/html; charset=utf-8" }, json: async () => { throw new SyntaxError("Unexpected token <"); }, text: async () => "<html>hi</html>" };
  const f = stubFetch([
    [GH_API + "gone/", () => json({ status: 404, error: "Job not found" }, 404)],
    [GH_API + "down/", () => json({}, 500)],
    [GH_API + "htmlco/", () => html],
    // real fetch with redirect:"error" rejects with a TypeError on a 3xx
    [GH_API + "moved/", (_u, init) => { if (init?.redirect === "error") throw new TypeError("fetch failed: unexpected redirect"); return json({ jobs: [] }); }],
  ]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const out = await call("list_board", {
    boards: [
      { url: "https://boards.greenhouse.io/gone", company: "Gone" },
      { url: "https://boards.greenhouse.io/down", company: "Down" },
      { url: "https://boards.greenhouse.io/htmlco", company: "Html" },
      { url: "https://boards.greenhouse.io/moved", company: "Moved" },
      { url: "https://careers.example.com/jobs", company: "Own Site" },
      { url: "https://acme.wd5.myworkdayjobs.com/External", company: "Workday Co" },
    ],
  });
  assert.deepEqual(out.boards.map((b: any) => b.status), ["not_found", "error", "error", "error", "unsupported_url", "unsupported_url"]);
  for (const c of f.calls) assert.equal(c.init?.redirect, "error", `redirect:"error" on ${c.url}`);
  assert.equal(f.calls.length, 4, "no fetch for an unsupported address");
});

test("§ 4.8: code fetches only addresses it builds, on the four API hosts — even when the model hands it a posting on a board", async () => {
  const f = stubFetch([
    [GH_API, () => json({ jobs: [] })],
    ["https://api.lever.co/v0/postings/", () => json([])],
    ["https://api.ashbyhq.com/posting-api/job-board/", () => json({ jobs: [] })],
    ["https://api.smartrecruiters.com/v1/companies/", () => json({ totalFound: 0, content: [] })],
  ]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  await call("list_board", {
    boards: [
      { url: "https://job-boards.greenhouse.io/acme/jobs/123?gh_src=evil.example", company: "A" },
      { url: "https://jobs.lever.co/acme", company: "B" },
      { url: "https://jobs.ashbyhq.com/acme", company: "C" },
      { url: "https://jobs.smartrecruiters.com/acme", company: "D" },
      { url: "https://boards.greenhouse.io/..%2F..%2Fevil", company: "E" },
      { url: "https://boards.greenhouse.io/a.b", company: "F" },
    ],
  });
  const hosts = new Set(f.calls.map((c) => new URL(c.url).host));
  assert.deepEqual([...hosts].sort(), ["api.ashbyhq.com", "api.lever.co", "api.smartrecruiters.com", "boards-api.greenhouse.io"]);
  assert.ok(f.calls.every((c) => !c.url.includes("evil")), JSON.stringify(f.calls.map((c) => c.url)));
});

// ================================================================== § 4.8 — the budget, concurrency, the 15 s timeout

test("§ 4.8 / S2 tester check (budget): 70 requested reads give 60 answers and 10 request_limit, shared across calls in the turn", async () => {
  const f = stubFetch([[GH_API, () => json({ jobs: [] })]]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn);
  const statuses: string[] = [];
  let left = -1;
  for (let c = 0; c < 7; c++) {
    const boards = Array.from({ length: 10 }, (_, i) => ({ url: `https://boards.greenhouse.io/b${c}x${i}`, company: `B${c}x${i}` }));
    const out = await call("list_board", { boards });
    statuses.push(...out.boards.map((b: any) => b.status));
    left = out.requestsLeftThisTurn;
  }
  assert.equal(f.calls.length, 60);
  assert.equal(statuses.filter((s) => s === "empty").length, 60);
  assert.equal(statuses.filter((s) => s === "request_limit").length, 10);
  assert.equal(left, 0);
  // add_roles and fetch_job share the same budget
  const ar = await call("add_roles", AR_OK);
  assert.deepEqual(ar.failed, [{ posting: AR_OK.roles[0].posting, reason: "request_limit" }]);
  const fj = await call("fetch_job", { url: "https://boards.greenhouse.io/acme/jobs/1" });
  assert.equal(fj?.error?.code, "request_limit");
  assert.equal(f.calls.length, 60);
});

test("§ 4.8: four requests at a time", async () => {
  let inFlight = 0;
  let peak = 0;
  const fn = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return json({ jobs: [] });
  };
  const { call } = toolsFor(createInMemoryWorkspaceStore(), fn);
  const boards = Array.from({ length: 10 }, (_, i) => ({ url: `https://boards.greenhouse.io/p${i}`, company: `P${i}` }));
  const out = await call("list_board", { boards });
  assert.equal(out.boards.length, 10);
  assert.equal(peak, 4, `peak concurrency ${peak}`);
});

async function flush(n = 20) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

test("§ 4.8 / S2 tester check (hanging board): a board that never answers is `error` at 15 s, not before, and the call returns", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let called!: () => void;
    const wasCalled = new Promise<void>((r) => (called = r));
    const hang = (_u: string, init: any) =>
      new Promise((_res, rej) => {
        called();
        init.signal.addEventListener("abort", () => rej(new DOMException("The operation was aborted.", "AbortError")));
      });
    const { call } = toolsFor(createInMemoryWorkspaceStore(), hang);
    let settled: any = null;
    const p = call("list_board", LB_OK).then((o: any) => (settled = o));
    await wasCalled;
    mock.timers.tick(14_999);
    await flush();
    assert.equal(settled, null, "not before 15 s");
    mock.timers.tick(1);
    await flush();
    await p;
    assert.equal(settled.boards[0].status, "error");
  } finally {
    mock.timers.reset();
  }
});

test("§ 4.8 (hanging board, body): a board that sends headers then never finishes the body is also `error` at 15 s", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let called!: () => void;
    const wasCalled = new Promise<void>((r) => (called = r));
    // Real fetch: the abort signal also aborts the body read. A body that
    // never finishes rejects only when the request's signal aborts.
    const stall = async (_u: string, init: any) => {
      called();
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: () => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
      };
    };
    const { call } = toolsFor(createInMemoryWorkspaceStore(), stall);
    let settled: any = null;
    call("list_board", LB_OK).then((o: any) => (settled = o));
    await wasCalled;
    await flush();
    mock.timers.tick(15_000);
    await flush();
    assert.ok(settled !== null, "list_board never returned: the 15 s timer is cleared before the body is read (board-readers.mjs createRequestBudget)");
    assert.equal(settled.boards[0].status, "error");
  } finally {
    mock.timers.reset();
  }
});

test("§ 4.8: an HTML answer and a redirect on a single-posting read give add_roles `error`, no throw, nothing written", async () => {
  const f = stubFetch([
    [GH_API + "acme/jobs/1", () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, json: async () => { throw new SyntaxError("Unexpected token <"); } })],
    [GH_API + "acme/jobs/2", (_u, init) => { if (init?.redirect === "error") throw new TypeError("fetch failed: redirect"); return json(ghJob(2, "X")); }],
  ]);
  const store = createInMemoryWorkspaceStore();
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/1", company: "Acme" }, { posting: "https://boards.greenhouse.io/acme/jobs/2", company: "Acme" }] });
  assert.deepEqual(out.failed.map((x: any) => x.reason), ["error", "error"]);
  assert.deepEqual(await store.list(), []);
});

// ================================================================== § 4.2 — add_roles

test("S2 tester check: nothing the model types except company and posting address reaches a row — title, link, location, date come from the board byte for byte", async () => {
  const board = ghJob(4242, "Staff Engineer, Platform (Remote – EU)", {
    absolute_url: "https://job-boards.greenhouse.io/acme/jobs/4242?gh_jid=4242",
    location: { name: "Remote – EU" },
    first_published: "2026-09-19T08:00:00-04:00",
  });
  const f = stubFetch([[GH_API + "acme/jobs/4242", () => json(board)]]);
  const store = createInMemoryWorkspaceStore();
  const { call } = toolsFor(store, f.fn);
  // The model's posting address differs from the board's own link (other host).
  const out = await call("add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/4242", company: "Acme" }] });
  assert.deepEqual(out.added, [{ company: "Acme", title: board.title, url: board.absolute_url }]);
  const rows = await rowsOf(await readText(store, "jobs.md"));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.company, "Acme");
  assert.equal(r.title, board.title);
  assert.equal(r.url, board.absolute_url);
  assert.equal(r.location, "Remote – EU");
  assert.equal(r.posted_at, "2026-09-19");
  assert.equal(r.stage, "To Review");
  assert.equal(r.jd_file, "jd-inbox/acme-staff-engineer-platform-remote-eu.md");
  assert.equal(r.seen_at, "2026-09-28T12:00:00+00:00");
  assert.equal(r.updated_at, "2026-09-28T12:00:00+00:00");
  assert.equal(r.fit_verdict ?? null, null, "no verdict claimed");
  const jd = await readText(store, r.jd_file);
  assert.ok(jd.startsWith(`# Acme — ${board.title}\n# Source: ${board.absolute_url}\n\n`), jd.slice(0, 200));
  assert.ok(jd.includes("Build & ship") && !jd.includes("&lt;") && !jd.includes("<p>"), "decode, then strip");
});

test("§ 4.2 item 3: company check — 'Acme' vs 'Acme, Inc.' adds; 'Acme' vs 'Beta Corp' fails naming both; SmartRecruiters company.name too", async () => {
  const f = stubFetch([
    [GH_API + "acme/jobs/1", () => json(ghJob(1, "Engineer"))],
    ["https://api.smartrecruiters.com/v1/companies/betacorp/postings/5", () => json({ id: "5", name: "Analyst", company: { name: "Beta Corp", identifier: "betacorp" }, location: { city: "Paris" }, releasedDate: "2026-09-10T00:00:00Z", jobAd: { sections: { jobDescription: { text: "<b>Do</b>" } } } })],
  ]);
  const store = createInMemoryWorkspaceStore();
  const { call } = toolsFor(store, f.fn);
  const ok = await call("add_roles", AR_OK);
  assert.equal(ok.added.length, 1);
  const bad = await call("add_roles", { roles: [{ posting: "https://jobs.smartrecruiters.com/betacorp/5-analyst", company: "Acme" }] });
  assert.equal(bad.failed[0].reason, "company_mismatch");
  assert.ok(bad.failed[0].message.includes("Acme") && bad.failed[0].message.includes("Beta Corp"));
  const before = await readText(store, "jobs.md");
  const bad2 = await call("add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/1", company: "Beta Corp" }] });
  assert.equal(bad2.failed[0].reason, "company_mismatch");
  assert.equal(await readText(store, "jobs.md"), before);
});

test("§ 4.2 item 6: known by key (other link), known by link under a different title, known when dismissed — stage untouched, jobs.md byte-identical", async () => {
  const md = jobsMd({
    Interested: [["Acme — Engineer", "- URL: https://somewhere.example/acme-eng", "- Was: To Review"]],
    "To Review": [["Acme — Old Title", "- URL: https://job-boards.greenhouse.io/acme/jobs/2"]],
    Dismissed: [["Acme — Recruiter", "- URL: https://job-boards.greenhouse.io/acme/jobs/3", "- Was: To Review", "- Dismissed: dq: not a fit"]],
  });
  const f = stubFetch([
    [GH_API + "acme/jobs/1", () => json(ghJob(1, "Engineer"))],
    [GH_API + "acme/jobs/2", () => json(ghJob(2, "Brand New Title"))],
    [GH_API + "acme/jobs/3", () => json(ghJob(3, "Recruiter"))],
  ]);
  const store = createInMemoryWorkspaceStore({ "jobs.md": md });
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", { roles: [1, 2, 3].map((i) => ({ posting: `https://boards.greenhouse.io/acme/jobs/${i}`, company: "Acme" })) });
  assert.deepEqual(out.added, []);
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.alreadyInJobList, [
    { company: "Acme", title: "Engineer", stage: "Interested" },
    { company: "Acme", title: "Old Title", stage: "To Review" },
    { company: "Acme", title: "Recruiter", stage: "dismissed" },
  ]);
  assert.equal(await readText(store, "jobs.md"), md, "byte-identical");
  assert.deepEqual((await store.list()).map((x: any) => x.path).sort(), ["jobs.md"], "no JD file written for a known role");
});

test("§ 4.2 item 5: an existing JD file is kept untouched (create-only) and the row still points at it", async () => {
  const existing = "# Acme — Engineer\n# Source: hand-pasted\n\nThe candidate's own copy.\n";
  const f = stubFetch([[GH_API + "acme/jobs/1", () => json(ghJob(1, "Engineer"))]]);
  const store = createInMemoryWorkspaceStore({ "jd-inbox/acme-engineer.md": existing });
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", AR_OK);
  assert.equal(out.added.length, 1, JSON.stringify(out));
  assert.equal(await readText(store, "jd-inbox/acme-engineer.md"), existing);
  const rows = await rowsOf(await readText(store, "jobs.md"));
  assert.equal(rows[0].jd_file, "jd-inbox/acme-engineer.md");
});

test("§ 4.3 B1 through add_roles: an injected title lands as one To Review row on one line; load() finds no Offer row", async () => {
  const evil = "Engineer\n## Offer\n### Evil Co — Row\n- URL: https://evil.example";
  const f = stubFetch([[GH_API + "acme/jobs/1", () => json(ghJob(1, evil))]]);
  const store = createInMemoryWorkspaceStore({ "jobs.md": jobsMd({ "To Review": [["Beta — Existing", "- URL: https://b.example/1"]] }) });
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", AR_OK);
  assert.equal(out.added.length, 1);
  const text = await readText(store, "jobs.md");
  assert.ok(!/^## Offer/m.test(text), text);
  assert.ok(!/^### Evil Co/m.test(text), text);
  assert.ok(!/^- URL: https:\/\/evil\.example/m.test(text), text);
  const rows = await rowsOf(text);
  assert.equal(rows.length, 2);
  const added = rows.find((r: any) => r.company === "Acme");
  assert.equal(added.stage, "To Review");
  assert.equal(added.title, "Engineer ## Offer ### Evil Co — Row - URL: https://evil.example");
  assert.equal(added.url, "https://job-boards.greenhouse.io/acme/jobs/1");
  assert.ok(rows.every((r: any) => r.stage !== "Offer"));
});

test("§ 4.2 item 7: a title of only newlines and spaces fails empty_field with jobs.md byte-identical", async () => {
  const md = jobsMd({ "To Review": [["Beta — Existing", "- URL: https://b.example/1"]] });
  const f = stubFetch([[GH_API + "acme/jobs/1", () => json(ghJob(1, " \n\r\n\t   "))]]);
  const store = createInMemoryWorkspaceStore({ "jobs.md": md });
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", AR_OK);
  assert.deepEqual(out.failed, [{ posting: AR_OK.roles[0].posting, reason: "empty_field" }]);
  assert.equal(await readText(store, "jobs.md"), md);
  assert.deepEqual((await store.list()).map((x: any) => x.path), ["jobs.md"]);
});

test("§ 4.2 item 8: the sixth new row of one company on one day fails company_limit — across calls; the next day it adds", async () => {
  const f = stubFetch([[GH_API + "acme/jobs/", (url) => { const id = Number(url.split("/").pop()); return json(ghJob(id, `Role ${id}`)); }]]);
  const store = createInMemoryWorkspaceStore();
  const day1 = toolsFor(store, f.fn);
  const first = await day1.call("add_roles", { roles: [1, 2, 3].map((i) => ({ posting: `https://boards.greenhouse.io/acme/jobs/${i}`, company: "Acme" })) });
  assert.equal(first.added.length, 3);
  const second = await day1.call("add_roles", { roles: [4, 5, 6].map((i) => ({ posting: `https://boards.greenhouse.io/acme/jobs/${i}`, company: "Acme" })) });
  assert.equal(second.added.length, 2);
  assert.deepEqual(second.failed.map((x: any) => x.reason), ["company_limit"]);
  const day2 = toolsFor(store, f.fn, { now: new Date("2026-09-29T09:00:00Z") });
  const third = await day2.call("add_roles", { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/6", company: "Acme" }] });
  assert.equal(third.added.length, 1, JSON.stringify(third));
});

test("§ 4.2 item 8: active_cap counts To Review rows that aren't dismissed; a criteria.md cap is read", async () => {
  const md = jobsMd({
    "To Review": [["X — One", "- URL: https://x.example/1"], ["Y — Two", "- URL: https://x.example/2"]],
    Interested: [["Z — Three", "- URL: https://x.example/3"]],
    Dismissed: [["W — Four", "- URL: https://x.example/4", "- Was: To Review"]],
  });
  const f = stubFetch([[GH_API + "acme/jobs/", (url) => { const id = Number(url.split("/").pop()); return json(ghJob(id, `Role ${id}`)); }]]);
  const store = createInMemoryWorkspaceStore({ "jobs.md": md, "criteria.md": "# Criteria\n\n## Search settings\n\n- active pipeline cap: 3\n- max new roles per company: 10\n" });
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", { roles: [1, 2].map((i) => ({ posting: `https://boards.greenhouse.io/acme/jobs/${i}`, company: "Acme" })) });
  assert.equal(out.added.length, 1);
  assert.deepEqual(out.failed.map((x: any) => x.reason), ["active_cap"]);
});

test("§ 4.2 item 8: a bullet 'active pipeline cap: many' is a tool_error naming the bullet; nothing fetched or written", async () => {
  const f = stubFetch([]);
  const store = createInMemoryWorkspaceStore({ "criteria.md": "## Search settings\n\n- active pipeline cap: many\n" });
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", AR_OK);
  assert.equal(out?.error?.code, "tool_error");
  assert.ok(out.error.message.includes("active pipeline cap"));
  assert.equal(f.calls.length, 0);
});

test("§ 4.1: Ashby is read once per turn — three add_roles postings on one board, one request", async () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const f = stubFetch([["https://api.ashbyhq.com/posting-api/job-board/acme", () => json({ apiVersion: "1", jobs: ids.map((id, i) => ({ id, title: `Role ${i}`, location: "Remote", jobUrl: `https://jobs.ashbyhq.com/acme/${id}`, publishedAt: "2026-09-20T00:00:00.000+00:00", descriptionPlain: "Text" })) })]]);
  const store = createInMemoryWorkspaceStore();
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", { roles: ids.map((id) => ({ posting: `https://jobs.ashbyhq.com/acme/${id}`, company: "Acme" })) });
  assert.equal(out.added.length, 3, JSON.stringify(out));
  assert.equal(f.calls.length, 1);
  const rows = await rowsOf(await readText(store, "jobs.md"));
  assert.deepEqual(rows.map((r: any) => [r.location, r.posted_at]), [["Remote", "2026-09-20"], ["Remote", "2026-09-20"], ["Remote", "2026-09-20"]]);
});

test("§ 4.2 item 4 (known item 4): a SmartRecruiters row's link comes from the board (company.identifier, as the sweep's extract), not from how the model typed the address", async () => {
  // Checked live 2026-09-28: the SR API answers /companies/SMARTRECRUITERS/…
  // the same as /companies/smartrecruiters/…, and returns
  // company.identifier "smartrecruiters". search_ats.py extract builds
  // jobs.smartrecruiters.com/{company.identifier}/{id}.
  const f = stubFetch([["https://api.smartrecruiters.com/v1/companies/", () => json({ id: "744000148454651", name: "Data Operations Consultant", company: { name: "SmartRecruiters Inc", identifier: "smartrecruiters" }, location: { city: "Kraków" }, releasedDate: "2026-09-10T00:00:00Z", postingUrl: "https://jobs.smartrecruiters.com/smartrecruiters/744000148454651-data-operations-consultant-", jobAd: { sections: { jobDescription: { text: "Do" } } } })]]);
  const store = createInMemoryWorkspaceStore();
  const { call } = toolsFor(store, f.fn);
  const out = await call("add_roles", { roles: [{ posting: "https://jobs.smartrecruiters.com/SmartRecruiters/744000148454651-data-operations-consultant-", company: "SmartRecruiters" }] });
  assert.equal(out.added.length, 1, JSON.stringify(out));
  assert.equal(out.added[0].url, "https://jobs.smartrecruiters.com/smartrecruiters/744000148454651");
});

// ================================================================== § 4.4 — fetch_job on the shared readers, both fixes

test("§ 4.4: fetch_job decodes Greenhouse entities before stripping; a Lever posting's company is the board slug, never the team", async () => {
  const f = stubFetch([
    [GH_API + "acme/jobs/1", () => json(ghJob(1, "Engineer"))],
    ["https://api.lever.co/v0/postings/leverco/", () => json({ id: "11111111-1111-4111-8111-111111111111", text: "Engineer", categories: { team: "Solutions", location: "NYC" }, hostedUrl: "https://jobs.lever.co/leverco/11111111-1111-4111-8111-111111111111", descriptionPlain: "Lever text" })],
  ]);
  const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn, { estimated: false });
  const gh = await call("fetch_job", { url: "https://boards.greenhouse.io/acme/jobs/1" });
  assert.equal(gh.text, "Build & ship");
  const lv = await call("fetch_job", { url: "https://jobs.lever.co/leverco/11111111-1111-4111-8111-111111111111" });
  assert.equal(lv.company, "leverco");
  assert.ok(!("boardName" in lv));
});

// ================================================================== SPEC GAP (reported to the lead; a todo, so it runs but doesn't fail the suite)

test(
  "§ 4.4 spec gap: real Greenhouse `content` is DOUBLE-encoded inside text (&amp;nbsp; &amp;amp; &amp;mdash;), so one decode then strip still saves `&nbsp;`",
  { todo: "design-web-search.md § 4.4 says 'decode, then strip' (one pass); live GitLab board 2026-09-28: 2771 &amp;nbsp;, 375 &amp;amp;, 84 &amp;mdash; across 199 postings. Spec needs a second decode after the strip." },
  async () => {
    const f = stubFetch([[GH_API + "acme/jobs/1", () => json(ghJob(1, "Engineer", { content: "&lt;p&gt;Build&amp;nbsp;fast &amp;amp; ship &amp;mdash; well&lt;/p&gt;" }))]]);
    const { call } = toolsFor(createInMemoryWorkspaceStore(), f.fn, { estimated: false });
    const gh = await call("fetch_job", { url: "https://boards.greenhouse.io/acme/jobs/1" });
    assert.ok(!/&(nbsp|amp);/.test(gh.text), gh.text);
  },
);

test(
  "§ 4.1 spec conflict: the model is to check boardName and put `gone` rows in the prune batch, but the compact form (M3) the model reads carries neither",
  { todo: "design-web-search.md § 4.1: 'boardName is shown so the model can check it reached the right company's board' and gone '…the model puts them in the prune batch', yet M3's compact line format lists neither. The code follows M3 literally. Chain fix needed (lead)." },
  async () => {
    const md = jobsMd({ "To Review": [["Acme — Vanished Role", "- URL: https://job-boards.greenhouse.io/acme/jobs/99"]] });
    const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "Engineer", { company_name: "Someone Else Ltd" })] })]]);
    const { tools, call } = toolsFor(createInMemoryWorkspaceStore({ "jobs.md": md }), f.fn);
    const out = await call("list_board", LB_OK);
    assert.equal(out.boards[0].boardName, "Someone Else Ltd");
    assert.deepEqual(out.boards[0].gone, [{ company: "Acme", title: "Vanished Role" }]);
    const text = tools.list_board.toModelOutput({ output: out, toolCallId: "x", input: {} }).value;
    assert.ok(text.includes("Someone Else Ltd"), `boardName not in the model's text:\n${text}`);
    assert.ok(text.includes("Vanished Role"), `gone not in the model's text:\n${text}`);
  },
);
