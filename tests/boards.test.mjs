// design-web-search.md § 4.1/§ 4.2/§ 4.4/§ 4.8 — expected-output cases and
// table tests for the shared board readers
// (skills/search/scripts/lib/board-readers.mjs) and the local CLI
// (skills/search/scripts/boards.mjs), over synthetic board answers. No
// live network call to any board — every fetch is a stub. "There is no
// second language to agree with" (§ 4.4): these are the specification.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ROOT, "skills/search/scripts/lib/board-readers.mjs");

const br = await import(`file://${LIB}`);
const { run: boardsRun } = await import(`file://${join(ROOT, "skills/search/scripts/boards.mjs")}`);

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeFetchStub(routes) {
  const calls = [];
  return {
    calls,
    fn: async (url, init) => {
      calls.push({ url, init });
      for (const [prefix, make] of Object.entries(routes)) {
        if (url.startsWith(prefix)) return typeof make === "function" ? make(url, init) : make;
      }
      throw new Error(`unstubbed fetch: ${url}`);
    },
  };
}

// ---------------------------------------------------------------------
// The browser-safety lint (lead ruling): board-readers.mjs never imports
// node:*/a bare Node builtin, and never references a DOM global.
// ---------------------------------------------------------------------

test("browser-safety: board-readers.mjs imports no node:*/builtin and references no DOM global", () => {
  const src = readFileSync(LIB, "utf8");
  const importLines = [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["'];?/gms)].map((m) => m[1]);
  for (const spec of importLines) {
    assert.ok(!spec.startsWith("node:"), `forbidden node: import: ${spec}`);
    assert.ok(
      !["fs", "path", "os", "child_process", "crypto", "util", "http", "https", "net", "url", "stream"].includes(spec),
      `forbidden bare Node builtin import: ${spec}`,
    );
  }
  const forbiddenGlobals = ["window", "document", "localStorage", "sessionStorage", "indexedDB", "navigator"];
  for (const g of forbiddenGlobals) {
    const re = new RegExp(`\\b${g}\\b`);
    assert.ok(!re.test(src), `board-readers.mjs references the forbidden global ${g}`);
  }
});

// ---------------------------------------------------------------------
// § 4.4 — the entity table, exactly, plus one unknown name
// ---------------------------------------------------------------------

test("decodeEntities: every named entity in the table", () => {
  assert.equal(br.decodeEntities("Ben &amp; Jerry"), "Ben & Jerry");
  assert.equal(br.decodeEntities("a &lt; b"), "a < b");
  assert.equal(br.decodeEntities("a &gt; b"), "a > b");
  assert.equal(br.decodeEntities("say &quot;hi&quot;"), 'say "hi"');
  assert.equal(br.decodeEntities("don&#39;t"), "don't");
  assert.equal(br.decodeEntities("don&apos;t"), "don't");
  assert.equal(br.decodeEntities("a&nbsp;b"), "a b");
});

test("decodeEntities: numeric &#NNN; and &#xHH;", () => {
  assert.equal(br.decodeEntities("&#65;&#66;&#67;"), "ABC");
  assert.equal(br.decodeEntities("&#x41;&#x42;&#x43;"), "ABC");
  assert.equal(br.decodeEntities("&#x2014;"), "—"); // em dash
});

test("decodeEntities: an entity outside the table is left as written (the design's own named risk)", () => {
  assert.equal(br.decodeEntities("caf&eacute;"), "caf&eacute;");
});

// ---------------------------------------------------------------------
// § 4.4's fix — decode BEFORE stripping tags (the Greenhouse bug)
// ---------------------------------------------------------------------

test("htmlToText: decodes entities before stripping tags — no &lt;div&gt; survives", () => {
  const out = br.htmlToText("<div>Ben &amp; Jerry&#39;s, on point &amp; on time</div>");
  assert.equal(out, "Ben & Jerry's, on point & on time");
  assert.ok(!out.includes("&lt;") && !out.includes("&amp;") && !out.includes("<div>"));
});

// ---------------------------------------------------------------------
// § 4.3/§ 4.4 — every whitespace character in the written-out class
// ---------------------------------------------------------------------

test("htmlToText/cleanValue collapse every character in the written-out whitespace class", () => {
  const chars = [" ", "\t", "\n", "\r", "\f", "\v", "\u0085", " ", " ", " "];
  for (const c of chars) {
    const out = br.htmlToText(`a${c}${c}b`);
    assert.equal(out, "a b", `whitespace char ${JSON.stringify(c)} did not collapse`);
  }
});

// ---------------------------------------------------------------------
// § 4.1 — the title-word filter table
// ---------------------------------------------------------------------

test("titleMatchesWords: hyphen, comma, slash read as spaces; case-insensitive; whole word only", () => {
  assert.equal(br.titleMatchesWords("Forward-Deployed Engineer", ["deployed"]), true);
  assert.equal(br.titleMatchesWords("VP, Engineering", ["vp engineering"]), true);
  assert.equal(br.titleMatchesWords("Data/ML Engineer", ["ml"]), true);
  assert.equal(br.titleMatchesWords("SOFTWARE ENGINEER", ["engineer"]), true);
  assert.equal(br.titleMatchesWords("Senior Engineer", ["eng"]), false, `"eng" must not match "engineer"`);
  assert.equal(br.titleMatchesWords("Anything", []), true, "no words keeps every title");
  assert.equal(br.titleMatchesWords("Anything", undefined), true);
});

// ---------------------------------------------------------------------
// § 4.1 — the posting-age filter, with a missing date
// ---------------------------------------------------------------------

test("withinPostedWindow: a missing date is always kept; an old date is dropped; a recent one kept", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  assert.equal(br.withinPostedWindow(undefined, 30, now), true, "no date is always kept");
  assert.equal(br.withinPostedWindow("2026-09-25", 30, now), true);
  assert.equal(br.withinPostedWindow("2026-01-01", 30, now), false);
  assert.equal(br.withinPostedWindow("2026-01-01", undefined, now), true, "no limit keeps everything");
});

// ---------------------------------------------------------------------
// § 4.1/§ 4.2 — dedupe by link and by key, dismissed included
// ---------------------------------------------------------------------

test("findInJobList: matches by link (trimmed, exact), by key, and finds a dismissed row too", () => {
  const rows = [
    { company: "Acme", title: "Engineer", url: "https://boards.greenhouse.io/acme/jobs/1 ", dismissed: false, stage: "To Review" },
    { company: "Beta Corp", title: "Recruiter", url: "", dismissed: true, stage: null, was_stage: "To Review" },
  ];
  const byLink = br.findInJobList({ company: "Acme", title: "Different Title", postingUrl: "https://boards.greenhouse.io/acme/jobs/1" }, rows);
  assert.equal(byLink, rows[0], "matched by link even though the title differs");
  const byKey = br.findInJobList({ company: "Beta Corp", title: "Recruiter", postingUrl: "https://elsewhere.example/x" }, rows);
  assert.equal(byKey, rows[1], "matched the dismissed row by key");
  const noMatch = br.findInJobList({ company: "Gamma", title: "Nothing", postingUrl: "https://nowhere.example" }, rows);
  assert.equal(noMatch, null);
});

// ---------------------------------------------------------------------
// § 4.1 — the 40/board and 120/call show caps, matched stays intact
// ---------------------------------------------------------------------

test("applyShowCap: caps at 40 per board and shares one 120 budget across boards, matched unaffected", () => {
  const budget = br.createShowBudget(120);
  const board1 = Array.from({ length: 50 }, (_, i) => ({ title: `Role ${i}` }));
  const shown1 = br.applyShowCap(board1, budget, 40);
  assert.equal(shown1.length, 40, "capped at 40 for one board");
  assert.equal(budget.remaining, 80);
  const board2 = Array.from({ length: 50 }, (_, i) => ({ title: `Role2 ${i}` }));
  const shown2 = br.applyShowCap(board2, budget, 40);
  assert.equal(shown2.length, 40);
  assert.equal(budget.remaining, 40);
  const board3 = Array.from({ length: 50 }, (_, i) => ({ title: `Role3 ${i}` }));
  const shown3 = br.applyShowCap(board3, budget, 40);
  assert.equal(shown3.length, 40, "the 3rd board is capped by the shared 120, not its own 40");
  assert.equal(budget.remaining, 0);
  const board4 = [{ title: "one more" }];
  const shown4 = br.applyShowCap(board4, budget, 40);
  assert.equal(shown4.length, 0, "the budget is exhausted — nothing more is shown");
});

// ---------------------------------------------------------------------
// § 4.1 — SmartRecruiters: empty vs ok, and "read 300 of N"
// ---------------------------------------------------------------------

test("readBoardList: SmartRecruiters totalFound 0 -> empty, never ok (unknown company indistinguishable)", async () => {
  const url = "https://api.smartrecruiters.com/v1/companies/nobody/postings";
  const { fn } = makeFetchStub({ [url]: () => jsonResponse({ totalFound: 0, content: [] }) });
  const budget = br.createRequestBudget();
  const result = await br.readBoardList({ system: "smartrecruiters", boardSlug: "nobody" }, { fetchImpl: fn, budget });
  assert.equal(result.status, "empty");
  assert.equal(result.total, 0);
});

test("readBoardList: SmartRecruiters reads at most 3 pages of 100 -> 'read 300 of N'", async () => {
  const base = "https://api.smartrecruiters.com/v1/companies/bigco/postings";
  const page = (n) => Array.from({ length: 100 }, (_, i) => ({ id: `${n}-${i}`, name: `Role ${n}-${i}`, company: { name: "BigCo" } }));
  const { fn, calls } = makeFetchStub({
    [base]: (url) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return jsonResponse({ totalFound: 1200, content: page(offset) });
    },
  });
  const budget = br.createRequestBudget();
  const result = await br.readBoardList({ system: "smartrecruiters", boardSlug: "bigco" }, { fetchImpl: fn, budget });
  assert.equal(result.status, "ok");
  assert.equal(result.total, 1200);
  assert.equal(result.read, 300, "300 of 1200 — capped at 3 pages");
  assert.equal(calls.length, 3);
});

