// rowAnalysisFile — design-web-agent.md C § 6.2, "A row's analysis file,
// legacy rows included" (lead ruling 2026-09-30, issue #32); design-web-
// ui.md § 5.3 Jobs "Row controls". Rows written before design-web-search.md
// S1 carry `- JD: jd-analysis/<key>.md` and no `- Analysis:` line. A row's
// analysis file is its `analysis_file`; else its `jd_file` when that names
// a path under `jd-analysis/`; else none. A `jd_file` anywhere else
// (`jd-inbox/…`, the raw posting) is never the analysis. This reads a field
// the row wrote — never a guess from company/title.
//
// The ONE reader (PRINCIPLES rule 12): the verdict card's `ref`, the Jobs
// row and detail, Jobs' "Open application" key and Applications' row join
// all go through this; none reads `analysis_file` directly.
//
// `row` is the jobs_md port's own `load()` row
// (skills/search/scripts/lib/jobs-md.mjs): snake_case fields, each value
// already stripped by load(), an empty value read as `null`, an absent
// field `undefined`. No further normalisation here. Pure; no window/
// document/localStorage/Node-only API.

/** The two fields this reads, in the port's own row shape. */
export interface AnalysisFileRow {
  analysis_file?: string | null;
  jd_file?: string | null;
}

const LEGACY_JD_PREFIX = "jd-analysis/";

/** The row's analysis file (a workspace-relative path), or `undefined`. */
export function rowAnalysisFile(row: AnalysisFileRow): string | undefined {
  if (row.analysis_file) return row.analysis_file;
  const jd = row.jd_file;
  if (jd && jd.startsWith(LEGACY_JD_PREFIX) && jd.length > LEGACY_JD_PREFIX.length) return jd;
  return undefined;
}
