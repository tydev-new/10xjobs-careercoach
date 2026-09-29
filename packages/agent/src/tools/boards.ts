// list_board and add_roles (design-web-search.md § 4.1, § 4.2) — the web
// tool wrappers around the shared board readers
// (skills/search/scripts/lib/board-readers.mjs), which the local command
// (skills/search/scripts/boards.mjs) also imports. One implementation
// (§ 4.4): every filter, dedupe decision, entity/whitespace clean, slug
// and JD header lives in that file; this one adds only what's web-specific
// — input checks in `execute` (§ 4.8), the estimate-first refusal (§ 4.7,
// M8), the 60-request/turn budget's home on the turn state, and writing
// jobs.md/jd-inbox through the workspace store (M7: no shell path, no new
// script).
//
// board-readers.mjs and jobs-md.mjs are plain JS (they also run in Node,
// under skills/search/scripts/boards.mjs, and in the browser here) — this
// file imports them the same way skills/*/scripts/lib is imported
// anywhere else in the repo, made resolvable to `tsc`/Node's type-stripped
// execution by packages/agent/tsconfig.json's `allowJs` (no .d.ts exists
// for either file, so every import below is typed `any`; every value this
// file puts into a typed return shape is cast explicitly at the boundary).
import { tool, jsonSchema } from "ai";
import type {
  AddRolesFailure,
  AddRolesFailureReason,
  AddRolesInput,
  AddRolesOutput,
  Deps,
  ListBoardBoardResult,
  ListBoardInput,
  ListBoardOutput,
  ListBoardPosting,
  ToolError,
} from "../types.ts";
import { countWords } from "../skills/system-prompt.ts";
import { err, isWorkspaceError } from "./tool-errors.ts";
// Type-only import cycle guard: ToolContext/TurnState live in ./index.ts,
// which imports createBoardsTools from here — a TYPE-only import is
// erased before either `tsc` or Node's type-stripped execution ever sees
// a runtime edge, so there is no real import cycle.
import type { ToolContext } from "./index.ts";

import * as jm from "../../../../skills/search/scripts/lib/jobs-md.mjs";
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
} from "../../../../skills/search/scripts/lib/board-readers.mjs";

const { canon, cleanValue } = jm as any;

// ---------------------------------------------------------------------
// The per-turn budget and Ashby cache (§ 4.8, § 4.1) — shared by
// list_board, add_roles AND fetch_job (index.ts's own tool), so they live
// lazily on ctx.turnState, created on first use.
// ---------------------------------------------------------------------

export function getBoardRequestBudget(ctx: ToolContext): ReturnType<typeof createRequestBudget> {
  if (!ctx.turnState.boardRequestBudget) {
    ctx.turnState.boardRequestBudget = createRequestBudget();
  }
  return ctx.turnState.boardRequestBudget as ReturnType<typeof createRequestBudget>;
}

export function getAshbyCache(ctx: ToolContext): Map<string, unknown> {
  if (!ctx.turnState.ashbyBoardCache) {
    ctx.turnState.ashbyBoardCache = new Map();
  }
  return ctx.turnState.ashbyBoardCache;
}

// ---------------------------------------------------------------------
// § 4.7 (M8) — estimate first, in code.
// ---------------------------------------------------------------------

function estimateFirstError(ctx: ToolContext): ToolError | null {
  if (ctx.turnState.estimateCostRanThisTurn) return null;
  if (ctx.turnStartedByApprovedGate) return null;
  return err("estimate_first", "Call estimate_cost for this run first.");
}

// ---------------------------------------------------------------------
// § 4.8 — input checks (each new tool checks its own input in `execute`)
// ---------------------------------------------------------------------

