#!/usr/bin/env node
// Node-only CLI: builds the HTML via the shared, browser-safe
// lib/render-resume.mjs, then — unlike the web dispatch, which always
// prints "PDF: NOT RENDERED" (no subprocess in a browser) — actually
// shells out to headless Chrome to render and measure a PDF, the same
// job the retired render_resume.py's to_pdf()/pdf_pages()/find_chrome()
// did. This file is the ONLY place that spawns a subprocess; the shared
// lib stays import-safe for the browser (no node:child_process).
//
// Safety semantics carried forward exactly (PR #20, docs/design-js-only.md
// lead ruling 1 — the 2026-09-26 Chrome-hang incident and its 2026-09-27
// independent review):
//   - RENDER_RESUME_CHROME is read ONLY when the caller passes no explicit
//     `chrome` argument to toPdf() — an explicit argument always wins.
//     The always-on harness sets this env var to its own fake so a real
//     browser is never launched in a test session; unset in production,
//     this whole branch is a no-op there.
//   - a fresh, throwaway --user-data-dir per call, so a run never touches
//     (or waits on) anyone's real Chrome profile;
//   - Chrome is spawned detached (its own process group); a 90s timeout
//     kills the WHOLE group via `process.kill(-pid, "SIGKILL")` — never a
//     name-based pkill/killall of anything else on the machine;
//   - the timeout message never hints that a DIFFERENT, already-open
//     browser window might be the cause — this call never shares a
//     profile with anything else, so that hint would point at the wrong
//     culprit (and, before this fix, invited exactly the wrong one).
import { spawn } from "node:child_process";
import { promises as fsp, existsSync, accessSync, realpathSync, constants as fsConstants } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
// node:path (not lib/path-util.mjs's pure POSIX join): this is a
// Node-only command file (like lib/io-node.mjs), and PATH search needs
// the host's own separator conventions, not a browser-safe POSIX-only
// stand-in.
import { join, isAbsolute } from "node:path";
import { toHtml, wordCount } from "./lib/render-resume.mjs";
import { parseFlags, argError, argHelp } from "../../profile/scripts/lib/argx.mjs";
import { HELP } from "../../profile/scripts/lib/help-text.mjs";
import { crashToTraceback } from "../../profile/scripts/lib/traceback.mjs";
import { restoreLineSeparators } from "../../profile/scripts/lib/py-text.mjs";
import { nodeIo } from "../../profile/scripts/lib/io-node.mjs";

// Re-exported so a caller that only wants the pure HTML builder (the web
// dispatch, tests) never needs to import a node:child_process-carrying
// file just to get it — and so the CSS stays the one place page-metric
// tests (tests/always-on/fixtures/fake-chrome, its own calibration test)
// derive their constants from.
export { toHtml, wordCount } from "./lib/render-resume.mjs";
export { CSS } from "./lib/render-resume.mjs";

// Sanctioned divergence from the retired render_resume.py's CHROME tuple
// order (PATH-resolvable names first, the macOS .app bundle paths last):
// Python's os.path.exists() can be monkey-patched from OUTSIDE the
// process to hide a machine's own real Chrome during a harness replay
// (tests/checkers/run-cases.mjs's PY_BOOT does exactly that for
// /Applications, and its own comment names why — "a Chrome installed on
// the recording machine can never stand in for the case's own stub").
// Node has no equivalent external hook, and the harness's only lever for
// the node path is PATH (tests/always-on/fixtures/fake-chrome,
// tests/checkers/run-cases.mjs's chromePath()) — so a hardcoded absolute
// path checked BEFORE PATH would make this script find a real Chrome.app
// on any Mac that happens to have one installed, even under a harness
// that explicitly set PATH to point at its own stub or at nothing at
// all: the exact hang this whole safety design exists to prevent
// (docs/design-js-only.md, lead ruling 1). Checking PATH first costs
// nothing in production (a real Chrome install and its PATH-resolvable
// name are the same browser); it is the only way a caller — real or a
// test harness — can reliably steer this function.
const CHROME_CANDIDATES = [
  "google-chrome", "chromium", "chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function which(cmd) {
  const dirs = (process.env.PATH || "").split(os.platform() === "win32" ? ";" : ":");
  for (const dir of dirs) {
    if (!dir) continue;
    const p = join(dir, cmd);
    try {
      accessSync(p, fsConstants.X_OK);
      return p;
    } catch {
      // not here — keep looking
    }
  }
  return null;
}

