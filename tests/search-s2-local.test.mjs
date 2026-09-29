// Tester-owned (S2, design-web-search.md § 4.1, § 4.2, § 4.3, § 4.4, § 5.2):
// the local command `skills/search/scripts/boards.mjs` over stubbed board
// answers, including the Node-only Workday reader. No live network call.
//
// Run: node --test tests/search-s2-local.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOARDS = join(ROOT, "skills/search/scripts/boards.mjs");
const { run } = await import(pathToFileURL(BOARDS).href);
const jm = await import(pathToFileURL(join(ROOT, "skills/search/scripts/lib/jobs-md.mjs")).href);

const NOW = () => new Date("2026-09-28T12:00:00Z");

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => "application/json" }, json: async () => body };
}

function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [prefix, make] of routes) if (url.startsWith(prefix)) return make(url, init);
    throw new TypeError(`unstubbed fetch: ${url}`);
  };
  return { fn, calls };
}

function memIo(seed = {}) {
  const files = new Map(Object.entries(seed));
  return {
    files,
    async exists(p) { return files.has(p); },
    async readFile(p) { if (!files.has(p)) throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" }); return files.get(p); },
    async writeFile(p, c) { files.set(p, c); },
    async mkdir() {},
  };
}

async function rowsOf(text) {
  return jm.load({ exists: async () => true, readFile: async () => text }, "");
}

function jobsMd(sections) {
  const out = ["# Pipeline", "", "**Active: 0** · dismissed: 0 · updated 2026-09-01", ""];
  for (const [name, rows] of Object.entries(sections)) {
    out.push(`## ${name}`, "");
    for (const [head, ...fields] of rows) out.push(`### ${head}`, ...fields, "");
  }
  return out.join("\n");
}

const GH_API = "https://boards-api.greenhouse.io/v1/boards/";
const ghJob = (id, title, extra = {}) => ({
  id, title, location: { name: "Berlin" }, absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
  company_name: "Acme, Inc.", first_published: "2026-09-20T10:00:00-04:00", content: "&lt;p&gt;Build&lt;/p&gt;", ...extra,
});
const add = (io, fetchFn, pairs, now = NOW) =>
  run(["add", "--workspace", ".", ...pairs.flatMap(([p, c]) => ["--posting", p, "--company", c])], io, { fetchImpl: fetchFn, now });
const list = (io, fetchFn, pairs, extra = []) =>
  run(["list", "--workspace", ".", ...pairs.flatMap(([b, c]) => ["--board", b, "--company", c]), ...extra], io, { fetchImpl: fetchFn, now: NOW });

// ------------------------------------------------------------------ § 4.2 through `boards.mjs add`

test("local add: the row's title/link/location/date come from the board; only company and address are typed", async () => {
  const board = ghJob(7, "Staff Engineer, Data (Remote – EU)", { absolute_url: "https://job-boards.greenhouse.io/acme/jobs/7?gh_jid=7", location: { name: "Remote – EU" } });
  const f = stubFetch([[GH_API + "acme/jobs/7", () => json(board)]]);
  const io = memIo();
  const r = await add(io, f.fn, [["https://boards.greenhouse.io/acme/jobs/7", "Acme"]]);
  assert.equal(r.exitCode, 0, r.stderr);
  const [row] = await rowsOf(io.files.get("jobs.md"));
  assert.deepEqual([row.company, row.title, row.url, row.location, row.posted_at, row.stage], ["Acme", board.title, board.absolute_url, "Remote – EU", "2026-09-20", "To Review"]);
  assert.equal(row.seen_at, "2026-09-28T12:00:00+00:00");
  const jd = io.files.get(row.jd_file);
  assert.ok(jd.startsWith(`# Acme — ${board.title}\n# Source: ${board.absolute_url}\n\nBuild`), jd);
});

test("§ 4.3 B1 through `boards.mjs add`: the injected title lands as one To Review row on one line; no Offer row", async () => {
  const evil = "Engineer\n## Offer\n### Evil Co — Row\n- URL: https://evil.example";
  const f = stubFetch([[GH_API + "acme/jobs/1", () => json(ghJob(1, evil))]]);
  const io = memIo({ "jobs.md": jobsMd({ "To Review": [["Beta — Existing", "- URL: https://b.example/1"]] }) });
  const r = await add(io, f.fn, [["https://boards.greenhouse.io/acme/jobs/1", "Acme"]]);
  assert.equal(r.exitCode, 0, r.stderr);
  const text = io.files.get("jobs.md");
  assert.ok(!/^## Offer/m.test(text) && !/^### Evil Co/m.test(text) && !/^- URL: https:\/\/evil/m.test(text), text);
  const rows = await rowsOf(text);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.stage === "To Review"));
});

