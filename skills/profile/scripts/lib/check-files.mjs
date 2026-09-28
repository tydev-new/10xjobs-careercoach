// A faithful JS port of skills/profile/scripts/check_files.py. Runs in Node
// AND in the browser; no node:fs, no node:path. Every function that reads
// the filesystem takes an `io` (see README.md "The io interface") as its
// first argument — the one deliberate signature difference from the Python
// functions of the same name, which `open()` a path directly.
//
// `--skills`'s default (fix round 2, item 1; fix round 3, item 1 —
// revised again): Python's default is `os.path.dirname(__file__) +
// "/../.."` — wherever check_files.py's OWN file physically sits, go up
// two levels to the skills/ root (confirmed against CPython: `__file__`
// for the `__main__` script is resolved to an absolute path, joining
// whatever relative script argument `python3` was given with the
// process's real cwd AT INVOCATION TIME — `python3
// skills/profile/scripts/check_files.py` from cwd `X` gives `__file__`
// == `X/skills/profile/scripts/check_files.py`). Every MVP skill's own
// SKILL.md runs `check_files.py --workspace .` with NO --skills (e.g.
// skills/apply/SKILL.md's session-close line), so this port must resolve
// the same default.
//
// This function does the SAME two-dirnames-up arithmetic Python does —
// but on a script path THIS PORT NEVER COMPUTES ITSELF. Each caller
// supplies its own caller-appropriate equivalent of `__file__`, via
// `resolveInvokedScriptPath(workspace)` — a function, not a bare string,
// because the answer can depend on where the caller resolves things from:
//
//   - `bin/check_files.mjs` (a Node-only file, like io-node.mjs) ignores
//     the workspace argument and always returns its own real position on
//     disk (there is deliberately no `import.meta.url`/host-disk-path
//     fallback IN THIS SHARED PORT FILE: that was fix round 1's
//     mistake — it silently pointed at wherever THIS PACKAGE happens to
//     live on the machine running the code, meaningless inside
//     just-bash's in-memory filesystem). A raw `new URL(...).pathname`
//     also percent-encodes a space in the path (`%20`); bin/check_files.mjs
//     decodes with `fileURLToPath` instead.
//   - `dispatch.mjs`'s `dispatchPython3` reconstructs it from where
//     docs/design-web-agent.md § 4 guarantees the skills bundle is
//     mounted: `<workspace>/skills/...` — joined against THIS SCRIPT'S
//     OWN `--workspace` argument (not the shell's cwd at large, and
//     deliberately ignoring the actual, often fictional per S12, argv[0]
//     path). Using cwd directly broke the moment the shell's cwd wasn't
//     the workspace root (fix round 3's `r3-cf-default-skills-from-subdir-cwd`:
//     `cd applications && check_files.py --workspace ..`) — the
//     workspace argument, resolved against cwd by the same `io` every
//     other relative path in this file already goes through, is cwd-depth
//     independent the way Python's own `__file__` resolution is.
//
// `--workspace` is never `~`-expanded (documented, unchanged): rule 9 —
// the web app never sees a real home directory; fixtures use explicit
// paths.
import { join, dirname, basename } from "./path-util.mjs";
import { pySortStrings, restoreLineSeparators } from "./py-text.mjs";
import { parseFlags, argError, argHelp } from "./argx.mjs";
import { listFiles } from "./fs-walk.mjs";
import { HELP } from "./help-text.mjs";
import { crashToTraceback } from "./traceback.mjs";
import { checkTable, checkHistory, checkSkillProse, loadSchemas, checkFile } from "./shapecheck.mjs";
// Re-exported: check-files.mjs is the host checker that composes these
// domain-neutral primitives (§ 2.1), and existing callers/tests import
// them from here rather than reaching into shapecheck.mjs directly.
export { checkTable, checkHistory, checkSkillProse, loadSchemas, checkFile, norm, headings } from "./shapecheck.mjs";

// os.path.join(os.path.dirname(__file__), "..", "..") — pure string
// arithmetic on whatever path the caller supplies; no filesystem access,
// no host-path assumption.
function skillsRootFromScriptPath(invokedScriptPath) {
  return join(dirname(invokedScriptPath), "..", "..");
}

export const HISTORY_HEADERS = {
  "base-resume-history.md": "| date | round | driver | scored vs FIXED | what changed |",
  "pitch-history.md": "| date | round | driver | scored vs FIXED | what changed |",
  "storybank-history.md": "| date | story | round | what changed | scored |",
};
const LOOP_HISTORY = new Set(Object.keys(HISTORY_HEADERS));

