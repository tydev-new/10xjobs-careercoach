// Independent checks for design-web-ui.md § 5.6 "The brand mark" (amended 2026-10-09, C30: the
// website's terracotta "10x" tile) — the "Proof" list's items 1, 2 and 4, read from the doc at test
// time so the doc is the one copy. Items 3, 5 and 7 (rendered: sign-in, the rail, Ten's avatar, the
// accessible name) are tests/web/stage1-foundation.test.ts and the e2e "brand" section.
//
//   node --test tests/web/brand-mark-10x.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SECTION = DOC.slice(DOC.indexOf("#### The brand mark"), DOC.indexOf("#### Component states"));
const fence = (lang: string) => {
  const m = SECTION.match(new RegExp("```" + lang + "\\n([\\s\\S]*?)```"));
  assert.ok(m, `no ${lang} fence in § 5.6 "The brand mark"`);
  return m![1];
};
const DOC_MARK_D = /<path fill="var\(--on-brand\)" d="([^"]+)"/.exec(fence("html"))![1];
const DOC_FAV = fence("svg").trim();
const DOC_FAV_D = /d="([^"]+)"/.exec(DOC_FAV)![1];

const BRAND_MARK = readFileSync(path.join(WEB, "src/components/BrandMark.tsx"), "utf8");
const FAVICON = readFileSync(path.join(WEB, "public/favicon.svg"), "utf8");
const CSS = readFileSync(path.join(WEB, "src/styles.css"), "utf8");
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, ""); // the stylesheet without its comments

/** Every file under a directory, skipping build output. */
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "dist") continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);

test("proof 1: the doc's path lengths are as it says (2672 and 1373), so the doc was read whole", () => {
  assert.equal(DOC_MARK_D.length, 2672);
  assert.equal(DOC_MARK_D.slice(0, 19), "M10.1 20.4L3.4 20.4");
  assert.ok(DOC_MARK_D.endsWith("28.6 19.9Z"));
  assert.equal(DOC_FAV_D.length, 1373);
  assert.ok(DOC_FAV_D.startsWith("M13.3 22.7L3.1 22.7") && DOC_FAV_D.endsWith("23.6 20.3Z"));
});

test("proof 1: BrandMark.tsx's path d is the doc's, byte for byte; the tile and the markup are the doc's", () => {
  const ds = [...BRAND_MARK.matchAll(/"(M[0-9][^"]*Z)"/g)].map((m) => m[1]);
  assert.deepEqual(ds, [DOC_MARK_D], "exactly one path string, equal to the doc's");
  assert.match(BRAND_MARK, /<path fill="var\(--on-brand\)" d=\{MARK_PATH\} \/>/);
  assert.match(BRAND_MARK, /<rect width="32" height="32" rx="8\.5" fill="var\(--brand\)" \/>/);
  assert.match(BRAND_MARK, /viewBox="0 0 32 32"/);
  assert.match(BRAND_MARK, /role="img"/);
  assert.match(BRAND_MARK, /aria-label="Ten"/);
  assert.equal((BRAND_MARK.match(/<rect\b/g) ?? []).length, 1, "its only <rect> is the 32 by 32 tile");
});

test("proof 1: favicon.svg is the doc's favicon byte for byte, with the hex written in", () => {
  assert.equal(FAVICON.trim(), DOC_FAV);
  assert.equal(/ d="([^"]+)"/.exec(FAVICON)![1], DOC_FAV_D);
  assert.match(FAVICON, /rx="8\.5" fill="#C15F3C"/);
  assert.match(FAVICON, /<path fill="#FFFFFF"/);
});

