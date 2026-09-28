// Documents (design-web-ui.md § 5.3, "Documents: every file"; § 5.9 Stage
// 3a). Pure functions only — no window/document/localStorage/Node-only API,
// so this runs the same in the browser and on a server (CLAUDE.md's rule).
//
// "Shows every file `store.list()` returns (C § 2: recursive, depth <= 3),
// except `leads.md`... Files at the top level come first, under 'Your
// records'. Then one group per top-level folder, labelled from a static UI
// table keyed by the folder names `check_files.py` lists in
// MANIFEST_DIRS... An unknown folder shows under its own name... Within a
// group, files are sorted by path."
import type { FileInfo } from "../types.ts";

// The folder names `check_files.py`'s MANIFEST_DIRS lists (§ 5.3), in the
// order § 5.3 itself writes them — used as the fixed group order for any
// folder that's actually present. `skills/profile/scripts/check_files.py`
// is the source of truth for the SET of names; § 5.3 is the source of
// truth for the order and the (still mostly unwritten) label words.
export const DOCUMENT_GROUP_ORDER = [
  "documents",
  "applications",
  "jd-analysis",
  "jd-inbox",
  "company",
  "contacts",
  "prep",
  "practice",
  "stories",
  "courses",
  "negotiation",
] as const;

// § 5.3.1 (Stage 4, rows D2-D12: docs/design-web-ui.md on
// origin/docs/workspace-labels, PR #22, not yet merged to main) — the
// architect's own label table, copied word for word. D13's fallback (any
// OTHER folder, not in this table) is the folder's own name, as written
// (unchanged from this module's own earlier reading of § 5.3 on main).
export const DOCUMENT_GROUP_LABELS: Readonly<Record<string, string>> = {
  documents: "Your uploads", // D2
  applications: "Applications", // D3
  "jd-analysis": "Role analyses", // D4
  "jd-inbox": "Saved postings", // D5
  company: "Company notes", // D6
  contacts: "Contacts", // D7
  prep: "Interview prep", // D8
  practice: "Interview practice", // D9
  stories: "Your stories", // D10
  courses: "Courses", // D11
  negotiation: "Pay notes", // D12
};

export const TOP_LEVEL_GROUP_LABEL = "Your records";

// search's schema: "a lead is unvalidated and the candidate never sees
// one." The export still includes it (rule 9) — only this page hides it.
const HIDDEN_PATH = "leads.md";

export interface DocumentGroup {
  /** "" for the top-level group ("Your records"); the folder name
   *  otherwise. Stable across renders — safe as a React list key. */
  key: string;
  label: string;
  files: FileInfo[];
}

function sortByPath(a: FileInfo, b: FileInfo): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

function topFolder(path: string): string | undefined {
  const slash = path.indexOf("/");
  return slash === -1 ? undefined : path.slice(0, slash);
}

/** Groups `store.list()`'s files exactly as § 5.3 describes: `leads.md`
 *  dropped, top-level files first under "Your records" (omitted entirely
 *  when there are none), then one group per top-level folder that's
 *  actually present — MANIFEST_DIRS' own folders first in § 5.3's order,
 *  any other (unknown) folder after, sorted by name for a stable order
 *  the spec doesn't otherwise name. Every file appears in exactly one
 *  group, each group sorted by path. */
export function groupDocuments(files: FileInfo[]): DocumentGroup[] {
  const visible = files.filter((f) => f.path !== HIDDEN_PATH);

  const topLevel: FileInfo[] = [];
  const byFolder = new Map<string, FileInfo[]>();
  for (const file of visible) {
    const folder = topFolder(file.path);
    if (folder === undefined) {
      topLevel.push(file);
    } else {
      const list = byFolder.get(folder);
      if (list) list.push(file);
      else byFolder.set(folder, [file]);
    }
  }

  const groups: DocumentGroup[] = [];
  if (topLevel.length > 0) {
    groups.push({ key: "", label: TOP_LEVEL_GROUP_LABEL, files: [...topLevel].sort(sortByPath) });
  }

  const placed = new Set<string>();
  for (const folder of DOCUMENT_GROUP_ORDER) {
    const list = byFolder.get(folder);
    if (list && list.length > 0) {
      groups.push({ key: folder, label: DOCUMENT_GROUP_LABELS[folder] ?? folder, files: [...list].sort(sortByPath) });
      placed.add(folder);
    }
  }

  const unknownFolders = [...byFolder.keys()].filter((folder) => !placed.has(folder)).sort();
  for (const folder of unknownFolders) {
    const list = byFolder.get(folder)!;
    groups.push({ key: folder, label: folder, files: [...list].sort(sortByPath) });
  }

  return groups;
}

/** Splits a path into its folder prefix (dimmed, § 5.6 "Documents": "the
 *  path in --type-ui with the folder prefix in --fg-subtle") and its own
 *  leaf name. A top-level path (no "/") has an empty prefix. */
export function splitPathForDisplay(path: string): { prefix: string; leaf: string } {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return { prefix: "", leaf: path };
  return { prefix: path.slice(0, slash + 1), leaf: path.slice(slash + 1) };
}

/** The date part of an ISO `updatedAt` (§ 5.3: "each with the date part of
 *  its updatedAt"; § 5.6 "Jobs": "as written (2026-09-22), not
 *  reformatted"). A `FileInfo.updatedAt` is always a full ISO string
 *  (store.ts / supabase-workspace-store.ts), so the date is always its
 *  first 10 characters. */
export function datePart(iso: string): string {
  return iso.slice(0, 10);
}
