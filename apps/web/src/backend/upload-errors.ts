// Upload wiring (docs/plan-portable-skills-and-web-agent.md step 5b, item
// 3): the composer's attach calls `upload("documents/<name>")` BEFORE
// sending (docs/design-web-agent.md § 2), with `-2`/`-3` appended on a
// name clash, and every refusal mapped to a clear, plain-language message
// — "the known gap: case clash, the 50-file cap, non-member → specific
// plain messages, not a generic error" (the lead's own framing).
//
// Two tiers of mapping, both exercised by the tests:
//   1. EXACT — a `WorkspaceError` with one of § 2's own codes maps
//      one-to-one to a plain sentence. Every backend (in-memory,
//      local-folder, and, for the one case it throws — `already_exists`
//      on the outer HTTP 409 / nested duplicate-key body —
//      SupabaseWorkspaceStore) raises these.
//   2. BEST-EFFORT — SupabaseWorkspaceStore's own comments say plainly
//      that Storage's OTHER refusals (case clash -> `path_conflict`, the
//      50-object cap -> `workspace_full`, a revoked membership ->
//      `not_a_member`) come back as a generic `Error` with the raw HTTP
//      status baked into its `message` (no WorkspaceError code) — "a real
//      gap vs. 'map exactly' that only ten_ws_write's own PT-code path
//      fully closes" (that store's own hand-back). This module's
//      `classifyGenericStorageError` recognizes the status codes that
//      file's own code paths are documented to produce (403, 409, 413,
//      400) and gives each a plain, best-effort message rather than
//      surfacing "upload failed: HTTP 403 {...}" to a candidate. It
//      cannot tell "50-object cap" apart from "case clash" from the HTTP
//      status alone (both would be a 400 RLS violation with no coded
//      body) — flagged in the hand-back as the residual part of the gap,
//      unresolved until SupabaseWorkspaceStore itself gains real codes.
//
// Browser-safe: no window/document/localStorage/node:*.
import { WorkspaceError, type FileInfo, type WorkspaceStore } from "../../../../packages/agent/src/types.ts";

function isWorkspaceError(e: unknown): e is WorkspaceError {
  return typeof e === "object" && e !== null && "code" in e && (e as { name?: string }).name === "WorkspaceError";
}

/** § 2's own EXACT `WorkspaceError.code` -> plain sentence for an upload. */
const EXACT_MESSAGES: Partial<Record<WorkspaceError["code"], (name: string) => string>> = {
  unsupported_type: (name) => `${name} isn't a file type Ten can use yet — only .pdf and .docx.`,
  upload_too_large: (name) => `${name} is over the 10 MB upload limit.`,
  content_too_large: (name) => `${name} is over the size limit.`,
  not_editable: () => "That name is reserved and can't be uploaded to.",
  path_conflict: (name) =>
    `${name} clashes with an existing file or folder (a name that only differs by capitalization counts as a clash).`,
  workspace_full: () => "Your workspace is at its file limit. Remove something before uploading more.",
  not_a_member: () => "Ten is in a private beta. Ask the person who invited you for access.",
  already_exists: (name) => `${name} already exists.`,
  invalid_ref: (name) => `${name} isn't a valid file name.`,
  outside_workspace: () => "That upload would land outside your workspace.",
  resource_missing: (name) => `${name} could not be found.`,
  version_conflict: (name) => `${name} changed since you last saw it.`,
};

/** BEST-EFFORT (tier 2, see file header): recognizes the HTTP status codes
 *  SupabaseWorkspaceStore's own `uploadOne` is documented to produce for a
 *  refusal it does NOT wrap in a `WorkspaceError` — matched against the
 *  raw `Error.message` text that function throws (`upload failed: HTTP
 *  <status> ...`), never a second network call. */
export function classifyGenericStorageError(name: string, message: string): string | null {
  const m = /HTTP (\d{3})/.exec(message);
  if (!m) return null;
  const status = Number(m[1]);
  switch (status) {
    case 403:
      return "Ten is in a private beta. Ask the person who invited you for access.";
    case 413:
      return `${name} is over the 10 MB upload limit.`;
    case 400:
      // Storage's own insert policy folds several distinct refusals (a
      // name that only differs by case, the 50-object cap, a path under
      // ws/skills/, …) into one generic RLS-violation 400 with no coded
      // body to tell them apart (see the file header) — this is the
      // residual, unresolved half of "the known gap".
      return `${name} couldn't be uploaded. Check the name (a matching file may already exist, even with different capitalization) and try again.`;
    default:
      return null;
  }
}

/** Maps ANY error `workspace.upload()` can throw to a plain, candidate-facing
 *  message — never the raw error text. */
export function uploadErrorMessage(name: string, error: unknown): string {
  if (isWorkspaceError(error)) {
    const build = EXACT_MESSAGES[error.code];
    if (build) return build(name);
  }
  if (error instanceof Error) {
    const generic = classifyGenericStorageError(name, error.message);
    if (generic) return generic;
  }
  return `Couldn't upload ${name}. Try again.`;
}

function splitExt(fileName: string): { base: string; ext: string } {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { base: fileName, ext: "" };
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot) };
}

export interface UploadOutcome {
  ok: boolean;
  /** The final `documents/<name>` path actually written, on success. */
  path?: string;
  info?: FileInfo;
  /** A plain, candidate-facing message, on failure. */
  message?: string;
}

/** `upload("documents/<name>")`, then `-2`, `-3` on a clash (§ 2 Uploads)
 *  — retries ONLY on `already_exists` (an actual name clash), up to
 *  `maxAttempts`; any other refusal (wrong type, too large, not a member,
 *  …) is mapped and returned immediately, no retry. */
export async function uploadWithClashRenumber(
  workspace: WorkspaceStore,
  fileName: string,
  bytes: Uint8Array,
  maxAttempts = 3,
): Promise<UploadOutcome> {
  const { base, ext } = splitExt(fileName);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidateName = attempt === 1 ? fileName : `${base}-${attempt}${ext}`;
    const path = `documents/${candidateName}`;
    try {
      const info = await workspace.upload(path, bytes);
      return { ok: true, path, info };
    } catch (error) {
      lastError = error;
      const isClash = isWorkspaceError(error) && error.code === "already_exists";
      if (isClash && attempt < maxAttempts) continue;
      return { ok: false, message: uploadErrorMessage(candidateName, error) };
    }
  }
  return { ok: false, message: uploadErrorMessage(fileName, lastError) };
}
