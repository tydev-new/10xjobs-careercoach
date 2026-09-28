#!/usr/bin/env node
// The local board reader/writer (design-web-search.md § 3.2, § 4.1, § 4.2,
// § 5.2): `boards.mjs list` and `boards.mjs add`, over five systems
// (Greenhouse, Lever, Ashby, SmartRecruiters, and — Node-only, this file —
// Workday). The four shared systems' address parsing, API calls, filters,
// dedupe and row-building all come from lib/board-readers.mjs, the same
// module packages/agent/src/tools/boards.ts imports for the web's
// list_board/add_roles (§ 4.4, "one implementation"). Workday's own
// parsing and reading live ONLY here ("the Workday reader runs only in the
// command, under Node") — it still calls board-readers.mjs's shared
// filters/dedupe/row-building, so a Workday posting is filtered, deduped,
// cleaned and slugged exactly like the other four.
//
// New in S2 (not ported from a Python original) — no captured `-h` text in
// help-text.mjs; its own USAGE string lives here.
import { nodeIo } from "../../profile/scripts/lib/io-node.mjs";
import { join } from "../../profile/scripts/lib/path-util.mjs";
import * as jm from "./lib/jobs-md.mjs";
import {
  applyShowCap,
  computeGone,
  createRequestBudget,
  createShowBudget,
  findInJobList,
  jdFileContents,
  jdPath,
  parseBoardUrl,
  parsePostingUrl,
  parseSearchSettings,
  readBoardList,
  readPosting,
  titleMatchesWords,
  withinPostedWindow,
} from "./lib/board-readers.mjs";

const { canon, cleanValue } = jm;

const USAGE = `usage: boards.mjs list --workspace WORKSPACE --board URL --company NAME
                   [--board URL --company NAME ...]
                   [--title-words "a,b,c"] [--days N]
       boards.mjs add --workspace WORKSPACE --posting URL --company NAME
                   [--posting URL --company NAME ...]

List or add postings from company job boards (Greenhouse, Lever, Ashby,
SmartRecruiters, Workday). One implementation shared with the web app's
list_board/add_roles (design-web-search.md § 4.4).

  node boards.mjs list --workspace . --board https://boards.greenhouse.io/acme --company Acme --title-words "engineer,eng lead" --days 30
  node boards.mjs add --workspace . --posting https://boards.greenhouse.io/acme/jobs/12345 --company Acme

options:
  -h, --help            show this help message and exit
  --workspace WORKSPACE
  --board URL           repeatable, paired in order with --company
  --company NAME        repeatable, paired in order with --board (list) or --posting (add)
  --posting URL         repeatable, paired in order with --company (add)
  --title-words "a,b"   comma-separated; each phrase up to 4 words (list)
  --days N              only postings within N days (list)
`;

// ---------------------------------------------------------------------
// Workday (Node-only — "the Workday reader runs only in the command,
// under Node", design-web-search.md § 4.4). Endpoint shapes match the
// sweep's own (search_ats.py's `fetch_postings`, vendor == "workday"),
// ported here rather than shared, since board-readers.mjs must stay
// browser-safe and Workday refuses browser calls (§ 12).
// ---------------------------------------------------------------------

const WORKDAY_HOST_RE = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/;

/** `{t}.wd{n}.myworkdayjobs.com/{site}` (a board) or any posting on one —
 *  same shape list_board/add_roles expect from the four shared systems'
 *  own parseBoardUrl/parsePostingUrl. Returns
 *  `{ tenant, dc, site }` or null. */
function parseWorkdayUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const hostMatch = WORKDAY_HOST_RE.exec(u.hostname);
  if (!hostMatch) return null;
  const [, tenant, dc] = hostMatch;
  const parts = u.pathname.split("/").filter(Boolean);
  // "/en-US/{site}..." or "/{site}..." — the locale prefix is optional.
  const siteIdx = parts[0] && /^[a-z]{2}-[A-Z]{2}$/.test(parts[0]) ? 1 : 0;
  const site = parts[siteIdx];
  if (!site || !/^[A-Za-z0-9_-]+$/.test(site)) return null;
  return { tenant, dc, site };
}

