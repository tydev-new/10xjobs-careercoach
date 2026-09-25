import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractPaths, classify, resolvePrivateRoot, checkPaths, REPO_ROOT } from "../check-handback-paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "check-handback-paths.mjs");

function run(args, input) {
  try {
    const out = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", input: input ?? "" });
    return { code: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

test("classify: URLs and mailto are ignored", () => {
  assert.equal(classify("https://example.com/foo/bar.png"), null);
  assert.equal(classify("http://example.com/a/b.md"), null);
  assert.equal(classify("mailto:jane@example.com"), null);
});

test("classify: code-looking tokens are ignored", () => {
  assert.equal(classify("chromium.launch()"), null);
  assert.equal(classify("SCREAMING_CASE"), null);
  assert.equal(classify("and/or"), null);
  assert.equal(classify("N/A"), null);
  assert.equal(classify("3/4"), null);
});

test("classify: repo-relative path needs a slash AND an extension", () => {
  assert.deepEqual(classify("scripts/design-sample.mjs"), { kind: "repo", raw: "scripts/design-sample.mjs" });
  assert.equal(classify("CLAUDE.md"), null, "no slash: not extracted per contract");
});

test("classify: absolute paths and private design-refs paths", () => {
  assert.deepEqual(classify("/opt/build/repo/scripts/foo.mjs"), {
    kind: "absolute",
    raw: "/opt/build/repo/scripts/foo.mjs",
  });
  assert.deepEqual(classify("10xjobs-design-refs/grok/hero.png"), {
    kind: "private",
    raw: "10xjobs-design-refs/grok/hero.png",
  });
});

test("extractPaths: pulls paths out of markdown-ish prose, de-duplicated, URLs stripped", () => {
  const text = [
    "Changed `scripts/design-sample.mjs` and (scripts/check-handback-paths.mjs).",
    "See https://example.com/scripts/design-sample.mjs for context (not a real path here).",
    "Also touched scripts/design-sample.mjs again.",
    "Screenshot: 10xjobs-design-refs/grok/hero.png",
    "Ran chromium.launch() and CONST_NAME, plus and/or a phrase.",
  ].join("\n");
  const found = extractPaths(text).map((c) => c.raw);
  assert.deepEqual(found, [
    "scripts/design-sample.mjs",
    "scripts/check-handback-paths.mjs",
    "10xjobs-design-refs/grok/hero.png",
  ]);
});

test("resolvePrivateRoot: --private-root > DESIGN_REFS_ROOT > repo's parent dir", () => {
  assert.equal(
    resolvePrivateRoot({ argRoot: "/explicit", envRoot: "/env", repoRoot: "/repo" }),
    path.resolve("/explicit")
  );
  assert.equal(resolvePrivateRoot({ argRoot: undefined, envRoot: "/env", repoRoot: "/repo" }), path.resolve("/env"));
  assert.equal(
    resolvePrivateRoot({ argRoot: undefined, envRoot: undefined, repoRoot: "/repo/child" }),
    path.resolve("/repo")
  );
});

test("checkPaths: resolves each kind against the right root and reports existence", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "chp-unit-"));
  const privateRoot = path.join(tmp, "private");
  mkdirSync(path.join(privateRoot, "grok"), { recursive: true });
  writeFileSync(path.join(privateRoot, "grok", "hero.png"), "x");

  const candidates = [
    { kind: "repo", raw: "CLAUDE.md" },
    { kind: "repo", raw: "scripts/does-not-exist.mjs" },
    { kind: "private", raw: "10xjobs-design-refs/grok/hero.png" },
    { kind: "private", raw: "10xjobs-design-refs/grok/missing.png" },
  ];
  const checked = checkPaths(candidates, { repoRoot: REPO_ROOT, privateRoot });
  const byRaw = Object.fromEntries(checked.map((c) => [c.raw, c.exists]));
  assert.equal(byRaw["CLAUDE.md"], true);
  assert.equal(byRaw["scripts/does-not-exist.mjs"], false);
  assert.equal(byRaw["10xjobs-design-refs/grok/hero.png"], true);
  assert.equal(byRaw["10xjobs-design-refs/grok/missing.png"], false);

  rmSync(tmp, { recursive: true, force: true });
});

test("CLI: exits 0 and reports 0 missing when every path exists", () => {
  const text = "Edited `scripts/design-sample.mjs` and `scripts/check-handback-paths.mjs`. See https://example.com/x.png too.";
  const r = run([], text);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /0 missing/);
});

test("CLI: exits 1 and tables the missing paths only, from a file arg", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "chp-cli-"));
  const handback = path.join(tmp, "handback.txt");
  const privateRoot = path.join(tmp, "private-refs");
  mkdirSync(path.join(privateRoot, "grok"), { recursive: true });
  writeFileSync(path.join(privateRoot, "grok", "hero.png"), "x");

  writeFileSync(
    handback,
    [
      "Files changed: `scripts/design-sample.mjs` (real), `scripts/nope.mjs` (fake).",
      "Screenshot 10xjobs-design-refs/grok/hero.png (real) and 10xjobs-design-refs/grok/missing.png (fake).",
      "Ignore this URL: https://example.com/scripts/nope.mjs",
      "Ignore this code: chromium.launch() and SCREAMING_CASE and and/or.",
    ].join("\n")
  );

  const r = run([handback, "--private-root", privateRoot]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /2 missing/);
  assert.match(r.stdout, /scripts\/nope\.mjs/);
  assert.match(r.stdout, /10xjobs-design-refs\/grok\/missing\.png/);
  assert.doesNotMatch(r.stdout, /scripts\/design-sample\.mjs\s/, "existing path should not appear in the missing table");

  rmSync(tmp, { recursive: true, force: true });
});

test("CLI: DESIGN_REFS_ROOT env var is honored when --private-root is absent", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "chp-env-"));
  const handback = path.join(tmp, "handback.txt");
  const privateRoot = path.join(tmp, "private-refs");
  mkdirSync(path.join(privateRoot, "grok"), { recursive: true });
  writeFileSync(path.join(privateRoot, "grok", "hero.png"), "x");
  writeFileSync(handback, "Screenshot: 10xjobs-design-refs/grok/hero.png");

  const out = execFileSync("node", [SCRIPT, handback], {
    encoding: "utf8",
    env: { ...process.env, DESIGN_REFS_ROOT: privateRoot },
  });
  assert.match(out, /0 missing/);

  rmSync(tmp, { recursive: true, force: true });
});

test("CLI: missing hand-back file argument fails clearly", () => {
  const r = run(["/no/such/handback.txt"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no such file/);
});
