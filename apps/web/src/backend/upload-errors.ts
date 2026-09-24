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
//      local-folder, and SupabaseWorkspaceStore) raises these — as of
//      fix round 1 item 7, SupabaseWorkspaceStore's own `uploadOne`
//      disambiguates a Storage RLS 403 (membership lost, a case-variant/
//      parent-folder clash, or the 50-object cap) via `ten_is_member()`
//      and its own `list()`, and raises the real code, so this tier now
//      covers those causes too, not just `already_exists`.
//   2. BEST-EFFORT — a fallback for any OTHER generic `Error` the store
//      might still throw (a genuinely unclassified Storage refusal, or a
//      different backend's own generic errors): `classifyGenericStorageError`
//      recognizes the raw HTTP status baked into the message (403, 409,
//      413, 400) and gives each a plain message rather than surfacing
//      "upload failed: HTTP 403 {...}" to a candidate.
//
// NON_MEMBER_MESSAGE is imported from auth.ts (the one canonical string,
// design-web-ui.md § 1.6) rather than duplicated here, so the two can
// never drift.
//
// Browser-safe: no window/document/localStorage/node:*.
import { WorkspaceError, type FileInfo, type WorkspaceStore } from "../../../../packages/agent/src/types.ts";
import { NON_MEMBER_MESSAGE } from "./auth.ts";

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
  not_a_member: () => NON_MEMBER_MESSAGE,
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
      return NON_MEMBER_MESSAGE;
    case 413:
      return `${name} is over the 10 MB upload limit.`;
    case 400:
      // SupabaseWorkspaceStore's own uploadOne (fix round 1, item 7) now
      // disambiguates its 403 RLS refusals into real WorkspaceError codes
      // (not_a_member / path_conflict / workspace_full) BEFORE they ever
      // reach this best-effort fallback — this branch only fires for a
      // genuinely unclassified 400 (a bug, or a backend this module
      // doesn't know about), so it stays a general "check the name"
      // message rather than guessing a specific cause.
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
