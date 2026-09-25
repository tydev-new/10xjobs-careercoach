#!/usr/bin/env node
// design-sample.mjs — prints a Markdown block for a designer task: a
// deterministic sample of fonts and pairings from design/library/*.json
// (design/library/README.md is the schema's own source of truth; shape
// mirrored here: fonts.json = { fonts: [{ name, fontsource, category,
// license, weights, variable, description, avoid_for }] }, pairings.json
// = { pairings: [{ id, use, heading_font, heading_weight, body_font,
// body_weight, mono_font?, mono_weight?, rationale }] }, mono_font is
// `null`, not absent, when a pairing has none) plus reference entries
// from docs/design-references.md, with the "Banned defaults" section
// always appended in full so a designer never samples it away.
//
// Usage:
//   node scripts/design-sample.mjs [--fonts N] [--pairings M] [--refs K]
//                                   [--seed <string>] [--use <use>]
//
//   --fonts N     how many fonts to sample (default 8)
//   --pairings M  how many pairings to sample (default 5)
//   --refs K      how many docs/design-references.md entries (default 3)
//   --use U       only sample pairings whose `use` is chat-ui,
//                 document-resume, or marketing-sign-in (default: no filter)
//   --seed S      deterministic seed; default = today's date + a random
//                 suffix, printed in the header so the run can be redone
//                 exactly with --seed <that value>
//
// Test-only overrides (not part of the designer-facing contract, but how
// scripts/test/design-sample.test.mjs points this at fixtures instead of
// the real design/library/*.json + docs/design-references.md):
//   --fonts-file <path> --pairings-file <path> --refs-file <path>
//
// Exits 1 with a clear message if a source file is missing.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { rngFromSeed, sampleWithoutReplacement } from "./lib/rng.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const DEFAULT_FONTS_FILE = path.join(REPO_ROOT, "design", "library", "fonts.json");
const DEFAULT_PAIRINGS_FILE = path.join(REPO_ROOT, "design", "library", "pairings.json");
const DEFAULT_REFS_FILE = path.join(REPO_ROOT, "docs", "design-references.md");

const BANNED_DEFAULTS_PREFIX = "banned defaults";
const PATTERNS_PREFIX = "patterns across the set";
export const PAIRING_USES = ["chat-ui", "document-resume", "marketing-sign-in"];

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function defaultSeed(now = new Date()) {
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${todayISO(now)}-${suffix}`;
}

function readJsonSource(filePath, label) {
  if (!existsSync(filePath)) {
    console.error(`design-sample: missing ${label} source file: ${filePath}`);
    process.exit(1);
  }
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`design-sample: could not read ${label} source file: ${filePath}\n${err.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`design-sample: ${label} source file is not valid JSON: ${filePath}\n${err.message}`);
    process.exit(1);
  }
}

function readTextSource(filePath, label) {
  if (!existsSync(filePath)) {
    console.error(`design-sample: missing ${label} source file: ${filePath}`);
    process.exit(1);
  }
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`design-sample: could not read ${label} source file: ${filePath}\n${err.message}`);
    process.exit(1);
  }
}

/**
 * Split docs/design-references.md into its "## <Heading>" sections. Each
 * section is { heading, body } where body is the raw text between this
 * heading and the next (trimmed).
 */
export function parseReferenceSections(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1], bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, body: s.bodyLines.join("\n").trim() }));
}

function isPatternsSection(heading) {
  return heading.trim().toLowerCase().startsWith(PATTERNS_PREFIX);
}

function isBannedDefaultsSection(heading) {
  return heading.trim().toLowerCase().startsWith(BANNED_DEFAULTS_PREFIX);
}

function fmtList(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  return String(v);
}

function renderFont(font) {
  const lines = [`### ${font.name ?? "(unnamed font)"}`];
  const category = fmtList(font.category);
  const license = fmtList(font.license);
  const weights = fmtList(font.weights);
  const fontsource = fmtList(font.fontsource);
  const description = fmtList(font.description);
  const avoidFor = fmtList(font.avoid_for);
  if (category) lines.push(`- Category: ${category}`);
  if (license) lines.push(`- License: ${license}`);
  if (weights) lines.push(`- Weights: ${weights}`);
  if (font.variable !== undefined && font.variable !== null) {
    lines.push(`- Variable: ${font.variable ? "yes" : "no"}`);
  }
  if (fontsource) lines.push(`- Fontsource: ${fontsource}`);
  if (description) lines.push(`- Description: ${description}`);
  if (avoidFor) lines.push(`- Avoid for: ${avoidFor}`);
  return lines.join("\n");
}

function renderFontWeight(font, weight) {
  if (!font) return "—";
  const w = weight != null ? ` (${weight})` : "";
  return `${font}${w}`;
}

function renderPairing(pairing, index) {
  const use = pairing.use ?? `pairing ${index + 1}`;
  const title = pairing.id ? `${use} — ${pairing.id}` : use;
  const lines = [`### Pairing ${index + 1}: ${title}`];
  lines.push(`- Heading: ${renderFontWeight(pairing.heading_font, pairing.heading_weight)}`);
  lines.push(`- Body: ${renderFontWeight(pairing.body_font, pairing.body_weight)}`);
  if (pairing.mono_font) lines.push(`- Mono: ${renderFontWeight(pairing.mono_font, pairing.mono_weight)}`);
  if (pairing.rationale) lines.push(`- Rationale: ${pairing.rationale}`);
  return lines.join("\n");
}

