// groupApplications — design-web-ui.md § 5.3, "Applications: the
// materials per role" ("Parsed by"): "a new pure function,
// groupApplications(paths) ... It reads file names only, never file
// contents. The key is the name with the first matching suffix removed,
// tried in this order... A name that matches none of them ... is its own
// entry, keyed by its full name. Nothing is dropped." Plus the small,
// exact `jobs.md` join § 5.3 names right beside it ("The link to jobs.md
// is exact: the row whose Analysis field is jd-analysis/<key>.md") and
// the notes-file rule ("The notes file is the entry's <key>.md or
// <key>-application.md"). No window/document/localStorage/Node-only API
// — runs in the browser and on a server.
import type { FileInfo } from "../types.ts";
import type { PlanBoard, PlanBoardItem } from "../../../../packages/agent/src/plan-board.ts";
// design-web-agent.md § 19 (the restore ruling): proposalRows is the ONE
// reader of an application file's Coverage and Selection tables — the
// same export `proposal_block`'s own `run()` is re-expressed through
// (skills/apply/scripts/lib/proposal-block.mjs). "The page passes the
// text through universalNewlines first, as the port's own io does...,
// and puts each returned cell through restoreLineSeparators before
// showing it" — readApplicationTables (below) does exactly that, the
// same posture readPlanBoard already uses for plan.md (C § 18).
// @ts-expect-error - plain .mjs, no type declarations (script-runner.ts's
// own posture for a skills/*/scripts/lib import; PR #24, the js-only J2
// switch, moved this out of packages/checkers/src).
import { proposalRows } from "../../../../skills/apply/scripts/lib/proposal-block.mjs";
// @ts-expect-error - plain .mjs, no type declarations
import { restoreLineSeparators, universalNewlines } from "../../../../skills/profile/scripts/lib/py-text.mjs";

// § 5.3's own ordered list — the FIRST one that matches a file's leaf
// name wins. Order matters: "-resume.md" must be tried before the bare
// ".md" fallback, or every résumé would key as its own unmatched entry.
const SUFFIXES = [
  "-resume.html",
  "-resume.pdf",
  "-resume.md",
  "-cover-letter.md",
  "-application.md",
  ".md",
] as const;

function leafOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/** One file's entry key: its leaf name with the first matching suffix
 *  (above) removed, or, when none matches, the file's own full path — "a
 *  name that matches none of them ... is its own entry, keyed by its
 *  full name" (§ 5.3). Exported on its own so a caller can compute the
 *  same key a linked `jobs.md` row's Analysis field would need to match,
 *  without re-running the whole grouping. */
export function applicationKeyFor(path: string): string {
  const leaf = leafOf(path);
  for (const suffix of SUFFIXES) {
    if (leaf.length > suffix.length && leaf.endsWith(suffix)) {
      return leaf.slice(0, leaf.length - suffix.length);
    }
  }
  return path;
}

export interface ApplicationEntry {
  key: string;
  /** Every file sharing this key — nothing dropped (§ 5.3). Ordered by
   *  `displayRank` below (the notes file(s) first, then the résumé, then
   *  the printable résumé, then the cover letter, then anything else),
   *  ties broken by path, so the page never re-decides file order
   *  itself. */
  files: FileInfo[];
}

function latestUpdatedAt(files: FileInfo[]): string {
  let latest = files[0]?.updatedAt ?? "";
  for (const f of files) if (f.updatedAt > latest) latest = f.updatedAt;
  return latest;
}

// § 5.3's own prose order for "Its files": "the application notes, the
// résumé, the résumé ready to print (the .html ...), and the cover
// letter." An unmatched-suffix file (or any file this entry's key
// doesn't name a role for) sorts last, in path order.
function displayRank(entryKey: string, file: FileInfo): number {
  const leaf = leafOf(file.path);
  if (leaf === `${entryKey}.md` || leaf === `${entryKey}-application.md`) return 0;
  if (leaf === `${entryKey}-resume.md` || leaf === `${entryKey}-resume.pdf`) return 1;
  if (leaf === `${entryKey}-resume.html`) return 2;
  if (leaf === `${entryKey}-cover-letter.md`) return 3;
  return 4;
}

/** Groups `store.list("applications")`'s files into one entry per role
 *  (§ 5.3). Entries are ordered newest change first, by the latest
 *  `updatedAt` among the entry's own files ("Entries are ordered newest
 *  change first..."); ties (including every file sharing one mock clock,
 *  as the fixture store's do) keep the order `paths` arrived in — a
 *  stable sort, never a second, invented tiebreak. */