// ---------------------------------------------------------------------
// § 4.1 — Ashby is read once per turn (the cache), for three postings
// ---------------------------------------------------------------------

test("readPosting: Ashby is fetched exactly once across three posting reads on the same board, sharing a turn's cache", async () => {
  const url = "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true";
  const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"];
  const body = { jobs: ids.map((id, i) => ({ id, title: `Role ${i}`, locationName: "Remote", jobUrl: `https://jobs.ashbyhq.com/acme/${id}`, descriptionPlain: "text" })) };
  const { fn, calls } = makeFetchStub({ [url]: () => jsonResponse(body) });
  const budget = br.createRequestBudget();
  const ashbyCache = new Map();
  for (const id of ids) {
    const r = await br.readPosting({ system: "ashby", boardSlug: "acme", postingId: id }, { fetchImpl: fn, budget, ashbyCache });
    assert.equal(r.ok, true);
  }
  assert.equal(calls.length, 1, "one Ashby request for three postings on the same board");
});

// ---------------------------------------------------------------------
// § 4.1 — "gone" only after a full read; a retitled-but-present row isn't
// ---------------------------------------------------------------------

test("computeGone: a same-company row missing from a full read is gone; present-by-link under a new title is not; another company's row never is", () => {
  const items = [{ title: "Forward Deployed Engineer (New Title)", postingUrl: "https://boards.greenhouse.io/acme/jobs/111" }];
  const rows = [
    { company: "Acme", title: "Old Title For 111", url: "https://boards.greenhouse.io/acme/jobs/111", stage: "To Review", dismissed: false },
    { company: "Acme", title: "Disappeared Role", url: "https://boards.greenhouse.io/acme/jobs/999", stage: "To Review", dismissed: false },
    { company: "Beta Corp", title: "Someone Else's Role", url: "https://boards.greenhouse.io/beta/jobs/1", stage: "To Review", dismissed: false },
  ];
  const gone = br.computeGone({ company: "Acme" }, items, rows);
  assert.deepEqual(gone, [{ company: "Acme", title: "Disappeared Role" }]);
});

