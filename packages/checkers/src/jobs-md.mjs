// A faithful JS port of skills/search/scripts/jobs_md.py — jobs.md as the
// pipeline's one readable record. Runs in Node AND in the browser; no
// node:fs, no node:path. Callers inject an `io` object (see README.md "The
// io interface") and, for save()/append_note(), a `now` clock (defaults to
// `() => new Date()`) so the parity test can freeze time exactly the way
// the real script's `datetime.now(timezone.utc)` is frozen for comparison.
import { join } from "./path-util.mjs";
import { pyInt, codePointCompare, pyRstrip, pyStrip, restoreLineSeparators, PY_S } from "./py-text.mjs";

// The Python source's `\s` in these patterns is Python's own whitespace
// set, which INCLUDES U+2028/U+2029 — but by the time text reaches here,
// `universalNewlines()` has already swapped any real U+2028/U+2029 for
// PY_S's own sentinel code points (so they survive JS's `^`/`$` as
// ordinary characters, not LineTerminators — see py-text.mjs). A NATIVE
// JS `\s` in these regexes would therefore silently stop matching
// whitespace Python's `\s*` still would (the corpus's
// `r2-rv-nel-and-u2028-in-fields` case: a field value like
// "Location:  x" where the second "space" is really a U+2029 — Python's
// `\s*` consumes it as part of the label/value separator; a bare JS `\s*`
// would leave the sentinel glued to the front of the captured value
// instead). PY_S is JS's `\s` set adjusted to match Python's exactly,
// AND it explicitly includes the two sentinels for this reason.
const HEADING2_RE = new RegExp(`^##${PY_S}+(.+?)${PY_S}*$`);
const HEADING3_RE = new RegExp(`^###${PY_S}+(.+?)${PY_S}*$`);
const FIELD_RE = new RegExp(`^-${PY_S}+([^:]+):${PY_S}*(.*)$`);

export const STAGES = ["To Review", "Interested", "Applied", "Interviewing", "Offer"];
export const DISMISSED = "Dismissed";

const FIELDS = [
  ["URL", "url"], ["Location", "location"], ["Posted", "posted_at"],
  ["Seen", "seen_at"], ["Updated", "updated_at"],
  ["Verdict", "fit_verdict"], ["Score", "fit_score"], ["Reason", "fit_reason"],
  ["Dealbreakers", "dealbreakers"], ["Track", "track"], ["Flags", "flags"],
  ["Sim", "jd_sim"], ["JD", "jd_file"], ["Company file", "company_file"],
  ["Evaluated", "evaluated_at"], ["Was", "was_stage"], ["Dismissed", "dismiss_note"],
];
const LABEL_TO_KEY = new Map(FIELDS);

