// Tester-owned acceptance tests for docs/design-web-agent.md § 10.1 and
// § 10.4 items (i) build and (ii) deploy scans (commit 7574d24), written
// from the spec, not the code.
//
// (i)  Two real `vite build`s of apps/web (the real config) into temp dirs.
// (ii) apps/web/scripts/deploy-prod.sh, COPIED into a temp tree (so it can
//      never touch apps/web/.vercel), run with a stub `npx` first on PATH:
//      its `vercel build` copies a prepared dist into .vercel/output/static,
//      its `vercel deploy` only records the call, and anything else fails.
//      Never a real vercel call. Each case runs under BSD grep (/usr/bin/grep,
//      what `bash` gets on macOS) and, when this host has it, ugrep.
//
// Run: node --test tests/web/version-build-deploy.test.ts
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const VITE = path.join(WEB, "node_modules/vite/bin/vite.js");
const ID_RE = /^([0-9a-f]{7,40}|nogit)-(\d{8}T\d{6}Z)$/;

const scratch = mkdtempSync(path.join(tmpdir(), "ten-version-build-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function viteBuild(outDir: string, env: Record<string, string | undefined> = {}) {
  const r = spawnSync(process.execPath, [VITE, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: WEB,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(r.status, 0, `vite build failed:\n${r.stdout}\n${r.stderr}`);
  return outDir;
}
const readId = (dist: string) => {
  const raw = readFileSync(path.join(dist, "version.json"), "utf8");
  const parsed = JSON.parse(raw);
  return { raw, parsed, id: parsed.id as string };
};
/** JS assets holding `needle` as a WHOLE string literal ("X", 'X' or `X`) —
 *  a substring match would pass a bundle carrying "X-something". */
const jsAssetsWith = (dist: string, needle: string) =>
  readdirSync(path.join(dist, "assets")).filter((f) => {
    if (!f.endsWith(".js")) return false;
    const js = readFileSync(path.join(dist, "assets", f), "utf8");
    return [`"${needle}"`, `'${needle}'`, `\`${needle}\``].some((lit) => js.includes(lit));
  });
function utcStamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
const stampToMs = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));

let distA = "";
let distB = "";
let idA = "";

before(async () => {
  distA = viteBuild(path.join(scratch, "distA"));
  await new Promise((r) => setTimeout(r, 1100)); // ids carry seconds; see the last (i) test
  distB = viteBuild(path.join(scratch, "distB"));
  idA = readId(distA).id;
});

// ---------------------------------------------------------------- (i) build

test("(i) dist/version.json is exactly {\"id\": X} and X has the § 10.1 format: <short git sha>-<UTC YYYYMMDDTHHMMSSZ>", () => {
  const { raw, parsed, id } = readId(distA);
  assert.deepEqual(Object.keys(parsed), ["id"], raw);
  const m = id.match(ID_RE);
  assert.ok(m, `format: ${id}`);
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  assert.equal(m![1], sha, "the short sha of the commit that was built");
  const age = Date.now() - stampToMs(m![2]);
  assert.ok(age >= -5_000 && age < 10 * 60_000, `the time is the build's own UTC time (${m![2]} vs now ${utcStamp(new Date())})`);
});

test("(i) X appears in a dist/assets/*.js file (the one value feeds both)", () => {
  assert.ok(jsAssetsWith(distA, idA).length >= 1, `id ${idA} in no dist/assets/*.js`);
  const idB = readId(distB).id;
  assert.ok(jsAssetsWith(distB, idB).length >= 1);
  assert.deepEqual(jsAssetsWith(distA, idB), [], "build A's bundle never carries build B's id");
});

test("(i) two builds, two ids", () => {
  assert.notEqual(readId(distA).id, readId(distB).id);
});

test("(i) without git, the id is nogit-<UTC time>", () => {
  const dist = viteBuild(path.join(scratch, "distNoGit"), { GIT_DIR: path.join(scratch, "no-such-git-dir") });
  const { id } = readId(dist);
  assert.match(id, /^nogit-\d{8}T\d{6}Z$/, id);
  assert.ok(jsAssetsWith(dist, id).length >= 1);
});

// ---------------------------------------------------------------- (ii) deploy scans

const STUB_NPX = `#!/usr/bin/env bash
# tester stub for npx — never runs the real vercel CLI
echo "$*" >> "$STUB_LOG"
case "$1 $2" in
  "vercel pull") exit 0 ;;
  "vercel build") rm -rf .vercel/output/static && mkdir -p .vercel/output && cp -R "$STUB_DIST" .vercel/output/static && exit 0 ;;
  "vercel deploy") echo "DEPLOY-CALLED" >> "$STUB_LOG"; exit 0 ;;
  *) echo "stub npx: unexpected call: $*" >&2; exit 97 ;;
esac
`;

interface GrepFlavor { name: string; shim?: string }
const GREPS: GrepFlavor[] = [{ name: "BSD grep (/usr/bin/grep)", shim: `#!/bin/sh\nexec /usr/bin/grep "$@"\n` }];
const UGREP = process.env.CLAUDE_CODE_EXECPATH;
if (UGREP && existsSync(UGREP)) GREPS.push({ name: "ugrep", shim: `#!/usr/bin/env bash\nexec -a ugrep "${UGREP}" "$@"\n` });

function runDeploy(dist: string, grep: GrepFlavor) {
  const root = mkdtempSync(path.join(scratch, "deploy-"));
  mkdirSync(path.join(root, "scripts"));
  cpSync(path.join(WEB, "scripts/deploy-prod.sh"), path.join(root, "scripts/deploy-prod.sh"));
  const bin = path.join(root, "stub-bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "npx"), STUB_NPX);
  chmodSync(path.join(bin, "npx"), 0o755);
  if (grep.shim) {
    writeFileSync(path.join(bin, "grep"), grep.shim);
    chmodSync(path.join(bin, "grep"), 0o755);
  }
  const log = path.join(root, "npx.log");
  writeFileSync(log, "");
  const r = spawnSync("bash", [path.join(root, "scripts/deploy-prod.sh")], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, STUB_LOG: log, STUB_DIST: dist },
  });
  const calls = readFileSync(log, "utf8");
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, calls, deployed: calls.includes("DEPLOY-CALLED") };
}

