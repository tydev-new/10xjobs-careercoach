// Jobs: the pipeline record (design-web-ui.md § 5.3, "Jobs: the pipeline
// record"; § 5.9 Stage 3b). Pure view-model functions over what the
// jobs_md port's own `load()` returns
// (skills/search/scripts/lib/jobs-md.mjs; PR #24, the js-only J2 switch,
// moved this out of packages/checkers/src) — the SAME reader Home's
// pipeline counts reuse (pipeline.ts, C § 18's own note: "the Jobs page
// reuses the port's load()"). No window/document/localStorage/Node-only
// API: runs in the browser and on a server.
//
// The Analysis field (design-web-search.md § 4.3/§ 7.1, S1): `record_
// verdict` writes it via `--analysis-file`; `JD` stays the raw posting.
// 3b waits for S1 (§ 5.9) — S1 is already in this snapshot (the port's
// own FIELDS table already carries `["Analysis", "analysis_file"]`).
import { load, STAGES } from "../../../../skills/search/scripts/lib/jobs-md.mjs";
import type { FileInfo, WorkspaceStore } from "../types.ts";
import { datePart as documentsDatePart } from "./documents.ts";
import { isMissingError, type ReadOnlyIo } from "./store-io.ts";
import { pickSection, splitSections, type Section } from "./sections.ts";

/** `load()`'s own row shape (the port's FIELDS table) — only the fields
 *  the Jobs page reads. `stage` is already normalized by `load()` itself:
 *  a dismissed row's `stage` holds its `was_stage` (or "To Review" when
 *  absent), never `null` — this page never re-derives it (one place per
 *  fact, rule 12; jobs-md.mjs: "if (r.dismissed) r.stage = r.was_stage ||
 *  'To Review'"). */
export interface JobsMdRow {
  company: string;
  title: string;
  stage: string | null;
  dismissed: boolean;
  url?: string | null;
  location?: string | null;
  posted_at?: string | null;
  seen_at?: string | null;
  updated_at?: string | null;
  fit_verdict?: string | null;
  fit_score?: number | null;
  fit_reason?: string | null;
  dealbreakers?: string | null;
  analysis_file?: string | null;
  company_file?: string | null;
  evaluated_at?: string | null;
  was_stage?: string | null;
  dismiss_note?: string | null;
}

/** `load(io, workspace)` — the jobs_md port's own reader, unchanged
 *  (§ 5.9's "READER (reuse)"). `workspace` is always `""`: the store
 *  adapter (`store-io.ts`) already scopes every path to the candidate's
 *  own workspace, so the port needs no second prefix (matching
 *  `pipeline.ts`'s own call). */
export async function loadJobsRows(io: ReadOnlyIo): Promise<JobsMdRow[]> {
  return (await load(io, "")) as JobsMdRow[];
}

export const JOB_STAGES: readonly string[] = STAGES as string[];

export interface JobsStageGroup {
  stage: string;
  rows: JobsMdRow[];
}

/** § 5.3: "grouped by stage in the port's own order... rows are in file
 *  order: the script already sorts them, so the page never re-sorts."
 *  A stage with no roles is left out entirely (unlike Home's pipeline
 *  strip, which always shows all five with a 0 — a different page, a
 *  different rule, § 5.3 Home: "a stage with no roles shows 0"; there is
 *  no `### ` role to show here under an empty Jobs heading). */
export function groupJobsByStage(rows: JobsMdRow[]): JobsStageGroup[] {
  const groups: JobsStageGroup[] = [];
  for (const stage of JOB_STAGES) {
    const stageRows = rows.filter((r) => !r.dismissed && r.stage === stage);
    if (stageRows.length > 0) groups.push({ stage, rows: stageRows });
  }
  return groups;
}

/** The Dismissed group (§ 5.3): "closed by default, with its count." File
 *  order, never re-sorted (load() already returns rows in file order). */
export function dismissedRows(rows: JobsMdRow[]): JobsMdRow[] {
  return rows.filter((r) => r.dismissed);
}

/** "The first row in page order" (§ 5.3, restore ruling): the stage
 *  groups, in `STAGES` order, each in file order, then the Dismissed
 *  group's own rows, in file order. `undefined` when there are no rows at
 *  all ("with no rows there is no detail"). */
export function firstRowInPageOrder(rows: JobsMdRow[]): JobsMdRow | undefined {
  for (const group of groupJobsByStage(rows)) {
    if (group.rows.length > 0) return group.rows[0];
  }
  const dismissed = dismissedRows(rows);
  return dismissed.length > 0 ? dismissed[0] : undefined;
}