// Testability-only escape hatch, off by default (production never sets
// it): skips the two hardcoded macOS .app-bundle paths, which bypass
// PATH entirely (existsSync() doesn't consult PATH the way which()
// does) — the one gap PATH reordering alone can't close, since a real
// Chrome.app installed on the machine running an automated test would
// otherwise always be found even when a harness has deliberately pointed
// PATH at nothing (docs/design-js-only.md, lead ruling 1: a harness must
// never be able to reach a real browser). tests/checkers/run-cases.mjs
// sets this whenever a case controls `chrome` at all.
const PATH_ONLY = process.env.RENDER_RESUME_CHROME_PATH_ONLY === "1";

export function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    let p = null;
    if (isAbsolute(c)) {
      if (!PATH_ONLY && existsSync(c)) p = c;
    } else {
      p = which(c);
    }
    if (p) return p;
  }
  return null;
}

/**
 * Render htmlPath to pdfPath with headless Chrome.
 *
 * Earned 2026-09-26 (the Chrome-hang incident): headless Chrome with no
 * --user-data-dir reaches for the CALLER's default profile, and a real
 * Chrome window already holding that profile's singleton lock makes the
 * headless run hang instead of failing fast. The old (Python) code also
 * called its subprocess with a timeout and no except around it — an
 * uncaught timeout crashed the script with a traceback instead of a plain
 * message, and left the agent under test to freelance its own fix; it
 * chose a name-based pkill, which killed every Chrome process on the
 * machine, including the owner's own browser.
 *
 * Independent review (2026-09-27) of that first fix found two more
 * holes, both closed here: (1) killing only Chrome's own top PID leaves
 * its own helper/renderer children orphaned and still running — Chrome
 * is started in its own process group so a timeout can kill the WHOLE
 * group, not one PID; (2) the default timeout (120s) was not under the
 * agent Bash tool's own 120s default, so the tool could cut this script
 * off before its own plain message ever printed — default dropped to
 * 90s, safely under it.
 *
 * RENDER_RESUME_CHROME (owner ruling 2026-09-26, replacing the test-user
 * isolation plan): the always-on harness must never launch a REAL
 * browser at all — that's what hung in the first place. A harness
 * runner sets this env var to point at its own fake, which writes a
 * small, realistically-sized PDF immediately and never hangs.
 *
 * @param {string} htmlPath
 * @param {string} pdfPath
 * @param {string} [chrome] an explicit binary path — always wins over
 *   RENDER_RESUME_CHROME (see this file's header comment)
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: boolean, err?: string}>}
 */
export async function toPdf(htmlPath, pdfPath, chrome, timeoutMs = 90_000) {
  chrome = chrome || process.env.RENDER_RESUME_CHROME || findChrome();
  if (!chrome) {
    return { ok: false, err: "no Chrome/Chromium found — see references/patterns.md § The PDF (the conversion ladder)" };
  }
  const profileDir = await fsp.mkdtemp(join(os.tmpdir(), "render-resume-chrome-profile-"));
  try {
    const child = spawn(
      chrome,
      [
        "--headless", "--disable-gpu", "--no-pdf-header-footer",
        `--user-data-dir=${profileDir}`,
        `--print-to-pdf=${pdfPath}`, htmlPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"], detached: true },
    );

    // J2 review, finding M1: an unread stderr pipe fills (a real Chrome
    // can write plenty of it) and then the CHILD blocks on its own next
    // write — the call would sit until the timeout, reporting "did not
    // finish" for a render that actually completed. The retired Python
    // drained stderr the same way (`proc.communicate(timeout=timeout)`
    // reads stdout AND stderr to EOF); here that's an explicit `data`
    // listener. Kept as a bounded tail (last 4KB) for the exited-with-
    // no-PDF error message below — not because a real caller is
    // expected to read it, but so a genuine Chrome failure isn't
    // reported with strictly less information than draining it costs.
    let stderrTail = "";
    const STDERR_TAIL_MAX = 4096;
    child.stderr.on("data", (chunk) => {
      stderrTail += chunk.toString("utf-8");
      if (stderrTail.length > STDERR_TAIL_MAX) stderrTail = stderrTail.slice(-STDERR_TAIL_MAX);
    });

    const outcome = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Kill THIS call's whole process group — Chrome's own helper/
        // renderer children die with it — never a broader, name-based
        // kill of anything else on the machine.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // it exited on its own between the timeout and here
        }
        resolve({ timedOut: true });
      }, timeoutMs);
      child.once("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, code: null, spawnError: true });
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, code });
      });
    });

    if (outcome.timedOut) {
      const seconds = Math.round(timeoutMs / 1000);
      return {
        ok: false,
        err: `Chrome did not finish within ${seconds}s and was stopped (its own process group only) — no PDF was produced. Try again.`,
      };
    }
    const pdfExists = existsSync(pdfPath);
    if (outcome.spawnError) {
      return { ok: false, err: "Chrome produced no file" };
    }
    if (outcome.code !== 0 && outcome.code !== null && !pdfExists) {
      const tail = stderrTail.trim();
      return {
        ok: false,
        err: tail ? `Chrome exited ${outcome.code} with no PDF produced: ${tail}` : `Chrome exited ${outcome.code} with no PDF produced`,
      };
    }
    return pdfExists ? { ok: true } : { ok: false, err: "Chrome produced no file" };
  } finally {
    await fsp.rm(profileDir, { recursive: true, force: true });
  }
}