test("computeGone: a dismissed row, or one the candidate already moved (Was set), is never gone", () => {
  const items = [];
  const rows = [
    { company: "Acme", title: "Already Dismissed", url: "", stage: null, dismissed: true },
    { company: "Acme", title: "Candidate Moved It", url: "", stage: "Interested", dismissed: false, was_stage: "To Review" },
  ];
  assert.deepEqual(br.computeGone({ company: "Acme" }, items, rows), []);
});

// ---------------------------------------------------------------------
// § 4.1/§ 4.8 — every failure status, no throw
// ---------------------------------------------------------------------

test("readBoardList: a 404 is not_found", async () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/nope/jobs?content=true";
  const { fn } = makeFetchStub({ [url]: () => jsonResponse({}, 404) });
  const budget = br.createRequestBudget();
  const r = await br.readBoardList({ system: "greenhouse", boardSlug: "nope" }, { fetchImpl: fn, budget });
  assert.equal(r.status, "not_found");
});

test("readBoardList: an HTML answer is error, not a throw", async () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/htmlboard/jobs?content=true";
  const { fn } = makeFetchStub({
    [url]: () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, json: async () => { throw new Error("not json"); } }),
  });
  const budget = br.createRequestBudget();
  const r = await br.readBoardList({ system: "greenhouse", boardSlug: "htmlboard" }, { fetchImpl: fn, budget });
  assert.equal(r.status, "error");
});

