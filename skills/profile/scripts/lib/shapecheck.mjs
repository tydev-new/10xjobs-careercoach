// shapecheck — the skill shape's checker core, domain-neutral. Ported
// from kit/shapecheck.py (docs/design-js-only.md § 2.1): a host's checker
// (here, skills/profile/scripts/lib/check-files.mjs) supplies what is
// domain-specific — the workspace manifest, the history headers, the
// declared tables — and calls these functions on top.
//
//   loadSchemas(io, skillsRoot)              -> {file: schema}, from every
//                                                SKILL.md and
//                                                references/schema.md
//                                                declaring line
//   checkFile(io, path, schema, all, name)   -> [[level, msg]] sections
//                                                vs the schema
//   checkTable(io, path, header, enums)      -> [[level, msg]] a declared
//                                                table
//   checkHistory(io, path, header)           -> [[level, msg]] an
//                                                append-only round table
//   checkSkillProse(io, skillsRoot)          -> [[level, msg]] every
//                                                backticked relative path
//                                                (and `node <path>.mjs`
//                                                command) in skill prose
//                                                resolves
//
// The kit (`kit/README.md`) now VENDORS this file (and the helpers it
// imports) instead of keeping a guarded copy — see kit/README.md
// "Adopting it". Runs in Node AND in the browser: no node:fs, no
// node:path — every filesystem touch goes through the `io` argument (see
// packages/checkers/README.md "The io interface", now this file's own
// contract too).
//
// The parser's three rules are in docs/skill-shape.md § schema.md.
import { join, dirname, basename, relative } from "./path-util.mjs";
import { pySplit, stripChars, pySplitlines, cpArray, cpSlice, pyListRepr, pySortStrings, restoreLineSeparators } from "./py-text.mjs";
import { walkFilesRecursive, listPerChild } from "./fs-walk.mjs";

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

// A declared table: exact header, matching cell counts, enum cells valid.
// Silent when the table is absent — not every application has one yet.
// `opts.titleForHeader` maps a table's exact header text to the "##
// Section" title check_table WARNs about when that title is present but
// the header beneath it isn't exactly right (2026-08-21 alignment
// review, L1). `opts.columnValidators` maps a column index to a function
// `(cellValue) => message|null` for a check an enum set can't express
// (e.g. apply's panel-outcome column) — both maps are supplied by the
// host, since the titles/headers/extra rules are domain-specific, not
// part of this domain-neutral core.
export async function checkTable(io, path, header, enums, opts = {}) {
  const { titleForHeader = new Map(), columnValidators = new Map() } = opts;
  const res = [];
  const rawFile = await io.readFile(path);
  const raw = rawFile.split("\\|").join("");
  const allLines = pySplitlines(raw).map((l) => l.trim());
  const idx = allLines.indexOf(header);
  if (idx === -1) {
    const title = titleForHeader.get(header);
    if (title && allLines.some((l) => l.startsWith(title))) {
      res.push(["WARN", `${title} present but its header is not exactly "${header}"`]);
    }
    return res;
  }
  // The table is the CONTIGUOUS run of pipe rows under the header; stop
  // at the first line that is not one. An application file holds several
  // tables and free prose, so walking to EOF measured the next table's
  // rows against this header — four bogus WARNs on the design's own
  // normal file (measured 2026-08-18).
  const block = [];
  for (const l of allLines.slice(idx + 1)) {
    if (!l.startsWith("|")) break;
    block.push(l);
  }
  const ncols = countChar(header, "|") - 1;
  for (const l of block) {
    if ([...l].every((c) => "|-: ".includes(c))) continue; // separator row
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
    for (const [i2, validate] of columnValidators) {
      const msg = validate(stripChars(cells[i2], "`*_ "));
      if (msg) res.push(["WARN", msg]);
    }
  }
  return res;
}

// FAIL on a missing/altered header or a row whose cell count drifts — a
// malformed append silently corrupts the loop's audit trail.
export async function checkHistory(io, path, header) {
  const res = [];
  const rawFile = await io.readFile(path);
  const raw = rawFile.split("\\|").join(""); // escaped pipes are cell text
  const lines = pySplitlines(raw).map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (!lines.includes(header)) {
    res.push(["FAIL", `history header missing or altered — must be exactly "${header}"`]);
    return res;
  }
  const ncols = countChar(header, "|") - 1;
  lines.forEach((l, i) => {
    if ([...l].every((c) => "|-: ".includes(c))) return; // the separator row
    const cols = countChar(l, "|") - 1;
    if (cols !== ncols) res.push(["FAIL", `history row ${i} has ${cols} cells, the header has ${ncols}`]);
  });
  return res;
}