test("proof 2: the token block has --brand #C15F3C and --on-brand #FFFFFF, and the dark block adds nothing", () => {
  const darkAt = RULES.indexOf('[data-theme="dark"] {');
  const root = RULES.slice(RULES.indexOf(":root {"), darkAt);
  assert.match(root, /--brand:\s*#C15F3C;/);
  assert.match(root, /--on-brand:\s*#FFFFFF;/);
  const dark = RULES.slice(darkAt).split("\n}")[0];
  assert.ok(!/--brand|--on-brand/.test(dark), "dark inherits the same values");
  // the doc's own token block and table say the same
  assert.match(SECTION, /\| `--brand` \| `#C15F3C` \| `#C15F3C` \|/);
  assert.match(SECTION, /\| `--on-brand` \| `#FFFFFF` \| `#FFFFFF` \|/);
});

test("proof 2: #C15F3C and the brand tokens are used by the mark's tile and nowhere else (the favicon carries the hex)", () => {
  const files = [...walk(path.join(WEB, "src")), ...walk(path.join(WEB, "public")), path.join(WEB, "index.html")].filter((f) => !isTest(f));
  const hex = files.filter((f) => /#C15F3C/i.test(readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f)).sort();
  assert.deepEqual(hex, ["public/favicon.svg", "src/styles.css"]);
  const css = (CSS.match(/#C15F3C/gi) ?? []).length;
  assert.equal(css, 1, "styles.css has the hex once, in the token definition");
  const uses = files.filter((f) => /var\(--brand\)|var\(--on-brand\)/.test(readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f));
  assert.deepEqual(uses, ["src/components/BrandMark.tsx"]);
});

test("proof 4: no leftover of the old mark in BrandMark.tsx, favicon.svg or styles.css", () => {
  for (const bad of ["<ellipse", "var(--lime)", "var(--hero)", "var(--on-hero)"]) assert.ok(!BRAND_MARK.includes(bad), `BrandMark.tsx has ${bad}`);
  for (const bad of ["ellipse", "#0A0A0B", "#C8F03C", "stroke"]) assert.ok(!FAVICON.toLowerCase().includes(bad.toLowerCase()), `favicon.svg has ${bad}`);
  assert.ok(!/"1" bar|oval "0"/.test(BRAND_MARK), "the header comment no longer describes the old mark");
  assert.ok(!/--hero:[^\n]*the mark's tile/.test(CSS), "the --hero comment no longer says the mark's tile");
  assert.ok(!/border-radius:\s*11px/.test(CSS.slice(CSS.indexOf(".avatar-mark::after {"), CSS.indexOf(".avatar-mark::after {") + 200)), "the ring's radius is no longer the old tile's 11px");
  assert.match(CSS.slice(CSS.indexOf(".avatar-mark::after {"), CSS.indexOf(".avatar-mark::after {") + 200), /border-radius:\s*10\.5px/);
});

test("proof 4: nothing inverts the mark on the --hero band, and no other file draws a mark", () => {
  assert.ok(!/\.mark[^{]*\{[^}]*(filter|invert)/.test(RULES), "a rule on .mark applies a filter");
  assert.ok(!/(hero|band)[^{}]*\.mark|\.mark[^{}]*(hero|band)/.test(RULES), "a rule ties the mark to the hero band");
  const src = walk(path.join(WEB, "src")).filter((f) => !isTest(f) && /\.(tsx|ts)$/.test(f));
  const drawers = src.filter((f) => /class(Name)?="mark"/.test(readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f));
  assert.deepEqual(drawers, ["src/components/BrandMark.tsx"], "one place draws the mark");
  for (const f of ["index.html", "public/terms.html", "public/privacy.html"]) {
    const t = readFileSync(path.join(WEB, f), "utf8");
    assert.ok(!/C8F03C|ellipse/i.test(t), `${f} carries the old mark`);
  }
});

test("rule 5 of C30: `utm_` appears nowhere under apps/web/src outside tests (the create link's tags are never read)", () => {
  const hits = walk(path.join(WEB, "src")).filter((f) => !isTest(f) && /utm_/.test(readFileSync(f, "utf8")));
  assert.deepEqual(hits, []);
});