/** Page count without a dependency: /Type /Page objects minus /Type /Pages. */
export async function pdfPages(pdfPath) {
  const buf = await fsp.readFile(pdfPath);
  const s = buf.toString("latin1"); // byte-preserving — matches Python's binary-mode count()
  const count = (needle) => {
    let n = 0;
    let idx = 0;
    for (;;) {
      idx = s.indexOf(needle, idx);
      if (idx === -1) break;
      n++;
      idx += needle.length;
    }
    return n;
  };
  return count("/Type /Page") - count("/Type /Pages");
}

const PROG = "render_resume.mjs";
const USAGE =
  "usage: render_resume.mjs [-h] --md MD [--html HTML] [--pdf PDF] [--pages PAGES]\n" +
  "                        [--strict]\n";
const OPTIONS = [
  { flag: "--md", dest: "md", required: true },
  { flag: "--html", dest: "html" },
  { flag: "--pdf", dest: "pdf" },
  { flag: "--pages", dest: "pages", type: "int", default: 2 },
  { flag: "--strict", dest: "strict", boolean: true },
];

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseFlags(argv, { options: OPTIONS, help: HELP.render_resume });
  if (parsed.help) {
    const { stdout, exitCode } = argHelp(parsed.text);
    if (stdout) process.stdout.write(stdout);
    process.exitCode = exitCode;
    return;
  }
  if (parsed.error) {
    const { stdout, stderr, exitCode } = argError(PROG, USAGE, parsed.error);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exitCode = exitCode;
    return;
  }
  const a = parsed.args;

  let mdText;
  try {
    mdText = await nodeIo.readFile(a.md);
  } catch (e) {
    const { stdout, stderr, exitCode } = crashToTraceback("", e);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exitCode = exitCode;
    return;
  }
  const words = wordCount(mdText);
  const htmlPath = a.html || join(await fsp.mkdtemp(join(os.tmpdir(), "render-resume-html-")), "resume.html");
  await nodeIo.writeFile(htmlPath, toHtml(mdText));

  let stdout = `words: ${words}  ->  ${htmlPath}\n`;
  let exitCode = 0;
  if (a.pdf) {
    const { ok, err } = await toPdf(htmlPath, a.pdf);
    if (!ok) {
      stdout += `PDF: NOT RENDERED — ${err}\n`;
    } else {
      const pages = await pdfPages(a.pdf);
      const size = (await fsp.stat(a.pdf)).size;
      const over = pages > a.pages;
      const sizeKb = Math.round(size / 1024);
      stdout +=
        `pages: ${pages} (target ${a.pages})${over ? "  ← OVER" : ""}  ` +
        `| ${sizeKb}KB${size > 100_000 ? "  ← over the ~100KB upload limit" : ""}\n`;
      if (over) {
        stdout += "  over target — propose a ranked cut list to the candidate; never trim silently (references/patterns.md § The page target)\n";
      }
      exitCode = over && a.strict ? 1 : 0;
    }
  }
  process.stdout.write(restoreLineSeparators(stdout));
  process.exitCode = exitCode;
}

// J2 review, finding B1: a bare `import.meta.url === \`file://${process.argv[1]}\``
// compares an ENCODED URL string against a RAW filesystem path — they
// diverge (silently making this guard false, so `main()` never runs and
// the process exits 0 having done nothing) the moment either side has a
// symlink component (macOS's /var -> /private/var, so EVERY `mktemp -d`
// workspace and every harness run), a space, `%`, `#`, or a non-ASCII
// character (URL-encoded on the left, literal on the right). Guarded so
// the harness's own import of this module's named exports
// (findChrome/toPdf/pdfPages/CSS) never triggers a second CLI run as a
// side effect — but that comparison has to survive real filesystem
// paths, not just the tidy ones a developer's own checkout happens to
// have. Fix: resolve BOTH sides to their real, symlink-free filesystem
// path first, then compare those directly — mirrored in every other
// Node CLI entry under skills/*/scripts/*.mjs (grepped one at a time,
// § 6 J2's tester check).
try {
  if (
    process.argv[1] &&
    realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  ) {
    await main();
  }
} catch {
  // process.argv[1] doesn't resolve (e.g. this file was imported, not
  // run) — never treat that as "run main()".
}
