// Path rules shared by every WorkspaceStore backend (§ 2), mirroring the
// APPLIED migration's ten_path_ok/ten_ws_write EXACTLY (fix round 1, L1:
// "one shared path-rule function for all backends" — additive, so every
// backend, not just Supabase, refuses the inputs the server would):
// "Paths are relative, NFC, <= 512 chars. No `..`, no segment starting
// with `.`, no `//`, backslash, control, invisible or format character;
// no `..`, no NUL."
// `.md .txt .json .html` are editable and versioned, capped at 2 MB.
// `.pdf .docx` are upload-only and create-only, capped at 10 MB.
// `skills/` and any `CLAUDE.md` (root or nested) are not writable by the
// agent (§ 7) — only the root file, create-only, through the app's own
// createRootClaudeMd() bypass (never through write()).
import { WorkspaceError } from "../types.ts";

export const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".html"]);
export const UPLOAD_EXTENSIONS = new Set([".pdf", ".docx"]);
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_REF_CHARS = 512;

// POSIX [:cntrl:]: 0x00-0x1F, 0x7F, AND the C1 control range 0x80-0x9F
// (fix round 2, M-new-1: PostgreSQL's [[:cntrl:]] character class in the
// server's own ten_path_ok regex is locale-aware and includes C1 — a
// BMP-wide sweep against the live migration (D7) confirmed U+0080-009F
// are refused server-side; the client must match exactly, not just ASCII).
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F-\x9F]/;

// The migration's invisible/format-character class, verbatim (Cf plus
// U+2028/2029 and the code points HFS+ ignores when comparing names --
// version control tooling, CVE-2014-9390). Built from explicit hex ranges
// (never a literal invisible character in this source file, for exactly
// the reason this check exists): U+00AD, U+0600-0605, U+061C, U+06DD,
// U+070F, U+0890-0891, U+08E2, U+180E, U+200B-200F, U+2028-202E,
// U+2060-2064, U+2066-206F, U+FEFF, U+FFF9-FFFB, U+110BD, U+110CD,
// U+13430-1343F, U+1BCA0-1BCA3, U+1D173-1D17A, U+E0001, U+E0020-E007F.
const INVISIBLE_CHAR_RANGES: readonly [number, number][] = [
  [0x00ad, 0x00ad],
  [0x0600, 0x0605],
  [0x061c, 0x061c],
  [0x06dd, 0x06dd],
  [0x070f, 0x070f],
  [0x0890, 0x0891],
  [0x08e2, 0x08e2],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0x110bd, 0x110bd],
  [0x110cd, 0x110cd],
  [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
];
const INVISIBLE_CHAR_RE = new RegExp(
  "[" +
    INVISIBLE_CHAR_RANGES.map(([a, b]) =>
      a === b ? `\\u{${a.toString(16)}}` : `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`,
    ).join("") +
    "]",
  "u",
);

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i <= slash) return "";
  return p.slice(i).toLowerCase();
}

/** Validates a path per § 2's rules and returns it normalized (NFC, posix
 *  separators, no leading "./"). Throws WorkspaceError("invalid_ref") or
 *  ("outside_workspace") on any violation. Does not check existence.
 *
 *  M3 (fix round 1): the client normalizes to NFC itself, rather than
 *  refusing an NFD-typed name — the SQL's own "is NFC normalized" check
 *  then just confirms what the client already sent. */
export function validateRef(ref: string): string {
  if (!ref || typeof ref !== "string" || ref.includes("\0")) {
    throw new WorkspaceError("invalid_ref", "Resource reference is invalid.");
  }
  const nfc = ref.normalize("NFC");
  if (nfc.length > MAX_REF_CHARS) {
    throw new WorkspaceError("invalid_ref", `Resource reference is longer than ${MAX_REF_CHARS} characters.`);
  }
  if (CONTROL_CHAR_RE.test(nfc)) {
    throw new WorkspaceError("invalid_ref", "Resource reference contains a control character.");
  }
  if (INVISIBLE_CHAR_RE.test(nfc)) {
    throw new WorkspaceError("invalid_ref", "Resource reference contains an invisible or format character.");
  }
  if (nfc.startsWith("/") || /^[A-Za-z]:[\\/]/.test(nfc)) {
    throw new WorkspaceError("outside_workspace", "Resource is outside the workspace.");
  }
  const segments = nfc.split(/[\\/]+/).filter((s) => s.length > 0);
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

/** true when the path is CLAUDE.md — at the workspace root OR nested — or
 *  under skills/ — never writable by the agent (§ 2, § 7). A NESTED
 *  CLAUDE.md is refused too (fix round 1, L1/D2/D6): only the root file is
 *  ever writable at all, and only create-only through the app's own
 *  bypass, never through this store's write() on any backend. Case
 *  insensitive (M8): a case-insensitive disk (macOS default) resolves
 *  "claude.md" to the same file as "CLAUDE.md", so the refusal has to
 *  match on every case. */
export function isReadOnlyPath(normalizedRef: string): boolean {
  const lower = normalizedRef.toLowerCase();
  return lower === "claude.md" || lower.endsWith("/claude.md") || lower === "skills" || lower.startsWith("skills/");
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
