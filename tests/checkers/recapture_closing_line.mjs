#!/usr/bin/env node
// design-honest-ceilings.md § 6A, item 4: the frozen expected-output
// corpus (docs/design-js-only.md § 5) changes for the new closing-line
// wording — "no script says 'clean' while a WARN stands". This is a
// MECHANICAL substitution, proved the way design-js-only.md § 5.5 proves
// its rename: take each case's OLD recorded stdout (git HEAD, before this
// commit), apply the one documented rule, and the result must equal the
// case file's CURRENT (working-tree) stdout exactly. Any other difference
// fails — the substitution is the only allowed change.
//
//   node tests/checkers/recapture_closing_line.mjs           # check mode (default)
//   node tests/checkers/recapture_closing_line.mjs --write   # apply the rule, write files
//   node tests/checkers/recapture_closing_line.mjs --base=<ref>   # git ref for "old" (default HEAD)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CASES_DIR = join(HERE, "cases");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const baseArg = args.find((a) => a.startsWith("--base="));
const BASE = baseArg ? baseArg.slice("--base=".length) : "HEAD";

// The scripts this recapture touches, and which stdout each rule applies
// to (matched by the case's own `steps[i].script`, index-aligned with
// `expect[i]`, § 5's schema).
const CHECK_MATERIALS = new Set(["apply/scripts/check_materials.py"]);
const CHECK_MESSAGES = new Set(["outreach/scripts/check_messages.py"]);
const PROPOSAL_BLOCK = new Set(["apply/scripts/proposal_block.py"]);

function warningWord(n) {
  return n === 1 ? "1 warning" : `${n} warnings`;
}

/** check_materials.py / check-materials.mjs: "✔ automatic checks clean"
 * only when 0 FAIL and 0 WARN; a WARN-only run gets the new line instead,
 * in the SAME place the old "clean" line sat. */
export function substituteCheckMaterials(stdout) {
  const warnCount = (stdout.match(/\[WARN\]/g) ?? []).length;
  const OLD = "\n✔ automatic checks clean\n";
  if (warnCount > 0 && stdout.includes(OLD)) {
    return stdout.replace(OLD, `\nno failures, ${warningWord(warnCount)} above — fix each one or tell the candidate\n`);
  }
  return stdout;
}

/** check_messages.py: same rule, "✔ message floor clean" is its clean line. */
export function substituteCheckMessages(stdout) {
  const warnCount = (stdout.match(/\[WARN\]/g) ?? []).length;
  const OLD = "\n✔ message floor clean\n";
  if (warnCount > 0 && stdout.includes(OLD)) {
    return stdout.replace(OLD, `\nno failures, ${warningWord(warnCount)} above — fix each one or tell the candidate\n`);
  }
  return stdout;
}

/** proposal_block.py / proposal-block.mjs: printed NO closing line at all
 * on a WARN-only run (the miss). The new line is APPENDED after the last
 * WARN line — nothing to replace, only to add. */
export function substituteProposalBlock(stdout) {
  const warnLines = (stdout.match(/^WARN {2}/gm) ?? []).length;
  const failLines = (stdout.match(/^FAIL {2}/gm) ?? []).length;
  if (warnLines > 0 && failLines === 0) {
    return stdout + `no failures, ${warningWord(warnLines)} above — fix each one or tell the candidate\n`;
  }
  return stdout;
}

function ruleFor(script) {
  if (CHECK_MATERIALS.has(script)) return substituteCheckMaterials;
  if (CHECK_MESSAGES.has(script)) return substituteCheckMessages;
  if (PROPOSAL_BLOCK.has(script)) return substituteProposalBlock;
  return null;
}

function allCaseFiles() {
  const out = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, n.name);
      if (n.isDirectory()) walk(abs);
      else if (n.name.endsWith(".json")) out.push(abs);
    }
  };
  walk(CASES_DIR);
  return out;
}

function gitShow(ref, relPath) {
  try {
    return execFileSync("git", ["show", `${ref}:${relPath}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // new file, not in the base ref
  }
}

/** Apply the substitution rule to every expect[i].stdout whose paired
 * steps[i].script has one, index-aligned (§ 5's schema). Returns the new
 * JSON text (same key order / formatting as JSON.parse -> JSON.stringify
 * would give — case files are always machine-written, so this is safe),
 * plus how many stdout entries actually changed. */
function apply(oldText) {
  const data = JSON.parse(oldText);
  let changedEntries = 0;
  const steps = data.steps ?? [];
  const expect = data.expect ?? [];
  for (let i = 0; i < expect.length; i++) {
    const script = steps[i]?.script;
    const rule = script ? ruleFor(script) : null;
    if (!rule || typeof expect[i].stdout !== "string") continue;
    const next = rule(expect[i].stdout);
    if (next !== expect[i].stdout) {
      expect[i].stdout = next;
      changedEntries++;
    }
  }
  // Case files are written with a 1-space indent (checked against the
  // corpus's own style); matching it keeps the git diff to the
  // substitution alone, not a reformat.
  return { text: JSON.stringify(data, null, 1) + "\n", changedEntries };
}

function main() {
  const files = allCaseFiles();
  let filesChanged = 0, filesUnchanged = 0, mismatches = 0;
  const changedList = [];

  for (const abs of files) {
    const rel = relative(ROOT, abs);
    const oldText = gitShow(BASE, rel);
    if (oldText === null) continue; // not tracked at BASE (new file) — nothing to recapture
    const { text: predicted, changedEntries } = apply(oldText);
    if (changedEntries === 0) {
      // no rule fired -> old and current working tree must be byte-identical
      const current = readFileSync(abs, "utf8");
      if (current !== oldText && !WRITE) {
        console.error(`UNEXPECTED CHANGE (not a closing-line case): ${rel}`);
        mismatches++;
      }
      filesUnchanged++;
      continue;
    }
    filesChanged++;
    changedList.push(rel);
    if (WRITE) {
      writeFileSync(abs, predicted);
      continue;
    }
    const current = readFileSync(abs, "utf8");
    if (current !== predicted) {
      console.error(`MISMATCH: ${rel}`);
      console.error(`  the closing-line substitution does NOT account for the whole diff.`);
      mismatches++;
    }
  }

  if (WRITE) {
    console.log(`recaptured ${filesChanged} case file(s) (closing-line substitution only); ${filesUnchanged} unchanged.`);
    return;
  }
  console.log(`${filesChanged} case file(s) differ from ${BASE} by EXACTLY the closing-line substitution; ${filesUnchanged} unchanged; ${mismatches} mismatch(es).`);
  if (changedList.length) {
    const byDir = {};
    for (const rel of changedList) {
      const dir = rel.split("/")[3]; // tests/checkers/cases/<script>/...
      byDir[dir] = (byDir[dir] ?? 0) + 1;
    }
    for (const [dir, n] of Object.entries(byDir).sort()) console.log(`  ${dir}: ${n}`);
  }
  if (mismatches > 0) {
    console.error(`FAIL: ${mismatches} case file(s) changed by more than the closing-line substitution.`);
    process.exitCode = 1;
  }
}

// Guarded so a unit test can import the pure substitute* functions above
// without also running the CLI (recapture_closing_line.test.mjs).
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
