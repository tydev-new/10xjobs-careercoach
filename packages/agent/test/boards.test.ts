// design-web-search.md § 4.1/§ 4.2/§ 4.7/§ 4.8 — list_board/add_roles unit
// tests against stubbed `fetch` and the in-memory workspace store. No live
// network call to any board (rule: "make no live network calls to
// Greenhouse, Lever, Ashby, SmartRecruiters or Workday in tests").
import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { CardBuilder } from "../src/cards.ts";
import { VersionTracker } from "../src/tools/version-tracker.ts";
import { createTools, type ToolContext, type TurnState } from "../src/tools/index.ts";
import type { Deps } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function fakeWriter() {
  const written: any[] = [];
  return { written, write: (chunk: any) => written.push(chunk) } as any;
}

async function makeCtx(overrides: Partial<Deps> = {}, ctxOverrides: Partial<ToolContext> = {}) {
  const skills = await loadRealSkillBundle();
  const writer = fakeWriter();
  const deps: Deps = {
    model: {} as any,
    workspace: overrides.workspace ?? createInMemoryWorkspaceStore(),
    skills,
    gate: overrides.gate ?? ({ open: async () => {}, decide: async () => {}, pending: async () => null, expireOtherChats: async () => {} } as any),
    balance: overrides.balance ?? (async () => 5),
    fetch: overrides.fetch ?? (globalThis.fetch as any),
    clock: overrides.clock ?? { now: () => new Date("2026-09-28T12:00:00Z") },
    scripts: overrides.scripts ?? createFakeScriptRunner([]),
    limits: overrides.limits,
    webSearch: overrides.webSearch,
    checkLanguage: overrides.checkLanguage,
  };
  const turnState: TurnState = { measuredSteps: [], spentSoFarUsd: 0, estimateCostRanThisTurn: true, ...ctxOverrides.turnState };
  const ctx: ToolContext = {
    chatId: "chat-1",
    writer,
    versionTracker: new VersionTracker(),
    cardBuilder: new CardBuilder(),
    turnState,
    gateGrammarMd: skills["skills/coach/references/gate-grammar.md"],
    idFor: () => "gate-1",
    ...ctxOverrides,
    turnState, // keep the merged one even if ctxOverrides also had a partial
  };
  return { deps, ctx, writer, tools: createTools(deps, ctx) };
}

const GH_LIST_URL = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
const GH_LIST_BODY = {
  jobs: [
    {
      id: 111,
      title: "Forward Deployed Engineer",
      location: { name: "NYC" },
      absolute_url: "https://boards.greenhouse.io/acme/jobs/111",
      company_name: "Acme, Inc.",
      content: "<p>Do &amp; build things</p>",
      first_published: "2026-09-01",
    },
    {
      id: 222,
      title: "Recruiter",
      location: { name: "SF" },
      absolute_url: "https://boards.greenhouse.io/acme/jobs/222",
      company_name: "Acme, Inc.",
      first_published: "2026-09-20",
    },
  ],
};
const GH_POSTING_URL = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/111";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
}

function makeFetchStub(routes: Record<string, () => any>) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    for (const [prefix, make] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return make();
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as typeof fetch;
  return { fn, calls };
}

// ---------------------------------------------------------------------
// § 4.7 — estimate-first (M8)
// ---------------------------------------------------------------------

test("list_board: refuses estimate_first when estimate_cost hasn't run this turn", async () => {
  const { tools } = await makeCtx({}, { turnState: { measuredSteps: [], spentSoFarUsd: 0, estimateCostRanThisTurn: false } as any });
  const out: any = await (tools.list_board.execute as any)({ boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }] }, {});
  assert.equal(out.error.code, "estimate_first");
});

test("add_roles: refuses estimate_first the same way", async () => {
  const { tools } = await makeCtx({}, { turnState: { measuredSteps: [], spentSoFarUsd: 0, estimateCostRanThisTurn: false } as any });
  const out: any = await (tools.add_roles.execute as any)({ roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] }, {});
  assert.equal(out.error.code, "estimate_first");
});