function renderReference(section) {
  return `### ${section.heading}\n\n${section.body}`;
}

function parseCount(raw, flagName) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    console.error(`design-sample: --${flagName} must be a non-negative integer, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

export function buildMarkdown({ fonts, pairings, refSections, bannedDefaults, n, m, k, seed, sourceLabels }) {
  const rng = rngFromSeed(seed);
  const sampledFonts = sampleWithoutReplacement(fonts, n, rng);
  const sampledPairings = sampleWithoutReplacement(pairings, m, rng);
  const sampledRefs = sampleWithoutReplacement(refSections, k, rng);

  const out = [];
  out.push(`# Design sample — seed \`${seed}\``);
  out.push("");
  out.push(
    `Sampled ${sampledFonts.length} font(s) (of ${fonts.length}), ${sampledPairings.length} pairing(s) (of ${pairings.length}), and ${sampledRefs.length} reference(s) (of ${refSections.length}) from ${sourceLabels.fonts}, ${sourceLabels.pairings}, and ${sourceLabels.refs}.`
  );
  out.push("");
  out.push(`Re-run this exact sample with \`--seed ${seed}\`.`);
  out.push("");

  out.push("## Fonts");
  out.push("");
  if (sampledFonts.length === 0) {
    out.push("_(none sampled)_");
  } else {
    out.push(sampledFonts.map((f) => renderFont(f)).join("\n\n"));
  }
  out.push("");

  out.push("## Pairings");
  out.push("");
  if (sampledPairings.length === 0) {
    out.push("_(none sampled)_");
  } else {
    out.push(sampledPairings.map((p, i) => renderPairing(p, i)).join("\n\n"));
  }
  out.push("");

  out.push("## References");
  out.push("");
  if (sampledRefs.length === 0) {
    out.push("_(none sampled)_");
  } else {
    out.push(sampledRefs.map((r) => renderReference(r)).join("\n\n"));
  }
  out.push("");

  out.push("## Banned defaults");
  out.push("");
  out.push(bannedDefaults ? bannedDefaults.body : "_(no Banned defaults section found in the references source)_");
  out.push("");

  return out.join("\n");
}

/** Pull the `fonts` array out of fonts.json's top-level object, validating its shape. */
export function extractFontsArray(data, sourceLabel) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.fonts)) {
    console.error(`design-sample: expected ${sourceLabel} to be a JSON object with a "fonts" array`);
    process.exit(1);
  }
  return data.fonts;
}

/** Pull the `pairings` array out of pairings.json's top-level object, validating its shape. */
export function extractPairingsArray(data, sourceLabel) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.pairings)) {
    console.error(`design-sample: expected ${sourceLabel} to be a JSON object with a "pairings" array`);
    process.exit(1);
  }
  return data.pairings;
}

function main() {
  const { values } = parseArgs({
    options: {
      fonts: { type: "string", default: "8" },
      pairings: { type: "string", default: "5" },
      refs: { type: "string", default: "3" },
      seed: { type: "string" },
      use: { type: "string" },
      "fonts-file": { type: "string" },
      "pairings-file": { type: "string" },
      "refs-file": { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      "usage: node scripts/design-sample.mjs [--fonts N] [--pairings M] [--refs K] [--seed S] [--use U]"
    );
    process.exit(0);
  }

  const n = parseCount(values.fonts, "fonts");
  const m = parseCount(values.pairings, "pairings");
  const k = parseCount(values.refs, "refs");
  const seed = values.seed ?? defaultSeed();

  if (values.use !== undefined && !PAIRING_USES.includes(values.use)) {
    console.error(`design-sample: --use must be one of ${PAIRING_USES.join(", ")}, got ${JSON.stringify(values.use)}`);
    process.exit(1);
  }

  const fontsFile = values["fonts-file"] ? path.resolve(values["fonts-file"]) : DEFAULT_FONTS_FILE;
  const pairingsFile = values["pairings-file"] ? path.resolve(values["pairings-file"]) : DEFAULT_PAIRINGS_FILE;
  const refsFile = values["refs-file"] ? path.resolve(values["refs-file"]) : DEFAULT_REFS_FILE;

  const fontsData = readJsonSource(fontsFile, "fonts");
  const fonts = extractFontsArray(fontsData, fontsFile);
  const pairingsData = readJsonSource(pairingsFile, "pairings");
  let pairings = extractPairingsArray(pairingsData, pairingsFile);
  if (values.use) {
    pairings = pairings.filter((p) => p.use === values.use);
  }
  const refsMarkdown = readTextSource(refsFile, "references");
  const allSections = parseReferenceSections(refsMarkdown);
  const bannedDefaults = allSections.find((s) => isBannedDefaultsSection(s.heading));
  const refSections = allSections.filter(
    (s) => !isPatternsSection(s.heading) && !isBannedDefaultsSection(s.heading)
  );

  const md = buildMarkdown({
    fonts,
    pairings,
    refSections,
    bannedDefaults,
    n,
    m,
    k,
    seed,
    sourceLabels: {
      fonts: path.relative(REPO_ROOT, fontsFile) || fontsFile,
      pairings: path.relative(REPO_ROOT, pairingsFile) || pairingsFile,
      refs: path.relative(REPO_ROOT, refsFile) || refsFile,
    },
  });

  console.log(md);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