test("local add: a company `A — B` is written as `A - B`, and still found again by key", async () => {
  const f = stubFetch([["https://api.lever.co/v0/postings/ab/", () => json({ id: "11111111-1111-4111-8111-111111111111", text: "Engineer", categories: { location: "NYC" }, hostedUrl: "https://jobs.lever.co/ab/11111111-1111-4111-8111-111111111111", descriptionPlain: "x" })]]);
  const io = memIo();
  const r = await add(io, f.fn, [["https://jobs.lever.co/ab/11111111-1111-4111-8111-111111111111", "A — B"]]);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.ok(io.files.get("jobs.md").includes("### A - B — Engineer"), io.files.get("jobs.md"));
  const again = await add(io, f.fn, [["https://jobs.lever.co/ab/11111111-1111-4111-8111-111111111111", "A — B"]]);
  assert.ok(again.stdout.includes("already in job list"), again.stdout);
});

test("local add: known by key, by link under another title, and dismissed — jobs.md byte-identical", async () => {
  const md = jobsMd({
    "To Review": [["Acme — Engineer", "- URL: https://somewhere.example/1"], ["Acme — Old Title", "- URL: https://job-boards.greenhouse.io/acme/jobs/2"]],
    Dismissed: [["Acme — Recruiter", "- URL: https://x.example/3", "- Was: To Review", "- Dismissed: dq: no"]],
  });
  const f = stubFetch([[GH_API + "acme/jobs/", (url) => { const id = Number(url.split("/").pop()); return json(ghJob(id, ["", "Engineer", "Brand New", "Recruiter"][id])); }]]);
  const io = memIo({ "jobs.md": md });
  const r = await add(io, f.fn, [1, 2, 3].map((i) => [`https://boards.greenhouse.io/acme/jobs/${i}`, "Acme"]));
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.stdout.match(/already in job list/g)?.length, 3, r.stdout);
  assert.ok(r.stdout.includes("(dismissed)"), r.stdout);
  assert.equal(io.files.get("jobs.md"), md);
  assert.deepEqual([...io.files.keys()], ["jobs.md"]);
});

test("local add: title only whitespace → empty_field, jobs.md byte-identical; `active pipeline cap: many` → exit 2 naming the bullet", async () => {
  const md = jobsMd({ "To Review": [["Beta — Existing", "- URL: https://b.example/1"]] });
  const f = stubFetch([[GH_API + "acme/jobs/1", () => json(ghJob(1, " \n\t  "))]]);
  const io = memIo({ "jobs.md": md });
  const r = await add(io, f.fn, [["https://boards.greenhouse.io/acme/jobs/1", "Acme"]]);
  assert.ok(r.stdout.includes("empty_field"), r.stdout);
  assert.equal(io.files.get("jobs.md"), md);
  const io2 = memIo({ "criteria.md": "## Search settings\n\n- active pipeline cap: many\n" });
  const r2 = await add(io2, f.fn, [["https://boards.greenhouse.io/acme/jobs/1", "Acme"]]);
  assert.equal(r2.exitCode, 2);
  assert.ok(r2.stderr.includes("active pipeline cap"), r2.stderr);
});

test("local add: the sixth row of one company on one day fails company_limit; the next day it adds", async () => {
  const f = stubFetch([[GH_API + "acme/jobs/", (url) => { const id = Number(url.split("/").pop()); return json(ghJob(id, `Role ${id}`)); }]]);
  const io = memIo();
  const r = await add(io, f.fn, [1, 2, 3, 4, 5, 6].map((i) => [`https://boards.greenhouse.io/acme/jobs/${i}`, "Acme"]));
  assert.equal(r.stdout.match(/^added:/gm)?.length, 5, r.stdout);
  assert.ok(r.stdout.includes("jobs/6 — company_limit"), r.stdout);
  const r2 = await add(io, f.fn, [["https://boards.greenhouse.io/acme/jobs/6", "Acme"]], () => new Date("2026-09-29T08:00:00Z"));
  assert.ok(r2.stdout.includes("added: Acme — Role 6"), r2.stdout);
});

// ------------------------------------------------------------------ § 4.1 through `boards.mjs list`

