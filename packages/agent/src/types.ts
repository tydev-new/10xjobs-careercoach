// Shared types for packages/agent, per docs/design-web-agent.md.
//
// IMPORTANT: this file (and every file under src/) must not import
// window/document/localStorage/node:*/a Supabase client — it runs in the
// browser and on a server (§ 1). See test/no-forbidden-imports.test.ts.
import type { LanguageModel, UIMessage, UIMessageChunk } from "ai";

// ---------------------------------------------------------------------
// § 1 — createCoach(deps), Deps, Coach
// ---------------------------------------------------------------------

export type MessageOrigin = "typed" | "ui";

export interface AppMessageMetadata {
  origin?: MessageOrigin;
}

export type CardType = "verdict" | "plan" | "document" | "checker" | "cost";

export interface VerdictCardProps {
  company: string;
  title: string;
  verdict: "strong" | "investable_stretch" | "long_shot" | "weak";
  score?: number;
  track?: string;
  reason: string;
  dealbreakers?: string;
}

export interface PlanCardItem {
  text: string;
  ref?: string;
}

export interface PlanCardProps {
  stage: string;
  items: PlanCardItem[];
}

export interface DocumentCardProps {
  words: number;
  htmlPath?: string;
  checker: "clean" | "fail" | "not-run" | string;
}

export interface CheckerFinding {
  level: string;
  message: string;
}

export interface CheckerCardProps {
  label: string;
  name: string;
  status: "pass" | "FAIL" | string;
  failCount: number;
  warnCount: number;
  findings: (CheckerFinding | string)[];
}

export interface CostCardProps {
  action: string;
  lowUsd: number;
  highUsd: number;
  balanceUsd: number;
}

export type CardProps =
  | VerdictCardProps
  | PlanCardProps
  | DocumentCardProps
  | CheckerCardProps
  | CostCardProps;

export interface DataCardData {
  card: CardType;
  props: CardProps;
  ref?: string;
}

/** GateRequest — the data of a data-gate part (§ 3). Carries no status. */
export interface GateRequest {
  gateId: string;
  kind: "spend";
  label: string;
  text: string;
  textHash: string;
  gateLine: string;
  amountUsd: number;
}

export type GateStatus = "pending" | "approved" | "declined" | "expired";

export interface GateStatusData {
  gateId: string;
  status: GateStatus;
}

export type ErrorCode = "over_balance" | "model_error" | "tool_error" | "offline" | "step_cap";

