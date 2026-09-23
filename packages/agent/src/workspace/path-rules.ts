// Path rules shared by every WorkspaceStore backend (§ 2):
// "Paths are relative. No `..`, no segment starting with `.`, no NUL."
// `.md .txt .json .html` are editable and versioned, capped at 2 MB.
// `.pdf .docx` are upload-only and create-only, capped at 10 MB.
// `skills/` and `CLAUDE.md` at the root are not writable by the agent (§ 7).
import { WorkspaceError } from "../types.ts";

export const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".html"]);
export const UPLOAD_EXTENSIONS = new Set([".pdf", ".docx"]);
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i <= slash) return "";
  return p.slice(i).toLowerCase();
}

/** Validates a path per § 2's rules and returns it normalized (posix
 *  separators, no leading "./"). Throws WorkspaceError("invalid_ref") or
 *  ("outside_workspace") on any violation. Does not check existence. */
export function validateRef(ref: string): string {
  if (!ref || typeof ref !== "string" || ref.includes("\0")) {
    throw new WorkspaceError("invalid_ref", "Resource reference is invalid.");
  }
  if (ref.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref)) {
    throw new WorkspaceError("outside_workspace", "Resource is outside the workspace.");
  }
  const segments = ref.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new WorkspaceError("invalid_ref", "Resource reference is invalid.");
  }
  for (const seg of segments) {
    if (seg === "." || seg === ".." || seg.startsWith(".")) {
      throw new WorkspaceError("outside_workspace", "Hidden and parent paths are not available.");
    }
  }
  return segments.join("/");
}

/** true when the path is CLAUDE.md at the workspace root, or under skills/
 *  — never writable by the agent (§ 2, § 7). Case-insensitive (M8): a
 *  case-insensitive disk (macOS default) resolves "claude.md" to the same
 *  file as "CLAUDE.md", so the refusal has to match on every case. */
export function isReadOnlyPath(normalizedRef: string): boolean {
  const lower = normalizedRef.toLowerCase();
  return lower === "claude.md" || lower === "skills" || lower.startsWith("skills/");
}

export function isEditableExt(normalizedRef: string): boolean {
  return TEXT_EXTENSIONS.has(extOf(normalizedRef));
}

export function isUploadExt(normalizedRef: string): boolean {
  return UPLOAD_EXTENSIONS.has(extOf(normalizedRef));
}

// TextEncoder, not Buffer.byteLength — Buffer is Node-only and this file
// runs in the browser too (§ 1).
export function assertEditSize(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_EDIT_BYTES) {
    throw new WorkspaceError("content_too_large", "Editable files are limited to 2 MB.");
  }
}

export function assertUploadSize(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new WorkspaceError("upload_too_large", "Uploads must be between 1 byte and 10 MB.");
  }
}