test("local list: 'prints the same facts' — a partial SmartRecruiters read says read 300 of N and yields no gone", async () => {
  const SR = "https://api.smartrecruiters.com/v1/companies/bigco/postings";
  const f = stubFetch([[SR, (url) => { const off = Number(new URL(url).searchParams.get("offset")); return json({ totalFound: 1200, content: Array.from({ length: 100 }, (_, i) => ({ id: String(9000 + off + i), name: `Role ${off + i}`, company: { name: "BigCo", identifier: "bigco" }, location: { city: "Austin" } })) }); }]]);
  const io = memIo({ "jobs.md": jobsMd({ "To Review": [["BigCo — Not In First 300", "- URL: https://jobs.smartrecruiters.com/bigco/1"]] }) });
  const r = await list(io, f.fn, [["https://jobs.smartrecruiters.com/bigco", "BigCo"]]);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.ok(/BigCo · ok · 1200 postings · 300 match · 0 already on the list · showing 40 · read 300 of 1200/.test(r.stdout), r.stdout);
  assert.ok(!r.stdout.includes("gone:"), r.stdout);
});

test("local list: a full read reports gone for a vanished same-company row", async () => {
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "Still Here")] })]]);
  const io = memIo({ "jobs.md": jobsMd({ "To Review": [["Acme — Vanished", "- URL: https://job-boards.greenhouse.io/acme/jobs/99"], ["Beta — Other Co", "- URL: https://b.example/1"]] }) });
  const r = await list(io, f.fn, [["https://boards.greenhouse.io/acme", "Acme"]]);
  assert.ok(r.stdout.includes("gone: Acme — Vanished"), r.stdout);
  assert.ok(!r.stdout.includes("Other Co"), r.stdout);
});

test("local list: 'prints the same facts' as list_board — the board's own name (boardName) is shown so the company can be checked (§ 4.1)", async () => {
  const f = stubFetch([[GH_API + "acme/jobs?", () => json({ jobs: [ghJob(1, "Engineer", { company_name: "Totally Different Holdings" })] })]]);
  const r = await list(memIo(), f.fn, [["https://boards.greenhouse.io/acme", "Acme"]]);
  assert.ok(r.stdout.includes("Totally Different Holdings"), `boardName missing from local list output:\n${r.stdout}`);
});

// ------------------------------------------------------------------ Workday (Node only; § 4.4, § 5.2) — known item 3

const WD = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs";
function workdayBoard(n, { totalOnLaterPages } = {}) {
  const all = Array.from({ length: n }, (_, i) => ({ title: `WD Role ${i}`, locationsText: "Berlin", externalPath: `/job/Berlin/WD-Role-${i}_R${1000 + i}`, postedOn: "Posted 3 Days Ago" }));
  return (url, init) => {
    const body = JSON.parse(init.body);
    const total = body.offset === 0 || totalOnLaterPages === undefined ? n : totalOnLaterPages;
    return json({ total, jobPostings: all.slice(body.offset, body.offset + body.limit) });
  };
}

test("Workday add (known item 3): a posting on the board's first page is added with the board's title, link and location", async () => {
  const f = stubFetch([[WD, workdayBoard(12)]]);
  const io = memIo();
  const r = await add(io, f.fn, [["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/WD-Role-3_R1003", "Acme"]]);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.ok(r.stdout.includes("added: Acme — WD Role 3"), r.stdout);
  const [row] = await rowsOf(io.files.get("jobs.md"));
  assert.equal(row.url, "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/WD-Role-3_R1003");
  assert.equal(row.location, "Berlin");
  assert.ok(f.calls.every((c) => c.init.method === "POST" && c.init.redirect === "error"));
});

test("Workday add (known item 3): a posting without the locale prefix is matched to the same row link", async () => {
  const f = stubFetch([[WD, workdayBoard(5)]]);
  const io = memIo();
  const r = await add(io, f.fn, [["https://acme.wd5.myworkdayjobs.com/External/job/Berlin/WD-Role-2_R1002", "Acme"]]);
  assert.ok(r.stdout.includes("added: Acme — WD Role 2"), r.stdout);
});

test("Workday add (known item 3): a real posting past the first 80 on a big board is found, never a false not_found", async () => {
  const f = stubFetch([[WD, workdayBoard(300)]]);
  const r = await add(memIo(), f.fn, [["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/WD-Role-150_R1150", "Acme"]]);
  assert.ok(r.stdout.includes("added: Acme — WD Role 150"), `the posting exists on the board; got:\n${r.stdout}`);
});