export interface DataErrorData {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface AppDataTypes {
  card: DataCardData;
  gate: GateRequest;
  "gate-status": GateStatusData;
  error: DataErrorData;
  [key: string]: unknown;
}

export type AppMessage = UIMessage<AppMessageMetadata, AppDataTypes>;

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";
export type AvatarState = "idle" | "thinking" | "working" | "needs-you" | "done";

export interface Status {
  state: AvatarState;
  action?: string;
}

// ---------------------------------------------------------------------
// § 2 — Workspace store
// ---------------------------------------------------------------------

export interface FileInfo {
  path: string;
  version: string; // opaque
  size: number;
  updatedAt: string;
  editable: boolean;
}

export type FileRead =
  | (FileInfo & { binary: false; content: string })
  | (FileInfo & { binary: true; bytes: Uint8Array });

export type WorkspaceErrorCode =
  | "invalid_ref"
  | "outside_workspace"
  | "resource_missing"
  | "version_conflict"
  | "already_exists"
  | "not_editable"
  | "content_too_large"
  | "upload_too_large"
  | "unsupported_type"
  // Added by the step 2 coder (Supabase workspace store), additive only:
  // docs/design-web-agent.md § 2's own WorkspaceError.code list already
  // names these three, and the applied migration
  // (supabase/migrations/20260923000000_ten_beta_init.sql)'s ten_ws_write
  // raises them (PT409 path_conflict, PT413 workspace_full, PT403
  // not_a_member) — the in-memory/local-folder stores never produce them,
  // only the Supabase-backed one does. Flagged in the coder's hand-back
  // for the lead's OK, since types.ts is shared outside this slice's
  // directories.
  | "path_conflict"
  | "workspace_full"
  | "not_a_member";

export class WorkspaceError extends Error {
  code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export interface WorkspaceStore {
  list(dir?: string): Promise<FileInfo[]>;
  read(path: string): Promise<FileRead>;
  write(path: string, content: string, expectedVersion: string | null): Promise<FileInfo>;
  upload(path: string, bytes: Uint8Array): Promise<FileInfo>;
}

// ---------------------------------------------------------------------
// § 3 — Gate protocol
// ---------------------------------------------------------------------

export interface Gate {
  open(req: GateRequest, chatId: string): Promise<void>;
  decide(gateId: string, status: "approved" | "declined" | "expired", typedText?: string): Promise<void>;
  pending(chatId: string): Promise<GateRequest | null>;
  expireOtherChats(chatId: string): Promise<void>;
}

// ---------------------------------------------------------------------
// § 4 — MVP tools / the checker seam
// ---------------------------------------------------------------------

/** The result of running one `bash` command. */
export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** paths (relative to the workspace) that the command wrote. */
  changed: string[];
}

/**
 * ScriptRunner — the seam packages/checkers plugs into (ported in a
 * parallel worktree). The `bash` tool calls `run(command, cwd, files)`
 * with the in-memory snapshot of the workspace files reachable from the
 * sandbox (workspace files + the read-only `skills/` bundle); the runner
 * returns stdout/stderr/exitCode plus the changed file contents so the
 * `bash` tool can write them back through WorkspaceStore.write with its
 * tracked version (§ 4). Unknown commands exit 127 with
 * "not available in the web app: <name>".
 */
export interface ScriptRunner {
  run(
    command: string,
    files: Readonly<Record<string, string>>,
  ): Promise<{ result: RunResult; changedFiles: Record<string, string> }>;
}

export interface SkillBundle extends Readonly<Record<string, string>> {}

export interface LoadSkillInput {
  name: "profile" | "evaluate" | "apply" | "coach";
}
export interface LoadSkillOutput {
  path: string;
  content: string;
}

export interface ReadFileInput {
  path: string;
}
export type ReadFileOutput =
  | { path: string; content: string; readOnly: boolean }
  | { path: string; text: string; extracted: true };

export interface WriteFileInput {
  path: string;
  content: string;
}
export interface WriteFileOutput {
  path: string;
  written: true;
}

export interface ListFilesInput {
  dir?: string;
}
export interface ListFilesOutput {
  files: { path: string; size: number; updatedAt: string }[];
}

export interface BashInput {
  command: string;
}
export type BashOutput = RunResult;

export interface WebSearchInput {
  query: string;
  maxResults?: number;
}
export interface WebSearchResult {
  url: string;
  title: string;
  excerpt: string;
}
export interface WebSearchOutput {
  results: WebSearchResult[];
  /** H2 (fix round 1): the seam MAY report its own cost, which counts
   *  toward the turn/chat's spend the same as a model step's. */
  usd?: number;
}

export interface FetchJobInput {
  url: string;
  saveTo?: string;
}
export interface FetchJobOutputOk {
  board: string;
  company: string;
  title: string;
  location: string;
  url: string;
  text: string;
  compensation?: string;
  savedTo?: string;
}
export interface FetchJobOutputUnsupported {
  error: { code: "unsupported_url"; message: string };
}
export type FetchJobOutput = FetchJobOutputOk | FetchJobOutputUnsupported;

export interface EstimateCostInput {
  action: string;
  steps: number;
  webSearches: number;
  items?: string[];
}
export interface EstimateCostOutput {
  // § 4's table lists {lowUsd, highUsd, balanceUsd, needsGate, method};
  // `action` is echoed back too because § 6.2's cost-card row sources the
  // card from "the result: action, lowUsd, highUsd, balanceUsd" — a small
  // gap between the two tables, closed here rather than silently dropped
  // (see the coder hand-back).
  action: string;
  lowUsd: number;
  highUsd: number;
  balanceUsd: number;
  needsGate: boolean;
  method: string;
}

export interface CheckLanguageInput {
  files: string[];
}
export interface CheckLanguageOutput {
  report: string;
  usd: number;
}

export type ToolError = { error: { code: string; message: string } };

// ---------------------------------------------------------------------
// § 1 — Deps / Coach
// ---------------------------------------------------------------------

export interface Limits {
  maxSteps?: number; // 25
  spendGateUsd?: number; // 1.00, owner 2026-09-22
  windowWords?: number; // 4000
}

export interface Logger {
  info(e: object): void;
  warn(e: object): void;
  error(e: object): void;
}

export interface Deps {
  model: LanguageModel; // AI SDK model, built by the entry point
  workspace: WorkspaceStore; // § 2
  skills: SkillBundle; // read-only map "skills/<path>" -> text
  gate: Gate; // § 3
  balance(): Promise<number>; // USD left to spend, § 8
  fetch: typeof fetch; // ATS fetch and the price list only
  clock: { now(): Date }; // every timestamp and mtime check reads this
  scripts: ScriptRunner; // the checkers seam (§ 4/§ 5)
  webSearch?: (input: WebSearchInput) => Promise<WebSearchOutput>;
  checkLanguage?: (input: CheckLanguageInput) => Promise<CheckLanguageOutput>;
  logger?: Logger;
  limits?: Limits;
}

export interface CoachStreamInput {
  chatId: string;
  messages: AppMessage[];
  abortSignal?: AbortSignal;
}

export interface Coach {
  stream(input: CoachStreamInput): ReadableStream<UIMessageChunk>;
}
