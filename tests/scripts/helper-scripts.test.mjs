// Tester-owned acceptance tests for the team helper scripts (owner-approved
// brief; commits f2b8172, cf065f5, 521ea2f), written from the brief, not
// the code. Every script runs as a real CLI (a child process), against the
// real design/library/*.json and docs/design-references.md unless a case
// needs a fixture; outputs go to temp dirs only.
// Run: node --test tests/scripts/helper-scripts.test.mjs
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE = path.join(REPO, "scripts/design-sample.mjs");
const HANDBACK = path.join(REPO, "scripts/check-handback-paths.mjs");
const CAPTURE = path.join(REPO, "scripts/capture.mjs");
const tmp = mkdtempSync(path.join(tmpdir(), "ten-helper-scripts-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const run = (script, args = [], opts = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: opts.cwd ?? REPO, encoding: "utf8", input: opts.input, env: { ...process.env, ...(opts.env ?? {}) } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
/** Async run: the test's own HTTP server must keep answering while it runs. */
const runAsync = (script, args = []) =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, [script, ...args], { cwd: REPO });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code, out, err }));
  });
const headings = (md, section) => {
  const s = md.split(/^## /m).find((x) => x.startsWith(section + "\n"));
  return s ? [...s.matchAll(/^### (.+)$/gm)].map((m) => m[1]) : [];
};
const REFS_DOC = readFileSync(path.join(REPO, "docs/design-references.md"), "utf8");
function refSection(title) {
  const m = REFS_DOC.split(/^## /m).find((x) => x.toLowerCase().startsWith(title.toLowerCase()));
  return m ? m.slice(m.indexOf("\n") + 1).trim() : null;
}

// =============================================================== design-sample.mjs

test("design-sample: samples N fonts / M pairings / K references from the real sources", () => {
  const r = run(SAMPLE, ["--fonts", "4", "--pairings", "3", "--refs", "2", "--seed", "acceptance-1"]);
  assert.equal(r.code, 0, r.err);
  const fonts = JSON.parse(readFileSync(path.join(REPO, "design/library/fonts.json"), "utf8")).fonts.map((f) => f.name);
  const f = headings(r.out, "Fonts");
  assert.equal(f.length, 4);
  assert.ok(f.every((n) => fonts.includes(n)), `every sampled font is in fonts.json: ${f}`);
  assert.equal(new Set(f).size, 4, "no font sampled twice");
  assert.equal(headings(r.out, "Pairings").length, 3);
  assert.equal(headings(r.out, "References").length, 2);
});

test("design-sample: the Banned defaults section is always appended IN FULL (even with --refs 0)", () => {
  const banned = refSection("Banned defaults");
  assert.ok(banned && banned.length > 50, "precondition: the doc has a Banned defaults section");
  for (const k of ["0", "3"]) {
    const r = run(SAMPLE, ["--refs", k, "--seed", "b"]);
    assert.equal(r.code, 0, r.err);
    const tail = r.out.split(/^## Banned defaults\n/m)[1];
    assert.ok(tail, "a Banned defaults section is present");
    assert.equal(tail.trim(), banned, `--refs ${k}: the section, word for word`);
  }
});

test("design-sample: the sampled references never include Banned defaults or the patterns summary", () => {
  for (const seed of ["r1", "r2", "r3", "r4", "r5"]) {
    const r = run(SAMPLE, ["--refs", "50", "--seed", seed]);
    const refs = headings(r.out, "References").map((h) => h.toLowerCase());
    assert.ok(!refs.some((h) => h.startsWith("banned defaults") || h.startsWith("patterns across the set")), `${seed}: ${refs}`);
  }
});

test("design-sample: deterministic with --seed across separate runs; different seeds differ; the default seed is printed and reproduces", () => {
  const a = run(SAMPLE, ["--seed", "same-seed"]);
  const b = run(SAMPLE, ["--seed", "same-seed"]);
  assert.equal(a.code, 0);
  assert.equal(a.out, b.out, "same seed, byte-identical output");
  const outs = new Set(["s1", "s2", "s3", "s4"].map((s) => run(SAMPLE, ["--seed", s]).out.replace(/`[^`]+`/g, "")));
  assert.ok(outs.size > 1, "different seeds give different samples");
  const free = run(SAMPLE, []);
  const seed = free.out.match(/seed `([^`]+)`/)?.[1];
  assert.ok(seed, "the chosen seed is printed");
  assert.equal(run(SAMPLE, ["--seed", seed]).out, free.out, "…and re-running with it reproduces the sample");
});

test("design-sample: --use keeps only pairings of that use", () => {
  const pairings = JSON.parse(readFileSync(path.join(REPO, "design/library/pairings.json"), "utf8")).pairings;
  for (const use of ["chat-ui", "document-resume", "marketing-sign-in"]) {
    const r = run(SAMPLE, ["--use", use, "--pairings", "50", "--seed", "u"]);
    assert.equal(r.code, 0, r.err);
    const got = headings(r.out, "Pairings");
    assert.equal(got.length, pairings.filter((p) => p.use === use).length, `${use}: every match, no others`);
    assert.ok(got.every((h) => h.includes(`: ${use} — `)), `${use}: ${got}`);
  }
});

test("design-sample: --use with no matching pairings samples none and says so; an unknown --use is refused", () => {
  const fx = path.join(tmp, "pairings-chat-only.json");
  const src = JSON.parse(readFileSync(path.join(REPO, "design/library/pairings.json"), "utf8"));
  writeFileSync(fx, JSON.stringify({ pairings: src.pairings.filter((p) => p.use === "chat-ui") }));
  const r = run(SAMPLE, ["--use", "document-resume", "--pairings-file", fx, "--seed", "x"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(headings(r.out, "Pairings").length, 0);
  assert.match(r.out, /0 pairing\(s\) \(of 0\)/, "the header says none matched");
  const bad = run(SAMPLE, ["--use", "billboard"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--use must be one of/);
});

test("design-sample: a missing source exits 1 with a clear message naming it", () => {
  for (const [flag, label] of [["--fonts-file", "fonts"], ["--pairings-file", "pairings"], ["--refs-file", "references"]]) {
    const missing = path.join(tmp, `nope-${label}.json`);
    const r = run(SAMPLE, [flag, missing]);
    assert.equal(r.code, 1, `${label}: exit 1`);
    assert.match(r.err, new RegExp(`missing ${label} source file: .*nope-${label}\\.json`), r.err);
    assert.equal(r.out, "", "nothing printed to stdout");
  }
});

test("design-sample: asking for more than exist gives all of them, once each", () => {
  const n = JSON.parse(readFileSync(path.join(REPO, "design/library/fonts.json"), "utf8")).fonts.length;
  const r = run(SAMPLE, ["--fonts", "999", "--seed", "all"]);
  const f = headings(r.out, "Fonts");
  assert.equal(f.length, n);
  assert.equal(new Set(f).size, n);
});

// =============================================================== check-handback-paths.mjs

const hb = (text, args = [], env = {}) => {
  const file = path.join(tmp, `hb-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, text);
  return run(HANDBACK, [file, ...args], { env });
};

test("handback: a hand-back naming zero paths exits 0 and says it checked 0", () => {
  const r = hb("All done. Tests pass; nothing else to report.");
  assert.equal(r.code, 0);
  assert.match(r.out, /Checked 0 referenced path\(s\); 0 missing\./);
});

test("handback: existing repo-relative, ./relative and absolute paths pass", () => {
  const r = hb(`Updated docs/PROCESS.md and ./scripts/design-sample.mjs; see also ${path.join(REPO, "CLAUDE.md")}.`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Checked 3 referenced path\(s\); 0 missing\./);
});

test("handback: a missing path is printed and exits 1 — repo-relative and absolute", () => {
  const r = hb(`Wrote docs/never-written-plan.md and ${path.join(tmp, "absent", "report.md")} and docs/PROCESS.md.`);
  assert.equal(r.code, 1);
  assert.match(r.out, /docs\/never-written-plan\.md/);
  assert.match(r.out, /absent\/report\.md/);
  assert.match(r.out, /Checked 3 referenced path\(s\); 2 missing\./);
});

test("handback: URLs and code-looking tokens are ignored", () => {
  const r = hb("See https://example.com/docs/missing.md and http://x.io/a/b.png, mailto:a@b.co; ratio 3/4, and/or, N/A, MAX_TOKENS_CAP, foo.bar(), a/b.");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Checked 0 referenced path/);
});

test("handback: trailing punctuation and wrapping quotes/backticks/parens are stripped", () => {
  const ok = hb("Edited `docs/PROCESS.md`, (CLAUDE.md is untouched), \"docs/PROCESS.md\". And docs/PROCESS.md; docs/PROCESS.md!");
  assert.equal(ok.code, 0, ok.out);
  const bad = hb("Wrote (docs/not-here.md), then `docs/also-not.md`.");
  assert.equal(bad.code, 1);
  assert.match(bad.out, /docs\/not-here\.md/);
  assert.match(bad.out, /docs\/also-not\.md/);
  assert.ok(!/not-here\.md\)/.test(bad.out), "no stray punctuation in what it reports");
});

test("handback: 10xjobs-design-refs/... resolves against --private-root, else DESIGN_REFS_ROOT, else the repo's parent", () => {
  const priv = path.join(tmp, "priv-arg");
  const env = path.join(tmp, "priv-env");
  mkdirSync(path.join(priv, "grok"), { recursive: true });
  mkdirSync(path.join(env, "grok"), { recursive: true });
  writeFileSync(path.join(priv, "grok", "only-arg.png"), "x");
  writeFileSync(path.join(env, "grok", "only-env.png"), "x");
  const text = "Screens: 10xjobs-design-refs/grok/only-arg.png";
  assert.equal(hb(text, ["--private-root", priv], { DESIGN_REFS_ROOT: env }).code, 0, "--private-root wins over the env");
  assert.equal(hb("Screens: 10xjobs-design-refs/grok/only-env.png", [], { DESIGN_REFS_ROOT: env }).code, 0, "DESIGN_REFS_ROOT is used");
  const r = hb("Screens: 10xjobs-design-refs/grok/only-env.png", [], { DESIGN_REFS_ROOT: "" });
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(path.join(path.dirname(REPO), "grok", "only-env.png")), `falls back to the repo's parent: ${r.out}`);
});

test("handback: reads the hand-back from stdin too", () => {
  const r = run(HANDBACK, [], { input: "Wrote docs/stdin-missing.md" });
  assert.equal(r.code, 1);
  assert.match(r.out, /docs\/stdin-missing\.md/);
});

// Hand-backs in this repo cite `file:line` constantly (the report format).
test("handback: a path cited with :line (or :line-line) is still checked", () => {
  const ok = hb("See docs/PROCESS.md:12 and docs/PROCESS.md:20-24.");
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Checked 1 referenced path/, `the cited file is checked: ${ok.out}`);
  const bad = hb(`Fixed apps/web/src/never/Here.tsx:433 and ${path.join(tmp, "gone.ts")}:272.`);
  assert.equal(bad.code, 1, `a missing file cited with :line must fail: ${bad.out}`);
});

test("handback: a path inside a Markdown link is checked", () => {
  const r = hb("See [the plan](docs/never-written-plan.md) for details.");
  assert.equal(r.code, 1, `a missing Markdown-linked file must fail: ${r.out}`);
});

test("handback: a path with a space (quoted or backticked) is checked, not silently skipped", () => {
  const dir = path.join(tmp, "has space");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "real file.md"), "x");
  const ok = hb(`Wrote \`${path.join(dir, "real file.md")}\`.`);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Checked 1 referenced path/, `the spaced path is checked: ${ok.out}`);
  const bad = hb(`Wrote \`${path.join(dir, "missing file.md")}\` and "docs/my notes.md".`);
  assert.equal(bad.code, 1, `missing spaced paths must fail: ${bad.out}`);
});

// ---- round-1 fix (cc2a15c) edge cases: quoted spans are whole candidates now

test("handback: a missing script named inside a backticked COMMAND is still reported", () => {
  const r = hb("Run `node scripts/never-written-tool.mjs --seed 7` to reproduce.");
  assert.equal(r.code, 1, `the command's missing script must fail: ${r.out}`);
  assert.match(r.out, /scripts\/never-written-tool\.mjs/);
});

test("handback: an existing script inside a backticked command passes, and is reported by its own path", () => {
  const r = hb("Run `node scripts/design-sample.mjs --seed 7` and `python3 tests/run.py`.");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Checked 2 referenced path\(s\); 0 missing\./, r.out);
});

test("handback: a double-quoted sentence naming a path checks that path — no miss, no false alarm", () => {
  const miss = hb('The coder said "I wrote docs/never-written-notes.md and more".');
  assert.equal(miss.code, 1, `a missing path inside a quoted sentence must fail: ${miss.out}`);
  const ok = hb('The coder said "Updated docs/PROCESS.md."');
  assert.equal(ok.code, 0, `an existing path inside a quoted sentence must pass: ${ok.out}`);
});

test("handback: a Markdown link target with a #anchor is checked by its file", () => {
  const miss = hb("See [notes](docs/never-written.md#section).");
  assert.equal(miss.code, 1, miss.out);
  const ok = hb("See [process](docs/PROCESS.md#the-ritual-in-order).");
  assert.equal(ok.code, 0, ok.out);
});

test("handback: a backticked path with :line is checked; a backticked URL is still ignored", () => {
  assert.equal(hb("See `docs/never-written.md:12`.").code, 1);
  assert.equal(hb("See `docs/PROCESS.md:12`.").code, 0);
  const url = hb("See `https://example.com/docs/missing.md`.");
  assert.equal(url.code, 0, url.out);
  assert.match(url.out, /Checked 0 referenced path/);
});

// =============================================================== capture.mjs

function pngInfo(file) {
  const png = readFileSync(file);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20), ct = png[25];
  let p = 8;
  const idat = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    if (png.toString("ascii", p + 4, p + 8) === "IDAT") idat.push(png.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3;
  const stride = w * bpp;
  // row 0 only, unfiltered by hand (filter types 0/1/2 cover row 0)
  const f = raw[0];
  const px = [];
  for (let x = 0; x < bpp; x++) px.push(raw[1 + x]);
  return { w, h, first: f === 0 || f === 1 || f === 2 || f === 3 || f === 4 ? px : null };
}
const HTML = path.join(tmp, "scheme page.html");
writeFileSync(HTML, `<!doctype html><meta name="color-scheme" content="light dark"><style>
html,body{margin:0;background:#ffffff}
@media (prefers-color-scheme: dark){html,body{background:#000000}}
.tall{height:3000px}</style><div class="tall">tall</div><img src="http://127.0.0.1:__PORT__/pixel.png">`);

test("capture: --out is required (exit 1, nothing written)", () => {
  const r = run(CAPTURE, [HTML]);
  assert.equal(r.code, 1);
  assert.match(r.err, /--out <dir> is required/);
});

test("capture: --dark and --light together are refused", () => {
  const r = run(CAPTURE, [HTML, "--out", path.join(tmp, "x"), "--dark", "--light"]);
  assert.equal(r.code, 1);
});

test("capture: renders a local HTML file at each --width, --dark/--light as asked, --full-page, only into --out; no repo files", async () => {
  const hits = [];
  const srv = createServer((req, res) => { hits.push(req.url); res.writeHead(404).end(); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const html = path.join(tmp, "scheme net.html");
  writeFileSync(html, readFileSync(HTML, "utf8").replace("__PORT__", String(srv.address().port)));
  const before = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO, encoding: "utf8" }).stdout;
  const out = path.join(tmp, "caps");
  const dark = await runAsync(CAPTURE, [html, "--out", out, "--widths", "375,1440", "--dark", "--height", "600"]);
  const light = await runAsync(CAPTURE, [html, "--out", out, "--widths", "375", "--light", "--full-page", "--height", "600"]);
  await new Promise((r) => srv.close(r));
  assert.equal(dark.code, 0, dark.err);
  assert.equal(light.code, 0, light.err);
  const files = readdirSync(out).sort();
  assert.equal(files.length, 3, JSON.stringify(files));
  const d375 = pngInfo(path.join(out, files.find((f) => f.includes("375w-dark"))));
  const d1440 = pngInfo(path.join(out, files.find((f) => f.includes("1440w-dark"))));
  const l375 = pngInfo(path.join(out, files.find((f) => f.includes("375w-light"))));
  assert.deepEqual([d375.w, d375.h, d1440.w, d1440.h], [375, 600, 1440, 600], "each width, the viewport height");
  assert.ok(l375.h >= 3000, `--full-page captures the whole page (${l375.h}px)`);
  assert.deepEqual(d375.first?.slice(0, 3), [0, 0, 0], "--dark renders the page's dark scheme");
  assert.deepEqual(l375.first?.slice(0, 3), [255, 255, 255], "--light renders its light scheme");
  for (const p of dark.out.trim().split("\n")) assert.ok(p.startsWith(out) && existsSync(p), `printed paths are the written files: ${p}`);
  const afterSt = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO, encoding: "utf8" }).stdout;
  assert.equal(afterSt, before, "nothing written inside the repo");
  networkHits = hits;
});

// capture.mjs's own header: "a local file target never touches the network".
// Round 1 found a local page's remote <img> fetched on every render; fixed
// in cc2a15c (non-file:// requests aborted for local targets).
let networkHits = [];
test("capture: a local file target never touches the network (a remote <img> in the page is never fetched)", () => {
  assert.deepEqual(networkHits, [], `a local file target made network requests: ${JSON.stringify(networkHits)}`);
});