const MAX_BOARDS = 10;
const MAX_ROLES = 20;
const MAX_TITLE_WORDS = 12;
const MAX_WORDS_PER_TITLE_WORD = 4;
const MAX_COMPANY_CHARS = 100;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateListBoardInput(input: unknown): string | null {
  if (!isPlainObject(input)) return "boards is required.";
  const allowed = new Set(["boards", "titleWords", "postedWithinDays"]);
  for (const k of Object.keys(input)) if (!allowed.has(k)) return `unknown field "${k}".`;
  const boards = (input as unknown as ListBoardInput).boards;
  if (!Array.isArray(boards) || boards.length < 1 || boards.length > MAX_BOARDS) {
    return `boards must have 1-${MAX_BOARDS} entries.`;
  }
  const allowedBoardKeys = new Set(["url", "company"]);
  for (const b of boards) {
    if (!isPlainObject(b)) return "each board must be an object.";
    for (const k of Object.keys(b)) if (!allowedBoardKeys.has(k)) return `unknown field "${k}" on a board.`;
    if (typeof b.url !== "string" || b.url.length === 0) return "each board needs a url.";
    if (typeof b.company !== "string" || b.company.trim().length === 0 || b.company.length > MAX_COMPANY_CHARS) {
      return `each board's company must be 1-${MAX_COMPANY_CHARS} characters.`;
    }
  }
  const titleWords = (input as unknown as ListBoardInput).titleWords;
  if (titleWords !== undefined) {
    if (!Array.isArray(titleWords) || titleWords.length > MAX_TITLE_WORDS) {
      return `titleWords must have at most ${MAX_TITLE_WORDS} entries.`;
    }
    for (const w of titleWords) {
      if (typeof w !== "string" || countWords(w) > MAX_WORDS_PER_TITLE_WORD) {
        return `each title word must be ${MAX_WORDS_PER_TITLE_WORD} words or fewer.`;
      }
    }
  }
  const postedWithinDays = (input as unknown as ListBoardInput).postedWithinDays;
  if (postedWithinDays !== undefined) {
    if (!Number.isInteger(postedWithinDays) || postedWithinDays < 1 || postedWithinDays > 365) {
      return "postedWithinDays must be a whole number from 1 to 365.";
    }
  }
  return null;
}

