// Smoke test for scripts/capture.mjs against a tiny local HTML fixture.
// Needs Playwright Chromium installed under apps/web/node_modules (this
// repo's own copy — capture.mjs never adds its own dependency). Skips
// loudly, not silently, when that isn't available yet, matching the
// pattern already used throughout tests/run.py for optional/heavy deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, statSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWidths, resolveTarget, baseNameFor, outputFileName } from "../capture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SCRIPT = path.join(HERE, "..", "capture.mjs");
const FIXTURE_HTML = path.join(HERE, "fixtures", "tiny.html");
const WEB_PACKAGE_JSON = path.join(REPO_ROOT, "apps", "web", "package.json");

function playwrightChromiumAvailable() {
  try {
    const require = createRequire(WEB_PACKAGE_JSON);
    require.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

test("parseWidths: parses, validates, and de-duplicates", () => {
  assert.deepEqual(parseWidths("375,1440"), [375, 1440]);
  assert.deepEqual(parseWidths("1440,1440,375"), [1440, 375]);
  assert.throws(() => parseWidths("375,abc"));
  assert.throws(() => parseWidths("0"));
  assert.throws(() => parseWidths("-10"));
});

test("resolveTarget: passes through http(s)/file URLs, resolves local files", () => {
  assert.equal(resolveTarget("https://example.com/x"), "https://example.com/x");
  assert.equal(resolveTarget("file:///tmp/x.html"), "file:///tmp/x.html");
  const url = resolveTarget(FIXTURE_HTML);
  assert.match(url, /^file:\/\//);
  assert.throws(() => resolveTarget("/no/such/file.html"));
});

test("baseNameFor / outputFileName: filesystem-safe names", () => {
  assert.equal(baseNameFor("file:///a/b/tiny.html"), "tiny");
  assert.match(baseNameFor("https://example.com/foo/bar"), /^example-com-foo-bar$/);
  assert.equal(outputFileName("tiny", 375, "dark"), "tiny-375w-dark.png");
  assert.equal(outputFileName("tiny", 1440, undefined), "tiny-1440w.png");
});

test("CLI: renders a local HTML fixture at two widths, dark + full-page", async (t) => {
  if (!playwrightChromiumAvailable()) {
    t.skip("playwright not installed under apps/web/node_modules — run `npm install` in apps/web first");
    return;
  }

  const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-smoke-"));
  try {
    const stdout = execFileSync(
      "node",
      [SCRIPT, FIXTURE_HTML, "--out", outDir, "--widths", "375,800", "--dark", "--full-page"],
      { encoding: "utf8", timeout: 60_000 }
    );
    const printedPaths = stdout.trim().split("\n").filter(Boolean);
    assert.equal(printedPaths.length, 2);

    const files = readdirSync(outDir);
    assert.equal(files.length, 2);
    for (const p of printedPaths) {
      assert.ok(existsSync(p), `printed path does not exist: ${p}`);
      const size = statSync(p).size;
      assert.ok(size > 0, `written PNG is empty: ${p}`);
    }
    assert.ok(printedPaths.some((p) => p.includes("375w")));
    assert.ok(printedPaths.some((p) => p.includes("800w")));
    assert.ok(printedPaths.every((p) => p.includes("-dark")));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("CLI: --out is required", () => {
  assert.throws(() => execFileSync("node", [SCRIPT, FIXTURE_HTML], { encoding: "utf8" }));
});

test("CLI: --dark and --light are mutually exclusive", () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "capture-smoke-conflict-"));
  try {
    assert.throws(() =>
      execFileSync("node", [SCRIPT, FIXTURE_HTML, "--out", outDir, "--dark", "--light"], { encoding: "utf8" })
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