export function canon(s) {
  let out = (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  out = out.replace(/\b(inc|llc|corp|labs|technologies|company|the)\b/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

export function key(row) {
  return `${canon(row.company)}\u0000${canon(row.title)}`;
}

// datetime.now(timezone.utc).isoformat(timespec="seconds") — e.g.
// "2026-09-23T12:34:56+00:00" (note the "+00:00", not "Z").
export function nowIso(now = () => new Date()) {
  const d = now();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  );
}

export function path(workspace) {
  return join(workspace, "jobs.md");
}

export async function load(io, workspace) {
  const p = path(workspace);
  const rows = [];
  if (!(await io.exists(p))) return rows;
  const text = await io.readFile(p);
  const lines = text.split(/\r?\n/);
  let curStage = null;
  let row = null;
  for (const raw of lines) {
    const line = raw.replace(/\n$/, "");
    let m = line.match(HEADING2_RE);
    if (m && !line.startsWith("###")) {
      const name = pyStrip(m[1]);
      curStage = STAGES.includes(name) || name === DISMISSED ? name : null;
      continue;
    }
    m = line.match(HEADING3_RE);
    if (m && curStage) {
      const head = m[1];
      const sepIdx = head.indexOf(" — ");
      const company = sepIdx === -1 ? head : head.slice(0, sepIdx);
      const title = sepIdx === -1 ? "" : head.slice(sepIdx + 3);
      row = {
        company: pyStrip(company),
        title: pyStrip(title),
        stage: curStage !== DISMISSED ? curStage : null,
        dismissed: curStage === DISMISSED,
      };
      rows.push(row);
      continue;
    }
    m = line.match(FIELD_RE);
    if (m && row !== null) {
      const k = LABEL_TO_KEY.get(pyStrip(m[1]));
      if (k) row[k] = pyStrip(m[2]) || null;
    }
  }
  for (const r of rows) {
    if (r.dismissed) r.stage = r.was_stage || "To Review";
    if (!("fit_score" in r)) r.fit_score = null;
    if (r.fit_score) {
      // Python: `int(r["fit_score"])`, ValueError caught -> None. This is
      // a DIFFERENT int conversion than argparse's type=int (argx.mjs) —
      // it's a plain `int(str)` with no error surfaced to the caller.
      r.fit_score = pyInt(r.fit_score);
    }
  }
  return rows;
}

export async function loadNotes(io, workspace) {
  const p = path(workspace);
  if (!(await io.exists(p))) return "";
  const text = await io.readFile(p);
  const m = text.match(new RegExp(`^## Search notes${PY_S}*$\\n([\\s\\S]*)$`, "m"));
  return m ? pyStrip(m[1]) : "";
}

export async function appendNote(io, workspace, text, now = () => new Date()) {
  const notes = await loadNotes(io, workspace);
  const stamp = now().toISOString().slice(0, 10);
  const block = `### ${stamp}\n\n${pyStrip(text)}`;
  const rows = await load(io, workspace);
  await save(io, workspace, rows, { notes: notes ? pyStrip(`${notes}\n\n${block}`) : block, now });
}

export class DuplicateKeyError extends Error {}

export async function save(io, workspace, rows, { notes = undefined, now = () => new Date() } = {}) {
  const seen = new Map();
  for (const r of rows) {
    const k = key(r);
    if (seen.has(k)) {
      const other = seen.get(k);
      throw new DuplicateKeyError(
        `jobs.md: duplicate role ${r.company} — ${r.title} (canonical collision with ${other.company} — ${other.title})`
      );
    }
    seen.set(k, r);
  }
  const out = [
    "# Pipeline",
    "",
    "*The record. Script-written (search sweeps, update_job.py moves,",
    "record_verdict.py judges) — read it anywhere; change it via chat so",
    "the duplicate-key check can protect it. Dismissed roles keep their",
    "history at the bottom; nothing is ever deleted.*",
    "",
  ];
  const active = rows.filter((r) => !r.dismissed);
  const iso = nowIso(now);
  out.push(`**Active: ${active.length}** · dismissed: ${rows.length - active.length} · updated ${iso.slice(0, 10)}`);
  out.push("");
  for (const stage of STAGES) {
    const block = active.filter((r) => r.stage === stage);
    if (!block.length) continue;
    out.push(`## ${stage}`);
    out.push("");
    const sorted = block.slice().sort((a, b) => {
      const sa = -(a.fit_score || 0);
      const sb = -(b.fit_score || 0);
      if (sa !== sb) return sa - sb;
      const ca = a.company.toLowerCase();
      const cb = b.company.toLowerCase();
      if (ca !== cb) return codePointCompare(ca, cb);
      return codePointCompare(a.title.toLowerCase(), b.title.toLowerCase());
    });
    for (const r of sorted) out.push(..._block(r, false));
  }
  const gone = rows.filter((r) => r.dismissed);
  if (gone.length) {
    out.push(`## ${DISMISSED}`);
    out.push("");
    const sorted = gone.slice().sort((a, b) => {
      const ca = a.company.toLowerCase();
      const cb = b.company.toLowerCase();
      if (ca !== cb) return codePointCompare(ca, cb);
      return codePointCompare(a.title.toLowerCase(), b.title.toLowerCase());
    });
    for (const r of sorted) {
      r.was_stage = r.stage || "To Review";
      out.push(..._block(r, true));
    }
  }
  let finalNotes = notes;
  if (finalNotes === undefined) finalNotes = await loadNotes(io, workspace);
  if (finalNotes) {
    out.push("## Search notes", "", finalNotes, "");
  }
  const text = restoreLineSeparators(pyRstrip(out.join("\n"))) + "\n";
  await io.writeFile(path(workspace), text);
}

function _block(r, dismissed) {
  const lines = [`### ${r.company} — ${r.title}`];
  for (const [label, k] of FIELDS) {
    if (k === "was_stage" && !dismissed) continue;
    let v;
    if (k === "dismiss_note") {
      v = r.dismiss_note || (dismissed ? r.dismiss_reason : undefined);
    } else {
      v = r[k];
    }
    if (v !== undefined && v !== null && v !== "") lines.push(`- ${label}: ${v}`);
  }
  lines.push("");
  return lines;
}

export function find(rows, company, titleFrag) {
  const ck = canon(company);
  const tf = canon(titleFrag);
  const hits = rows.filter((r) => canon(r.company) === ck && canon(r.title).includes(tf));
  if (hits.length > 1) {
    const exact = hits.filter((r) => canon(r.title) === tf);
    if (exact.length === 1) return exact;
  }
  return hits;
}