const MANIFEST_FILES = new Map([
  ["CLAUDE.md", "profile (written at setup from the template)"],
  ["jobs.md", "search scripts"],
  ["companies.md", "search scripts"],
  ["leads.md", "search scripts (internal lead tier)"],
  ["criteria.json", "search (generated projection of criteria.md)"],
  ["jobs.db", "search (on-demand scratch)"],
  ["jobs.db.bak", "search (migration backup)"],
  ["autopilot-log.md", "search (scheduled-run log, append-only)"],
  ["plan-log.md", "coach (append-only annex)"],
  ["practice-log.md", "interview"],
  ["question-bank.md", "interview"],
  ["composite-target.md", "interview"],
  ["linkedin-audit.md", "profile (regenerated per audit)"],
  ["base-resume-history.md", "profile (append-only; header checked)"],
  ["pitch-history.md", "profile (append-only; header checked)"],
  ["storybank-history.md", "storybank (append-only; header checked)"],
]);
const MANIFEST_DIRS = new Map([
  ["documents", "the candidate (drop folder — read on sight, captured into the owned files)"],
  ["applications", "apply"], ["company", "evaluate"], ["contacts", "outreach"],
  ["jd-analysis", "evaluate"], ["jd-inbox", "search + candidate drops"],
  ["prep", "interview"], ["practice", "interview"], ["stories", "storybank"],
  ["courses", "learn"],
  ["negotiation", "interview"],
  // JS-port-only addition (fix round 2): docs/design-web-agent.md § 4 —
  // "the bundle mounted read-only at `skills/`" of the sandboxed
  // workspace, and later in the same section, refused by WorkspaceStore.write
  // the same way CLAUDE.md is (already in MANIFEST_FILES). This convention
  // doesn't exist for the original local-Python world (no local candidate
  // workspace ever has a "skills/" subdirectory of its own), so the
  // Python source's MANIFEST_DIRS never needed it — this is a deliberate,
  // documented divergence, not a parity gap (see README.md "Known,
  // sanctioned divergences").
  ["skills", "the skills bundle mount (design-web-agent.md § 4) — read-only, never the candidate's own directory"],
]);

export const COVERAGE_HEADER = "| requirement | status | evidence | decision |";
export const COVERAGE_ENUMS = new Map([
  [1, new Set(["have", "shown-but-unnamed", "gap"])],
  [3, new Set(["open", "answered", "skipped"])],
]);
export const SELECTION_HEADER = "| # | role | bullet | in/out | source | words | why |";
export const SELECTION_ENUMS = new Map([
  [3, new Set(["in", "out"])],
  [4, new Set(["base", "story", "new"])],
]);
export const ROUNDS_HEADER = "| date | round | driver | scored | what changed |";
export const ROUNDS_ENUMS = new Map();
export const PANEL_HEADER = "| lens | finding | outcome |";
export const PANEL_ENUMS = new Map([[0, new Set(["ats", "recruiter", "hiring manager"])]]);

// The "## Section" title check_table WARNs about when it's present but
// the header beneath it isn't exactly right (2026-08-21 alignment review,
// L1) — domain-specific text, supplied to shapecheck's checkTable.
const TITLE_FOR_HEADER = new Map([
  [COVERAGE_HEADER, "## Coverage"],
  [SELECTION_HEADER, "## Selection"],
  [ROUNDS_HEADER, "## Rounds"],
  [PANEL_HEADER, "## Panel"],
  [HISTORY_HEADERS["base-resume-history.md"], "## Rounds"],
  [HISTORY_HEADERS["pitch-history.md"], "## Rounds"],
  [HISTORY_HEADERS["storybank-history.md"], "## Rounds"],
]);

// The panel outcome column (index 2) isn't a plain enum set — "fixed",
// "discarded — <why>" (any reason text) or "—" on a VOID row — so it's a
// column validator, not an `enums` entry.
const PANEL_COLUMN_VALIDATORS = new Map([
  [2, (o) => (o && !(o === "fixed" || o.startsWith("discarded —") || o === "—")
    ? `panel outcome "${o}" is neither "fixed" nor "discarded — <why>" (or "—" on a VOID row) — apply/references/schema.md`
    : null)],
]);

async function checkTableHere(io, path, header, enums) {
  return checkTable(io, path, header, enums, {
    titleForHeader: TITLE_FOR_HEADER,
    columnValidators: header === PANEL_HEADER ? PANEL_COLUMN_VALIDATORS : undefined,
  });
}

export async function checkStrays(io, workspace, schemas) {
  const res = [];
  const allowed = new Set([...Object.keys(schemas), ...MANIFEST_FILES.keys()]);
  // Python: `sorted(os.listdir(workspace))` — unlike fs-walk.mjs's other
  // helpers (which treat a missing/non-directory path as "nothing here"),
  // os.listdir() raises (FileNotFoundError / NotADirectoryError) UNCAUGHT
  // for exactly those two cases — the corpus's `cf-missing-workspace-dir`
  // and `cf-workspace-is-a-file`. The `io` interface's own readdir is
  // deliberately graceful (every OTHER caller in this file wants "nothing
  // here", not a thrown error) so the check is done explicitly here,
  // rather than by relying on io.readdir to fail.
  if (!(await io.isDir(workspace))) {
    throw new Error(`[Errno 2] No such file or directory: '${workspace}'`);
  }
  const names = pySortStrings(await io.readdir(workspace));
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const p = join(workspace, name);
    if (await io.isDir(p)) {
      if (!MANIFEST_DIRS.has(name)) res.push(["WARN", `stray directory "${name}/" — no skill owns it`]);
    } else if (!allowed.has(name)) {
      res.push([
        "WARN",
        `stray file "${name}" — no skill reads or writes it. A second source of truth starts exactly here: if the candidate dropped it, move it to documents/ and capture it; if it holds real facts, it needs an owner; if it is scratch, move it out`,
      ]);
    }
  }
  return res;
}

