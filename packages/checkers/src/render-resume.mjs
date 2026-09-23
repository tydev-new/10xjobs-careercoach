// A faithful JS port of skills/apply/scripts/render_resume.py's HTML
// builder and word counter — the browser prints the HTML itself, so
// (per docs/design-web-agent.md § 5) this port never shells out to Chrome:
// `--pdf` is accepted for CLI-shape compatibility but produces a one-line
// note instead of a PDF, and never claims a page count. That is an
// intentional, contract-sanctioned divergence from the Python script's
// `--pdf` behaviour — see packages/checkers/README.md "render_resume and
// --pdf". Everything else (the `.md` -> HTML builder, the word count, the
// `words: N  ->  <path>` line) matches byte for byte.
//
// Runs in Node AND in the browser; no node:fs, no node:path.
import { join } from "./path-util.mjs";
import { pySplit, normSpace, pySplitlines, pyRstrip, pyStrip, restoreLineSeparators } from "./py-text.mjs";
import { parseFlags, argError, argHelp } from "./argx.mjs";
import { HELP } from "./help-text.mjs";
import { crashToTraceback } from "./traceback.mjs";

const CSS = `
@page { size: Letter; margin: 0.4in 0.5in; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
       font-size: 10pt; line-height: 1.25; color: #111; margin: 0; }
h1 { font-size: 18pt; letter-spacing: .5px; margin: 0 0 2pt; }
h1 + p { font-size: 9.5pt; margin: 0 0 7pt; }
h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .6px;
     border-bottom: 1px solid #222; padding-bottom: 2pt; margin: 8pt 0 4pt; }
h3 { font-size: 10.5pt; margin: 7pt 0 1pt; }
h3 + p { margin: 0 0 2pt; font-size: 9.3pt; }
p { margin: 0 0 4pt; }
ul { margin: 2pt 0 4pt; padding-left: 14pt; }
li { margin: 0 0 2.5pt; }
h2, h3, li { page-break-inside: avoid; }
h2, h3, h3 + p { page-break-after: avoid; }
`;

function htmlEscape(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

export function blocks(mdText) {
  const out = [];
  let kind = null;
  let buf = [];
  const flush = () => {
    if (kind && buf.length) out.push([kind, normSpace(buf.join(" "))]);
    kind = null;
    buf = [];
  };
  for (const raw of pySplitlines(mdText)) {
    const s = pyRstrip(raw);
    if (!pyStrip(s)) {
      flush();
      continue;
    }
    const m = s.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      flush();
      out.push([`h${m[1].length}`, pyStrip(m[2])]);
      continue;
    }
    if (s.startsWith("- ")) {
      flush();
      kind = "li";
      buf = [s.slice(2)];
      continue;
    }
    if (kind === "li" || kind === "p") {
      buf.push(pyStrip(s));
      continue;
    }
    flush();
    kind = "p";
    buf = [s];
  }
  flush();
  return out;
}

function inline(text) {
  let t = htmlEscape(text);
  t = t.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
  t = t.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  return t.replaceAll("`", "");
}

export function toHtml(mdText, title = "Resume") {
  const body = [];
  let inUl = false;
  for (const [kind, text] of blocks(mdText)) {
    if (kind === "li") {
      if (!inUl) {
        body.push("<ul>");
        inUl = true;
      }
      body.push(`<li>${inline(text)}</li>`);
    } else {
      if (inUl) {
        body.push("</ul>");
        inUl = false;
      }
      body.push(`<${kind}>${inline(text)}</${kind}>`);
    }
  }
  if (inUl) body.push("</ul>");
  return (
    `<!doctype html><html><head><meta charset='utf-8'>` +
    `<title>${htmlEscape(title)}</title><style>${CSS}</style>` +
    `</head><body>${body.join("")}</body></html>`
  );
}

export function wordCount(mdText) {
  return blocks(mdText).reduce((sum, [, t]) => sum + pySplit(t.replace(/[*`#|]/g, " ")).length, 0);
}

const PROG = "render_resume.py";
const USAGE =
  "usage: render_resume.py [-h] --md MD [--html HTML] [--pdf PDF] [--pages PAGES]\n" +
  "                        [--strict]\n";
const OPTIONS = [
  { flag: "--md", dest: "md", required: true },
  { flag: "--html", dest: "html" },
  { flag: "--pdf", dest: "pdf" },
  { flag: "--pages", dest: "pages", type: "int", default: 2 },
  { flag: "--strict", dest: "strict", boolean: true },
];

/**
 * @param {string[]} argv
 * @param {{readFile(p:string):Promise<string>, writeFile(p:string, c:string):Promise<void>}} io
 */
export async function run(argv, io) {
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.render_resume });
  if (parsed.help) return argHelp(parsed.text);
  if (parsed.error) return argError(PROG, USAGE, parsed.error);
  const a = parsed.args;

  // Python's main() has no os.path.exists() guard before open(a.md) — a
  // missing --md file crashes uncaught (FileNotFoundError).
  let mdText;
  try {
    mdText = await io.readFile(a.md);
  } catch (e) {
    return crashToTraceback("", e);
  }
  const words = wordCount(mdText);
  // Python falls back to tempfile.mkdtemp() — a fresh directory OUTSIDE
  // wherever --md lives — when --html is omitted, so it never touches (or
  // collides with) a file already in the candidate's workspace. There is
  // no directory concept a browser sandbox can call "temporary" the same
  // way, so this port instead uses a fixed path outside any reasonable
  // relative workspace tree, for the same reason: never overwrite a
  // workspace file the caller didn't name. (The exact path differs from
  // Python's own — which is a fresh random directory every run and so can
  // never be matched byte-for-byte either — see README.md "render_resume
  // and --html".)
  const htmlPath = a.html || "/tmp/checkers-render-resume/resume.html";
  await io.writeFile(htmlPath, toHtml(mdText));
  let stdout = `words: ${words}  ->  ${htmlPath}\n`;
  if (a.pdf) {
    stdout +=
      "PDF: NOT RENDERED — the web app renders the HTML for the candidate's own browser to print (no Chrome subprocess in the browser); see references/patterns.md § The PDF (the conversion ladder)\n";
  }
  return { stdout: restoreLineSeparators(stdout), stderr: "", exitCode: 0 };
}