/** The first row of one named stage, in file order — Home's pipeline
 *  count -> Jobs link (§ 5.4: "A Home count opens Jobs at that stage,
 *  with its first row chosen"). `undefined` when that stage has no rows.
 *  Not wired by 3b's own Frame (that link is Stage 3e's exit, § 5.9); this
 *  export exists so 3e can call it without a second reader. */
export function firstRowOfStage(rows: JobsMdRow[], stage: string): JobsMdRow | undefined {
  return rows.find((r) => !r.dismissed && r.stage === stage);
}

/** A stable identity for a row across re-fetches (jobs.md has no numeric
 *  id; company+title is the port's own dedupe key, `jobs-md.mjs`'s
 *  `key()`). Exact match, never canonicalized: this is identity for
 *  "still the same row after a re-read", not the port's own duplicate
 *  check. */
export function rowKey(row: Pick<JobsMdRow, "company" | "title">): string {
  return `${row.company}\u0000${row.title}`;
}

// TODO(3e): import from Cards.tsx once it exports this table (3d, on
// another branch, per the Stage 3b review) — keeping a second copy here
// for now, flagged for the lead to reconcile at merge.
const VERDICT_LABEL: Record<string, string> = {
  strong: "Strong Fit",
  investable_stretch: "Investable Stretch",
  long_shot: "Long-Shot Stretch",
  weak: "Weak Fit",
};

/** § 2.1's static label table (P5-P8), plus J1's "no verdict" case and
 *  the "an unknown value is shown as written" fallback (§ 5.3 Jobs). The
 *  same four words Cards.tsx's own `VERDICT_LABEL` table uses. */
export function verdictLabel(fitVerdict: string | null | undefined): string {
  if (!fitVerdict) return "Not evaluated yet"; // J1
  return VERDICT_LABEL[fitVerdict] ?? fitVerdict; // unknown value: as written
}

/** § 2.1: "A reason beginning `quick-scan:` gets a quick-scan badge" — the
 *  same case-insensitive check Cards.tsx's `VerdictCard` uses (rule 12:
 *  the card and the page must agree on the same reason). */
export function isQuickScan(reason: string | null | undefined): boolean {
  return (reason ?? "").toLowerCase().startsWith("quick-scan:");
}

/** § 5.3: "Dealbreakers, only on a row with a Verdict, reading 'none' when
 *  absent." `undefined` means the field isn't shown at all (no Verdict). */
export function dealbreakersDisplay(row: Pick<JobsMdRow, "fit_verdict" | "dealbreakers">): string | undefined {
  if (!row.fit_verdict) return undefined;
  return row.dealbreakers && row.dealbreakers.trim() !== "" ? row.dealbreakers : "none";
}

/** N1: one score form, "<n>/100", wherever a score shows. `--score` is
 *  optional (record_verdict.py:37): no score, no number. */
export function scoreDisplay(score: number | null | undefined): string | undefined {
  return typeof score === "number" ? `${score}/100` : undefined;
}

/** The date part of an ISO field, as written (`2026-09-22`, never
 *  reformatted) — reuses documents.ts's own `datePart` (Stage 3b review:
 *  reuse instead of copying) rather than a second copy of the same one
 *  line. `undefined` when the field itself is absent (Posted is very
 *  often unset; Evaluated only ever exists once a verdict has been
 *  recorded) — documents.ts's own version takes a required string, since
 *  every `FileInfo.updatedAt` it reads always has one. */
export function datePart(iso: string | null | undefined): string | undefined {
  return iso ? documentsDatePart(iso) : undefined;
}

/** P4: "<Company> — <Title>", the role's label as written. */
export function roleLabel(row: Pick<JobsMdRow, "company" | "title">): string {
  return `${row.company} — ${row.title}`;
}

/** § 5.2 rule 7: a URL becomes a link only when it starts with `https://`
 *  or `http://`. `.startsWith` itself already refuses a leading-space URL
 *  (the space is then the string's first character, so neither prefix
 *  matches) and any other scheme (`javascript:`, `data:`, ...). */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("https://") || url.startsWith("http://") ? url : undefined;
}

/** J5: "Dismissed from <stage>" — reads the SAME field `load()` already
 *  folded into the row's own `stage` for a dismissed row (never a second
 *  source, rule 12). `undefined` for a row that isn't dismissed. */
export function dismissedFromLabel(row: Pick<JobsMdRow, "dismissed" | "stage">): string | undefined {
  if (!row.dismissed) return undefined;
  return `Dismissed from ${row.stage || "To Review"}`;
}

