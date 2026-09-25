// packages/agent — the public interface (docs/design-web-agent.md § 1).
//
// BROWSER-SAFE ENTRY POINT: everything reachable from this file must not
// import window/document/localStorage/node:*/a Supabase client — it runs
// in the browser tab and (headless) on a server. See
// test/no-forbidden-imports.test.ts, which walks this file's import graph.
//
// The Node-only adapters (the local-folder WorkspaceStore, the disk-based
// SkillBundle reader) are NOT re-exported here — import them by their own
// path (see their file-header comments) from Node-only code such as
// bin/run.mjs or this package's own tests.
export { createCoach, ERROR_MESSAGES } from "./coach.ts";
export { matchGateReply, statusOf, parsePlanTodo, latestGateStatuses, gateIdsWithCards } from "./helpers.ts";
export type { GateReplyResult, ChatStatus, PlanTodoItem } from "./helpers.ts";
export { createInMemoryWorkspaceStore } from "./workspace/in-memory-store.ts";
export { validateRef, isReadOnlyPath, isEditableExt, isUploadExt } from "./workspace/path-rules.ts";
export { createInMemoryGate, buildGateLine, textHashOf, sha256Hex, findSpendLineTemplate } from "./gate.ts";
export { CardBuilder } from "./cards.ts";
export { parseJobsMdRows, findJobsMdRow } from "./jobs-md.ts";
export { computeCostEstimate, needsGate, DEFAULT_STEP_COST_MEDIAN_USD, DEFAULT_STEP_COST_MAX_USD } from "./estimate-cost.ts";
export { trimHistoryToWindow } from "./window.ts";
export {
  conversationToSave,
  capConversationSize,
  prepareConversationForSave,
  stubFor,
  stubLongStrings,
  STUB_THRESHOLD_CHARS,
  STOPPED_BEFORE_RESULT_TEXT,
  CONVERSATION_BYTE_CAP,
} from "./conversation.ts";
export type { CapResult, StubWalkResult } from "./conversation.ts";
export {
  buildAlwaysOnSystemPrompt,
  buildTier1,
  extractDescription,
  countWords,
  HOST_NOTE_PATH,
  MVP_SKILLS,
  TIER0_PATH,
} from "./skills/system-prompt.ts";
export { createTools, TOOL_DESCRIPTIONS, toolDescriptionsWordCount } from "./tools/index.ts";
export { VersionTracker } from "./tools/version-tracker.ts";
export { createFakeScriptRunner } from "./tools/fake-script-runner.ts";
export type { CannedScript } from "./tools/fake-script-runner.ts";

export type {
  AppDataTypes,
  AppMessage,
  AppMessageMetadata,
  AvatarState,
  BashInput,
  BashOutput,
  CardProps,
  CardType,
  CheckerCardProps,
  CheckerFinding,
  CheckLanguageInput,
  CheckLanguageOutput,
  ChatStatus as CoachChatStatus,
  Coach,
  CoachStreamInput,
  CostCardProps,
  DataCardData,
  DataErrorData,
  Deps,
  DocumentCardProps,
  ErrorCode,
  EstimateCostInput,
  EstimateCostOutput,
  FetchJobInput,
  FetchJobOutput,
  FileInfo,
  FileRead,
  Gate,
  GateRequest,
  GateStatus,
  GateStatusData,
  ListFilesInput,
  ListFilesOutput,
  LoadSkillInput,
  LoadSkillOutput,
  Logger,
  MessageOrigin,
  PlanCardItem,
  PlanCardProps,
  ReadFileInput,
  ReadFileOutput,
  RunResult,
  ScriptRunner,
  SkillBundle,
  Status,
  ToolError,
  VerdictCardProps,
  WebSearchInput,
  WebSearchOutput,
  WebSearchResult,
  WorkspaceErrorCode,
  WorkspaceStore,
  WriteFileInput,
  WriteFileOutput,
} from "./types.ts";
export { WorkspaceError } from "./types.ts";