test("list_board: a turn started by an approved gate skips the estimate_first check", async () => {
  const { fn } = makeFetchStub({ [GH_LIST_URL]: () => jsonResponse(GH_LIST_BODY) });
  const { tools } = await makeCtx(
    { fetch: fn },
    { turnState: { measuredSteps: [], spentSoFarUsd: 0, estimateCostRanThisTurn: false } as any, turnStartedByApprovedGate: true },
  );
  const out: any = await (tools.list_board.execute as any)({ boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }] }, {});
  assert.ok(!("error" in out), JSON.stringify(out));
});

// ---------------------------------------------------------------------
// § 4.8 — input checks
// ---------------------------------------------------------------------

test("list_board: tool_error on 0 boards, no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.list_board.execute as any)({ boards: [] }, {});
  assert.equal(out.error.code, "tool_error");
  assert.equal(calls.length, 0);
});

test("list_board: tool_error on 11 boards (> 10), no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const boards = Array.from({ length: 11 }, (_, i) => ({ url: `https://boards.greenhouse.io/c${i}`, company: `C${i}` }));
  const out: any = await (tools.list_board.execute as any)({ boards }, {});
  assert.equal(out.error.code, "tool_error");
  assert.equal(calls.length, 0);
});

test("list_board: tool_error on an unknown top-level field, no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.list_board.execute as any)(
    { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }], extra: true },
    {},
  );
  assert.equal(out.error.code, "tool_error");
  assert.equal(calls.length, 0);
});

test("list_board: tool_error on a title word over 4 words, no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.list_board.execute as any)(
    { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }], titleWords: ["one two three four five"] },
    {},
  );
  assert.equal(out.error.code, "tool_error");
  assert.equal(calls.length, 0);
});

test("list_board: tool_error on postedWithinDays out of 1-365, no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.list_board.execute as any)(
    { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }], postedWithinDays: 0 },
    {},
  );
  assert.equal(out.error.code, "tool_error");
  assert.equal(calls.length, 0);
});

test("add_roles: tool_error on 21 roles (> 20), no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const roles = Array.from({ length: 21 }, (_, i) => ({ posting: `https://boards.greenhouse.io/acme/jobs/${i}`, company: "Acme" }));
  const out: any = await (tools.add_roles.execute as any)({ roles }, {});
  assert.equal(out.error.code, "tool_error");
  assert.equal(calls.length, 0);
});

test("add_roles: tool_error on an unknown key inside a role (the input schema has no title field), no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme", title: "Invented Title" }] },
    {},
  );
  assert.equal(out.error.code, "tool_error");
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------
// list_board — the happy path, dedupe, caps, toModelOutput
// ---------------------------------------------------------------------

test("list_board: reads a Greenhouse board, entity-decodes, title-filters, and reports counts", async () => {
  const { fn, calls } = makeFetchStub({ [GH_LIST_URL]: () => jsonResponse(GH_LIST_BODY) });
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.list_board.execute as any)(
    { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }], titleWords: ["engineer"] },
    {},
  );
  assert.equal(calls.length, 1);
  const b = out.boards[0];
  assert.equal(b.status, "ok");
  assert.equal(b.boardName, "Acme, Inc.");
  assert.equal(b.total, 2);
  assert.equal(b.read, 2);
  assert.equal(b.matched, 1);
  assert.equal(b.alreadyInJobList, 0);
  assert.equal(b.shown, 1);
  assert.equal(b.postings[0].posting, "https://boards.greenhouse.io/acme/jobs/111");
  assert.equal(b.postings[0].title, "Forward Deployed Engineer");
  assert.equal(out.requestsLeftThisTurn, 59);
});

test("list_board: a posting already in jobs.md (by link) is counted, not shown", async () => {
  const jobsMd = [
    "# Pipeline",
    "",
    "**Active: 1** · dismissed: 0 · updated 2026-09-01",
    "",
    "## To Review",
    "",
    "### Acme — Forward Deployed Engineer",
    "- URL: https://boards.greenhouse.io/acme/jobs/111",
    "- Seen: 2026-09-01T00:00:00+00:00",
    "- Updated: 2026-09-01T00:00:00+00:00",
    "",
  ].join("\n");
  const { fn } = makeFetchStub({ [GH_LIST_URL]: () => jsonResponse(GH_LIST_BODY) });
  const workspace = createInMemoryWorkspaceStore({ "jobs.md": jobsMd });
  const { tools } = await makeCtx({ fetch: fn, workspace });
  const out: any = await (tools.list_board.execute as any)(
    { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }] },
    {},
  );
  const b = out.boards[0];
  assert.equal(b.matched, 2);
  assert.equal(b.alreadyInJobList, 1);
  assert.equal(b.shown, 1);
  assert.equal(b.postings[0].title, "Recruiter");
});