// The link rung (docs/design-js-only.md § 3.6, J2): a backticked path with
// a `/` and an .md/.mjs/.py/.html suffix must resolve, and so must the
// script in any backticked `node <path>.mjs …` command. Both resolve from
// the file's own directory, or from its skill root when the path doesn't
// start with `.`.
const LINK_RE = /\]\((\.\.?\/[^)#\s]+)\)|`([\w./-]*\/[\w./-]+\.(?:md|mjs|py|html))(?: §[^`]*)?`|`node ([\w./-]*\/[\w./-]+\.mjs)\b[^`]*`/g;

// The skill files' own structure — the one artifact class that shipped
// unchecked while schemas, tables, materials and language all had a rung.
//
// Two checks only, both unambiguous:
//   FAIL  a relative link, a backticked script path, or the script named
//         in a `node <path>.mjs …` command that does not resolve
//   WARN  a table row whose cell count differs from its header
//
// Deliberately NOT checked: "§ Some Section" pointers — indistinguishable
// from a local reference without parsing intent, and a noisy rung trains
// people to ignore it.
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
      const target = m[1] || m[2] || m[3];
      if (target.includes("<") || seen.has(target)) continue;
      seen.add(target);
      // A ./ or ../ link means what it says: it resolves from the file's
      // OWN directory, never from the skill root. Allowing the root as a
      // fallback would mask the original bug — an `../` one short from
      // inside references/ would quietly resolve.
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
        // resolves in the repo, not in ~/.claude/skills — a skill must be
        // self-contained or its pointer is dead for every user
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

// A schema block in a SKILL.md looks like:
//   **`profile.md` — who they are.** Any prose.
//   - `## Snapshot` — notes
//   - `## Intake findings` — with all four:
//     - `### Positioning strengths`
//   - `## Other notes` — optional
// Two declaration forms: the inline `**\`file.md\`**` block (SKILL.md §
// State), and a `## \`file.md\` — ...` heading (a references/schema.md
// organised per file).
export const FILE_RE = /^(?:\*\*|##\s+)`([\w\-.]+\.md)`/;

// Some files carry the candidate's own structure (a résumé body). Their
// header line says "free-form body"; only the named sections are
// required and unknown headings there are not flagged.
export const FREEFORM = "free-form body";

export const SECTION_RE = /^(\s*)-\s+`(#{2,3})\s+([^`]+)`(.*)$/;

// Parse every skill's schema blocks into {filename: schema}. Read from
// BOTH `SKILL.md` and `references/schema.md`, because a skill may declare
// its file shapes in either. A filename declared in both places is a
// duplicate the caller reports.
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
        if (basename(skillDir) === "references") skillDir = dirname(skillDir); // references/schema.md -> the skill
        current = { sections: [], freeform: line.toLowerCase().includes(FREEFORM), owner: basename(skillDir) };
        // A bare bold mention of a file in ANOTHER skill's prose must
        // never clobber the owner's real schema: only a block that
        // gathers sections may claim the name.
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
        current = null; // prose resumed; the block ended
      }
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(schemas)) if (v.sections.length) out[k] = v;
  return out;
}

// Compare on words only — an appended date or count is not a new section.
// Trailing plurals are folded so "Target" and "Targets" are one section,
// not a silent miss.
export function norm(s) {
  let out = s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  out = out.trim();
  const parts = pySplit(out);
  if (parts.length && parts[parts.length - 1].length > 3 && parts[parts.length - 1].endsWith("s")) {
    parts[parts.length - 1] = cpArray(parts[parts.length - 1]).slice(0, -1).join("");
  }
  return parts.join(" ");
}

// Headings present, each tagged with the `##` section it sits under.
// Anything under `## Other notes` carries under_escape=true: that section
// is the sanctioned home for novel material, so policing its internals
// would defeat the point of having an escape hatch.
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
    // A required heading may carry a suffix ("Targets — two, 50/50").
    if (![...presentNorm].some((p) => p === w || p.startsWith(w))) {
      res.push(["FAIL", `missing required section "${"#".repeat(want.level)} ${want.name}"`]);
    }
  }
  const known = new Set(schema.sections.map((s) => norm(s.name)));
  known.add(norm("Other notes"));
  // Sections owned by some OTHER file — the cross-contamination class.
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
    if (schema.freeform) continue; // the candidate's own headings are theirs
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

// Re-exported so a caller (e.g. check-files.mjs) that needs to restore the
// U+2028/U+2029 sentinels before returning a message doesn't also need its
// own import of py-text.mjs just for this.
export { restoreLineSeparators };
