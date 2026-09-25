#!/usr/bin/env node
// check-handback-paths.mjs — "verify the file, not narration" (CLAUDE.md).
// Reads an agent's hand-back text, extracts every file path it names, and
// checks each one actually exists — so the lead never has to grep by hand
// before believing a "written/fixed".
//
// Usage:
//   node scripts/check-handback-paths.mjs <handback.txt>
//   cat handback.txt | node scripts/check-handback-paths.mjs
//   node scripts/check-handback-paths.mjs handback.txt --private-root /some/dir
//
// Path kinds recognised:
//   - absolute paths                    /opt/build/repo/scripts/foo.mjs
//   - repo-relative paths (slash + ext) scripts/foo.mjs, docs/plan.md
//   - private design-refs paths         10xjobs-design-refs/grok/hero.png
//     resolved against --private-root, else $DESIGN_REFS_ROOT, else this
//     repo's own parent directory (never a hard-coded home path here).
//
// URLs (http/https/mailto) and code-looking tokens (no slash, or a slash
// with no trailing extension — division, "and/or", SCREAMING_CASE, a bare
// function call) are ignored.
//
// Exit 0 if every extracted path exists, 1 if any is missing.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..");

const PRIVATE_PREFIX = "10xjobs-design-refs/";

const LEADING_TRIM = /^[`'"(\[{*_<>]+/;
const TRAILING_TRIM = /[`'"()[\]{}.,;:!?*_<>]+$/;

function cleanToken(tok) {
  return tok.replace(LEADING_TRIM, "").replace(TRAILING_TRIM, "");
}

function isUrlLike(tok) {
  return /^https?:\/\//i.test(tok) || /^mailto:/i.test(tok) || /^www\./i.test(tok);
}

/**
 * Classify a single cleaned token as a candidate path, or return null if
 * it's a URL / code-looking token / not path-shaped.
 */
export function classify(tok) {
  if (!tok) return null;
  if (isUrlLike(tok)) return null;

  if (tok.startsWith(PRIVATE_PREFIX)) {
    return { kind: "private", raw: tok };
  }

  if (tok.startsWith("/")) {
    // Require a second slash so a lone "/" or something like "/etc" (no
    // further structure) doesn't get treated as a path reference.
    if (tok.length > 1 && tok.slice(1).includes("/") && /^[A-Za-z0-9_.\-/]+$/.test(tok)) {
      return { kind: "absolute", raw: tok };
    }
    return null;
  }

  const lastSlash = tok.lastIndexOf("/");
  if (lastSlash === -1) return null; // no slash: division-like, SCREAMING_CASE, bare code
  const afterSlash = tok.slice(lastSlash + 1);
  if (!/\.[A-Za-z0-9]+$/.test(afterSlash)) return null; // slash but no extension: "and/or", "N/A"
  if (!/^[A-Za-z0-9_.\-/]+$/.test(tok)) return null; // leftover punctuation: not a clean path
  return { kind: "repo", raw: tok };
}

/** Extract an ordered, de-duplicated list of classified path candidates from free text. */
export function extractPaths(text) {
  // Strip whole URLs first so a URL's own /path/segments never get
  // mis-tokenized as a separate path reference.
  const withoutUrls = text.replace(/\bhttps?:\/\/\S+/gi, " ").replace(/\bmailto:\S+/gi, " ");
  const seen = new Set();
  const out = [];
  for (const rawTok of withoutUrls.split(/\s+/)) {
    const cleaned = cleanToken(rawTok);
    const c = classify(cleaned);
    if (!c) continue;
    if (seen.has(c.raw)) continue;
    seen.add(c.raw);
    out.push(c);
  }
  return out;
}

/**
 * Pure resolution of the private-refs root, given the already-parsed
 * inputs — no env/argv reading here, so tests can call it directly.
 */
export function resolvePrivateRoot({ argRoot, envRoot, repoRoot }) {
  if (argRoot) return path.resolve(argRoot);
  if (envRoot) return path.resolve(envRoot);
  return path.resolve(repoRoot, "..");
}

/** Resolve each candidate to an absolute path and check whether it exists. */
export function checkPaths(candidates, { repoRoot, privateRoot }) {
  return candidates.map((c) => {
    let resolved;
    if (c.kind === "absolute") {
      resolved = c.raw;
    } else if (c.kind === "private") {
      resolved = path.join(privateRoot, c.raw.slice(PRIVATE_PREFIX.length));
    } else {
      resolved = path.join(repoRoot, c.raw);
    }
    return { ...c, resolved, exists: existsSync(resolved) };
  });
}

function padRight(s, width) {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function renderMissingTable(missing) {
  if (missing.length === 0) return "";
  const kindWidth = Math.max(4, ...missing.map((m) => m.kind.length));
  const pathWidth = Math.max(4, ...missing.map((m) => m.raw.length));
  const lines = [];
  lines.push(`${padRight("kind", kindWidth)}  ${padRight("named path", pathWidth)}  resolved to`);
  lines.push(`${"-".repeat(kindWidth)}  ${"-".repeat(pathWidth)}  ${"-".repeat(11)}`);
  for (const m of missing) {
    lines.push(`${padRight(m.kind, kindWidth)}  ${padRight(m.raw, pathWidth)}  ${m.resolved}`);
  }
  return lines.join("\n");
}

function readInput(fileArg) {
  if (fileArg) {
    if (!existsSync(fileArg)) {
      console.error(`check-handback-paths: no such file: ${fileArg}`);
      process.exit(1);
    }
    return readFileSync(fileArg, "utf8");
  }
  if (process.stdin.isTTY) {
    console.error(
      "usage: node scripts/check-handback-paths.mjs <handback.txt> [--private-root DIR]\n" +
        "   or: <something> | node scripts/check-handback-paths.mjs"
    );
    process.exit(1);
  }
  return readFileSync(0, "utf8");
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      "private-root": { type: "string" },
    },
    allowPositionals: true,
  });

  const text = readInput(positionals[0]);
  const candidates = extractPaths(text);
  const privateRoot = resolvePrivateRoot({
    argRoot: values["private-root"],
    envRoot: process.env.DESIGN_REFS_ROOT,
    repoRoot: REPO_ROOT,
  });
  const checked = checkPaths(candidates, { repoRoot: REPO_ROOT, privateRoot });
  const missing = checked.filter((c) => !c.exists);

  console.log(`Checked ${checked.length} referenced path(s); ${missing.length} missing.`);
  if (missing.length > 0) {
    console.log("");
    console.log(renderMissingTable(missing));
  }

  process.exit(missing.length > 0 ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
