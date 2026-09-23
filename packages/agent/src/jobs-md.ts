// A MINIMAL reader for jobs.md rows (§ 6.2: the verdict card's props come
// "from the jobs.md row it wrote, via the jobs_md port"). This is NOT the
// full jobs_md.py port (search/scripts/jobs_md.py, field list, stage
// rewriting, dedupe) — that lands with packages/checkers. This file reads
// just the fields the verdict card needs (company, title, verdict, score,
// track, reason, dealbreakers, jd_file), matching jobs_md.py's own
// "### {company} — {title}" heading and "- {Label}: {value}" field-line
// shape (skills/search/scripts/jobs_md.py's FIELDS table). Once the real
// port lands, this should be replaced with an import from it — flagged in
// the coder hand-back as a stub pending that port.
export interface JobsMdRow {
  company: string;
  title: string;
  verdict?: string;
  score?: number;
  track?: string;
  reason?: string;
  dealbreakers?: string;
  jdFile?: string;
}

const ROLE_HEADING_RE = /^###\s+(.+?)\s+—\s+(.+?)\s*$/;
const FIELD_RE = /^-\s+([^:]+):\s*(.*)$/;

export function parseJobsMdRows(markdown: string): JobsMdRow[] {
  const rows: JobsMdRow[] = [];
  let current: Record<string, string> | null = null;
  const flush = () => {
    if (!current) return;
    rows.push({
      company: current.company,
      title: current.title,
      verdict: current["verdict"],
      score: current["score"] !== undefined ? Number.parseInt(current["score"], 10) : undefined,
      track: current["track"],
      reason: current["reason"],
      dealbreakers: current["dealbreakers"],
      jdFile: current["jd"],
    });
  };
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const roleMatch = rawLine.match(ROLE_HEADING_RE);
    if (roleMatch) {
      flush();
      current = { company: roleMatch[1], title: roleMatch[2] };
      continue;
    }
    if (!current) continue;
    const fieldMatch = rawLine.match(FIELD_RE);
    if (fieldMatch) {
      current[fieldMatch[1].trim().toLowerCase()] = fieldMatch[2].trim();
    }
  }
  flush();
  return rows;
}

/** The row for a given company + title, case- and whitespace-insensitive
 *  on the same terms record_verdict.py itself is called with. Returns the
 *  LAST matching row (record_verdict rewrites the file each save, so
 *  there is only ever one, but "last" is the honest choice if not). */
export function findJobsMdRow(markdown: string, company: string, title: string): JobsMdRow | undefined {
  const norm = (s: string) => s.trim().toLowerCase();
  const rows = parseJobsMdRows(markdown);
  return [...rows].reverse().find((r) => norm(r.company) === norm(company) && norm(r.title) === norm(title));
}
