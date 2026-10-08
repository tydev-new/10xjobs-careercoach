// Independent checks for design-web-ui.md § 1.4's 2026-10-07 amendment (one way
// to sign in, C29) and design-web-agent.md § 16.5: the "Proved by" list's
// items 5, 6 (the bundle half) and 7 (the source half). Every expected string
// is READ FROM § 5.3.1 at test time, so the doc is the one copy (rule 12).
//
//   node --test tests/web/one-way-sign-in.test.ts
//
// Items 1-4, 6 (rendered states), 9, 10, 11 are tests/web/password.test.ts
// section 10; item 7's zero `POST /otp` count is tests/e2e-real/e2e.ts.
// One real `vite build` of apps/web into a temp dir; nothing touches a network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const UI = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");

/** The `String` cell of a § 5.3.1 row, without its backticks. */
function row(id: string): string {
  const line = UI.split("\n").find((l) => l.startsWith(`| ${id} |`));
  assert.ok(line, `no row ${id} in § 5.3.1`);
  const cell = line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ")[3];
  assert.ok(cell.startsWith("`") && cell.endsWith("`"), `${id}: not one backticked string`);
  return cell.slice(1, -1);
}

/** Proof 6's list, read from the amendment's own item 6 (quoted strings between "state" and "The check ignores case"). */
function mustNotAppear(): string[] {
  const start = UI.indexOf("6. **Not in the bundle, and not on any rendered sign-in state**");
  const end = UI.indexOf("The check ignores", start);
  assert.ok(start > 0 && end > start, "proof item 6 not found in § 1.4");
  return [...UI.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ")).filter((s) => s.length > 3);
}

const scratch = mkdtempSync(path.join(tmpdir(), "ten-one-way-"));
let BUNDLE = "";
before(() => {
  const VITE = path.join(WEB, "node_modules/vite/bin/vite.js");
  const r = spawnSync(process.execPath, [VITE, "build", "--outDir", path.join(scratch, "dist"), "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, encoding: "utf8" });
  assert.equal(r.status, 0, `vite build failed:\n${r.stdout}\n${r.stderr}`);
  const dist = path.join(scratch, "dist", "assets");
  BUNDLE = readdirSync(dist).filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(dist, f), "utf8")).join("\n");
});
after(() => rmSync(scratch, { recursive: true, force: true }));

// The bundle stores apostrophes either raw or escaped; look for either form.
const variants = (s: string) => [s, s.replace(/'/g, "\\'"), s.replace(/'/g, "\\u2019"), JSON.stringify(s).slice(1, -1)];
const inBundle = (s: string) => variants(s).some((v) => BUNDLE.includes(v));

test("proof 6 list was read from the doc: ten strings, the ones the owner's ruling retired", () => {
  const list = mustNotAppear();
  assert.equal(list.length, 10, JSON.stringify(list));
  for (const s of ["Email link", "Email + password", "Send me a link", "Ask for a new one below"]) assert.ok(list.includes(s), s);
});

test("proof 5: Y12, Y13, Y27, Y20, Y8, Y9 and O5 are each one whole literal in the bundle", () => {
  for (const id of ["Y12", "Y13", "Y27", "Y20", "Y8", "Y9", "O5"]) assert.ok(inBundle(row(id)), `${id} is not one whole literal in the bundle: ${row(id)}`);
});

test("proof 6 (bundle): none of the retired sign-in strings is in the bundle, ignoring case", () => {
  const hay = BUNDLE.toLowerCase();
  const found = mustNotAppear().filter((s) => variants(s.toLowerCase()).some((v) => hay.includes(v)));
  assert.deepEqual(found, []);
});

test("proof 7 (source): signInWithOtp and signInWithMagicLink appear nowhere under apps/web/src, tests and comments included", () => {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const a = path.join(d, n);
      if (statSync(a).isDirectory()) walk(a);
      else if (/signInWith(Otp|MagicLink)/.test(readFileSync(a, "utf8"))) hits.push(path.relative(REPO, a));
    }
  };
  walk(path.join(WEB, "src"));
  assert.deepEqual(hits, []);
});
