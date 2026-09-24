// Shared types for the mock preview UI. Deliberately loose on tool-part
// typing (tool names are dynamic, per docs/design-web-agent.md § 4) — the
// AI SDK's own `UIMessage` generic carries METADATA and DATA_TYPES; TOOLS
// stays the SDK default so `tool-<name>` parts type-check without a static
// tool registry (this app never calls a model or executes a tool).
import type { UIMessage } from "ai";

/** metadata.origin — only "typed" can approve a gate (C § 3). */
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

/** GateRequest — the data of a data-gate part (C § 3). Carries no status. */
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

export type ErrorCode =
  | "over_balance"
  | "model_error"
  | "tool_error"
  | "offline"
  | "step_cap"
  // A reply cut off at the output limit (design-web-agent.md § 9.3,
  // amended 2026-09-24; design-web-ui.md § 2.7): its own code, a fixed
  // message that already says what to do, so no `nextStep` entry below.
  | "cut_off";

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

// ---- Fixture file shape (docs/design-web-ui.md § 4, C § 6.1) -----------

export interface FixtureMeta {
  persona: string;
  description: string;
  /** L1 (fix round 2): a fixture may explicitly declare a starting
   *  balance (e.g. a brand-new account's $0) — the only source besides a
   *  streamed `cost` card the balance chip is allowed to show a number
   *  from. Absent means unknown, never assumed $0. */
  startingBalanceUsd?: number;
  [key: string]: unknown;
}

export interface Fixture {
  meta: FixtureMeta;
  files: Record<string, string>;
  messages: AppMessage[];
}

// ---- Avatar / status (C § 6.1) ------------------------------------------

export type AvatarState = "idle" | "thinking" | "working" | "needs-you" | "done";

export interface Status {
  state: AvatarState;
  action?: string;
}

// ---- Workspace store (C § 2) --------------------------------------------
// The mock preview's store implements this shape (async read -> FileRead,
// list, write, upload) so swapping in the real store at step 5b is the
// transport only, not a UI rework. The UI never reads a fixture's `files`
// directly — only through a store built from it.

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
  | "unsupported_type";

export class WorkspaceError extends Error {
  constructor(public code: WorkspaceErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WorkspaceError";
  }
}

export interface WorkspaceStore {
  list(dir?: string): Promise<FileInfo[]>;
  read(path: string): Promise<FileRead>;
  write(path: string, content: string, expectedVersion: string | null): Promise<FileInfo>;
  upload(path: string, bytes: Uint8Array): Promise<FileInfo>;
}