test("list_board: an unsupported host is unsupported_url, no fetch for that board", async () => {
  const { fn, calls } = makeFetchStub({});
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.list_board.execute as any)({ boards: [{ url: "https://example.com/careers", company: "Acme" }] }, {});
  assert.equal(out.boards[0].status, "unsupported_url");
  assert.equal(calls.length, 0);
});

test("list_board: SmartRecruiters totalFound 0 is empty, never ok (unknown company indistinguishable from a real empty board)", async () => {
  const url = "https://api.smartrecruiters.com/v1/companies/nobody/postings";
  const { fn } = makeFetchStub({ [url]: () => jsonResponse({ totalFound: 0, content: [] }) });
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.list_board.execute as any)({ boards: [{ url: "https://jobs.smartrecruiters.com/nobody", company: "Nobody" }] }, {});
  assert.equal(out.boards[0].status, "empty");
});

test("list_board: toModelOutput is compact text, not JSON — one line per board, one per posting", async () => {
  const { fn } = makeFetchStub({ [GH_LIST_URL]: () => jsonResponse(GH_LIST_BODY) });
  const { tools } = await makeCtx({ fetch: fn });
  const output: any = await (tools.list_board.execute as any)(
    { boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }], titleWords: ["engineer"] },
    {},
  );
  const modelOut = (tools.list_board as any).toModelOutput({ output, toolCallId: "x", input: {} });
  assert.equal(modelOut.type, "text");
  assert.ok(modelOut.value.includes("Acme · ok · 2 postings · 1 match · 0 already on the list · showing 1"), modelOut.value);
  assert.ok(modelOut.value.includes("https://boards.greenhouse.io/acme/jobs/111 | Forward Deployed Engineer | NYC | 2026-09-01"), modelOut.value);
  assert.ok(!modelOut.value.startsWith("{"), "must not be JSON");
});

// ---------------------------------------------------------------------
// add_roles — happy path, both fixes, company_mismatch, empty_field, caps
// ---------------------------------------------------------------------

test("add_roles: adds a Greenhouse posting, writes jobs.md and jd-inbox, decodes entities before stripping tags", async () => {
  const { fn } = makeFetchStub({ [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]) });
  const workspace = createInMemoryWorkspaceStore();
  const { tools } = await makeCtx({ fetch: fn, workspace });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] },
    {},
  );
  assert.deepEqual(out.failed, []);
  assert.equal(out.added.length, 1);
  assert.equal(out.added[0].company, "Acme");
  assert.equal(out.added[0].title, "Forward Deployed Engineer");
  const jobsMd = await workspace.read("jobs.md");
  assert.ok(!jobsMd.binary);
  assert.ok(jobsMd.content.includes("### Acme — Forward Deployed Engineer"));
  const jd = await workspace.read("jd-inbox/acme-forward-deployed-engineer.md");
  assert.ok(!jd.binary);
  assert.ok(jd.content.includes("Do & build things"), "entities decoded before tags stripped");
  assert.ok(!jd.content.includes("&amp;"));
});

test("add_roles: Lever names the company after the board slug, never the team (§ 4.4's fix)", async () => {
  const leverUrl = "https://api.lever.co/v0/postings/acme/11111111-2222-3333-4444-555555555555";
  const { fn } = makeFetchStub({
    [leverUrl]: () =>
      jsonResponse({
        text: "Forward Deployed Engineer",
        categories: { team: "Solutions", location: "NYC" },
        hostedUrl: "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555",
        descriptionPlain: "Build things.",
      }),
  });
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555", company: "Acme" }] },
    {},
  );
  assert.deepEqual(out.failed, []);
  assert.equal(out.added[0].company, "Acme"); // the plan's name, not "Solutions" (the OLD bug)
});

