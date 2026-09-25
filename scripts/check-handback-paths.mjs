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
//   - any of the above cited with a trailing :N or :N-M line reference
//     (the hand-back report format) — the line ref is stripped before
//     checking, e.g. apps/web/src/x.tsx:433, /abs/coach.ts:272
//   - any of the above cited with a trailing #fragment (a Markdown anchor,
//     e.g. docs/PROCESS.md#the-ritual-in-order) — stripped the same way
//     (fragment first, then line ref)
//   - any of the above as a Markdown link target — [text](path/to/file.md)
//   - any of the above wrapped in backticks or double quotes as a single
//     token, spaces allowed — `has space/real file.md`, "docs/my notes.md"
//     — but ONLY when the whole trimmed span itself is one path: a
//     backticked COMMAND like `node scripts/x.mjs --seed 7` or a
//     double-quoted SENTENCE like "I wrote docs/x.md and more" is left to
//     the plain tokenizer below instead, which finds the real path inside
//     it word by word (single quotes are deliberately never a delimiter:
//     an ordinary contraction like "don't" pairs unpredictably and would
//     swallow prose as a false path candidate)
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
// A trailing "report format" line reference — :433 or :20-24 — stripped
// before a path is checked, not treated as part of the path itself.
const LINE_REF = /:\d+(?:-\d+)?$/;
// A trailing Markdown anchor — #section — stripped the same way, and
// before the line-ref strip (fragment first, then line ref).
const FRAGMENT_REF = /#\S*$/;
// Whole-token delimiters: content between a matching pair is one
// candidate, internal spaces preserved. Deliberately backtick + double
// quote only (see the file-header note on single quotes).
const BACKTICK_RE = /`([^`]+)`/g;
const DOUBLE_QUOTE_RE = /"([^"]+)"/g;
// Markdown link target: [text](target) — "]" sits hard against "(" with
// no whitespace to split on, so this is pulled out by regex, not by the
// whitespace tokenizer below.
const MD_LINK_RE = /\]\(([^)]+)\)/g;

function cleanToken(tok) {
  return tok.replace(LEADING_TRIM, "").replace(TRAILING_TRIM, "");
}

function stripFragment(tok) {
  return tok.replace(FRAGMENT_REF, "");
}

function stripLineRef(tok) {
  return tok.replace(LINE_REF, "");
}

function isUrlLike(tok) {
  return /^https?:\/\//i.test(tok) || /^mailto:/i.test(tok) || /^www\./i.test(tok);
}

// A candidate with an internal space is only a single real path if the
// path itself starts immediately — i.e. a "/" appears before the first
// space. That's true of a genuinely spaced filename (`docs/my notes.md`,
// `/tmp/has space/real file.md`, both start with a path segment) and
// false of a command line (`node scripts/x.mjs --seed 7`, `python3
// tests/run.py` — a bare word with no slash comes before the first
// space). A token with no space at all trivially passes (nothing to
// check) — this only ever matters for backtick/quote span candidates;
// a plain whitespace-split token can never contain a space to begin with.
function hasSlashBeforeFirstSpace(tok) {
  const spaceIdx = tok.indexOf(" ");
  if (spaceIdx === -1) return true;
  const slashIdx = tok.indexOf("/");
  return slashIdx !== -1 && slashIdx < spaceIdx;
}

/**
 * Classify a single cleaned token as a candidate path, or return null if
 * it's a URL / code-looking token / not path-shaped. A space is allowed
 * in the shape checks below — never present in a plain whitespace-split
 * token, but a real part of a backtick/quote-delimited candidate.
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
    if (tok.length > 1 && tok.slice(1).includes("/") && /^[A-Za-z0-9_.\-/ ]+$/.test(tok)) {
      return { kind: "absolute", raw: tok };
    }
    return null;
  }

  const lastSlash = tok.lastIndexOf("/");
  if (lastSlash === -1) return null; // no slash: division-like, SCREAMING_CASE, bare code
  const afterSlash = tok.slice(lastSlash + 1);
  if (!/\.[A-Za-z0-9]+$/.test(afterSlash)) return null; // slash but no extension: "and/or", "N/A"
  if (!/^[A-Za-z0-9_.\-/ ]+$/.test(tok)) return null; // leftover punctuation: not a clean path
  if (!hasSlashBeforeFirstSpace(tok)) return null; // a command line, not a spaced filename
  return { kind: "repo", raw: tok };
}

/** cleanToken -> stripFragment -> stripLineRef -> classify, in that order — the one pipeline every candidate (whitespace token, Markdown link target, or quoted span) goes through. */
function toCandidate(raw) {
  return classify(stripLineRef(stripFragment(cleanToken(raw))));
}

/**
 * Pull out backtick- and double-quote-delimited spans. A span becomes ONE
 * whole candidate (spaces preserved) — and is blanked out of the
 * returned text, so the plain whitespace tokenizer below never also sees
 * and mis-splits it — only when the ENTIRE trimmed span itself classifies
 * as a path. Otherwise the span is left untouched in the returned text,
 * so its contents (e.g. a command's script argument, or a path named
 * mid-sentence) go through the normal whitespace tokenizer like any other
 * text.
 */
function extractQuotedSpans(text) {
  const spans = [];
  const maybeBlank = (full, inner) => {
    const candidate = toCandidate(inner);
    if (!candidate) return full; // not a whole path itself — leave it in place
    spans.push(candidate);
    return " ";
  };
  const remaining = text.replace(BACKTICK_RE, maybeBlank).replace(DOUBLE_QUOTE_RE, maybeBlank);
  return { spans, remaining };
}

/** Extract an ordered, de-duplicated list of classified path candidates from free text. */
export function extractPaths(text) {
  const { spans: quotedCandidates, remaining: withoutQuoted } = extractQuotedSpans(text);

  // Strip whole URLs so a URL's own /path/segments never get
  // mis-tokenized as a separate path reference.
  const withoutUrls = withoutQuoted.replace(/\bhttps?:\/\/\S+/gi, " ").replace(/\bmailto:\S+/gi, " ");

  const mdLinkTargets = [];
  MD_LINK_RE.lastIndex = 0;
  let m;
  while ((m = MD_LINK_RE.exec(withoutUrls))) {
    const target = m[1].trim().split(/\s+/)[0];
    if (target) mdLinkTargets.push(target);
  }

  const seen = new Set();
  const out = [];
  const add = (c) => {
    if (!c || seen.has(c.raw)) return;
    seen.add(c.raw);
    out.push(c);
  };

  for (const c of quotedCandidates) add(c);
  for (const rawTarget of mdLinkTargets) add(toCandidate(rawTarget));
  for (const rawTok of withoutUrls.split(/\s+/)) add(toCandidate(rawTok));

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