test("createRequestBudget: 70 requested reads give 60 answers and 10 request_limit, never a throw", async () => {
  const budget = br.createRequestBudget();
  const fn = async () => jsonResponse({ jobs: [] });
  let ok = 0;
  let limited = 0;
  for (let i = 0; i < 70; i++) {
    const r = await budget.fetch(fn, "https://boards-api.greenhouse.io/v1/boards/x/jobs?content=true");
    if (r.ok) ok++;
    else if (r.reason === "request_limit") limited++;
  }
  assert.equal(ok, 60);
  assert.equal(limited, 10);
});

test("createRequestBudget: a hanging stub times out at 15s and reports error, not a throw", async () => {
  const budget = br.createRequestBudget({ timeoutMs: 30 }); // shortened for the test
  const hangingFetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const r = await budget.fetch(hangingFetch, "https://boards-api.greenhouse.io/v1/boards/x/jobs?content=true");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "error");
});

test("createRequestBudget: fetch is always called with redirect: 'error'", async () => {
  const budget = br.createRequestBudget();
  let seenInit;
  const fn = async (url, init) => {
    seenInit = init;
    return jsonResponse({ jobs: [] });
  };
  await budget.fetch(fn, "https://boards-api.greenhouse.io/v1/boards/x/jobs?content=true");
  assert.equal(seenInit.redirect, "error");
});

// ---------------------------------------------------------------------
// § 4.8 — address parsing: board ids, posting ids, unsupported hosts
// ---------------------------------------------------------------------

test("parseBoardUrl: recognises a board root and any posting on it, for all four shared systems", () => {
  assert.deepEqual(br.parseBoardUrl("https://boards.greenhouse.io/acme"), { system: "greenhouse", boardSlug: "acme" });
  assert.deepEqual(br.parseBoardUrl("https://job-boards.greenhouse.io/acme/jobs/123"), { system: "greenhouse", boardSlug: "acme" });
  assert.deepEqual(br.parseBoardUrl("https://jobs.lever.co/acme"), { system: "lever", boardSlug: "acme" });
  assert.deepEqual(br.parseBoardUrl("https://jobs.ashbyhq.com/acme"), { system: "ashby", boardSlug: "acme" });
  assert.deepEqual(br.parseBoardUrl("https://jobs.smartrecruiters.com/acme"), { system: "smartrecruiters", boardSlug: "acme" });
});

test("parseBoardUrl: an unsupported host is null ('not a job board Ten can read here')", () => {
  assert.equal(br.parseBoardUrl("https://example.com/careers/acme"), null);
  assert.equal(br.parseBoardUrl("not a url"), null);
});

