// A faithful JS port of skills/apply/scripts/proposal_block.py. Runs in
// Node AND in the browser; no node:fs, no node:path.
import { join, isAbsolute } from "../../../profile/scripts/lib/path-util.mjs";
import { stripChars, pyInt, pyListRepr, cpSlice, cpLength, restoreLineSeparators, pySplitlines } from "../../../profile/scripts/lib/py-text.mjs";
import { parseFlags, argError, argHelp } from "../../../profile/scripts/lib/argx.mjs";
import { HELP } from "../../../profile/scripts/lib/help-text.mjs";
import { crashToTraceback } from "../../../profile/scripts/lib/traceback.mjs";

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

// proposalRows — docs/design-web-agent.md § 19 (the restore ruling): the
// Applications page's own reader of an application file's two tables. It
// does EXACTLY what run() did, between reading the file and building the
// reply, before this export existed: the `\|`-strip, pySplitlines, each
// line trimmed, table(lines, COVERAGE_HEADER) and table(lines,
// SELECTION_HEADER), and the same in/out test run() already used. `run()`
// (below) is re-expressed through this export so there is exactly one
// reader of the file's tables (rule 12) — its own output is unchanged
// (every place it read coverage/selection rows already filtered by cell
// count, so a row this function now routes to `unreadable` never reached
// run()'s output either way).
//
// A row under either header whose cell count isn't the table's own (4 for
// Coverage, 7 for Selection) is dropped from `coverage`/`cuts`/`kept` and
// added to `unreadable`, AS SPLIT (the page joins the cells back with
// " | " when it shows them, design-web-ui.md § 5.2 rule 6) — never
// dropped outright, so a malformed row is said, not silently lost. A
// 7-cell Selection row whose in/out cell is neither `in` nor `out` (after
// the port's own `` `*_ `` strip) is simply not `cuts` or `kept` — that
// matches run()'s own behaviour today, which never flagged such a row
// either.
// **A coverage status is matched once, here** (lead ruling, 2026-09-29,
// docs/workspace-review-drift). `run()` used to re-derive a status cell's
// normalised form in three separate places (`stripChars(r[1].toLowerCase(),
// "`*_ ")`) — a second normalisation the page would have had to copy
// exactly to agree with the reply. `statuses[i]` is coverage[i]'s own
// normalised status, computed once, here; `run()` (below) uses it in all
// three places instead of normalising again, and the page keys its status
// label table on it too (never the raw cell) — so `**gap**`, `` `gap` ``
// and `Gap` all read `gap` everywhere, page and reply alike.
export function proposalRows(text) {
  const raw = text.split("\\|").join("");
  const lines = pySplitlines(raw).map((l) => l.trim());
  const covAll = table(lines, COVERAGE_HEADER);
  const selAll = table(lines, SELECTION_HEADER);
  const unreadable = [];

  let coverage = null;
  let statuses = null;
  if (covAll !== null) {
    coverage = [];
    statuses = [];
    for (const r of covAll) {
      if (r.length === 4) {
        coverage.push(r);
        statuses.push(stripChars(r[1].toLowerCase(), "`*_ "));
      } else {
        unreadable.push(r);
      }
    }
  }

  let cuts = null;
  let kept = null;
  if (selAll !== null) {
    cuts = [];
    kept = [];
    for (const r of selAll) {
      if (r.length !== 7) {
        unreadable.push(r);
        continue;
      }
      const io = stripChars(r[3].toLowerCase(), "`*_ ");
      if (io === "out") cuts.push(r);
      else if (io === "in") kept.push(r);
    }
  }

  return { coverage, statuses, cuts, kept, unreadable };
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

const PROG = "proposal_block.mjs";
const USAGE =
  "usage: proposal_block.mjs [-h] --workspace WORKSPACE --application APPLICATION\n" +
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
  const baseText = (await io.exists(bpath)) ? await io.readFile(bpath) : "";
  const baseStems = new Set(contentWords(baseText).map(stem));

  const findings = [];
  const out = [];
  // § 19 (the restore ruling): run() reads the file's two tables through
  // the same `proposalRows` export the Applications page uses — one
  // reader of the file, never two (rule 12). `cov`/`outs`/`ins` are
  // exactly what `table(lines, COVERAGE_HEADER)`/the old inline `sel`
  // filters returned before this change: every row below is already
  // filtered to the right cell count, so this output is unchanged.
  const { coverage: cov, statuses, cuts, kept } = proposalRows(rawFile);
  if (cov === null) findings.push(["FAIL", "no coverage table under the declared header — write it to the file first"]);
  if (cuts === null) findings.push(["FAIL", "no selection table under the declared header — write it to the file first"]);

  // The block is the candidate's DECISIONS, short, beside the delivered
  // document (founder 2026-08-21: deliver first, disclose beside, silence
  // is a yes). The full seven-column tables stay in the file as the
  // record; ~20 trials showed a 26-row table never reaches a reply.
  if (cuts !== null) {
    const outs = cuts;
    const ins = kept;
    if (outs.length) {
      out.push(`**Cut — ${outs.length} of ${outs.length + ins.length} bullets, weakest first.** Say "keep" and the bullet's name or number to bring one back.`);
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
    // statuses[i] is coverage[i]'s own normalised status (the port's
    // single `stripChars(...toLowerCase(), "`*_ ")` pass, computed once
    // in proposalRows above) — every row in `cov` already has exactly 4
    // cells, so this index always lines up.
    const sbu = cov.filter((r, i) => statuses[i] === "shown-but-unnamed");
    const gaps = cov.filter((r, i) => statuses[i] === "gap");
    if (sbu.length) {
      out.push("");
      out.push('**Their words, placed** — say "Summary", "Skills", or "leave it out" to move any of these:');
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
    for (const [i, r] of cov.entries()) {
      const req = r[0];
      const status = statuses[i];
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
  const failCount = findings.filter(([l]) => l === "FAIL").length;
  const warnCount = findings.length - failCount;
  // design-honest-ceilings.md § 6A: never say "clean" beside a standing
  // WARN. A FAIL prints no closing line here (unchanged); exit codes
  // don't change either way.
  if (!findings.length) {
    stdout += "clean: proposal block printed; no FAIL, no WARN\n";
  } else if (failCount === 0) {
    stdout += `no failures, ${warnCount === 1 ? "1 warning" : `${warnCount} warnings`} above — fix each one or tell the candidate\n`;
  }
  const exitCode = failCount > 0 ? 1 : 0;
  return { stdout: restoreLineSeparators(stdout), stderr: "", exitCode };
}