// ---------------------------------------------------------------------
// The detail's two file sections (§ 5.3, items 4-5): "From the analysis
// file" / "From the company file". Each field is read independently, so
// one file's trouble never hides the other's content (§ 5.2 rule 6).
// ---------------------------------------------------------------------

export type FieldFileState =
  | { kind: "absent" } // the row has no such field at all
  | { kind: "missing"; path: string } // the field names a file that isn't there
  | { kind: "error"; path: string } // any other read failure (§ 5.2 rule 6)
  | { kind: "ready"; path: string; sections: Section[] };

/** Reads one of the row's referenced files (its `Analysis` or `Company
 *  file` field) and splits it into sections, unit-testable directly
 *  against a `WorkspaceStore` (no component-rendering harness needed).
 *  § 5.3: "A field that names a file which doesn't exist shows one line
 *  in that part's place, '<path> isn't in your workspace.'" (`missing`);
 *  "Any other read failure shows § 5.2 rule 6's error... in that file's
 *  place only" (`error`). */
export async function loadFieldFile(
  store: WorkspaceStore,
  path: string | null | undefined,
): Promise<FieldFileState> {
  if (!path) return { kind: "absent" };
  try {
    const file = await store.read(path);
    const content = file.binary ? "" : file.content;
    return { kind: "ready", path, sections: splitSections(content) };
  } catch (err) {
    if (isMissingError(err)) {
      return { kind: "missing", path };
    }
    return { kind: "error", path };
  }
}

/** § 5.3 detail item 4: "What the posting asks for" (J9; the section
 *  whose heading starts `Competency extraction`) and "How you fit" (J10;
 *  `Fit assessment` — the heading's own rest, e.g. "(Track A lens)", is
 *  not shown, C4; the body is). */
export function competencySection(sections: Section[]): Section | undefined {
  return pickSection(sections, "Competency extraction");
}
export function fitSection(sections: Section[]): Section | undefined {
  return pickSection(sections, "Fit assessment");
}

/** § 5.3 detail item 5: "About <Company>" (the section whose heading
 *  starts `Snapshot`) and "Culture and hiring signals" (`Culture &
 *  hiring signals`). */
export function snapshotSection(sections: Section[]): Section | undefined {
  return pickSection(sections, "Snapshot");
}
export function cultureSection(sections: Section[]): Section | undefined {
  return pickSection(sections, "Culture & hiring signals");
}

// ---------------------------------------------------------------------
// "Open application" (§ 5.3 detail item 6; § 5.4 page-to-page links).
// This is a minimal PRESENCE check only — not `groupApplications`
// (grouping, unlinked entries, the two-notes-files case), which is Stage
// 3d's own new reader (§ 5.9), not yet in this snapshot. It exists only
// so Jobs' own "Open application" control knows whether to show at all,
// via the exact `Analysis` join § 5.3 Applications names: "the row whose
// `Analysis` field is `jd-analysis/<key>.md`... apply names its files
// with the same slug evaluate used for the analysis." Full cross-page
// navigation (opening Applications WITH that entry chosen) is Stage 3e's
// own exit (§ 5.9: "page-to-page links"), once 3d's Applications page
// exists to choose an entry in — `onOpenApplication` stays unwired in
// Frame.tsx until then; the control shows (Stage 3b review requires
// `has === linked`) but clicking it is a no-op until 3e wires a handler.
// FLAGGED FOR THE LEAD: once `groupApplications` lands (3d), consider
// replacing `hasLinkedApplication` below with a shared export of its own
// suffix table, so the two can never silently diverge (rule 12).
// ---------------------------------------------------------------------

const APPLICATION_SUFFIXES = [
  "-resume.html",
  "-resume.pdf",
  "-resume.md",
  "-cover-letter.md",
  "-application.md",
  ".md",
] as const;

/** The `<key>` in the row's own `Analysis` field (`jd-analysis/<key>.md`)
 *  — the same slug apply names its own application files with.
 *  `undefined` when the row has no `Analysis` field, or it isn't in
 *  exactly that shape (never guessed from the company/title, § 5.3). */
export function applicationKeyForRow(row: Pick<JobsMdRow, "analysis_file">): string | undefined {
  const m = row.analysis_file?.match(/^jd-analysis\/(.+)\.md$/);
  return m ? m[1] : undefined;
}

/** Whether any file under `applications/` names this exact key, in one of
 *  the six suffix forms § 5.3 Applications names. */
export function hasLinkedApplication(files: FileInfo[], key: string): boolean {
  const paths = new Set(files.map((f) => f.path));
  return APPLICATION_SUFFIXES.some((suffix) => paths.has(`applications/${key}${suffix}`));
}
