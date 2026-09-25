#!/usr/bin/env node
// capture.mjs — render a URL or a local HTML file to PNG with Playwright
// Chromium, at one or more widths. The only script of the three allowed
// to make network calls (loading a live URL); a local file target never
// touches the network.
//
// Uses apps/web's own installed Playwright (no separate dependency here):
// resolution is rooted at apps/web/package.json, so `npm install` in
// apps/web is the one setup step this script needs.
//
// Usage:
//   node scripts/capture.mjs <url-or-html-file> --out <dir>
//       [--widths 375,1440] [--dark|--light] [--full-page] [--height H]
//
//   <url-or-html-file>  an http(s) URL, or a path to a local .html file
//   --out <dir>         REQUIRED — where PNGs are written (created if
//                        missing). Never defaults into the repo: there is
//                        no default at all, so a repo path only happens
//                        if it's passed explicitly.
//   --widths L,L,...    comma-separated pixel widths (default 1440)
//   --height H          viewport height in px (default 900)
//   --dark / --light    force a color scheme (default: Playwright's own
//                        default, i.e. no override)
//   --full-page         capture the full scrollable page, not just the
//                        viewport
//
// Prints the written file paths, one per line.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const WEB_PACKAGE_JSON = path.join(REPO_ROOT, "apps", "web", "package.json");

function usage(msg) {
  if (msg) console.error(`capture.mjs: ${msg}`);
  console.error(
    "usage: node scripts/capture.mjs <url-or-html-file> --out <dir> " +
      "[--widths 375,1440] [--dark|--light] [--full-page] [--height H]"
  );
  process.exit(1);
}

export function parseWidths(raw) {
  const widths = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s));
  if (widths.length === 0 || widths.some((w) => !Number.isInteger(w) || w <= 0)) {
    throw new Error(`--widths must be a comma-separated list of positive integers, got ${JSON.stringify(raw)}`);
  }
  return [...new Set(widths)];
}

/** Resolve a CLI target (URL string or local file path) to a navigable URL. */
export function resolveTarget(raw, cwd = process.cwd()) {
  if (/^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw)) return raw;
  const abs = path.resolve(cwd, raw);
  if (!existsSync(abs)) {
    throw new Error(`target not found: ${raw} (resolved to ${abs})`);
  }
  return pathToFileURL(abs).href;
}

/** A filesystem-safe base name to prefix output files with. */
export function baseNameFor(target) {
  try {
    const u = new URL(target);
    if (u.protocol === "file:") {
      const base = path.basename(fileURLToPath(u)).replace(/\.[^.]+$/, "");
      return base || "capture";
    }
    const slug = (u.hostname + u.pathname).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "capture";
  } catch {
    return "capture";
  }
}

export function outputFileName(base, width, colorScheme) {
  const scheme = colorScheme ? `-${colorScheme}` : "";
  return `${base}-${width}w${scheme}.png`;
}

async function loadChromium() {
  const require = createRequire(WEB_PACKAGE_JSON);
  const { chromium } = require("playwright");
  return chromium;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      out: { type: "string" },
      widths: { type: "string", default: "1440" },
      height: { type: "string", default: "900" },
      dark: { type: "boolean", default: false },
      light: { type: "boolean", default: false },
      "full-page": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const targetArg = positionals[0];
  if (!targetArg) usage("missing <url-or-html-file>");
  if (!values.out) usage("--out <dir> is required");
  if (values.dark && values.light) usage("--dark and --light are mutually exclusive");

  let widths;
  try {
    widths = parseWidths(values.widths);
  } catch (err) {
    usage(err.message);
  }

  const height = Number(values.height);
  if (!Number.isInteger(height) || height <= 0) usage(`--height must be a positive integer, got ${values.height}`);

  let targetUrl;
  try {
    targetUrl = resolveTarget(targetArg);
  } catch (err) {
    usage(err.message);
  }

  const colorScheme = values.dark ? "dark" : values.light ? "light" : undefined;
  const fullPage = values["full-page"];
  const outDir = path.resolve(values.out);
  mkdirSync(outDir, { recursive: true });

  const base = baseNameFor(targetUrl);
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme,
      });
      try {
        const page = await context.newPage();
        await page.goto(targetUrl, { waitUntil: "load" });
        const filePath = path.join(outDir, outputFileName(base, width, colorScheme));
        await page.screenshot({ path: filePath, fullPage });
        written.push(filePath);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  for (const p of written) console.log(p);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`capture.mjs: ${err.message}`);
    process.exit(1);
  });
}