test("parsePostingUrl: board ids reject dots (no '..' path); posting ids match the right shape per system", () => {
  assert.equal(br.parsePostingUrl("https://boards.greenhouse.io/ac..me/jobs/123"), null);
  assert.deepEqual(br.parsePostingUrl("https://boards.greenhouse.io/acme/jobs/123"), { system: "greenhouse", boardSlug: "acme", postingId: "123" });
  assert.equal(br.parsePostingUrl("https://boards.greenhouse.io/acme/jobs/abc"), null, "Greenhouse posting ids are digits");
  assert.deepEqual(
    br.parsePostingUrl("https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555"),
    { system: "lever", boardSlug: "acme", postingId: "11111111-2222-3333-4444-555555555555" },
  );
  assert.equal(br.parsePostingUrl("https://jobs.lever.co/acme/not-a-uuid"), null, "Lever posting ids are 36-char UUIDs");
  assert.deepEqual(
    br.parsePostingUrl("https://jobs.smartrecruiters.com/acme/456-some-slug"),
    { system: "smartrecruiters", boardSlug: "acme", postingId: "456" },
  );
});

// ---------------------------------------------------------------------
// § 4.2 — the slug and the JD header, the sweep's own shape
// ---------------------------------------------------------------------

test("jdPath/jdFileContents: the sweep's own slug and header shape", () => {
  assert.equal(br.jdPath("Acme, Inc.", "Forward Deployed Engineer"), "jd-inbox/acme-inc-forward-deployed-engineer.md");
  const out = br.jdFileContents("Acme", "Engineer", "https://boards.greenhouse.io/acme/jobs/1", "Build things.");
  assert.equal(out, "# Acme — Engineer\n# Source: https://boards.greenhouse.io/acme/jobs/1\n\nBuild things.\n");
});

test("jdPath: caps at 80 characters, one run of non [a-z0-9] becomes one '-'", () => {
  const slug = br.jdSlug("A, B & C Inc.", "Senior/Staff Engineer (Remote, US)");
  assert.ok(/^[a-z0-9-]+$/.test(slug));
  assert.ok(slug.length <= 80);
  assert.ok(!slug.includes("--"));
});

// ---------------------------------------------------------------------
// § 4.2 item 8 — the two settings code enforces
// ---------------------------------------------------------------------

test("parseSearchSettings: reads the two bullets, defaults when absent, errors when not a whole number", () => {
  assert.deepEqual(br.parseSearchSettings(""), { maxNewRolesPerCompany: 5, activePipelineCap: 25 });
  assert.deepEqual(
    br.parseSearchSettings("## Search settings\n\n- max new roles per company: 3\n- active pipeline cap: 10\n"),
    { maxNewRolesPerCompany: 3, activePipelineCap: 10 },
  );
  const bad = br.parseSearchSettings("## Search settings\n\n- active pipeline cap: many\n");
  assert.ok("error" in bad && bad.error.includes("active pipeline cap"));
});

// ---------------------------------------------------------------------
// § 4.4 — the two named bug fixes, at the readPosting level
// ---------------------------------------------------------------------

test("readPosting: Greenhouse content is entity-decoded before tags are stripped", async () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/111";
  const { fn } = makeFetchStub({
    [url]: () => jsonResponse({ title: "Engineer", company_name: "Acme", location: { name: "NYC" }, content: "<p>Ben &amp; Jerry&#39;s</p>", absolute_url: "https://boards.greenhouse.io/acme/jobs/111" }),
  });
  const budget = br.createRequestBudget();
  const r = await br.readPosting({ system: "greenhouse", boardSlug: "acme", postingId: "111" }, { fetchImpl: fn, budget });
  assert.equal(r.ok, true);
  assert.equal(r.text, "Ben & Jerry's");
});

