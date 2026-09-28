// A faithful JS port of skills/search/scripts/jobs_md.py — jobs.md as the
// pipeline's one readable record. Runs in Node AND in the browser; no
// node:fs, no node:path. Callers inject an `io` object (see README.md "The
// io interface") and, for save()/append_note(), a `now` clock (defaults to
// `() => new Date()`) so the parity test can freeze time exactly the way
// the real script's `datetime.now(timezone.utc)` is frozen for comparison.
import { join } from "../../../profile/scripts/lib/path-util.mjs";
import { pyInt, codePointCompare, pyRstrip, pyStrip, restoreLineSeparators, PY_S } from "../../../profile/scripts/lib/py-text.mjs";

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
export const NOTES = "Search notes";

const FIELDS = [
  ["URL", "url"], ["Location", "location"], ["Posted", "posted_at"],
  ["Seen", "seen_at"], ["Updated", "updated_at"],
  ["Verdict", "fit_verdict"], ["Score", "fit_score"], ["Reason", "fit_reason"],
  ["Dealbreakers", "dealbreakers"], ["Track", "track"], ["Flags", "flags"],
  ["Sim", "jd_sim"], ["JD", "jd_file"], ["Analysis", "analysis_file"],
  ["Company file", "company_file"],
  ["Evaluated", "evaluated_at"], ["Was", "was_stage"], ["Dismissed", "dismiss_note"],
];
const LABEL_TO_KEY = new Map(FIELDS);

// B2: sanitising (design-web-search.md § 4.3/§ 4.4) — every row value
// save() writes (a field's value, and the company/title in a row's
// heading; NEVER the `## Search notes` block, which save() copies as it
// is) has every run of THIS exact class collapsed to one space, then is
// trimmed. Deliberately NOT PY_S (this file's own import, matching
// Python's broader `\s`) and NOT a native JS `\s` — a different,
// narrower, written-out class so both languages agree on the same
// posting (the design's own reasoning: `\s` differs between Python and
// JS on several code points, so a checker whose sanitiser used either
// language's native `\s` would disagree with its counterpart on the same
// input). Prevents a posting title carrying a newline and `## Offer` or
// `- URL:` from becoming a stage heading or a field of another row (a
// job posting is the plan's named prompt-injection risk).
//
// This class holds the 10 REAL characters § 4.3 names, nothing else — in
// particular NOT the two PY_S sentinels (S1 review, finding 7): a literal
// U+E000/U+E001 in a value (rare, but not impossible — a candidate's own
// text, or a board's) is an ORDINARY character to this design, exactly as
// Python sees it (Python has no sentinel concept at all), so it must
// never collapse to a space. `load()` (below) is the one place that
// makes this safe: it converts each extracted field's own sentinel-form
// value back to the real U+2028/U+2029 the FILE held, immediately after
// that value is captured out of the line-oriented parse and before it
// ever reaches this class — so by the time ANY value (fresh off argv, or
// returned by `load()`) arrives here, a sentinel code point can only ever
// mean "a literal U+E000/U+E001", never "a stand-in for U+2028/U+2029".
const SANITISE_WS_CHARS = " \\t\\n\\r\\f\\v\\u0085\\u00a0\\u2028\\u2029";
const SANITISE_WS_RE = new RegExp(`[${SANITISE_WS_CHARS}]+`, "g");
const SANITISE_TRIM_RE = new RegExp(`^[${SANITISE_WS_CHARS}]+|[${SANITISE_WS_CHARS}]+$`, "g");

// Collapse every run of the sanitising whitespace class to one space and
// trim both ends. `null`/`undefined` (an absent field) pass through
// unchanged.
function cleanValue(value) {
  if (value === null || value === undefined) return value;
  const cleaned = String(value).replace(SANITISE_WS_RE, " ");
  return cleaned.replace(SANITISE_TRIM_RE, "");
}

