// A faithful JS port of skills/profile/scripts/check_files.py. Runs in Node
// AND in the browser; no node:fs, no node:path. Every function that reads
// the filesystem takes an `io` (see README.md "The io interface") as its
// first argument — the one deliberate signature difference from the Python
// functions of the same name, which `open()` a path directly.
//
// `--skills`'s default (fix round 2, item 1 — BLOCKER, revised): Python's
// default is `os.path.dirname(__file__) + "/../.."` — wherever
// check_files.py's OWN file physically sits, go up two levels to the
// skills/ root (confirmed against CPython: `__file__` for the `__main__`
// script is resolved to an absolute path, joining whatever relative
// script argument `python3` was given with the process's real cwd —
// `python3 skills/profile/scripts/check_files.py` from cwd `X` gives
// `__file__` == `X/skills/profile/scripts/check_files.py`). Every MVP
// skill's own SKILL.md runs `check_files.py --workspace .` with NO
// --skills (e.g. skills/apply/SKILL.md's session-close line), so this
// port must resolve the same default.
//
// This function does the SAME two-dirnames-up arithmetic Python does —
// but on `invokedScriptPath`, a value THIS PORT NEVER COMPUTES ITSELF.
// Each caller supplies its own caller-appropriate equivalent of
// `__file__`: `dispatch.mjs`'s `dispatchPython3` reconstructs it from
// where docs/design-web-agent.md § 4 guarantees the skills bundle is
// mounted (`<ctx.cwd>/skills/...`) — deliberately ignoring the actual
// (often fictional, per S12) argv[0] path — and `bin/check_files.mjs`
// (a Node-only file, like io-node.mjs) uses its own real position on
// disk. There is deliberately no `import.meta.url`/host-disk-path
// fallback IN THIS SHARED PORT FILE: that was fix round 1's mistake —
// it silently pointed at wherever THIS PACKAGE happens to live on the
// machine running the code, which is meaningless inside just-bash's
// in-memory filesystem (docs/design-web-agent.md § 4's actual runtime;
// this is why the round-1 fix passed every case that happened to mirror
// the host's real disk layout into the sandbox, and failed the one case,
// `r2-cf-default-skills-design-mount`, that mounts the bundle only where
// the design doc says it lives), and — a second, independent bug — a raw
// `new URL(...).pathname` percent-encodes a space in the path (`%20`),
// which a caller that DOES have a real filesystem path (bin/check_files.mjs)
// must decode with `fileURLToPath`, not read as `.pathname` directly.
//
// `--workspace` is never `~`-expanded (documented, unchanged): rule 9 —
// the web app never sees a real home directory; fixtures use explicit
// paths.
import { join, dirname, basename, relative } from "./path-util.mjs";
import { pySplit, stripChars, pyListRepr, cpSlice, cpArray, pySplitlines, codePointCompare, pySortStrings, restoreLineSeparators } from "./py-text.mjs";
import { parseFlags, argError, argHelp } from "./argx.mjs";
import { walkFilesRecursive, listFiles, listPerChild, listDirNames } from "./fs-walk.mjs";
import { HELP } from "./help-text.mjs";
import { crashToTraceback } from "./traceback.mjs";

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

const TITLE_FOR_HEADER = new Map([
  [COVERAGE_HEADER, "## Coverage"],
  [SELECTION_HEADER, "## Selection"],
  [ROUNDS_HEADER, "## Rounds"],
  [PANEL_HEADER, "## Panel"],
  [HISTORY_HEADERS["base-resume-history.md"], "## Rounds"],
  [HISTORY_HEADERS["pitch-history.md"], "## Rounds"],
  [HISTORY_HEADERS["storybank-history.md"], "## Rounds"],
]);

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

