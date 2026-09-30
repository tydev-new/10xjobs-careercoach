// Tiny shared helpers used by every tool module (index.ts, boards.ts) —
// split out so boards.ts doesn't have to import from index.ts (which
// imports boards.ts back, for createTools) just to reach them.
import type { ToolError, WorkspaceError } from "../types.ts";

export function err(code: string, message: string): ToolError {
  return { error: { code, message } };
}

export function isWorkspaceError(e: unknown): e is WorkspaceError {
  return typeof e === "object" && e !== null && "code" in e && "name" in e && (e as { name: unknown }).name === "WorkspaceError";
}