// Like cleanValue, plus: a company containing ` — ` (space, em dash,
// space), or ENDING in ` —` (space, em dash, nothing after — the
// heading's own separator supplies the space and the title that would
// otherwise follow), has that em dash written as `-` — a row's heading
// splits company from title on the FIRST ` — `, so a company that
// legitimately carries an em dash must never be misread as the
// company/title separator. Titles keep theirs; the split above takes the
// first one. (S1 review, finding 8: a company ending in ` —` with no
// rewrite would make the heading read `### Acme — — Role`, two ` — `
// runs, so the FIRST one — the company's own trailing dash, not the
// real separator — is what load() would split on.)
function cleanCompany(value) {
  let cleaned = cleanValue(value);
  if (cleaned === null || cleaned === undefined) return cleaned;
  cleaned = cleaned.split(" — ").join(" - ");
  if (cleaned.endsWith(" —")) cleaned = cleaned.slice(0, -1) + "-";
  return cleaned;
}

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

// Parse jobs.md -> row objects. Parsing STOPS at the `## Search notes`
// heading (S1 review, finding 1): everything after it is notes, matching
// loadNotes(); a posting quoted inside that block can legitimately carry
// a line that reads like a real stage heading (`## Offer` is both a stage
// name and ordinary English) or a fake `### Company — Title` / `- URL:`
// row — those must never parse as a row, the same threat model § 4.3's
// B1 sanitising already covers for a title arriving through a field.
export async function load(io, workspace) {
  const p = path(workspace);
  const rows = [];
  if (!(await io.exists(p))) return rows;
  const text = await io.readFile(p);
  const lines = text.split(/\r?\n/);
  let curStage = null;
  let row = null;
  // LEAD ruling (S1 review, third pass): accumulates the CURRENT row's
  // exact original lines, cached as `row._raw` so save() can echo an
  // UNTOUCHED row byte for byte, even a legacy/hand-edited heading that
  // would fail B2's cleaning (e.g. `### Acme Staff Engineer`, no ` — `
  // separator at all) — an old row must never block, or even reformat,
  // a write it isn't part of.
  let rawLines = null;
  const finalizeRaw = () => {
    if (row !== null && rawLines !== null) {
      while (rawLines.length && rawLines[rawLines.length - 1] === "") rawLines.pop();
      // restoreLineSeparators: `text` (and so every line in `rawLines`)
      // already went through `io.readFile`'s own `universalNewlines`, so
      // any real U+2028/U+2029 the file held is a sentinel here — same
      // reasoning as the per-field restore above, applied to the whole
      // cached block at once.
      row._raw = restoreLineSeparators(rawLines.join("\n"));
    }
    rawLines = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\n$/, "");
    let m = line.match(HEADING2_RE);
    if (m && !line.startsWith("###")) {
      finalizeRaw();
      const name = pyStrip(m[1]);
      if (name === NOTES) break;
      curStage = STAGES.includes(name) || name === DISMISSED ? name : null;
      continue;
    }
    m = line.match(HEADING3_RE);
    if (m && curStage) {
      finalizeRaw();
      const head = m[1];
      const sepIdx = head.indexOf(" — ");
      const company = sepIdx === -1 ? head : head.slice(0, sepIdx);
      const title = sepIdx === -1 ? "" : head.slice(sepIdx + 3);
      // restoreLineSeparators AFTER pyStrip (which needs PY_S's sentinel
      // form to strip a leading/trailing U+2028/U+2029 the same way
      // Python's str.strip() strips the real character) and BEFORE this
      // value goes anywhere else — see SANITISE_WS_CHARS's comment above.
      row = {
        company: restoreLineSeparators(pyStrip(company)),
        title: restoreLineSeparators(pyStrip(title)),
        stage: curStage !== DISMISSED ? curStage : null,
        dismissed: curStage === DISMISSED,
      };
      rows.push(row);
      rawLines = [line];
      continue;
    }
    if (row !== null && rawLines !== null) rawLines.push(line);
    m = line.match(FIELD_RE);
    if (m && row !== null) {
      const k = LABEL_TO_KEY.get(pyStrip(m[1]));
      if (k) {
        const v = pyStrip(m[2]);
        row[k] = v ? restoreLineSeparators(v) : null;
      }
    }
  }
  finalizeRaw();
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
  // restoreLineSeparators AFTER pyStrip — see load()'s own comment above.
  return m ? restoreLineSeparators(pyStrip(m[1])) : "";
}