test("add_roles: company_mismatch can never fire on Lever — the board gives no company name, § 6's own named hole", async () => {
  const leverUrl = "https://api.lever.co/v0/postings/acme/11111111-2222-3333-4444-555555555555";
  const { fn } = makeFetchStub({
    [leverUrl]: () =>
      jsonResponse({
        text: "Forward Deployed Engineer",
        categories: { team: "Totally Different Co", location: "NYC" },
        hostedUrl: "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555",
        descriptionPlain: "Build things.",
      }),
  });
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555", company: "A Wholly Unrelated Name Inc" }] },
    {},
  );
  assert.deepEqual(out.failed, [], "no company_mismatch — Lever has no company field to compare against");
  assert.equal(out.added[0].company, "A Wholly Unrelated Name Inc");
});

test("add_roles: company_mismatch fails and names both when the board's own name disagrees", async () => {
  const { fn } = makeFetchStub({ [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]) });
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Beta Corp" }] },
    {},
  );
  assert.equal(out.failed[0].reason, "company_mismatch");
  assert.ok(out.failed[0].message.includes("Beta Corp"));
  assert.ok(out.failed[0].message.includes("Acme"));
});

test("add_roles: 'Acme' against the board's 'Acme, Inc.' still adds (canon() match, not exact string)", async () => {
  const { fn } = makeFetchStub({ [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]) });
  const { tools } = await makeCtx({ fetch: fn });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] },
    {},
  );
  assert.deepEqual(out.failed, []);
  assert.equal(out.added.length, 1);
});

test("add_roles: a title of only whitespace after cleaning fails empty_field, jobs.md untouched", async () => {
  const { fn } = makeFetchStub({
    [GH_POSTING_URL]: () => jsonResponse({ ...GH_LIST_BODY.jobs[0], title: "   \n\t  " }),
  });
  const workspace = createInMemoryWorkspaceStore();
  const { tools } = await makeCtx({ fetch: fn, workspace });
  const before = await workspace.list();
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] },
    {},
  );
  assert.equal(out.failed[0].reason, "empty_field");
  const after = await workspace.list();
  assert.deepEqual(before, after, "jobs.md byte-identical (nothing written)");
});

test("add_roles: a role already in the job list (by link) reports alreadyInJobList with its stage, dismissed included", async () => {
  const jobsMd = [
    "# Pipeline",
    "",
    "**Active: 0** · dismissed: 1 · updated 2026-09-01",
    "",
    "## Dismissed",
    "",
    "### Acme — Forward Deployed Engineer",
    "- URL: https://boards.greenhouse.io/acme/jobs/111",
    "- Seen: 2026-09-01T00:00:00+00:00",
    "- Updated: 2026-09-01T00:00:00+00:00",
    "- Was: To Review",
    "",
  ].join("\n");
  const { fn } = makeFetchStub({ [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]) });
  const workspace = createInMemoryWorkspaceStore({ "jobs.md": jobsMd });
  const { tools } = await makeCtx({ fetch: fn, workspace });
  const before = await workspace.read("jobs.md");
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] },
    {},
  );
  assert.deepEqual(out.added, []);
  assert.equal(out.alreadyInJobList[0].stage, "dismissed");
  const after = await workspace.read("jobs.md");
  assert.ok(!after.binary && !before.binary);
  assert.equal(after.content, before.content, "jobs.md byte-identical");
});

test("add_roles: the sixth new row of one company on one day fails company_limit (default 5)", async () => {
  const rows: string[] = [
    "# Pipeline",
    "",
    "**Active: 5** · dismissed: 0 · updated 2026-09-28",
    "",
    "## To Review",
    "",
  ];
  for (let i = 1; i <= 5; i++) {
    rows.push(`### Acme — Existing Role ${i}`, "- Seen: 2026-09-28T00:00:00+00:00", "- Updated: 2026-09-28T00:00:00+00:00", "");
  }
  const workspace = createInMemoryWorkspaceStore({ "jobs.md": rows.join("\n") });
  const { fn } = makeFetchStub({ [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]) });
  const { tools } = await makeCtx({ fetch: fn, workspace });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] },
    {},
  );
  assert.equal(out.failed[0].reason, "company_limit");
});