test("readPosting: Lever names the company after the board slug, never the team", async () => {
  const url = "https://api.lever.co/v0/postings/acme/11111111-2222-3333-4444-555555555555";
  const { fn } = makeFetchStub({
    [url]: () => jsonResponse({ text: "Engineer", categories: { team: "Solutions Engineering", location: "NYC" }, hostedUrl: "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555", descriptionPlain: "Build." }),
  });
  const budget = br.createRequestBudget();
  const r = await br.readPosting({ system: "lever", boardSlug: "acme", postingId: "11111111-2222-3333-4444-555555555555" }, { fetchImpl: fn, budget });
  assert.equal(r.ok, true);
  assert.equal(r.companyName, "acme", "the board slug, not 'Solutions Engineering'");
});

// ---------------------------------------------------------------------
// The CLI (boards.mjs run()) — a thin smoke test over the same stubs;
// the tool-level behaviour is proved above and in
// packages/agent/test/boards.test.ts (one implementation).
// ---------------------------------------------------------------------

function makeMemIo(seed = {}) {
  const files = new Map(Object.entries(seed));
  return {
    async exists(p) {
      return files.has(p);
    },
    async readFile(p) {
      if (!files.has(p)) throw new Error(`missing ${p}`);
      return files.get(p);
    },
    async writeFile(p, c) {
      files.set(p, c);
    },
    _files: files,
  };
}

test("boards.mjs list: prints one line per board and one per posting, and the requests-left line", async () => {
  const url = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
  const { fn } = makeFetchStub({
    [url]: () =>
      jsonResponse({
        jobs: [
          { id: 1, title: "Forward Deployed Engineer", location: { name: "NYC" }, absolute_url: "https://boards.greenhouse.io/acme/jobs/1", company_name: "Acme", first_published: "2026-09-01" },
        ],
      }),
  });
  const io = makeMemIo();
  const result = await boardsRun(
    ["list", "--workspace", ".", "--board", "https://boards.greenhouse.io/acme", "--company", "Acme"],
    io,
    { fetchImpl: fn, now: () => new Date("2026-09-28T00:00:00Z") },
  );
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("Acme · ok · 1 postings"));
  assert.ok(result.stdout.includes("https://boards.greenhouse.io/acme/jobs/1 | Forward Deployed Engineer | NYC | 2026-09-01"));
  assert.ok(result.stdout.includes("requests left this turn:"));
});

test("boards.mjs list: --board/--company count mismatch is a usage error, no fetch", async () => {
  const { fn, calls } = makeFetchStub({});
  const io = makeMemIo();
  const result = await boardsRun(["list", "--workspace", ".", "--board", "https://boards.greenhouse.io/acme"], io, { fetchImpl: fn, now: () => new Date() });
  assert.equal(result.exitCode, 2);
  assert.equal(calls.length, 0);
});

test("boards.mjs add: adds a posting, writes jobs.md and the JD file, create-only", async () => {
  const postingUrl = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/1";
  const { fn } = makeFetchStub({
    [postingUrl]: () => jsonResponse({ title: "Engineer", company_name: "Acme", location: { name: "NYC" }, content: "Build.", absolute_url: "https://boards.greenhouse.io/acme/jobs/1" }),
  });
  const io = makeMemIo();
  const result = await boardsRun(
    ["add", "--workspace", ".", "--posting", "https://boards.greenhouse.io/acme/jobs/1", "--company", "Acme"],
    io,
    { fetchImpl: fn, now: () => new Date("2026-09-28T00:00:00Z") },
  );
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("added: Acme — Engineer"));
  assert.ok(io._files.get("jobs.md").includes("### Acme — Engineer"));
  assert.ok(io._files.has("jd-inbox/acme-engineer.md"));

  // Re-running add for the SAME posting keeps the existing JD file and
  // reports alreadyInJobList, never a second row.
  const jdBefore = io._files.get("jd-inbox/acme-engineer.md");
  const result2 = await boardsRun(
    ["add", "--workspace", ".", "--posting", "https://boards.greenhouse.io/acme/jobs/1", "--company", "Acme"],
    io,
    { fetchImpl: fn, now: () => new Date("2026-09-28T00:00:00Z") },
  );
  assert.equal(result2.exitCode, 0);
  assert.ok(result2.stdout.includes("already in job list"));
  assert.equal(io._files.get("jd-inbox/acme-engineer.md"), jdBefore, "an existing JD file is kept");
});