export async function checkTable(io, path, header, enums) {
  const res = [];
  const rawFile = await io.readFile(path);
  const raw = rawFile.split("\\|").join("");
  const allLines = pySplitlines(raw).map((l) => l.trim());
  const idx = allLines.indexOf(header);
  if (idx === -1) {
    const title = TITLE_FOR_HEADER.get(header);
    if (title && allLines.some((l) => l.startsWith(title))) {
      res.push(["WARN", `${title} present but its header is not exactly "${header}"`]);
    }
    return res;
  }
  const block = [];
  for (const l of allLines.slice(idx + 1)) {
    if (!l.startsWith("|")) break;
    block.push(l);
  }
  const ncols = countChar(header, "|") - 1;
  for (const l of block) {
    if ([...l].every((c) => "|-: ".includes(c))) continue;
    const stripped = l.replace(/^\|+/, "").replace(/\|+$/, "");
    const cells = stripped.split("|").map((c) => c.trim());
    if (cells.length !== ncols) {
      res.push(["WARN", `row has ${cells.length} cells, the header has ${ncols}: "${cpSlice(l, 60)}"`]);
      continue;
    }
    for (const [i2, allowed] of enums) {
      const v = stripChars(cells[i2].toLowerCase(), "`*_ ");
      if (v && !allowed.has(v)) {
        res.push(["WARN", `"${cells[i2]}" is not one of ${pyListRepr(pySortStrings([...allowed]))} — apply/references/schema.md declares the enum`]);
      }
    }
    if (header === PANEL_HEADER) {
      const o = stripChars(cells[2], "`*_ ");
      if (o && !(o === "fixed" || o.startsWith("discarded —") || o === "—")) {
        res.push(["WARN", `panel outcome "${o}" is neither "fixed" nor "discarded — <why>" (or "—" on a VOID row) — apply/references/schema.md`]);
      }
    }
  }
  return res;
}

export async function checkHistory(io, path, header) {
  const res = [];
  const rawFile = await io.readFile(path);
  const raw = rawFile.split("\\|").join("");
  const lines = pySplitlines(raw).map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (!lines.includes(header)) {
    res.push(["FAIL", `history header missing or altered — must be exactly "${header}"`]);
    return res;
  }
  const ncols = countChar(header, "|") - 1;
  lines.forEach((l, i) => {
    if ([...l].every((c) => "|-: ".includes(c))) return;
    const cols = countChar(l, "|") - 1;
    if (cols !== ncols) res.push(["FAIL", `history row ${i} has ${cols} cells, the header has ${ncols}`]);
  });
  return res;
}