const PROG = "check_files.mjs";
const USAGE = "usage: check_files.mjs [-h] --workspace WORKSPACE [--skills SKILLS]\n";
const OPTIONS = [
  { flag: "--workspace", dest: "workspace", required: true },
  { flag: "--skills", dest: "skills" }, // no static default — see skillsRootFromScriptPath above
];

/**
 * @param {string[]} argv
 * @param {object} io
 * @param {(workspace: string) => string} [resolveInvokedScriptPath] given
 *   the ALREADY-PARSED `--workspace` value, returns the caller's
 *   equivalent of Python's `__file__` for check_files.py (see this
 *   file's header comment) — only consulted when `--skills` isn't given.
 *   If a caller has none to offer, `--skills` falls back to `"."` (never
 *   silently succeeds with the wrong root; a caller that truly has
 *   nothing better should say so explicitly rather than this port
 *   guessing a host path).
 */
export async function run(argv, io, resolveInvokedScriptPath) {
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.check_files });
  if (parsed.help) return argHelp(parsed.text);
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;

  const skillsRoot = a.skills ?? (resolveInvokedScriptPath ? skillsRootFromScriptPath(resolveInvokedScriptPath(a.workspace)) : ".");
  const schemas = await loadSchemas(io, skillsRoot);
  const fnames = pySortStrings(Object.keys(schemas));
  if (fnames.length === 0) {
    return { stdout: "FAIL  no schemas found — is --skills pointing at the skills directory?\n", stderr: "", exitCode: 1 };
  }

  let failed = 0;
  let checked = 0;
  let stdout = "";
  const ws = a.workspace;

  try {
  for (const fname of fnames) {
    const path = join(ws, fname);
    if (!(await io.exists(path))) continue;
    checked++;
    for (const [level, msg] of await checkFile(io, path, schemas[fname], schemas, fname)) {
      stdout += `${level}  ${fname}: ${msg}\n`;
      if (level === "FAIL") failed++;
    }
  }

  const historyPaths = await listFiles(io, ws, "-history.md");
  for (const hpath of historyPaths) {
    const hname = basename(hpath);
    if (!LOOP_HISTORY.has(hname)) continue;
    checked++;
    for (const [level, msg] of await checkHistory(io, hpath, HISTORY_HEADERS[hname])) {
      stdout += `${level}  ${hname}: ${msg}\n`;
      if (level === "FAIL") failed++;
    }
  }

  const inlineRounds = [
    ["base-resume.md", HISTORY_HEADERS["base-resume-history.md"]],
    ["pitch.md", HISTORY_HEADERS["pitch-history.md"]],
    ["storybank.md", HISTORY_HEADERS["storybank-history.md"]],
  ];
  for (const [f, hdr] of inlineRounds) {
    const p = join(ws, f);
    if (await io.exists(p)) {
      for (const [level, msg] of await checkTableHere(io, p, hdr, new Map())) {
        stdout += `${level}  ${f}: ${msg}\n`;
        if (level === "FAIL") failed++;
      }
    }
  }

  const appPaths = await listFiles(io, join(ws, "applications"), ".md");
  for (const apath of appPaths) {
    checked++;
    const tables = [
      [COVERAGE_HEADER, COVERAGE_ENUMS],
      [ROUNDS_HEADER, ROUNDS_ENUMS],
      [PANEL_HEADER, PANEL_ENUMS],
      [SELECTION_HEADER, SELECTION_ENUMS],
    ];
    for (const [header, enums] of tables) {
      for (const [level, msg] of await checkTableHere(io, apath, header, enums)) {
        stdout += `${level}  applications/${basename(apath)}: ${msg}\n`;
        if (level === "FAIL") failed++;
      }
    }
  }

  for (const [level, msg] of await checkSkillProse(io, skillsRoot)) {
    stdout += `${level}  ${msg}\n`;
    if (level === "FAIL") failed++;
  }
  for (const [level, msg] of await checkStrays(io, ws, schemas)) {
    stdout += `${level}  ${msg}\n`;
    if (level === "FAIL") failed++;
  }
  stdout += `\n${checked} file(s) checked against ${fnames.length} schema(s); ${failed} failure(s).\n`;
  return { stdout: restoreLineSeparators(stdout), stderr: "", exitCode: failed ? 1 : 0 };
  } catch (e) {
    // checkStrays' io.readdir(workspace) is the one call in this script
    // that matches Python's own uncaught os.listdir() crash — a missing
    // workspace or a workspace path that's actually a file.
    return crashToTraceback(restoreLineSeparators(stdout), e);
  }
}
