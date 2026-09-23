// A faithful JS port of skills/apply/scripts/proposal_block.py. Runs in
// Node AND in the browser; no node:fs, no node:path.
import { join, isAbsolute } from "./path-util.mjs";
import { stripChars, pyInt, pyListRepr, cpSlice, cpLength, restoreLineSeparators, pySplitlines } from "./py-text.mjs";
import { parseFlags, argError, argHelp } from "./argx.mjs";
import { HELP } from "./help-text.mjs";
import { crashToTraceback } from "./traceback.mjs";

const COVERAGE_HEADER = "| requirement | status | evidence | decision |";
const SELECTION_HEADER = "| # | role | bullet | in/out | source | words | why |";

const STOP = new Set(
  ("a an the and or of to in on for with at by from as is are be this that " +
    "these those their its our your we they it into over under up down out off " +
    "own data scale work working team teams across within").split(" ")
);

function table(lines, header) {
  const idx = lines.indexOf(header);
  if (idx === -1) return null;
  const rows = [];
  for (const l of lines.slice(idx + 1)) {
    if (!l.startsWith("|")) break;
    if ([...l].every((c) => "|-: ".includes(c))) continue;
    const stripped = l.replace(/^\|+/, "").replace(/\|+$/, "");
    rows.push(stripped.split("|").map((c) => c.trim()));
  }
  return rows;
}

function stem(w) {
  w = w.toLowerCase();
  const sufs = ["ations", "ation", "ings", "ing", "ies", "ers", "er", "ed", "es", "s"];
  for (const suf of sufs) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, w.length - suf.length);
  }
  return w;
}

function contentWords(text) {
  const words = text.match(/[A-Za-z][A-Za-z\-/]+/g) || [];
  return words.filter((w) => !STOP.has(w.toLowerCase()) && w.length > 2);
}

const PROG = "proposal_block.py";
const USAGE =
  "usage: proposal_block.py [-h] --workspace WORKSPACE --application APPLICATION\n" +
  "                         [--base BASE]\n";
const OPTIONS = [
  { flag: "--workspace", dest: "workspace", required: true },
  { flag: "--application", dest: "application", required: true },
  { flag: "--base", dest: "base" },
];

/**
 * @param {string[]} argv
 * @param {{exists(p:string):Promise<boolean>, readFile(p:string):Promise<string>}} io
 */
export async function run(argv, io) {
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.proposal_block });
  if (parsed.help) return argHelp(parsed.text);
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;

  const apath = isAbsolute(a.application) ? a.application : join(a.workspace, a.application);
  const bpath = a.base || join(a.workspace, "base-resume.md");
  // Python's main() has no os.path.exists() guard before open(apath) — a
  // missing application file crashes uncaught (FileNotFoundError).
  let rawFile;
  try {
    rawFile = await io.readFile(apath);
  } catch (e) {
    return crashToTraceback("", e);
  }
  const raw = rawFile.split("\\|").join("");
  const lines = pySplitlines(raw).map((l) => l.trim());
  const baseText = (await io.exists(bpath)) ? await io.readFile(bpath) : "";
  const baseStems = new Set(contentWords(baseText).map(stem));

  const findings = [];
  const out = [];
  const cov = table(lines, COVERAGE_HEADER);
  const sel = table(lines, SELECTION_HEADER);
  if (cov === null) findings.push(["FAIL", "no coverage table under the declared header — write it to the file first"]);
  if (sel === null) findings.push(["FAIL", "no selection table under the declared header — write it to the file first"]);

  if (sel !== null) {
    const outs = sel.filter((r) => r.length === 7 && stripChars(r[3].toLowerCase(), "`*_ ") === "out");
    const ins = sel.filter((r) => r.length === 7 && stripChars(r[3].toLowerCase(), "`*_ ") === "in");
    if (outs.length) {
      out.push(`**Cut — ${outs.length} of ${outs.length + ins.length} bullets, weakest first.** Say "keep <bullet>" and it comes back.`);
      outs.forEach((r, idx) => {
        const bullet = cpLength(r[2]) <= 70 ? r[2] : cpSlice(r[2], 67).replace(/\s+$/, "") + "…";
        out.push(`${idx + 1}. ${r[1]} — ${bullet} — *${r[6]}*`);
      });
    }
    for (const r of outs) {
      if (stripChars(r[6], " —-") === "" || stripChars(r[5], " —-") === "") {
        findings.push(["FAIL", `out row #${r[0]} (${r[1]}) has no \`why\` or no \`words\` — a cut nobody can weigh`]);
      }
    }
    const nums = [];
    for (const r of outs) {
      const n = pyInt(r[0]);
      if (n !== null) nums.push(n);
    }
    let rising = nums.length >= 3;
    for (let i = 1; rising && i < nums.length; i++) if (!(nums[i - 1] < nums[i])) rising = false;
    if (rising) {
      findings.push([
        "WARN",
        "the `out` rows are in base order (# strictly rising) — rank them weakest-first for THIS posting, in the file, then re-run",
      ]);
    }
  }

  if (cov !== null) {
    const sbu = cov.filter((r) => r.length === 4 && stripChars(r[1].toLowerCase(), "`*_ ") === "shown-but-unnamed");
    const gaps = cov.filter((r) => r.length === 4 && stripChars(r[1].toLowerCase(), "`*_ ") === "gap");
    if (sbu.length) {
      out.push("");
      out.push('**Their words, placed** — say "Summary" / "Skills" / "leave it out" to move any of these:');
      for (const r of sbu) {
        const ev = cpSlice(r[2], 60) + (cpLength(r[2]) > 60 ? "…" : "");
        out.push(`- **${r[0]}** — true of you (${ev}); placed where the document shows it`);
      }
    }
    if (gaps.length) {
      out.push("");
      out.push('**Gaps — evidence you might have?** ("no" is a fine answer)');
      for (const r of gaps) {
        const ev = cpSlice(r[2], 80) + (cpLength(r[2]) > 80 ? "…" : "");
        out.push(`- ${r[0]} — ${ev}`);
      }
    }
    for (const r of cov) {
      if (r.length !== 4) continue;
      const req = r[0];
      const status = stripChars(r[1].toLowerCase(), "`*_ ");
      if (status === "have" && baseText) {
        const missing = contentWords(req).filter((w) => !baseStems.has(stem(w)));
        if (missing.length) {
          findings.push([
            "WARN",
            `\`have\` row "${cpSlice(req, 50)}": their word(s) ${pyListRepr(missing)} do not appear in the base — true in the base but missing THEIR word is \`shown-but-unnamed\`, and then it is a placement the candidate can move`,
          ]);
        }
      }
    }
  }
  out.push("");
  out.push("Otherwise this is the version.");

  let stdout = out.join("\n") + "\n\n--- paste everything above this line into the reply, beside the delivered document ---\n";
  for (const [level, msg] of findings) stdout += `${level}  ${msg}\n`;
  if (!findings.length) stdout += "clean: proposal block printed; no FAIL, no WARN\n";
  const exitCode = findings.some(([l]) => l === "FAIL") ? 1 : 0;
  return { stdout: restoreLineSeparators(stdout), stderr: "", exitCode };
}