function validateAddRolesInput(input: unknown): string | null {
  if (!isPlainObject(input)) return "roles is required.";
  const allowed = new Set(["roles"]);
  for (const k of Object.keys(input)) if (!allowed.has(k)) return `unknown field "${k}".`;
  const roles = (input as unknown as AddRolesInput).roles;
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > MAX_ROLES) {
    return `roles must have 1-${MAX_ROLES} entries.`;
  }
  const allowedRoleKeys = new Set(["posting", "company"]);
  for (const r of roles) {
    if (!isPlainObject(r)) return "each role must be an object.";
    for (const k of Object.keys(r)) if (!allowedRoleKeys.has(k)) return `unknown field "${k}" on a role.`;
    if (typeof r.posting !== "string" || r.posting.length === 0) return "each role needs a posting address.";
    if (typeof r.company !== "string" || r.company.trim().length === 0 || r.company.length > MAX_COMPANY_CHARS) {
      return `each role's company must be 1-${MAX_COMPANY_CHARS} characters.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// jobs.md through the workspace store — the same write rules and conflict
// handling as write_file (§ 4.2, M7): reads are chat-tracked (so a
// version_conflict on write is a REAL race, not a stale local guess), and
// jd-inbox writes are create-only (an existing JD file is kept).
// ---------------------------------------------------------------------

function makeWorkspaceIo(deps: Deps, ctx: ToolContext) {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        const read = await deps.workspace.read(path);
        ctx.versionTracker.record(path, read.version);
        return true;
      } catch (e) {
        if (isWorkspaceError(e) && e.code === "resource_missing") return false;
        throw e;
      }
    },
    async readFile(path: string): Promise<string> {
      const read = await deps.workspace.read(path);
      ctx.versionTracker.record(path, read.version);
      if (read.binary) throw new Error(`${path} is binary`);
      return read.content;
    },
    async writeFile(path: string, content: string): Promise<void> {
      const seenVersion = ctx.versionTracker.get(path) ?? null;
      const info = await deps.workspace.write(path, content, seenVersion);
      ctx.versionTracker.record(path, info.version);
    },
  };
}

/** § 4.2 item 5: "create-only; an existing file is kept." Deliberately
 *  NOT routed through the chat's versionTracker (unlike jobs.md above) —
 *  a JD file's create-only-ness must hold regardless of whether the chat
 *  happens to have read/written that exact path before. */
async function writeJdIfAbsent(deps: Deps, path: string, content: string): Promise<void> {
  try {
    await deps.workspace.write(path, content, null);
  } catch (e) {
    if (isWorkspaceError(e) && e.code === "already_exists") return; // kept
    throw e;
  }
}

// ---------------------------------------------------------------------
// § 4.1 — list_board
// ---------------------------------------------------------------------

async function listBoardExecute(deps: Deps, ctx: ToolContext, input: ListBoardInput): Promise<ListBoardOutput | ToolError> {
  const gateErr = estimateFirstError(ctx);
  if (gateErr) return gateErr;
  const problem = validateListBoardInput(input);
  if (problem) return err("tool_error", problem);

  const io = makeWorkspaceIo(deps, ctx);
  const rows = await jm.load(io, "");

  const budget = getBoardRequestBudget(ctx);
  const ashbyCache = getAshbyCache(ctx);

  const parsedBoards = input.boards.map((b) => ({ ref: b, parsed: parseBoardUrl(b.url) }));
  const readResults = await Promise.all(
    parsedBoards.map(({ parsed }: { parsed: any }) =>
      parsed ? readBoardList(parsed, { fetchImpl: deps.fetch, budget, ashbyCache }) : null,
    ),
  );

  const showBudget = createShowBudget(120);
  const boardsOut: ListBoardBoardResult[] = [];
  for (let i = 0; i < input.boards.length; i++) {
    const ref = input.boards[i];
    const parsed = parsedBoards[i].parsed;
    if (!parsed) {
      boardsOut.push({
        url: ref.url,
        company: ref.company,
        status: "unsupported_url",
        total: 0,
        read: 0,
        matched: 0,
        alreadyInJobList: 0,
        shown: 0,
        postings: [],
        gone: [],
      });
      continue;
    }
    const read = readResults[i] as any;
    if (read.status !== "ok" && read.status !== "empty") {
      boardsOut.push({
        url: ref.url,
        company: ref.company,
        status: read.status,
        boardName: read.boardName,
        total: read.total,
        read: read.read,
        matched: 0,
        alreadyInJobList: 0,
        shown: 0,
        postings: [],
        gone: [],
      });
      continue;
    }
    const matchedItems = read.items.filter(
      (it: any) => titleMatchesWords(it.title, input.titleWords) && withinPostedWindow(it.postedAt, input.postedWithinDays),
    );
    let alreadyCount = 0;
    const notDup: any[] = [];
    for (const it of matchedItems) {
      const found = findInJobList({ company: ref.company, title: it.title, postingUrl: it.postingUrl, applyUrl: it.applyUrl }, rows);
      if (found) alreadyCount++;
      else notDup.push(it);
    }
    const shownItems = applyShowCap(notDup, showBudget, 40);
    const gone: { company: string; title: string }[] =
      read.status === "ok" && read.read === read.total ? computeGone({ company: ref.company }, read.items, rows) : [];
    const postings: ListBoardPosting[] = shownItems.map((it: any) => ({
      posting: it.postingUrl,
      title: it.title,
      location: it.location,
      ...(it.postedAt ? { postedAt: it.postedAt } : {}),
    }));
    boardsOut.push({
      url: ref.url,
      company: ref.company,
      status: read.status,
      ...(read.boardName ? { boardName: read.boardName } : {}),
      total: read.total,
      read: read.read,
      matched: matchedItems.length,
      alreadyInJobList: alreadyCount,
      shown: shownItems.length,
      postings,
      gone,
    });
  }
  return { boards: boardsOut, requestsLeftThisTurn: budget.remaining };
}

/** § 4.1 M3: one line per board, one line per posting, no JSON — see
 *  test/boards.test.ts's turn-2-prompt assertion. */
function listBoardCompactText(output: ListBoardOutput): string {
  const lines: string[] = [];
  for (const b of output.boards) {
    const partial = b.status === "ok" && b.read < b.total ? ` · read ${b.read} of ${b.total}` : "";
    // Lead ruling, 2026-09-28 (S2 review): the model is told to check
    // boardName and to put `gone` rows in the prune batch, and on the
    // web the compact form is all it reads — so both must be IN it.
    // `board name <boardName>` only appears when the board gives one.
    const boardNamePart = b.boardName ? ` · board name ${b.boardName}` : "";
    lines.push(
      `${b.company}${boardNamePart} · ${b.status} · ${b.total} postings · ${b.matched} match · ${b.alreadyInJobList} already on the list · showing ${b.shown}${partial}`,
    );
    for (const p of b.postings) {
      lines.push(`${p.posting} | ${p.title} | ${p.location} | ${p.postedAt ?? ""}`);
    }
    for (const g of b.gone) {
      lines.push(`gone: ${g.company} — ${g.title}`);
    }
  }
  lines.push(`${output.requestsLeftThisTurn} board requests left this turn`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// § 4.2 — add_roles
// ---------------------------------------------------------------------

function mapReadFailureReason(reason: string): AddRolesFailureReason {
  if (reason === "request_limit") return "request_limit";
  if (reason === "not_found") return "not_found";
  return "error";
}

async function addRolesExecute(deps: Deps, ctx: ToolContext, input: AddRolesInput): Promise<AddRolesOutput | ToolError> {
  const gateErr = estimateFirstError(ctx);
  if (gateErr) return gateErr;
  const problem = validateAddRolesInput(input);
  if (problem) return err("tool_error", problem);

  const io = makeWorkspaceIo(deps, ctx);
  const rows: any[] = await jm.load(io, "");

  // § 4.2 item 8: the two settings code enforces, read from criteria.md
  // itself — absent file means the defaults, same as an absent bullet.
  let settings: { maxNewRolesPerCompany: number; activePipelineCap: number };
  try {
    const criteriaRead = await deps.workspace.read("criteria.md");
    ctx.versionTracker.record("criteria.md", criteriaRead.version);
    const parsed = parseSearchSettings(criteriaRead.binary ? "" : criteriaRead.content);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return err("tool_error", (parsed as { error: string }).error);
    }
    settings = parsed as { maxNewRolesPerCompany: number; activePipelineCap: number };
  } catch (e) {
    if (isWorkspaceError(e) && e.code === "resource_missing") {
      settings = { maxNewRolesPerCompany: 5, activePipelineCap: 25 };
    } else if (isWorkspaceError(e)) {
      return err(e.code, e.message);
    } else {
      throw e;
    }
  }

  const budget = getBoardRequestBudget(ctx);
  const ashbyCache = getAshbyCache(ctx);
  const now = deps.clock.now();
  const todayStr = now.toISOString().slice(0, 10);

  const countsByCompanyToday = new Map<string, number>();
  for (const row of rows) {
    if (String(row.seen_at || "").slice(0, 10) !== todayStr) continue;
    const k = canon(row.company);
    countsByCompanyToday.set(k, (countsByCompanyToday.get(k) ?? 0) + 1);
  }
  let activeCount = rows.filter((r) => !r.dismissed && r.stage === "To Review").length;

  const added: AddRolesOutput["added"] = [];
  const alreadyInJobList: AddRolesOutput["alreadyInJobList"] = [];
  const failed: AddRolesFailure[] = [];

  for (const role of input.roles) {
    const parsed = parsePostingUrl(role.posting);
    if (!parsed) {
      failed.push({ posting: role.posting, reason: "unsupported_url" });
      continue;
    }
    const read = await readPosting(parsed, { fetchImpl: deps.fetch, budget, ashbyCache });
    if (!read.ok) {
      failed.push({ posting: role.posting, reason: mapReadFailureReason(read.reason) });
      continue;
    }
    // § 4.2 item 3: the board's own name, where it has one, must match the
    // plan's `company` under jobs_md's canon() — Lever/Ashby give none, so
    // this can never fire for them (§ 6, "the company check has a hole").
    if (read.companyName && canon(read.companyName) !== canon(role.company)) {
      failed.push({
        posting: role.posting,
        reason: "company_mismatch",
        message: `"${role.company}" doesn't match the board's own name, "${read.companyName}".`,
      });
      continue;
    }
    // § 4.2 item 7: empty after § 4.3's cleaning.
    const cleanedCompany = cleanValue(role.company);
    const cleanedTitle = cleanValue(read.title);
    if (!cleanedCompany || !cleanedTitle) {
      failed.push({ posting: role.posting, reason: "empty_field" });
      continue;
    }
    // § 4.2 item 6: link or company-and-title key, dismissed included.
    const dup = findInJobList({ company: role.company, title: read.title, postingUrl: read.postingUrl, applyUrl: read.applyUrl }, rows);
    if (dup) {
      alreadyInJobList.push({ company: role.company, title: dup.title, stage: dup.dismissed ? "dismissed" : dup.stage });
      continue;
    }
    const companyKey = canon(role.company);
    if ((countsByCompanyToday.get(companyKey) ?? 0) >= settings.maxNewRolesPerCompany) {
      failed.push({ posting: role.posting, reason: "company_limit" });
      continue;
    }
    if (activeCount >= settings.activePipelineCap) {
      failed.push({ posting: role.posting, reason: "active_cap" });
      continue;
    }

    const jdRelPath = jdPath(role.company, read.title);
    await writeJdIfAbsent(deps, jdRelPath, jdFileContents(role.company, read.title, read.postingUrl, read.text));

    const nowIsoStr = jm.nowIso(() => now);
    const row = {
      company: role.company,
      title: read.title,
      stage: "To Review",
      dismissed: false,
      url: read.postingUrl,
      location: read.location,
      posted_at: read.postedAt ?? null,
      jd_file: jdRelPath,
      seen_at: nowIsoStr,
      updated_at: nowIsoStr,
    };
    rows.push(row);
    // One save() per row, with THIS row's own key as writeKey (jobs-md.mjs's
    // own contract, "S1 review, third pass"): every OTHER row — including
    // ones this same call already appended, and every pre-existing row —
    // is written back untouched via its own `_raw`/clean path, so a
    // multi-role add_roles call never risks reformatting a row it isn't
    // the one writing.
    try {
      // `as any`: jm.save's inferred (JSDoc-less JS) parameter type narrows
      // writeKey to `null` from its own default value — a `tsc`-only
      // artifact of allowJs inference, not a real type mismatch (jobs-md.mjs
      // itself accepts any string key; see its own writeKey comment).
      await jm.save(io, "", rows, { now: () => now, writeKey: jm.key(row) } as any);
    } catch (e: any) {
      if (e?.name === "DuplicateKeyError" || e?.name === "EmptyFieldError") {
        return err("tool_error", e.message);
      }
      throw e;
    }
    countsByCompanyToday.set(companyKey, (countsByCompanyToday.get(companyKey) ?? 0) + 1);
    activeCount++;
    added.push({ company: role.company, title: read.title, url: read.postingUrl });
  }

  return { added, alreadyInJobList, failed };
}

// ---------------------------------------------------------------------
// § 4.10 — the tool text (target text, short on purpose)
// ---------------------------------------------------------------------

export const TOOL_DESCRIPTIONS = {
  list_board:
    "List open roles on company job boards. Title words and a posting age narrow the list; roles already listed are counted, not shown.",
  add_roles: "Add job-board postings to the job list. The board supplies title, link and location.",
} as const;

export function createBoardsTools(deps: Deps, ctx: ToolContext) {
  return {
    list_board: tool({
      description: TOOL_DESCRIPTIONS.list_board,
      inputSchema: jsonSchema<ListBoardInput>({
        type: "object",
        properties: {
          boards: {
            type: "array",
            minItems: 1,
            maxItems: MAX_BOARDS,
            items: {
              type: "object",
              properties: { url: { type: "string" }, company: { type: "string" } },
              required: ["url", "company"],
            },
          },
          titleWords: { type: "array", items: { type: "string" }, maxItems: MAX_TITLE_WORDS },
          postedWithinDays: { type: "number" },
        },
        required: ["boards"],
      }),
      execute: (input: ListBoardInput) => listBoardExecute(deps, ctx, input),
      toModelOutput: ({ output }: { output: ListBoardOutput | ToolError }) => {
        if (output && typeof output === "object" && "error" in output) {
          return { type: "json" as const, value: output as any };
        }
        return { type: "text" as const, value: listBoardCompactText(output as ListBoardOutput) };
      },
    }),
    add_roles: tool({
      description: TOOL_DESCRIPTIONS.add_roles,
      inputSchema: jsonSchema<AddRolesInput>({
        type: "object",
        properties: {
          roles: {
            type: "array",
            minItems: 1,
            maxItems: MAX_ROLES,
            items: {
              type: "object",
              properties: { posting: { type: "string" }, company: { type: "string" } },
              required: ["posting", "company"],
            },
          },
        },
        required: ["roles"],
      }),
      execute: (input: AddRolesInput) => addRolesExecute(deps, ctx, input),
    }),
  };
}