/** A copy of the real dist A, changed by `edit`. */
function variant(name: string, edit: (dir: string) => void) {
  const dir = path.join(scratch, `variant-${name}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(distA, dir, { recursive: true });
  edit(dir);
  return dir;
}

const CASES: Array<{ name: string; dist: () => string; ok: boolean; why?: RegExp; plain?: boolean }> = [
  { name: "a clean build deploys", dist: () => distA, ok: true },
  { name: "a home path is refused", dist: () => variant("home", (d) => writeFileSync(path.join(d, "assets/leak.txt"), "built at /Users/someone/src/ten")), ok: false, why: /home-directory path/ },
  {
    name: "no SKILL.md text is refused",
    dist: () => {
      const d = path.join(scratch, "variant-noskills");
      rmSync(d, { recursive: true, force: true });
      mkdirSync(path.join(d, "assets"), { recursive: true });
      writeFileSync(path.join(d, "index.html"), "<!doctype html><script src=/assets/app.js></script>");
      writeFileSync(path.join(d, "assets/app.js"), `const v=${JSON.stringify(idA)};`);
      writeFileSync(path.join(d, "version.json"), JSON.stringify({ id: idA }));
      return d;
    },
    ok: false,
    why: /no skill text/,
  },
  { name: "no version.json is refused", dist: () => variant("noversion", (d) => rmSync(path.join(d, "version.json"))), ok: false, why: /version\.json/ },
  { name: "an id in no asset is refused", dist: () => variant("foreignid", (d) => writeFileSync(path.join(d, "version.json"), JSON.stringify({ id: "deadbee-20990101T000000Z" }))), ok: false, why: /not found in any built JS asset/ },
  { name: "an empty id is refused", dist: () => variant("emptyid", (d) => writeFileSync(path.join(d, "version.json"), JSON.stringify({ id: "" }))), ok: false },
  { name: "a version.json without an id is refused", dist: () => variant("noid", (d) => writeFileSync(path.join(d, "version.json"), JSON.stringify({ version: idA }))), ok: false },
  // Fixed in release round 2 (7713737): a plain REFUSED line, never a raw node stack.
  { name: "an unparseable version.json is refused, with a plain REFUSED line", dist: () => variant("badjson", (d) => writeFileSync(path.join(d, "version.json"), '{"id": ')), ok: false, why: /REFUSED: version\.json could not be parsed\. Nothing was deployed\./ },
  {
    name: "an id found only in index.html (not an asset) is refused",
    dist: () =>
      variant("idinhtml", (d) => {
        const other = "0badc0d-20990101T000000Z";
        writeFileSync(path.join(d, "version.json"), JSON.stringify({ id: other }));
        writeFileSync(path.join(d, "index.html"), readFileSync(path.join(d, "index.html"), "utf8") + `<!-- ${other} -->`);
      }),
    ok: false,
  },
];

for (const g of GREPS) {
  for (const c of CASES) {
    test(`(ii) [${g.name}] ${c.name}`, () => {
      const r = runDeploy(c.dist(), g);
      assert.ok(!/unexpected call/.test(r.stderr), `the script called npx with something unexpected: ${r.stderr}`);
      assert.ok(r.calls.includes("vercel build --prod"), `vercel build ran: ${r.calls}`);
      if (c.ok) {
        assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
        assert.ok(r.deployed, "the deploy was called");
        assert.equal((r.calls.match(/vercel deploy --prebuilt --prod/g) ?? []).length, 1, "exactly once, prebuilt, prod");
      } else {
        assert.equal(r.status, 1, `exit 1 (got ${r.status}): ${r.stderr}`);
        assert.ok(!r.deployed, `no deploy call: ${r.calls}`);
        if (c.plain !== false) assert.match(r.stderr, /REFUSED/, `a plain REFUSED line: ${r.stderr}`);
        if (c.why) assert.match(r.stderr, c.why);
      }
    });
  }
}