const LINK_RE = /\]\((\.\.?\/[^)#\s]+)\)|`([\w./-]*\/[\w./-]+\.(?:md|py|html))(?: §[^`]*)?`/g;

export async function checkSkillProse(io, skillsRoot) {
  const res = [];
  const files = await walkFilesRecursive(io, skillsRoot, ".md");
  for (const path of files) {
    const relName = relative(skillsRoot, path);
    const text = await io.readFile(path);
    const here = dirname(path);
    const skillRoot = join(skillsRoot, relName.split("/")[0]);
    const seen = new Set();
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(text)) !== null) {
      const target = m[1] || m[2];
      if (target.includes("<") || seen.has(target)) continue;
      seen.add(target);
      const bases = target.startsWith(".") ? [here] : [here, skillRoot];
      let hit = null;
      for (const base of bases) {
        const candidate = join(base, target);
        if (await io.exists(candidate)) {
          hit = candidate;
          break;
        }
      }
      if (hit === null) {
        res.push(["FAIL", `${relName}: link does not resolve — ${target}`]);
      } else if (relative(skillsRoot, hit).startsWith("..")) {
        res.push(["FAIL", `${relName}: link escapes the skill tree — ${target}`]);
      }
    }
    const lines = text.split("\n");
    let i = 0;
    while (i < lines.length - 1) {
      const head = lines[i];
      const sep = lines[i + 1].trim();
      if (head.startsWith("|") && sep.startsWith("|") && [...sep].every((c) => "|-: ".includes(c))) {
        const ncols = countChar(head, "|");
        let j = i + 2;
        while (j < lines.length && lines[j].startsWith("|")) {
          if (countChar(lines[j], "|") !== ncols) {
            res.push(["WARN", `${relName}: table row ${j + 1} has ${countChar(lines[j], "|") - 1} cells, header has ${ncols - 1}`]);
          }
          j++;
        }
        i = j;
      } else {
        i++;
      }
    }
  }
  return res;
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

const FILE_RE = /^(?:\*\*|##\s+)`([\w\-.]+\.md)`/;
const FREEFORM = "free-form body";
const SECTION_RE = /^(\s*)-\s+`(#{2,3})\s+([^`]+)`(.*)$/;

export async function loadSchemas(io, skillsRoot) {
  const schemas = {};
  const paths = [
    ...(await listPerChild(io, skillsRoot, "SKILL.md")),
    ...(await listPerChild(io, skillsRoot, "references/schema.md")),
  ];
  for (const path of paths) {
    let current = null;
    const text = await io.readFile(path);
    for (const line of text.split("\n")) {
      const m = line.match(FILE_RE);
      if (m) {
        let skillDir = dirname(path);
        if (basename(skillDir) === "references") skillDir = dirname(skillDir);
        current = { sections: [], freeform: line.toLowerCase().includes(FREEFORM), owner: basename(skillDir) };
        if (!(m[1] in schemas) || schemas[m[1]].sections.length === 0) {
          schemas[m[1]] = current;
        }
        continue;
      }
      if (current === null) continue;
      const sec = line.match(SECTION_RE);
      if (sec) {
        const [, , hashes, name, rest] = sec;
        current.sections.push({ name: name.trim(), level: hashes.length, optional: rest.toLowerCase().includes("optional") });
      } else if (line.trim() && ![" ", "\t", "*", "-"].some((c) => line.startsWith(c))) {
        current = null;
      }
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(schemas)) if (v.sections.length) out[k] = v;
  return out;
}

export function norm(s) {
  let out = s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  out = out.trim();
  const parts = pySplit(out);
  if (parts.length && parts[parts.length - 1].length > 3 && parts[parts.length - 1].endsWith("s")) {
    parts[parts.length - 1] = cpArray(parts[parts.length - 1]).slice(0, -1).join("");
  }
  return parts.join(" ");
}

export function headings(text) {
  const out = [];
  let currentTop = null;
  const re = /^(#{2,3})\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const level = m[1].length;
    const name = m[2].trim();
    if (level === 2) currentTop = name;
    out.push({
      name,
      level,
      under_escape: norm(currentTop || "") === norm("Other notes") && !(level === 2 && norm(name) === norm("Other notes")),
    });
  }
  return out;
}

export async function checkFile(io, path, schema, allSchemas, fname) {
  const res = [];
  const text = await io.readFile(path);
  const present = headings(text);
  const presentNorm = new Set(present.map((h) => norm(h.name)));
  for (const want of schema.sections) {
    if (want.optional) continue;
    const w = norm(want.name);
    if (![...presentNorm].some((p) => p === w || p.startsWith(w))) {
      res.push(["FAIL", `missing required section "${"#".repeat(want.level)} ${want.name}"`]);
    }
  }
  const known = new Set(schema.sections.map((s) => norm(s.name)));
  known.add(norm("Other notes"));
  const foreign = new Map();
  for (const [other, osch] of Object.entries(allSchemas)) {
    if (other === fname) continue;
    for (const s of osch.sections) {
      const nk = norm(s.name);
      if (!foreign.has(nk)) foreign.set(nk, other);
    }
  }
  for (const h of present) {
    if (h.under_escape) continue;
    const n = norm(h.name);
    if ([...known].some((k) => n === k || n.startsWith(k))) continue;
    if (schema.freeform) continue;
    let owner = null;
    for (const [k, f] of foreign) {
      if (n === k || n.startsWith(k)) {
        owner = f;
        break;
      }
    }
    if (owner) {
      res.push(["FAIL", `section "${h.name}" belongs to ${owner} — content in the wrong file breaks its consumers`]);
    } else {
      res.push(["WARN", `unrecognised section "${h.name}" — put novel material under \`## Other notes\``]);
    }
  }
  return res;
}

const PROG = "check_files.py";
const USAGE = "usage: check_files.py [-h] --workspace WORKSPACE [--skills SKILLS]\n";
const OPTIONS = [
  { flag: "--workspace", dest: "workspace", required: true },
  { flag: "--skills", dest: "skills" }, // no static default — see skillsRootFromScriptPath above
];

/**
 * @param {string[]} argv
 * @param {object} io
 * @param {string} [invokedScriptPath] the caller's equivalent of Python's
 *   `__file__` for check_files.py (see this file's header comment) — only
 *   consulted when `--skills` isn't given. If a caller has none to offer,
 *   `--skills` falls back to `"."` (never silently succeeds with the
 *   wrong root; a caller that truly has nothing better should say so
 *   explicitly rather than this port guessing a host path).
 */
export async function run(argv, io, invokedScriptPath) {
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.check_files });
  if (parsed.help) return argHelp(parsed.text);
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;

  const skillsRoot = a.skills ?? (invokedScriptPath ? skillsRootFromScriptPath(invokedScriptPath) : ".");
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
      for (const [level, msg] of await checkTable(io, p, hdr, new Map())) {
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
      for (const [level, msg] of await checkTable(io, apath, header, enums)) {
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
