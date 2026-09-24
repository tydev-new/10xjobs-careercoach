// § 4 — the MVP tools. Every failure goes back to the model as
// `{ error: { code, message } }`; nothing is thrown into the UI stream.
import { generateText, jsonSchema, tool, type UIMessageStreamWriter } from "ai";
import { CardBuilder } from "../cards.ts";
import { buildGateLine, openGateForChat, roundUpCents, textHashOf } from "../gate.ts";
import {
  computeCostEstimate,
  DEFAULT_WEB_SEARCH_COST_USD,
  needsGate as isOverGate,
  type StepCostSample,
} from "../estimate-cost.ts";
import { countWords } from "../skills/system-prompt.ts";
import type {
  AppMessage,
  BashOutput,
  CheckLanguageInput,
  CheckLanguageOutput,
  Deps,
  EstimateCostInput,
  EstimateCostOutput,
  FetchJobInput,
  FetchJobOutput,
  GateRequest,
  ListFilesInput,
  ListFilesOutput,
  LoadSkillInput,
  LoadSkillOutput,
  ReadFileInput,
  ReadFileOutput,
  ToolError,
  WebSearchInput,
  WebSearchOutput,
  WorkspaceError,
  WriteFileInput,
  WriteFileOutput,
} from "../types.ts";
import { VersionTracker } from "./version-tracker.ts";

function err(code: string, message: string): ToolError {
  return { error: { code, message } };
}

function isWorkspaceError(e: unknown): e is WorkspaceError {
  return typeof e === "object" && e !== null && "code" in e && "name" in e && (e as any).name === "WorkspaceError";
}

// ---------------------------------------------------------------------
// fetch_job (§ 4) — the four supported boards, exact URL shapes.
// ---------------------------------------------------------------------

interface BoardMatch {
  board: string;
  apiUrl: string;
  extract: (json: any) => { company: string; title: string; location: string; text: string; compensation?: string };
}