test("add_roles: a bullet 'active pipeline cap: many' in criteria.md is a tool_error", async () => {
  const workspace = createInMemoryWorkspaceStore({ "criteria.md": "## Search settings\n\n- active pipeline cap: many\n" });
  const { fn } = makeFetchStub({ [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]) });
  const { tools } = await makeCtx({ fetch: fn, workspace });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] },
    {},
  );
  assert.equal(out.error.code, "tool_error");
});

test("add_roles: at 25 To Review rows (default cap), the next add fails active_cap", async () => {
  const rows: string[] = ["# Pipeline", "", "**Active: 25** · dismissed: 0 · updated 2026-09-01", "", "## To Review", ""];
  for (let i = 1; i <= 25; i++) {
    rows.push(`### Other Co — Role ${i}`, "- Seen: 2026-09-01T00:00:00+00:00", "- Updated: 2026-09-01T00:00:00+00:00", "");
  }
  const workspace = createInMemoryWorkspaceStore({ "jobs.md": rows.join("\n") });
  const { fn } = makeFetchStub({ [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]) });
  const { tools } = await makeCtx({ fetch: fn, workspace });
  const out: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://boards.greenhouse.io/acme/jobs/111", company: "Acme" }] },
    {},
  );
  assert.equal(out.failed[0].reason, "active_cap");
});

// ---------------------------------------------------------------------
// § 4.8 — the 60-request budget, shared by list_board/add_roles/fetch_job
// ---------------------------------------------------------------------

test("the 60-request budget is shared across list_board, add_roles and fetch_job in one turn", async () => {
  const { fn } = makeFetchStub({
    [GH_LIST_URL]: () => jsonResponse(GH_LIST_BODY),
    [GH_POSTING_URL]: () => jsonResponse(GH_LIST_BODY.jobs[0]),
  });
  const { tools, ctx } = await makeCtx({ fetch: fn });
  const { getBoardRequestBudget } = await import("../src/tools/boards.ts");
  const budget = getBoardRequestBudget(ctx);
  // Drain the budget to exactly 1 request left, via the real budgeted-fetch
  // API (not by poking internals) — a throwaway consuming stub.
  const consumingFn = (async () => jsonResponse({ jobs: [] })) as any;
  for (let i = 0; i < 59; i++) {
    await budget.fetch(consumingFn, "https://boards-api.greenhouse.io/v1/boards/x/jobs?content=true");
  }
  assert.equal(budget.remaining, 1);
  const listOut: any = await (tools.list_board.execute as any)({ boards: [{ url: "https://boards.greenhouse.io/acme", company: "Acme" }] }, {});
  assert.equal(listOut.boards[0].status, "ok"); // used the last request
  assert.equal(budget.remaining, 0);
  const fetchOut: any = await (tools.fetch_job.execute as any)({ url: "https://boards.greenhouse.io/acme/jobs/111" }, {});
  assert.equal(fetchOut.error.code, "request_limit");
});

test("Ashby is read once per turn — list_board then add_roles share the same read", async () => {
  const ashbyUrl = "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true";
  const ASHBY_BODY = {
    jobs: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        title: "Forward Deployed Engineer",
        locationName: "Remote",
        jobUrl: "https://jobs.ashbyhq.com/acme/11111111-2222-3333-4444-555555555555",
        descriptionPlain: "Build things.",
        publishedDate: "2026-09-01",
      },
    ],
  };
  const { fn, calls } = makeFetchStub({ [ashbyUrl]: () => jsonResponse(ASHBY_BODY) });
  const { tools } = await makeCtx({ fetch: fn });
  const listOut: any = await (tools.list_board.execute as any)({ boards: [{ url: "https://jobs.ashbyhq.com/acme", company: "Acme" }] }, {});
  assert.equal(listOut.boards[0].status, "ok");
  const addOut: any = await (tools.add_roles.execute as any)(
    { roles: [{ posting: "https://jobs.ashbyhq.com/acme/11111111-2222-3333-4444-555555555555", company: "Acme" }] },
    {},
  );
  assert.deepEqual(addOut.failed, []);
  assert.equal(addOut.added.length, 1);
  assert.equal(calls.length, 1, "the Ashby board was fetched exactly once across list_board + add_roles");
});