export async function appendNote(io, workspace, text, now = () => new Date()) {
  const notes = await loadNotes(io, workspace);
  const stamp = now().toISOString().slice(0, 10);
  const block = `### ${stamp}\n\n${pyStrip(text)}`;
  const rows = await load(io, workspace);
  await save(io, workspace, rows, { notes: notes ? pyStrip(`${notes}\n\n${block}`) : block, now });
}

export class DuplicateKeyError extends Error {}
// LEAD spec amendment (S1 review, finding 6; design-web-search.md § 4.3):
// a company or title that is empty after cleaning is refused — every
// caller maps this to exit 2 (never DuplicateKeyError's own exit 1).
export class EmptyFieldError extends Error {}

// `writeKey` (LEAD ruling, S1 review, third pass): the canonical `key(row)`
// of the ONE row this call is creating or updating — the writers
// (record-verdict.mjs, update-job.mjs) always pass it. Every OTHER row is
// written back exactly as it was read (`_block()`'s echo path below), so
// a pre-existing row's legacy or hand-edited heading never blocks, or
// reformats, a write it isn't part of. `writeKey` omitted (the default —
// a bare library call, no single row identified) cleans and validates
// every row, unchanged from before this ruling.
export async function save(io, workspace, rows, { notes = undefined, now = () => new Date(), writeKey = null } = {}) {
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
    "*The record. Script-written (search sweeps, update_job.mjs moves,",
    "record_verdict.mjs judges) — read it anywhere; change it via chat so",
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
    for (const r of sorted) out.push(..._block(r, false, writeKey));
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
      out.push(..._block(r, true, writeKey));
    }
  }
  let finalNotes = notes;
  if (finalNotes === undefined) finalNotes = await loadNotes(io, workspace);
  if (finalNotes) {
    out.push("## Search notes", "", finalNotes, "");
  }
  // No blanket restoreLineSeparators here (S1 review, finding 7): every
  // value already reaching `out` is already in its final, real-character
  // form — `_block()`'s row values (fresh off argv, or `load()`'s own
  // per-value restore above) and `finalNotes` (fresh, or `loadNotes()`'s
  // own restore above) — so a blanket call at this point could only ever
  // MISinterpret a literal U+E000/U+E001 a value legitimately carries as
  // a translated sentinel, silently rewriting it into a real
  // U+2028/U+2029 that was never there.
  const text = pyRstrip(out.join("\n")) + "\n";
  await io.writeFile(path(workspace), text);
}

function _block(r, dismissed, writeKey = null) {
  // LEAD ruling (S1 review, third pass): a row that ISN'T the one this
  // call is writing, and still carries its `_raw` cache from load(), is
  // echoed byte for byte — never cleaned, never validated, so its own
  // legacy/hand-edited shape can't block or reformat someone else's
  // write. `writeKey` omitted (no single row identified) always takes
  // the clean-and-validate path below, unchanged from before.
  const isTarget = writeKey !== null && key(r) === writeKey;
  if (writeKey !== null && !isTarget && r._raw !== undefined && r._raw !== null) {
    return [...r._raw.split("\n"), ""];
  }
  const company = cleanCompany(r.company);
  const title = cleanValue(r.title);
  // LEAD spec amendment (S1 review, finding 6; design-web-search.md § 4.3):
  // a company or title that is empty after cleaning, IN THE ROW THIS
  // CALL WRITES, is refused — this check runs before any line of `out`
  // is written to disk, so a throw here never touches the file — see
  // EmptyFieldError's own comment.
  if (!company || !title) {
    throw new EmptyFieldError("error: empty company or title after cleaning; nothing written");
  }
  const lines = [`### ${company} — ${title}`];
  for (const [label, k] of FIELDS) {
    if (k === "was_stage" && !dismissed) continue;
    let v;
    if (k === "dismiss_note") {
      v = r.dismiss_note || (dismissed ? r.dismiss_reason : undefined);
    } else {
      v = r[k];
    }
    v = cleanValue(v);
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