test("Workday add (known item 3): the saved posting has the posting's text (§ 4.2 item 5), not a placeholder", { todo: "spec-ambiguous: the sweep (search_ats.py extract, workday) also saved no text, and § 4.2 item 4 says 'the same fields the sweep reads'; but § 4.6's quick pass reads 'the saved posting', which here is a placeholder. Reported, not counted." }, async () => {
  const f = stubFetch([[WD, workdayBoard(3)]]);
  const io = memIo();
  await add(io, f.fn, [["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/WD-Role-1_R1001", "Acme"]]);
  const [row] = await rowsOf(io.files.get("jobs.md"));
  const jd = io.files.get(row.jd_file);
  assert.ok(!jd.includes("(JD body not fetched for this posting)"), jd);
});

test("Workday add (known item 3): three postings from one board share one read of the list (per-run cache), and a missing posting ends as not_found", async () => {
  const f = stubFetch([[WD, workdayBoard(60)]]);
  const r = await add(memIo(), f.fn, [0, 1, 2].map((i) => [`https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/WD-Role-${i}_R${1000 + i}`, "Acme"]));
  assert.equal(r.stdout.match(/^added:/gm)?.length, 3, r.stdout);
  assert.equal(f.calls.length, 1, `${f.calls.length} requests for three postings on the first page of one board`);
  const f2 = stubFetch([[WD, workdayBoard(45)]]);
  const r2 = await add(memIo(), f2.fn, [["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/No-Such_R9", "Acme"]]);
  assert.ok(r2.stdout.includes("— not_found"), r2.stdout);
  assert.equal(r2.exitCode, 1, "add exits 1 when a role failed (round-2 also-fix)");
  assert.equal(f2.calls.length, 3, "read to the end of a 45-posting board (3 pages), then stopped");
});

test("Workday add: on a very large board a posting not found stops at the 60-request budget and says request_limit, not not_found", async () => {
  const f = stubFetch([[WD, workdayBoard(5000)]]);
  const r = await add(memIo(), f.fn, [["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/No-Such_R9", "Acme"]]);
  assert.equal(f.calls.length, 60);
  assert.ok(r.stdout.includes("— request_limit"), r.stdout);
});

test(
  "Workday list: a partial read (80 of 200) yields no gone, even when later pages carry total 0 (total taken from offset 0 only; the Workday premise stays UNVERIFIED live)",
  async () => {
    const f = stubFetch([[WD, workdayBoard(200, { totalOnLaterPages: 0 })]]);
    const io = memIo({ "jobs.md": jobsMd({ "To Review": [["Acme — WD Role 150", "- URL: https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/WD-Role-150_R1150"]] }) });
    const r = await list(io, f.fn, [["https://acme.wd5.myworkdayjobs.com/External", "Acme"]]);
    assert.ok(r.stdout.includes("read 80 of 200"), r.stdout);
    assert.ok(!r.stdout.includes("gone:"), r.stdout);
  },
);

test("Workday list: a consistent total (80 of 200) is a partial read with no gone", async () => {
  const f = stubFetch([[WD, workdayBoard(200)]]);
  const io = memIo({ "jobs.md": jobsMd({ "To Review": [["Acme — WD Role 150", "- URL: https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/WD-Role-150_R1150"]] }) });
  const r = await list(io, f.fn, [["https://acme.wd5.myworkdayjobs.com/External", "Acme"]]);
  assert.ok(r.stdout.includes("read 80 of 200"), r.stdout);
  assert.ok(!r.stdout.includes("gone:"), r.stdout);
});

// ------------------------------------------------------------------ the command runs from any path (J2 review's main-guard note)

test("boards.mjs runs when invoked through a symlinked path (macOS mktemp: /var -> /private/var)", () => {
  const dir = mkdtempSync(join(tmpdir(), "s2t-boards-"));
  cpSync(join(ROOT, "skills"), join(dir, "skills"), { recursive: true });
  const viaTmp = join(dir, "skills/search/scripts/boards.mjs");
  const real = realpathSync(viaTmp);
  const r = spawnSync(process.execPath, [viaTmp], { encoding: "utf8" });
  const rr = spawnSync(process.execPath, [real], { encoding: "utf8" });
  assert.equal(rr.status, 2, `control via real path: ${rr.stderr}`);
  assert.equal(r.status, 2, `via ${viaTmp} (real: ${real}): exit ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)} — the main guard compared import.meta.url (realpath) with argv[1] (as typed) and silently did nothing`);
  assert.ok(r.stderr.includes("subcommand"), r.stderr);
});