export function groupApplications(paths: FileInfo[]): ApplicationEntry[] {
  const byKey = new Map<string, FileInfo[]>();
  const order: string[] = [];
  for (const file of paths) {
    const key = applicationKeyFor(file.path);
    let files = byKey.get(key);
    if (!files) {
      files = [];
      byKey.set(key, files);
      order.push(key);
    }
    files.push(file);
  }

  const entries: ApplicationEntry[] = order.map((key) => {
    const files = byKey.get(key)!;
    const sorted = [...files].sort((a, b) => {
      const ra = displayRank(key, a);
      const rb = displayRank(key, b);
      if (ra !== rb) return ra - rb;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    return { key, files: sorted };
  });

  entries.sort((a, b) => {
    const ua = latestUpdatedAt(a.files);
    const ub = latestUpdatedAt(b.files);
    if (ua === ub) return 0; // stable: keeps `paths`' own order
    return ua > ub ? -1 : 1;
  });

  return entries;
}

/** The notes file(s) among an entry's own files — `<key>.md` or
 *  `<key>-application.md` (§ 5.3: "The notes file is the entry's
 *  `<key>.md` or `<key>-application.md`"). 0, 1 (the normal case), or 2
 *  (both present — the page shows neither's tables and says so, AP14);
 *  never a guess between the two forms. */
export function notesFilesOf(entry: ApplicationEntry): FileInfo[] {
  return entry.files.filter((f) => {
    const leaf = leafOf(f.path);
    return leaf === `${entry.key}.md` || leaf === `${entry.key}-application.md`;
  });
}

/** The exact `jobs.md` join (§ 5.3: "The link to jobs.md is exact: the
 *  row whose Analysis field is jd-analysis/<key>.md. Apply names its
 *  files with the same slug evaluate used for the analysis"). `rows` is
 *  the `jobs_md` port's own `load()` output — this never guesses a link
 *  from a company name (§ 5.3), and an entry whose key is a full path
 *  (an unmatched suffix, above) can never coincidentally match, since
 *  `jd-analysis/<full path>.md` names no real file. */
export function linkedApplicationRow<T extends { analysis_file?: string | null }>(
  entry: ApplicationEntry,
  rows: readonly T[]
): T | undefined {
  const wanted = `jd-analysis/${entry.key}.md`;
  return rows.find((r) => r.analysis_file === wanted);
}

/** "Next, from you" (§ 5.3 Applications, part 4; also Home's Active
 *  application card, which reuses this same function): "the plan items,
 *  Waiting on you and then To do, in file order, whose `ref` ... is one
 *  of this entry's file paths or the linked row's Analysis path. ...
 *  No match: the part is left out." An exact path match, never a
 *  computed next step (§ 5.2 rule 3) — `board` is `readPlanBoard`'s own
 *  output (C § 18), unchanged. */
export function nextFromYou(
  board: PlanBoard,
  entry: ApplicationEntry,
  linkedAnalysisPath?: string | null
): PlanBoardItem[] {
  const refs = new Set(entry.files.map((f) => f.path));
  if (linkedAnalysisPath) refs.add(linkedAnalysisPath);

  const items: PlanBoardItem[] = [];
  for (const label of ["Waiting on you", "To do"] as const) {
    const section = board.sections.find((s) => s.label === label);
    if (!section) continue;
    for (const item of section.items) {
      if (item.ref !== undefined && refs.has(item.ref)) items.push(item);
    }
  }
  return items;
}

export interface ApplicationTables {
  coverage: string[][] | null;
  cuts: string[][] | null;
  kept: string[][] | null;
  unreadable: string[][];
}

function restoreRows(rows: string[][] | null): string[][] | null {
  return rows === null ? null : rows.map((r) => r.map((cell) => restoreLineSeparators(cell)));
}

/** The notes file's Coverage and Selection tables (C § 19), read the same
 *  way `proposal_block`'s own `run()` does: `universalNewlines` on the
 *  way in (the port's own io already does this for `run()`; the page
 *  must do it itself here, since it reads the file straight from the
 *  store), `restoreLineSeparators` on every returned cell on the way out
 *  (§ 18's own posture, applied here to C § 19's export). */
export function readApplicationTables(text: string): ApplicationTables {
  const rows = proposalRows(universalNewlines(text)) as {
    coverage: string[][] | null;
    cuts: string[][] | null;
    kept: string[][] | null;
    unreadable: string[][];
  };
  return {
    coverage: restoreRows(rows.coverage),
    cuts: restoreRows(rows.cuts),
    kept: restoreRows(rows.kept),
    unreadable: restoreRows(rows.unreadable) ?? [],
  };
}
