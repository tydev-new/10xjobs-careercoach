// The board readers, written once (design-web-search.md § 4.4): address
// parsing, API address building, reading each system's list and posting,
// the word and date filters, the dedupe decision, the row built, the slug
// and the JD header. Runs in Node (skills/search/scripts/boards.mjs) AND in
// the browser (packages/agent/src/tools/boards.ts) — no node:*, no DOM
// global (tests/agent/board-readers-browser-safety.test.ts). The Workday
// reader is NOT here on purpose: "the Workday reader runs only in the
// command, under Node" (§ 4.4) — its parsing and fetching live entirely in
// boards.mjs, which imports the shared pieces below (the entity decode, the
// whitespace clean, the filters, the dedupe/row-building) the same as the
// other four systems.
//
// Lead ruling: the whitespace class is defined ONCE, in jobs-md.mjs; this
// file imports it rather than redefining it.
import { SANITISE_WS_CHARS, cleanValue, canon, key as jobsMdKey } from "./jobs-md.mjs";

// ---------------------------------------------------------------------
// § 4.4 — one entity table, one whitespace class (imported above)
// ---------------------------------------------------------------------

// "Decoding uses exactly this table: &amp; &lt; &gt; &quot; &#39; &apos;
// &nbsp; (to U+00A0), plus numeric &#NNN; and &#xHH;; any other &name; is
// left as written." No library HTML unescape (Node has none built in; the
// browser's DOMParser exists only there and knows ~2,000 names, so a
// library call would decode the same posting differently by host).
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** Decodes exactly the table above, leaving any other &name; as written
 *  (the design's own named risk: "a posting using an entity outside the
 *  table shows it as written"). */
export function decodeEntities(text) {
  return String(text ?? "").replace(ENTITY_RE, (whole, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = isHex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

const TAG_RE = /<[^>]+>/g;

/** § 4.4's fix: "the new readers decode, then strip" (Greenhouse's
 *  `content` — and any other HTML field — used to have tags stripped
 *  before entities were decoded, leaving `&lt;div&gt;` in saved postings).
 *  Whitespace is then collapsed with jobs-md's own written-out class
 *  (never `\s`), so a posting is cleaned identically here and in
 *  `jobs_md.save()`. */
export function htmlToText(html) {
  const decoded = decodeEntities(html);
  const stripped = decoded.replace(TAG_RE, " ");
  return cleanValue(stripped) ?? "";
}

// ---------------------------------------------------------------------
// § 4.1 — title-word and posting-age filters
// ---------------------------------------------------------------------

// "a posting is kept when its title contains any of them as whole words,
// ignoring case, with hyphens, commas and slashes read as spaces."
function normalizeForWordMatch(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[-,/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `title` contains at least one of `titleWords` as a whole
 *  (possibly multi-word) phrase. No words -> every title is kept. */
export function titleMatchesWords(title, titleWords) {
  if (!titleWords || titleWords.length === 0) return true;
  const t = normalizeForWordMatch(title);
  if (!t) return false;
  return titleWords.some((word) => {
    const needle = normalizeForWordMatch(word);
    if (!needle) return false;
    const re = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:$|\\s)`);
    return re.test(t);
  });
}

/** "only postings with a known date older than the limit are dropped" — no
 *  date, or no limit, always passes. `postedAt` is `YYYY-MM-DD` or
 *  undefined/empty. */
export function withinPostedWindow(postedAt, postedWithinDays, now = new Date()) {
  if (!postedWithinDays) return true;
  if (!postedAt) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(postedAt);
  if (!m) return true;
  const posted = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(posted)) return true;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = Math.floor((today - posted) / 86400000);
  return ageDays <= postedWithinDays;
}

// ---------------------------------------------------------------------
// § 4.1/§ 4.2 — dedupe against the job list
// ---------------------------------------------------------------------

/** A posting is "already in the job list" when its link (trimmed, exact —
 *  the hosted address or the application link) OR its company-and-title
 *  key matches any row, dismissed rows included. Returns the matching row,
 *  or null. */
export function findInJobList(posting, existingRows) {
  const postingLink = (posting.postingUrl || "").trim();
  const postingKeyStr = jobsMdKey({ company: posting.company ?? "", title: posting.title ?? "" });
  for (const row of existingRows) {
    const rowLink = (row.url || "").trim();
    if (postingLink && rowLink && rowLink === postingLink) return row;
    if (jobsMdKey(row) === postingKeyStr) return row;
  }
  return null;
}

// ---------------------------------------------------------------------
// § 4.1 — "gone" (a board read in full no longer lists a row)
// ---------------------------------------------------------------------

/** `items` is the board's FULL, unfiltered list (before title/date
 *  filtering — a retitled posting must still count as present, § 4.1's own
 *  proof). Only call this when the board was read IN FULL (status "ok" and
 *  read === total): the caller decides that, this function assumes it. */
export function computeGone({ company }, items, existingRows) {
  const boardCompanyKey = canon(company);
  const gone = [];
  for (const row of existingRows) {
    if (row.dismissed) continue;
    if (row.stage !== "To Review") continue;
    if (row.was_stage) continue; // "never moved by the candidate"
    if (canon(row.company) !== boardCompanyKey) continue;
    const present = items.some((it) => {
      const link = (it.postingUrl || "").trim();
      const rowLink = (row.url || "").trim();
      if (link && rowLink && link === rowLink) return true;
      return jobsMdKey({ company: row.company, title: row.title }) === jobsMdKey({ company, title: it.title });
    });
    if (!present) gone.push({ company: row.company, title: row.title });
  }
  return gone;
}

// ---------------------------------------------------------------------
// § 4.2 — the slug and the JD header (search_ats.py's own rule, ported)
// ---------------------------------------------------------------------

/** `search_ats.py`'s own rule: lowercase "{company}-{title}", every run of
 *  non [a-z0-9] characters becomes one "-", trimmed, capped at 80 chars. */
export function jdSlug(company, title) {
  return String(`${company}-${title}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function jdPath(company, title) {
  return `jd-inbox/${jdSlug(company, title)}.md`;
}

/** The sweep's own header shape, byte for byte: "# {company} — {title}\n#
 *  Source: {url}\n\n{body}\n". */
export function jdFileContents(company, title, url, body) {
  const cleanBody = cleanValue(body) || "(JD body not fetched for this posting)";
  return `# ${company} — ${title}\n# Source: ${url}\n\n${cleanBody}\n`;
}

// ---------------------------------------------------------------------
// § 4.2 item 8 — the two settings code enforces
// ---------------------------------------------------------------------

const SETTINGS_BULLET_RE = /^-\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/;

/** Returns the body of a `## <name>` markdown section (everything after
 *  the heading line, up to the next `## ` heading or end of file). Plain
 *  line scanning — no lookahead-past-multiline-`$` regex, which `\Z`
 *  (Python-only) can't express in JS anyway. */
function extractSection(text, name) {
  const lines = text.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(name)}\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Reads `criteria.md § Search settings`' two code-enforced bullets:
 *  "max new roles per company" (default 5) and "active pipeline cap"
 *  (default 25). A value present but not a non-negative whole number is a
 *  `tool_error` naming the bullet (as the sweep's parser did). Absent
 *  bullets keep their default. */
export function parseSearchSettings(criteriaMd) {
  const defaults = { maxNewRolesPerCompany: 5, activePipelineCap: 25 };
  const text = String(criteriaMd ?? "");
  const body = extractSection(text, "Search settings");
  const labels = {
    "max new roles per company": "maxNewRolesPerCompany",
    "active pipeline cap": "activePipelineCap",
  };
  const out = { ...defaults };
  for (const line of body.split("\n")) {
    const m = SETTINGS_BULLET_RE.exec(line.trim());
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    const key = labels[label];
    if (!key) continue;
    const raw = m[2].trim();
    if (raw === "") continue;
    if (!/^[0-9]+$/.test(raw)) {
      return { error: `criteria.md § Search settings: "${m[1].trim()}" must be a whole number, got "${raw}"` };
    }
    out[key] = Number.parseInt(raw, 10);
  }
  return out;
}

// ---------------------------------------------------------------------
// § 4.8 — address parsing (the four shared systems)
// ---------------------------------------------------------------------

// Board ids: `^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$` (no dots, so no `..` path).
const BOARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
// Posting ids: digits (Greenhouse, SmartRecruiters) or a 36-character UUID
// (Lever, Ashby).
const DIGIT_ID_RE = /^[0-9]+$/;
const UUID_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function validBoardId(s) {
  return typeof s === "string" && BOARD_ID_RE.test(s);
}

const SYSTEMS = {
  greenhouse: {
    hosts: new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]),
    boardPathRe: /^\/([^/]+)\/?$/,
    postingPathRe: /^\/([^/]+)\/jobs\/([0-9]+)\/?$/,
    validPostingId: (id) => DIGIT_ID_RE.test(id),
  },
  lever: {
    hosts: new Set(["jobs.lever.co"]),
    boardPathRe: /^\/([^/]+)\/?$/,
    postingPathRe: /^\/([^/]+)\/([0-9a-fA-F-]{36})\/?$/,
    validPostingId: (id) => UUID_ID_RE.test(id),
  },
  ashby: {
    hosts: new Set(["jobs.ashbyhq.com"]),
    boardPathRe: /^\/([^/]+)\/?$/,
    postingPathRe: /^\/([^/]+)\/([0-9a-fA-F-]{36})\/?$/,
    validPostingId: (id) => UUID_ID_RE.test(id),
  },
  smartrecruiters: {
    hosts: new Set(["jobs.smartrecruiters.com"]),
    boardPathRe: /^\/([^/]+)\/?$/,
    postingPathRe: /^\/([^/]+)\/([0-9]+)(?:-[^/]*)?\/?$/,
    validPostingId: (id) => DIGIT_ID_RE.test(id),
  },
};

export const SUPPORTED_SYSTEMS = Object.keys(SYSTEMS);

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** `url` is a board address, or any posting on one (§ 4.1). Returns
 *  `{ system, boardSlug }` or null ("not a job board Ten can read here"). */
export function parseBoardUrl(url) {
  const u = parseUrl(url);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return null;
  for (const [system, cfg] of Object.entries(SYSTEMS)) {
    if (!cfg.hosts.has(u.hostname)) continue;
    let m = u.pathname.match(cfg.postingPathRe);
    if (m && validBoardId(m[1])) return { system, boardSlug: m[1] };
    m = u.pathname.match(cfg.boardPathRe);
    if (m && validBoardId(m[1])) return { system, boardSlug: m[1] };
    return null; // right host, unrecognised path shape
  }
  return null;
}

/** A single posting's own address (add_roles, fetch_job). Returns
 *  `{ system, boardSlug, postingId }` or null. */
export function parsePostingUrl(url) {
  const u = parseUrl(url);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return null;
  for (const [system, cfg] of Object.entries(SYSTEMS)) {
    if (!cfg.hosts.has(u.hostname)) continue;
    const m = u.pathname.match(cfg.postingPathRe);
    if (!m || !validBoardId(m[1]) || !cfg.validPostingId(m[2])) return null;
    return { system, boardSlug: m[1], postingId: m[2] };
  }
  return null;
}

// ---------------------------------------------------------------------
// § 4.8 — code fetches only addresses it builds, on the four API hosts
// ---------------------------------------------------------------------

const API_HOSTS = {
  greenhouse: "boards-api.greenhouse.io",
  lever: "api.lever.co",
  ashby: "api.ashbyhq.com",
  smartrecruiters: "api.smartrecruiters.com",
};
export { API_HOSTS };

function listApiUrl(system, boardSlug, page) {
  switch (system) {
    case "greenhouse":
      return `https://${API_HOSTS.greenhouse}/v1/boards/${boardSlug}/jobs?content=true`;
    case "lever":
      return `https://${API_HOSTS.lever}/v0/postings/${boardSlug}?mode=json`;
    case "ashby":
      return `https://${API_HOSTS.ashby}/posting-api/job-board/${boardSlug}?includeCompensation=true`;
    case "smartrecruiters": {
      const offset = ((page ?? 1) - 1) * SMARTRECRUITERS_PAGE_SIZE;
      return `https://${API_HOSTS.smartrecruiters}/v1/companies/${boardSlug}/postings?limit=${SMARTRECRUITERS_PAGE_SIZE}&offset=${offset}`;
    }
    default:
      throw new Error(`listApiUrl: unknown system ${system}`);
  }
}

function postingApiUrl(system, boardSlug, postingId) {
  switch (system) {
    case "greenhouse":
      return `https://${API_HOSTS.greenhouse}/v1/boards/${boardSlug}/jobs/${postingId}`;
    case "lever":
      return `https://${API_HOSTS.lever}/v0/postings/${boardSlug}/${postingId}`;
    case "ashby":
      // No single-posting endpoint (§ 4.1) — read the board once, find the
      // job within it.
      return `https://${API_HOSTS.ashby}/posting-api/job-board/${boardSlug}?includeCompensation=true`;
    case "smartrecruiters":
      return `https://${API_HOSTS.smartrecruiters}/v1/companies/${boardSlug}/postings/${postingId}`;
    default:
      throw new Error(`postingApiUrl: unknown system ${system}`);
  }
}

const SMARTRECRUITERS_PAGE_SIZE = 100;
const SMARTRECRUITERS_MAX_PAGES = 3;

// ---------------------------------------------------------------------
// § 4.8 — the request budget: 60/turn, 4 at a time, 15s each, no retries
// ---------------------------------------------------------------------

export function createRequestBudget({ max = 60, concurrency = 4, timeoutMs = 15000 } = {}) {
  let remaining = max;
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const resolve = queue.shift();
    resolve();
  };
  const acquire = () =>
    new Promise((resolve) => {
      queue.push(resolve);
      runNext();
    });
  const release = () => {
    active--;
    runNext();
  };
  return {
    get remaining() {
      return remaining;
    },
    get used() {
      return max - remaining;
    },
    /** Performs one budgeted, concurrency-limited, timed-out, no-retry
     *  fetch. `redirect: "error"` always (§ 4.8: "a board answer can't
     *  send the browser's request elsewhere"). Never throws — every
     *  outcome is a tagged return value. */
    async fetch(fetchImpl, url, init = {}) {
      if (remaining <= 0) return { ok: false, reason: "request_limit" };
      remaining -= 1;
      await acquire();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
          return { ok: true, response };
        } catch (e) {
          return { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) };
        } finally {
          clearTimeout(timer);
        }
      } finally {
        release();
      }
    },
  };
}

// ---------------------------------------------------------------------
// § 4.1/§ 4.4 — extracting fields from each system's own JSON shape
// ---------------------------------------------------------------------

function isoDateOnly(v) {
  if (!v) return undefined;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function extractGreenhouseItem(boardSlug, j) {
  return {
    title: htmlToText(j.title ?? ""),
    location: htmlToText(j.location?.name ?? ""),
    postingUrl: j.absolute_url ?? "",
    postedAt: isoDateOnly(j.first_published ?? j.updated_at),
    companyName: j.company_name ? htmlToText(j.company_name) : undefined,
    text: htmlToText(j.content ?? ""),
    _id: j.id !== undefined && j.id !== null ? String(j.id) : undefined,
  };
}

function extractLeverItem(boardSlug, j) {
  return {
    title: htmlToText(j.text ?? ""),
    location: htmlToText(j.categories?.location ?? ""),
    postingUrl: j.hostedUrl ?? "",
    postedAt: (() => {
      const ms = j.createdAt;
      if (!ms) return undefined;
      const d = new Date(Number(ms));
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
    })(),
    // § 4.4's fix: Lever has no company field — the OLD fetch_job named
    // the role after its team; the board slug is the company here,
    // boardName stays absent.
    companyName: undefined,
    text: htmlToText(j.descriptionPlain ?? j.description ?? ""),
    _id: j.id ?? undefined,
  };
}

function extractAshbyItem(boardSlug, j) {
  return {
    title: htmlToText(j.title ?? ""),
    location: htmlToText(j.locationName ?? j.location ?? ""),
    postingUrl: j.jobUrl ?? "",
    postedAt: isoDateOnly(j.publishedDate ?? j.publishedAt),
    companyName: undefined, // Ashby gives no company name either (§ 6)
    text: htmlToText(j.descriptionPlain ?? j.descriptionHtml ?? j.description ?? ""),
    compensation: j.compensation?.summary ? htmlToText(j.compensation.summary) : undefined,
    _id: j.id ?? undefined,
  };
}

function extractSmartRecruitersItem(boardSlug, j) {
  const sections = j.jobAd?.sections ?? {};
  const text = [sections.jobDescription?.text, sections.qualifications?.text].filter(Boolean).join("\n\n");
  return {
    title: htmlToText(j.name ?? ""),
    location: htmlToText(j.location?.city ?? ""),
    postingUrl: `https://jobs.smartrecruiters.com/${boardSlug}/${j.id ?? ""}`,
    postedAt: isoDateOnly(j.releasedDate),
    companyName: j.company?.name ? htmlToText(j.company.name) : undefined,
    text: htmlToText(text),
    _id: j.id !== undefined && j.id !== null ? String(j.id) : undefined,
  };
}

const EXTRACTORS = {
  greenhouse: extractGreenhouseItem,
  lever: extractLeverItem,
  ashby: extractAshbyItem,
  smartrecruiters: extractSmartRecruitersItem,
};

// ---------------------------------------------------------------------
// Reading a board's list
// ---------------------------------------------------------------------

/** Reads one board's list, in full for greenhouse/lever/ashby, paginated
 *  (100/page, at most 3 pages) for smartrecruiters. `ashbyCache` (a Map,
 *  owned by the caller, one per turn) lets add_roles/fetch_job reuse an
 *  Ashby read already done this turn (§ 4.1: "one request"). Never throws. */
export async function readBoardList({ system, boardSlug }, { fetchImpl, budget, ashbyCache }) {
  if (system === "ashby" && ashbyCache?.has(boardSlug)) {
    return ashbyCache.get(boardSlug);
  }
  const result = await readBoardListUncached({ system, boardSlug }, { fetchImpl, budget });
  if (system === "ashby" && ashbyCache) ashbyCache.set(boardSlug, result);
  return result;
}

async function readBoardListUncached({ system, boardSlug }, { fetchImpl, budget }) {
  const extractor = EXTRACTORS[system];
  if (system !== "smartrecruiters") {
    const r = await budget.fetch(fetchImpl, listApiUrl(system, boardSlug));
    if (!r.ok) return statusFromFailure(r);
    const status = await statusFromResponse(r.response);
    if (status.status !== "json") return status;
    const json = status.json;
    const items = (system === "lever" ? json : json?.jobs ?? json) ?? [];
    const list = Array.isArray(items) ? items : [];
    const extracted = list.map((raw) => extractor(boardSlug, raw));
    const boardName = extracted.find((x) => x.companyName)?.companyName;
    return {
      status: extracted.length === 0 ? "empty" : "ok",
      boardName,
      total: extracted.length,
      read: extracted.length,
      items: extracted,
    };
  }
  // SmartRecruiters: up to 3 pages of 100.
  let allItems = [];
  let totalFound = 0;
  for (let page = 1; page <= SMARTRECRUITERS_MAX_PAGES; page++) {
    const r = await budget.fetch(fetchImpl, listApiUrl(system, boardSlug, page));
    if (!r.ok) {
      if (page === 1) return statusFromFailure(r);
      break; // a later page failing still reports what was read
    }
    const status = await statusFromResponse(r.response);
    if (status.status !== "json") {
      if (page === 1) return status;
      break;
    }
    const json = status.json;
    totalFound = Number.isFinite(json?.totalFound) ? json.totalFound : totalFound;
    const content = Array.isArray(json?.content) ? json.content : [];
    allItems = allItems.concat(content.map((raw) => extractor(boardSlug, raw)));
    if (content.length < SMARTRECRUITERS_PAGE_SIZE) break;
  }
  const boardName = allItems.find((x) => x.companyName)?.companyName;
  return {
    status: allItems.length === 0 ? "empty" : "ok",
    boardName,
    total: totalFound || allItems.length,
    read: allItems.length,
    items: allItems,
  };
}

function statusFromFailure(r) {
  if (r.reason === "request_limit") return { status: "request_limit", total: 0, read: 0, items: [] };
  return { status: "error", total: 0, read: 0, items: [] };
}

async function statusFromResponse(response) {
  if (response.status === 404) return { status: "not_found", total: 0, read: 0, items: [] };
  if (!response.ok) return { status: "error", total: 0, read: 0, items: [] };
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (contentType && !contentType.includes("json")) {
    return { status: "error", total: 0, read: 0, items: [] };
  }
  try {
    const json = await response.json();
    return { status: "json", json };
  } catch {
    return { status: "error", total: 0, read: 0, items: [] };
  }
}

// ---------------------------------------------------------------------
// Reading one posting
// ---------------------------------------------------------------------

/** Reads one posting. Returns `{ ok: true, ...fields }` or
 *  `{ ok: false, reason }` where reason is one of
 *  "not_found" | "error" | "request_limit". Never throws. */
export async function readPosting({ system, boardSlug, postingId }, { fetchImpl, budget, ashbyCache }) {
  if (system === "ashby") {
    const board = await readBoardList({ system, boardSlug }, { fetchImpl, budget, ashbyCache });
    if (board.status === "request_limit") return { ok: false, reason: "request_limit" };
    if (board.status === "not_found" || board.status === "error") return { ok: false, reason: board.status };
    const found = board.items.find((it) => String(it._id) === String(postingId));
    if (!found) return { ok: false, reason: "not_found" };
    return { ok: true, board: system, boardSlug, ...found };
  }
  const r = await budget.fetch(fetchImpl, postingApiUrl(system, boardSlug, postingId));
  if (!r.ok) return { ok: false, reason: r.reason === "request_limit" ? "request_limit" : "error" };
  if (r.response.status === 404) return { ok: false, reason: "not_found" };
  if (!r.response.ok) return { ok: false, reason: "error" };
  let json;
  try {
    json = await r.response.json();
  } catch {
    return { ok: false, reason: "error" };
  }
  const extractor = EXTRACTORS[system];
  const extracted = extractor(boardSlug, json);
  // Lever's fix (§ 4.4): no company field — the board slug names the
  // company, never the team.
  const companyName = system === "lever" ? boardSlug : extracted.companyName;
  return { ok: true, board: system, boardSlug, ...extracted, companyName };
}

// ---------------------------------------------------------------------
// § 4.1 — capping shown postings (40/board, 120/call)
// ---------------------------------------------------------------------

export function createShowBudget(max = 120) {
  return { remaining: max };
}

/** Applies the per-board (40) and per-call (120, running across boards in
 *  the order they were processed) caps. `matched` stays the true count;
 *  the rest are simply not included in `postings`. */
export function applyShowCap(matchedNotDuplicate, showBudget, perBoardCap = 40) {
  const boardCap = Math.max(0, Math.min(perBoardCap, showBudget.remaining));
  const shown = matchedNotDuplicate.slice(0, boardCap);
  showBudget.remaining -= shown.length;
  return shown;
}