async function fetchWorkdayList({ tenant, dc, site }, { fetchImpl, budget }) {
  const base = `https://${tenant}.${dc}.myworkdayjobs.com`;
  let out = [];
  let offset = 0;
  let total = 0;
  while (offset <= 60) {
    // 4 pages x 20, same bound the sweep used.
    const r = await budget.fetch(fetchImpl, `${base}/wday/cxs/${tenant}/${site}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }),
    });
    if (!r.ok) {
      if (offset === 0) return r.reason === "request_limit" ? { status: "request_limit", total: 0, read: 0, items: [] } : { status: "error", total: 0, read: 0, items: [] };
      break;
    }
    if (!r.response.ok) {
      if (offset === 0) return r.response.status === 404 ? { status: "not_found", total: 0, read: 0, items: [] } : { status: "error", total: 0, read: 0, items: [] };
      break;
    }
    let json;
    try {
      json = await r.response.json();
    } catch {
      if (offset === 0) return { status: "error", total: 0, read: 0, items: [] };
      break;
    }
    total = Number.isFinite(json?.total) ? json.total : total;
    const page = Array.isArray(json?.jobPostings) ? json.jobPostings : [];
    for (const p of page) {
      out.push({
        title: cleanValue(p.title ?? "") ?? "",
        location: cleanValue(p.locationsText ?? "") ?? "",
        postingUrl: `${base}/en-US/${site}${p.externalPath ?? ""}`,
        postedAt: undefined, // Workday's list gives a relative string ("Posted 3 Days Ago"), not a date — never guessed (rule 11).
        companyName: undefined,
        text: "",
        _id: p.externalPath ?? undefined,
      });
    }
    if (page.length < 20) break;
    offset += 20;
  }
  return { status: out.length === 0 ? "empty" : "ok", boardName: undefined, total: total || out.length, read: out.length, items: out };
}

async function readWorkdayPosting({ tenant, dc, site }, postingPath, { fetchImpl, budget }) {
  const board = await fetchWorkdayList({ tenant, dc, site }, { fetchImpl, budget });
  if (board.status === "request_limit") return { ok: false, reason: "request_limit" };
  if (board.status === "not_found" || board.status === "error") return { ok: false, reason: board.status };
  const found = board.items.find((it) => it.postingUrl.endsWith(postingPath));
  if (!found) return { ok: false, reason: "not_found" };
  return { ok: true, board: "workday", boardSlug: site, ...found, companyName: undefined };
}

// ---------------------------------------------------------------------
// Address dispatch across all five systems.
// ---------------------------------------------------------------------

function parseAnyBoardUrl(url) {
  const shared = parseBoardUrl(url);
  if (shared) return shared;
  const wd = parseWorkdayUrl(url);
  if (wd) return { system: "workday", ...wd };
  return null;
}

function parseAnyPostingUrl(url) {
  const shared = parsePostingUrl(url);
  if (shared) return shared;
  const wd = parseWorkdayUrl(url);
  if (wd) {
    const u = new URL(url);
    return { system: "workday", ...wd, postingPath: u.pathname };
  }
  return null;
}

async function readAnyBoardList(parsed, deps) {
  if (parsed.system === "workday") return fetchWorkdayList(parsed, deps);
  return readBoardList(parsed, deps);
}

async function readAnyPosting(parsed, deps) {
  if (parsed.system === "workday") return readWorkdayPosting(parsed, parsed.postingPath, deps);
  return readPosting(parsed, deps);
}

// ---------------------------------------------------------------------
// A tiny argv parser for this file's own repeatable `--board`/`--company`/
// `--posting` pairs — argx.mjs's `append` collects same-flag values in
// appearance order, which is exactly "paired in order" as long as the
// caller alternates them (documented in USAGE above); it does not itself
// enforce alternation, so this file cross-checks the two arrays' lengths.
// ---------------------------------------------------------------------

function parseArgv(argv) {
  const out = {
    help: false,
    workspace: null,
    boards: [],
    companies: [],
    postings: [],
    titleWords: null,
    days: null,
    error: null,
  };
  let i = 0;
  const next = (name) => {
    i++;
    if (i >= argv.length) throw new Error(`argument ${name}: expected one argument`);
    return argv[i];
  };
  try {
    for (; i < argv.length; i++) {
      const tok = argv[i];
      if (tok === "-h" || tok === "--help") {
        out.help = true;
        return out;
      } else if (tok === "--workspace") {
        out.workspace = next("--workspace");
      } else if (tok === "--board") {
        out.boards.push(next("--board"));
      } else if (tok === "--company") {
        out.companies.push(next("--company"));
      } else if (tok === "--posting") {
        out.postings.push(next("--posting"));
      } else if (tok === "--title-words") {
        out.titleWords = next("--title-words");
      } else if (tok === "--days") {
        out.days = next("--days");
      } else {
        throw new Error(`unrecognized arguments: ${tok}`);
      }
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// ---------------------------------------------------------------------
// list
// ---------------------------------------------------------------------

async function runList(a, io, { fetchImpl, now }) {
  if (a.boards.length === 0) return { stdout: "", stderr: "error: at least one --board/--company pair is required\n", exitCode: 2 };
  if (a.boards.length !== a.companies.length) {
    return { stdout: "", stderr: "error: --board and --company must be given the same number of times, paired in order\n", exitCode: 2 };
  }
  if (a.boards.length > 10) return { stdout: "", stderr: "error: at most 10 --board/--company pairs\n", exitCode: 2 };
  let days = null;
  if (a.days !== null) {
    days = Number(a.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return { stdout: "", stderr: "error: --days must be a whole number from 1 to 365\n", exitCode: 2 };
    }
  }
  const titleWords = a.titleWords ? a.titleWords.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const rows = await jm.load(io, a.workspace);
  const budget = createRequestBudget();
  const ashbyCache = new Map();
  const showBudget = createShowBudget(120);

  const lines = [];
  for (let idx = 0; idx < a.boards.length; idx++) {
    const url = a.boards[idx];
    const company = a.companies[idx];
    const parsed = parseAnyBoardUrl(url);
    if (!parsed) {
      lines.push(`${company} · unsupported_url · not a job board Ten can read here`);
      continue;
    }
    const read = await readAnyBoardList(parsed, { fetchImpl, budget, ashbyCache });
    if (read.status !== "ok" && read.status !== "empty") {
      lines.push(`${company} · ${read.status} · 0 postings`);
      continue;
    }
    const matchedItems = read.items.filter((it) => titleMatchesWords(it.title, titleWords) && withinPostedWindow(it.postedAt, days ?? undefined, now()));
    let alreadyCount = 0;
    const notDup = [];
    for (const it of matchedItems) {
      const found = findInJobList({ company, title: it.title, postingUrl: it.postingUrl }, rows);
      if (found) alreadyCount++;
      else notDup.push(it);
    }
    const shownItems = applyShowCap(notDup, showBudget, 40);
    const gone = read.status === "ok" && read.read === read.total ? computeGone({ company }, read.items, rows) : [];
    const partial = read.status === "ok" && read.read < read.total ? ` · read ${read.read} of ${read.total}` : "";
    lines.push(
      `${company} · ${read.status} · ${read.total} postings · ${matchedItems.length} match · ${alreadyCount} already on the list · showing ${shownItems.length}${partial}`,
    );
    for (const it of shownItems) {
      lines.push(`  ${it.postingUrl} | ${it.title} | ${it.location} | ${it.postedAt ?? ""}`);
    }
    for (const g of gone) {
      lines.push(`  gone: ${g.company} — ${g.title}`);
    }
  }
  lines.push(`requests left this turn: ${budget.remaining}`);
  return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
}

// ---------------------------------------------------------------------
// add
// ---------------------------------------------------------------------

async function runAdd(a, io, { fetchImpl, now }) {
  if (a.postings.length === 0) return { stdout: "", stderr: "error: at least one --posting/--company pair is required\n", exitCode: 2 };
  if (a.postings.length !== a.companies.length) {
    return { stdout: "", stderr: "error: --posting and --company must be given the same number of times, paired in order\n", exitCode: 2 };
  }
  if (a.postings.length > 20) return { stdout: "", stderr: "error: at most 20 --posting/--company pairs\n", exitCode: 2 };

  const rows = await jm.load(io, a.workspace);

  let settings = { maxNewRolesPerCompany: 5, activePipelineCap: 25 };
  const criteriaPath = join(a.workspace, "criteria.md");
  if (await io.exists(criteriaPath)) {
    const criteriaText = await io.readFile(criteriaPath);
    const parsed = parseSearchSettings(criteriaText);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return { stdout: "", stderr: `error: ${parsed.error}\n`, exitCode: 2 };
    }
    settings = parsed;
  }

  const budget = createRequestBudget();
  const ashbyCache = new Map();
  const nowDate = now();
  const todayStr = nowDate.toISOString().slice(0, 10);

  const countsByCompanyToday = new Map();
  for (const row of rows) {
    if (String(row.seen_at || "").slice(0, 10) !== todayStr) continue;
    const k = canon(row.company);
    countsByCompanyToday.set(k, (countsByCompanyToday.get(k) ?? 0) + 1);
  }
  let activeCount = rows.filter((r) => !r.dismissed && r.stage === "To Review").length;

  const lines = [];
  let anyFailed = false;

  for (let idx = 0; idx < a.postings.length; idx++) {
    const posting = a.postings[idx];
    const company = a.companies[idx];
    const parsed = parseAnyPostingUrl(posting);
    if (!parsed) {
      lines.push(`failed: ${posting} — unsupported_url`);
      anyFailed = true;
      continue;
    }
    const read = await readAnyPosting(parsed, { fetchImpl, budget, ashbyCache });
    if (!read.ok) {
      lines.push(`failed: ${posting} — ${read.reason}`);
      anyFailed = true;
      continue;
    }
    if (read.companyName && canon(read.companyName) !== canon(company)) {
      lines.push(`failed: ${posting} — company_mismatch ("${company}" vs board's "${read.companyName}")`);
      anyFailed = true;
      continue;
    }
    const cleanedCompany = cleanValue(company);
    const cleanedTitle = cleanValue(read.title);
    if (!cleanedCompany || !cleanedTitle) {
      lines.push(`failed: ${posting} — empty_field`);
      anyFailed = true;
      continue;
    }
    const dup = findInJobList({ company, title: read.title, postingUrl: read.postingUrl }, rows);
    if (dup) {
      lines.push(`already in job list: ${company} — ${dup.title} (${dup.dismissed ? "dismissed" : dup.stage})`);
      continue;
    }
    const companyKey = canon(company);
    if ((countsByCompanyToday.get(companyKey) ?? 0) >= settings.maxNewRolesPerCompany) {
      lines.push(`failed: ${posting} — company_limit`);
      anyFailed = true;
      continue;
    }
    if (activeCount >= settings.activePipelineCap) {
      lines.push(`failed: ${posting} — active_cap`);
      anyFailed = true;
      continue;
    }

    const jdRel = jdPath(company, read.title);
    const jdFullPath = join(a.workspace, jdRel);
    if (!(await io.exists(jdFullPath))) {
      await io.writeFile(jdFullPath, jdFileContents(company, read.title, read.postingUrl, read.text));
    }

    const nowIsoStr = jm.nowIso(() => nowDate);
    const row = {
      company,
      title: read.title,
      stage: "To Review",
      dismissed: false,
      url: read.postingUrl,
      location: read.location,
      posted_at: read.postedAt ?? null,
      jd_file: jdRel,
      seen_at: nowIsoStr,
      updated_at: nowIsoStr,
    };
    rows.push(row);
    try {
      await jm.save(io, a.workspace, rows, { now: () => nowDate, writeKey: jm.key(row) });
    } catch (e) {
      if (e instanceof jm.DuplicateKeyError || e instanceof jm.EmptyFieldError) {
        return { stdout: lines.join("\n") + (lines.length ? "\n" : ""), stderr: e.message + "\n", exitCode: 1 };
      }
      throw e;
    }
    countsByCompanyToday.set(companyKey, (countsByCompanyToday.get(companyKey) ?? 0) + 1);
    activeCount++;
    lines.push(`added: ${company} — ${read.title}`);
  }

  return { stdout: lines.join("\n") + (lines.length ? "\n" : ""), stderr: "", exitCode: 0 };
}

// ---------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------

export async function run(argv, io = nodeIo, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "-h" || sub === "--help") {
    return { stdout: sub === undefined ? "" : USAGE, stderr: sub === undefined ? `error: a subcommand (list|add) is required\n${USAGE}` : "", exitCode: sub === undefined ? 2 : 0 };
  }
  if (sub !== "list" && sub !== "add") {
    return { stdout: "", stderr: `error: unrecognized subcommand "${sub}" (want list|add)\n${USAGE}`, exitCode: 2 };
  }
  const a = parseArgv(rest);
  if (a.help) return { stdout: USAGE, stderr: "", exitCode: 0 };
  if (a.error) return { stdout: "", stderr: `error: ${a.error}\n`, exitCode: 2 };
  if (!a.workspace) return { stdout: "", stderr: "error: --workspace is required\n", exitCode: 2 };
  if (sub === "list") return runList(a, io, { fetchImpl, now });
  return runAdd(a, io, { fetchImpl, now });
}

const isMain = (() => {
  try {
    return import.meta.url === new URL(process.argv[1], "file://").href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const frozen = process.env.CHECKER_NOW_ISO;
  const now = frozen ? () => new Date(frozen) : undefined;
  const { stdout, stderr, exitCode } = await run(process.argv.slice(2), nodeIo, now ? { now } : {});
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}