function matchBoard(url: string): BoardMatch | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let m: RegExpMatchArray | null;

  if (
    (u.hostname === "boards.greenhouse.io" || u.hostname === "job-boards.greenhouse.io") &&
    (m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)\/?$/))
  ) {
    const [, board, id] = m;
    return {
      board: "greenhouse",
      apiUrl: `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`,
      extract: (j) => ({
        company: j.company_name ?? board,
        title: j.title ?? "",
        location: j.location?.name ?? "",
        text: String(j.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      }),
    };
  }
  if (u.hostname === "jobs.lever.co" && (m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/))) {
    const [, company, id] = m;
    return {
      board: "lever",
      apiUrl: `https://api.lever.co/v0/postings/${company}/${id}`,
      extract: (j) => ({
        company: j.categories?.team ?? company,
        title: j.text ?? "",
        location: j.categories?.location ?? "",
        text: String(j.descriptionPlain ?? j.description ?? "").trim(),
      }),
    };
  }
  if (u.hostname === "jobs.ashbyhq.com" && (m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/))) {
    const [, board, id] = m;
    return {
      board: "ashby",
      apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
      extract: (j) => {
        const jobs = Array.isArray(j.jobs) ? j.jobs : [];
        const found = jobs.find((x: any) => x.id === id) ?? {};
        return {
          company: board,
          title: found.title ?? "",
          location: found.location ?? "",
          text: String(found.descriptionPlain ?? found.description ?? "").trim(),
          compensation: found.compensation?.summary,
        };
      },
    };
  }
  if (
    u.hostname === "jobs.smartrecruiters.com" &&
    (m = u.pathname.match(/^\/([^/]+)\/(\d+)(?:-[^/]*)?\/?$/))
  ) {
    const [, company, id] = m;
    return {
      board: "smartrecruiters",
      apiUrl: `https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`,
      extract: (j) => ({
        company: j.company?.name ?? company,
        title: j.name ?? "",
        location: j.location?.city ?? "",
        text: [j.jobAd?.sections?.jobDescription?.text, j.jobAd?.sections?.qualifications?.text]
          .filter(Boolean)
          .join("\n\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      }),
    };
  }
  return null;
}

// ---------------------------------------------------------------------

export interface TurnState {
  gateId?: string;
  lastHighUsd?: number;
  measuredSteps: StepCostSample[];
  spentSoFarUsd: number;
}

export interface ToolContext {
  chatId: string;
  writer: UIMessageStreamWriter<AppMessage>;
  versionTracker: VersionTracker;
  cardBuilder: CardBuilder;
  turnState: TurnState;
  /** § 4: "so far in this chat" — persists across turns (M6, fix round
   *  1); coach.ts supplies the chat's own array. Optional so the
   *  tester's/this package's bare-ctx tool unit tests (which never
   *  exercise cross-turn pricing) don't have to build one; falls back to
   *  turnState.measuredSteps (empty, turn-scoped) when absent. */
  chatMeasuredSteps?: StepCostSample[];
  gateGrammarMd: string;
  idFor(kind: string): string;
  /** § 3.1's one-gate-per-chat, serialized against concurrent callers in
   *  the same chat (M2). Optional: falls back to the unserialized
   *  `openGateForChat` directly for bare-ctx unit tests that never open
   *  two gates in the same step. */
  openGate?: (req: GateRequest) => Promise<void>;
}

// § 4's own text cap (the same 2 MB § 2 caps an editable file at):
// read_file never hands the model more than this many characters —
// past it, the text is truncated with a clear marker rather than
// silently flooding a turn's context (lead ruling, fix round 1).
const MAX_READ_CHARS = 2 * 1024 * 1024;

function capText(text: string): string {
  if (text.length <= MAX_READ_CHARS) return text;
  return `${text.slice(0, MAX_READ_CHARS)}\n\n[...truncated — ${text.length} characters total, ${MAX_READ_CHARS} shown...]`;
}

async function readFileTool(deps: Deps, ctx: ToolContext, input: ReadFileInput): Promise<ReadFileOutput | ToolError> {
  const { path } = input;
  if (path.startsWith("skills/")) {
    const content = deps.skills[path];
    if (content === undefined) return err("resource_missing", `${path} is not in the skill bundle.`);
    return { path, content: capText(content), readOnly: true };
  }
  try {
    const read = await deps.workspace.read(path);
    ctx.versionTracker.record(path, read.version);
    if (read.binary) {
      // H5 (fix round 1, lead ruling): until a real extractor exists,
      // .pdf/.docx are refused rather than decoded — decoding raw bytes
      // as text produces garbage (mojibake, U+FFFD) that silently
      // pollutes the model's context. No pdfjs-dist/mammoth is wired in
      // (§ 4 marks this UNVERIFIED for both Node and the browser); this
      // is the honest state until that lands.
      return err("unsupported_type", "This file type can't be read yet. Paste the text instead.");
    }
    return { path, content: capText(read.content), readOnly: !read.editable };
  } catch (e) {
    if (isWorkspaceError(e)) return err(e.code, e.message);
    throw e;
  }
}

async function writeFileTool(deps: Deps, ctx: ToolContext, input: WriteFileInput): Promise<WriteFileOutput | ToolError> {
  const { path, content } = input;
  const seenVersion = ctx.versionTracker.get(path);
  if (seenVersion === undefined) {
    // "Writing an existing file the chat has never seen returns read_first."
    const exists = await deps.workspace
      .read(path)
      .then(() => true)
      .catch((e) => {
        if (isWorkspaceError(e) && e.code === "resource_missing") return false;
        throw e;
      });
    if (exists) {
      return err("read_first", `${path} already exists — read it first, then write your change.`);
    }
  }
  try {
    const info = await deps.workspace.write(path, content, seenVersion ?? null);
    ctx.versionTracker.record(path, info.version);
    return { path, written: true };
  } catch (e) {
    if (isWorkspaceError(e)) {
      if (e.code === "version_conflict") {
        ctx.versionTracker.forget(path); // model must re-read
        return err("version_conflict", `${path} changed since you read it — re-read it, then redo your change.`);
      }
      return err(e.code, e.message);
    }
    throw e;
  }
}

async function listFilesTool(deps: Deps, input: ListFilesInput): Promise<ListFilesOutput> {
  const files = await deps.workspace.list(input.dir);
  return { files: files.map((f) => ({ path: f.path, size: f.size, updatedAt: f.updatedAt })) };
}

async function bashTool(
  deps: Deps,
  ctx: ToolContext,
  input: { command: string },
): Promise<BashOutput | ToolError> {
  // Mount the current workspace (every editable file) plus the read-only
  // skill bundle at "skills/" (§ 4). M1 (fix round 1): this snapshot is
  // built to give the SCRIPT full context, but merely being IN the
  // snapshot is not "the chat having seen" a file — § 4 tracks versions
  // "from read_file, write_file, and bash WRITE-BACKS" only, so nothing
  // here touches ctx.versionTracker; only the changed-files loop below
  // (the script's own write-back report) does.
  const snapshot: Record<string, string> = {};
  // The version each snapshotted file had AT SNAPSHOT TIME — needed so a
  // write-back below passes the RIGHT expectedVersion (this is ordinary
  // read-then-write plumbing, internal to running the script), which is
  // a separate concern from ctx.versionTracker ("has the chat seen this
  // path"): a snapshot read is not a chat-visible read_file (M1).
  const snapshotVersions: Record<string, string> = {};
  const listed = await deps.workspace.list();
  for (const info of listed) {
    if (!info.editable && !info.path.startsWith("skills/")) continue; // binary uploads aren't script inputs
    try {
      const read = await deps.workspace.read(info.path);
      if (!read.binary) {
        snapshot[info.path] = read.content;
        snapshotVersions[info.path] = read.version;
      }
    } catch {
      /* file disappeared between list and read — skip */
    }
  }
  for (const [path, content] of Object.entries(deps.skills)) snapshot[path] = content;

  const { result, changedFiles } = await deps.scripts.run(input.command, snapshot);

  const changed: string[] = [];
  for (const [path, newContent] of Object.entries(changedFiles)) {
    // Prefer whatever the CHAT has itself already seen (a prior
    // read_file/write_file/write-back in this chat) so a stale outside
    // edit is still caught as a real conflict; otherwise fall back to
    // the version this very snapshot just read.
    const seenVersion = ctx.versionTracker.get(path) ?? snapshotVersions[path] ?? null;
    try {
      const info = await deps.workspace.write(path, newContent, seenVersion);
      ctx.versionTracker.record(path, info.version);
      changed.push(path);
    } catch (e) {
      if (isWorkspaceError(e)) {
        return {
          stdout: result.stdout,
          stderr: `${e.message} (writing back ${path})\n`,
          exitCode: 1,
          changed,
        };
      }
      throw e;
    }
  }

  const finalResult: BashOutput = { ...result, changed };
  const cards = await ctx.cardBuilder.forToolResult("bash", input, finalResult, deps.workspace);
  for (const card of cards) {
    ctx.writer.write({ type: "data-card", data: card });
  }
  return finalResult;
}

const MAX_WEB_SEARCH_RESULTS = 5;

async function webSearchTool(deps: Deps, ctx: ToolContext, input: WebSearchInput): Promise<WebSearchOutput | ToolError> {
  if (!deps.webSearch) return err("tool_error", "web_search is not configured.");
  // § 4 "maxResults? (≤ 5)" — capped whatever the seam returns or the
  // model asks (L5, fix round 1): clamp the REQUEST too, then the result.
  const maxResults = Math.max(1, Math.min(input.maxResults ?? MAX_WEB_SEARCH_RESULTS, MAX_WEB_SEARCH_RESULTS));
  const seamOutput = await deps.webSearch({ ...input, maxResults });
  // H2 (fix round 1): web_search's own cost counts toward the turn's
  // spend, same as check_language's — the seam MAY report it; a dated
  // last-resort default (labelled) stands in when it doesn't.
  const usd = (seamOutput as any).usd ?? DEFAULT_WEB_SEARCH_COST_USD;
  ctx.turnState.spentSoFarUsd += usd;
  return { results: seamOutput.results.slice(0, MAX_WEB_SEARCH_RESULTS) };
}

async function fetchJobTool(deps: Deps, ctx: ToolContext, input: FetchJobInput): Promise<FetchJobOutput | ToolError> {
  const match = matchBoard(input.url);
  if (!match) {
    return { error: { code: "unsupported_url", message: "paste the posting text" } };
  }
  let res: Response;
  try {
    res = await deps.fetch(match.apiUrl);
  } catch {
    return err("tool_error", "Could not reach the job board.");
  }
  if (!res.ok) {
    return err("tool_error", `The job board returned ${res.status}.`);
  }
  const json = await res.json();
  const extracted = match.extract(json);
  const output: Extract<FetchJobOutput, { board: string }> = {
    board: match.board,
    company: extracted.company,
    title: extracted.title,
    location: extracted.location,
    url: input.url,
    text: extracted.text,
    ...(extracted.compensation ? { compensation: extracted.compensation } : {}),
  };
  if (input.saveTo) {
    const written = await writeFileTool(deps, ctx, { path: input.saveTo, content: extracted.text });
    if (!("error" in written)) (output as any).savedTo = input.saveTo;
  }
  return output;
}

const MAX_ACTION_WORDS = 6;
const MAX_ITEM_WORDS = 12;
const MAX_ITEMS = 8;

async function estimateCostTool(
  deps: Deps,
  ctx: ToolContext,
  input: EstimateCostInput,
): Promise<EstimateCostOutput | ToolError> {
  if (countWords(input.action) > MAX_ACTION_WORDS) {
    return err("tool_error", `action must be ${MAX_ACTION_WORDS} words or fewer.`);
  }
  const items = input.items ?? [];
  if (items.length > MAX_ITEMS) {
    return err("tool_error", `items must be ${MAX_ITEMS} or fewer.`);
  }
  for (const item of items) {
    if (countWords(item) > MAX_ITEM_WORDS) {
      return err("tool_error", `each item must be ${MAX_ITEM_WORDS} words or fewer.`);
    }
  }
  // rule 8 (fix round 1): reject nonsense before it can print a negative
  // or NaN cost — steps/webSearches must be finite and non-negative.
  if (
    !Number.isFinite(input.steps) ||
    input.steps < 0 ||
    !Number.isFinite(input.webSearches) ||
    input.webSearches < 0
  ) {
    return err("tool_error", "steps and webSearches must be non-negative numbers.");
  }

  // § 4 "so far in this chat" / M6 (fix round 1): price from this CHAT's
  // own measured steps (persisted across turns), not a per-turn reset.
  const measuredSteps = ctx.chatMeasuredSteps ?? ctx.turnState.measuredSteps;
  // lowUsd/highUsd stay the raw computed numbers (linear in `steps`, so
  // e.g. "just under/over $1.00" boundary math stays exact) — rounding
  // up to the cent (L2) happens only where a dollar figure is actually
  // DISPLAYED (the gate line, the cost line), never on the stored value,
  // so `amountUsd === highUsd` holds exactly.
  const { lowUsd, highUsd, method } = computeCostEstimate({
    steps: input.steps,
    webSearches: input.webSearches,
    measuredSteps,
  });
  const balanceUsd = await deps.balance();
  const spendGateUsd = deps.limits?.spendGateUsd ?? 1.0;
  const gateNeeded = isOverGate(highUsd, spendGateUsd);

  if (gateNeeded) {
    const amountUsd = highUsd;
    // The cost line shown to the candidate: plain money, no internal
    // jargon (the method — "measured"/"dated-constant" — goes in the
    // log/output only, per the lead ruling). Rounded UP to the cent for
    // display only (L2) — amountUsd itself stays the raw highUsd.
    const costLine = `Estimated cost: $${roundUpCents(lowUsd).toFixed(2)} to $${roundUpCents(amountUsd).toFixed(2)}.`;
    const text = [input.action, ...items, costLine].join("\n");
    const gateId = ctx.idFor("gate");
    const req: GateRequest = {
      gateId,
      kind: "spend",
      label: input.action,
      text,
      textHash: await textHashOf(text),
      gateLine: buildGateLine(ctx.gateGrammarMd, amountUsd),
      amountUsd,
    };
    const openGate = ctx.openGate ?? ((r: GateRequest) => openGateForChat(deps, ctx.chatId, r, ctx.writer));
    await openGate(req);
    ctx.turnState.gateId = gateId;
  }
  ctx.turnState.lastHighUsd = highUsd;

  const output: EstimateCostOutput = { action: input.action, lowUsd, highUsd, balanceUsd, needsGate: gateNeeded, method };
  // § 4 "it emits a cost card"; § 6.2 row 1 — EVERY estimate_cost call,
  // gated or not (M5, fix round 1).
  for (const card of await ctx.cardBuilder.forToolResult("estimate_cost", input, output, deps.workspace)) {
    ctx.writer.write({ type: "data-card", data: card });
  }
  return output;
}

async function loadSkillTool(deps: Deps, input: LoadSkillInput): Promise<LoadSkillOutput | ToolError> {
  const path = `skills/${input.name}/SKILL.md`;
  const content = deps.skills[path];
  if (content === undefined) return err("resource_missing", `${path} is not in the skill bundle.`);
  return { path, content };
}

// step 4's own dated figure for a language check call, from the design
// doc's decision log ("about $0.015-$0.02 a call") — a last-resort
// default only, used when a real cost isn't reported (never to decide
// whether to run the check, only to keep the allowance honest when the
// actual figure is unavailable).
const DEFAULT_CHECK_LANGUAGE_COST_USD = 0.0175;

async function checkLanguageTool(deps: Deps, ctx: ToolContext, input: CheckLanguageInput): Promise<CheckLanguageOutput | ToolError> {
  let output: CheckLanguageOutput | ToolError;
  if (deps.checkLanguage) {
    output = await deps.checkLanguage(input);
  } else {
    // Default: "a fresh-context model call" (owner, 2026-09-22) using the
    // bundled language-check reference as its whole instruction, so it
    // carries none of this chat's own context.
    const instructions = deps.skills["skills/profile/references/language-check.md"] ?? "";
    if (!instructions) return err("tool_error", "language-check.md is not in the skill bundle.");
    const contents: string[] = [];
    for (const path of input.files) {
      try {
        const read = await deps.workspace.read(path);
        if (!read.binary) contents.push(`# ${path}\n\n${read.content}`);
      } catch (e) {
        if (isWorkspaceError(e)) return err(e.code, e.message);
        throw e;
      }
    }
    const result = await generateText({
      model: deps.model,
      system: instructions,
      prompt: contents.join("\n\n---\n\n"),
      // Fix round 2, item 5: same reasoning as coach.ts's streamText()
      // call — ONE proxy call, no SDK-internal retry of a deliberate
      // proxy refusal (402/403/413/503).
      maxRetries: 0,
    });
    const usd = (result.providerMetadata as any)?.openrouter?.usage?.cost ?? DEFAULT_CHECK_LANGUAGE_COST_USD;
    output = { report: result.text, usd };
  }
  // H2 (fix round 1): "the loop adds up the measured cost" — a seam's
  // own reported cost counts toward the turn's spend, same as a model
  // step's, so the allowance (§ 4) can't be spent around by routing
  // money through a tool instead of the model.
  if (!("error" in output)) ctx.turnState.spentSoFarUsd += output.usd;
  return output;
}

// One place for every tool's description text, so § 7's "the tool
// descriptions: about 350 words" line item can be MEASURED (see
// test/word-budget.test.ts) from the same strings actually registered
// below — not a second, driftable copy.
export const TOOL_DESCRIPTIONS = {
  load_skill: "Load one MVP skill's SKILL.md (profile, evaluate, apply, or coach) by name.",
  read_file: "Read a workspace file by path, or a skill file under skills/. .pdf/.docx are not extractable yet.",
  write_file: "Write a workspace text file (.md/.txt/.json/.html). Read the file first if it already exists.",
  list_files: "List workspace files, optionally under one directory.",
  bash: "Run one shell command in the workspace sandbox — used only to run a skill's ported checker script (python3 <script> ...args).",
  web_search: "Search the web (up to 5 results) for current, outside-the-workspace information.",
  fetch_job:
    "Fetch a job posting's text from a supported board's public API (Greenhouse, Lever, Ashby, SmartRecruiters). Optionally save it into the workspace.",
  estimate_cost:
    "Estimate the USD cost of a run before doing it. Opens a spend gate and ends the turn when the estimate is over the threshold.",
  check_language: "Run a fresh-context language/voice check over a set of files.",
} as const;

export function toolDescriptionsWordCount(): number {
  return Object.values(TOOL_DESCRIPTIONS).reduce((sum, d) => sum + countWords(d), 0);
}

export function createTools(deps: Deps, ctx: ToolContext) {
  return {
    load_skill: tool({
      description: TOOL_DESCRIPTIONS.load_skill,
      inputSchema: jsonSchema<LoadSkillInput>({
        type: "object",
        properties: { name: { type: "string", enum: ["profile", "evaluate", "apply", "coach"] } },
        required: ["name"],
      }),
      execute: (input: LoadSkillInput) => loadSkillTool(deps, input),
    }),
    read_file: tool({
      description: TOOL_DESCRIPTIONS.read_file,
      inputSchema: jsonSchema<ReadFileInput>({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      }),
      execute: (input: ReadFileInput) => readFileTool(deps, ctx, input),
    }),
    write_file: tool({
      description: TOOL_DESCRIPTIONS.write_file,
      inputSchema: jsonSchema<WriteFileInput>({
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      }),
      execute: (input: WriteFileInput) => writeFileTool(deps, ctx, input),
    }),
    list_files: tool({
      description: TOOL_DESCRIPTIONS.list_files,
      inputSchema: jsonSchema<ListFilesInput>({
        type: "object",
        properties: { dir: { type: "string" } },
      }),
      execute: (input: ListFilesInput) => listFilesTool(deps, input),
    }),
    bash: tool({
      description: TOOL_DESCRIPTIONS.bash,
      inputSchema: jsonSchema<{ command: string }>({
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      }),
      execute: (input: { command: string }) => bashTool(deps, ctx, input),
    }),
    web_search: tool({
      description: TOOL_DESCRIPTIONS.web_search,
      inputSchema: jsonSchema<WebSearchInput>({
        type: "object",
        properties: { query: { type: "string" }, maxResults: { type: "number" } },
        required: ["query"],
      }),
      execute: (input: WebSearchInput) => webSearchTool(deps, ctx, input),
    }),
    fetch_job: tool({
      description: TOOL_DESCRIPTIONS.fetch_job,
      inputSchema: jsonSchema<FetchJobInput>({
        type: "object",
        properties: { url: { type: "string" }, saveTo: { type: "string" } },
        required: ["url"],
      }),
      execute: (input: FetchJobInput) => fetchJobTool(deps, ctx, input),
    }),
    estimate_cost: tool({
      description: TOOL_DESCRIPTIONS.estimate_cost,
      inputSchema: jsonSchema<EstimateCostInput>({
        type: "object",
        properties: {
          action: { type: "string" },
          steps: { type: "number" },
          webSearches: { type: "number" },
          items: { type: "array", items: { type: "string" } },
        },
        required: ["action", "steps", "webSearches"],
      }),
      execute: (input: EstimateCostInput) => estimateCostTool(deps, ctx, input),
    }),
    check_language: tool({
      description: TOOL_DESCRIPTIONS.check_language,
      inputSchema: jsonSchema<CheckLanguageInput>({
        type: "object",
        properties: { files: { type: "array", items: { type: "string" } } },
        required: ["files"],
      }),
      execute: (input: CheckLanguageInput) => checkLanguageTool(deps, ctx, input),
    }),
  };
}

export type AgentTools = ReturnType<typeof createTools>;
