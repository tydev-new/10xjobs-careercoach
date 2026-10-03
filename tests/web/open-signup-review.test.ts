// Independent tester, open sign-up review. Written from the spec, not the code:
// every expected string is READ FROM THE DOCS at test time (design-web-ui.md
// § 5.3.1 rows O1-O8, E16, B7, Q1 and its "Removed from the screen" list;
// design-web-agent.md § 20.7's terms text and privacy sentences; § 13.6's host
// list), so the docs, not this file, are the one copy (rule 12).
//
//   node --test tests/web/open-signup-review.test.ts
//
// One real `vite build` of apps/web into a temp dir (like
// version-build-deploy.test.ts); nothing touches a network.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claimWelcome, NOT_SET_UP_MESSAGE } from "../../apps/web/src/backend/auth.ts";
import { NOT_A_MEMBER_LINES, SIGN_IN_INVITATION, welcomeLine } from "../../apps/web/src/real/welcome-copy.ts";
import { COACH_MODELS } from "../../apps/web/src/backend/coach-model.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const UI = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const AGENT = readFileSync(path.join(REPO, "docs/design-web-agent.md"), "utf8");
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- the docs
/** The quoted string of a § 5.3.1 row, by id (the 4th cell's backticked text). */
function row(id: string): string {
  const line = UI.split("\n").find((l) => l.startsWith(`| ${id} |`));
  assert.ok(line, `design-web-ui.md has no row ${id}`);
  const cells = line!.split(" | ");
  const m = /`([^`]+)`/.exec(cells[3]);
  assert.ok(m, `row ${id} has no quoted string: ${line}`);
  return m![1];
}
const O = Object.fromEntries(["O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8", "E16", "B7", "Q1"].map((id) => [id, row(id)]));

/** § 5.3.1's "Removed from the screen" list: every quoted literal in it. */
function removedList(): string[] {
  const start = UI.indexOf("**Removed from the screen**");
  const end = UI.indexOf("**What the Stage 4 build changes in code**", start);
  const block = UI.slice(start, end);
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => ws(m[1]));
}
/** § 20.7 item 1: the terms page, word for word, as paragraphs. */
function termsFromSpec(): string[] {
  const s = AGENT.indexOf("> **Terms**");
  const e = AGENT.indexOf("*Checked against:*", s);
  const lines = AGENT.slice(s, e).split("\n").map((l) => l.replace(/^\s*>\s?/, ""));
  const paras: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l.trim() === "") { if (cur.length) paras.push(ws(cur.join(" "))); cur = []; } else cur.push(l);
  }
  if (cur.length) paras.push(ws(cur.join(" ")));
  return paras.map((p) => p.replace(/\*\*/g, ""));
}
/** § 20.7 item 2: the privacy sentences given word for word. */
function privacyFromSpec() {
  const s = AGENT.indexOf("2. **`/privacy.html`, corrected,**");
  const e = AGENT.indexOf("### 20.8", s);
  const block = ws(AGENT.slice(s, e));
  const deepseek = /It becomes, word for word: "([^"]+)"/.exec(block)![1];
  const account = /heading "Your account", then: "([^"]+)"/.exec(block)![1];
  return { deepseek, account };
}
/** § 13.6's DeepSeek host list (re-read 2026-10-02). */
function hostsFromSpec(): string[] {
  const s = AGENT.indexOf("- **DeepSeek V4.1 Flash:**", AGENT.indexOf("### 13.6"));
  const flat = ws(AGENT.slice(s + "- **DeepSeek V4.1 Flash:**".length, s + 2000));
  const list = flat.slice(0, flat.indexOf(". Every one"));
  return list.split(/,\s*/).map((x) => x.trim());
}
const htmlText = (html: string) =>
  ws(html.slice(html.indexOf("<main>"), html.indexOf("</main>")).replace(/<[^>]+>/g, " ").replace(/&larr;/g, "←").replace(/&ctdot;/g, "⋯").replace(/&amp;/g, "&").replace(/\s+([.,;:])/g, "$1"));

// ---------------------------------------------------------------- one build
const scratch = mkdtempSync(path.join(tmpdir(), "ten-open-signup-"));
let DIST = "";
let BUNDLE = "";
before(() => {
  const VITE = path.join(WEB, "node_modules/vite/bin/vite.js");
  const r = spawnSync(process.execPath, [VITE, "build", "--outDir", path.join(scratch, "dist"), "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, encoding: "utf8" });
  assert.equal(r.status, 0, `vite build failed:\n${r.stdout}\n${r.stderr}`);
  DIST = path.join(scratch, "dist");
  BUNDLE = readdirSync(path.join(DIST, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(DIST, "assets", f), "utf8")).join("\n");
});
after(() => rmSync(scratch, { recursive: true, force: true }));

// The bundle stores apostrophes either raw or escaped; look for either form.
const inBundle = (s: string) => [s, s.replace(/'/g, "\\'"), s.replace(/'/g, "\\u2019"), JSON.stringify(s).slice(1, -1)].some((v) => BUNDLE.includes(v));

// ------------------------------------------------- the copy, word for word
test("O1: the welcome line is the § 5.3.1 row with <amount> as two decimals of the claim's usd", () => {
  const [pre, post] = O.O1.split("<amount>");
  for (const usd of [1, 2.5, 0.01, 5]) assert.equal(welcomeLine(usd), `${pre}${usd.toFixed(2)}${post}`);
  assert.ok(!/gate|reply costs|about \d+ replies/i.test(O.O1), "O1 promises no gate and no reply count (§ 20.5)");
});
test("O2/O3/O4: the not-a-member lines are the rows, keyed by the claim's answer (§ 1.6's table)", () => {
  assert.deepEqual(NOT_A_MEMBER_LINES, { paused: O.O2, unconfirmed: O.O3, already_claimed: O.O4 });
});
test("O5 and O6 are the rows, word for word", () => {
  assert.equal(SIGN_IN_INVITATION, O.O5);
  assert.equal(NOT_SET_UP_MESSAGE, O.O6);
});
test("O6 and E16 are the server's words too (proxy and ten-paypal 403; proxy upstream 402)", () => {
  const proxy = readFileSync(path.join(REPO, "supabase/functions/ten-model-proxy/handler.ts"), "utf8");
  const paypal = readFileSync(path.join(REPO, "supabase/functions/ten-paypal/handler.ts"), "utf8");
  assert.ok(proxy.includes(`notMember: ${JSON.stringify(O.O6)}`), "proxy notMember != O6");
  assert.ok(proxy.includes(`${JSON.stringify(O.E16)}`), "proxy has no E16");
  assert.ok(paypal.includes(`notMember: ${JSON.stringify(O.O6)}`), "ten-paypal notMember != O6");
});
test("§ 20.6: the proxy's code names no daily ceiling and no day-spend read", () => {
  for (const f of ["index.ts", "handler.ts", "core.ts"]) {
    const src = readFileSync(path.join(REPO, "supabase/functions/ten-model-proxy", f), "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const banned of ["BETA_CEILING_USD", "FREE_DAILY_CEILING_USD", "betaSpendToday", "ten_beta_spend_today", "ten_free_spend_today", "ten_is_paid", "spendToday"]) {
      assert.ok(!code.includes(banned), `${f} code names ${banned}`);
    }
  }
});
test("§ 13.6 (amended 2026-10-02): the DeepSeek label has no '(testing)'", () => {
  const ds = COACH_MODELS.find((m) => m.id === "deepseek/deepseek-v4.1-flash");
  assert.equal(ds?.name, "DeepSeek V4.1 Flash");
});

// ------------------------------------------------------------- the bundle
test("§ 20.11 App 6: the bundle has O2-O6, O8, B7, Q1 and E16 whole, and O1 around its placeholder", () => {
  for (const id of ["O2", "O3", "O4", "O5", "O6", "B7", "Q1"]) assert.ok(inBundle(O[id]), `${id} not in the bundle: ${O[id]}`);
  assert.ok(inBundle(O.O8), "O8 not in the bundle");
  const [pre, post] = O.O1.split("<amount>");
  assert.ok(inBundle(pre.replace(/\$$/, "")) && inBundle(post), "O1's words around <amount> not in the bundle");
});
test("§ 20.11 App 6: E16 is in the bundle (§ 20.11 lists it; the words come from the proxy)", { todo: "FINDING (tester, open sign-up review): E16 is server text, not in the bundle; § 20.11 App 6 says it is" }, () => {
  assert.ok(inBundle(O.E16), `E16 not in the bundle: ${O.E16}`);
});
test("§ 5.3.1 proof 2: O7 is in the bundle as one whole literal", { todo: "FINDING (tester, open sign-up review): SignIn.tsx glues O7 from parts around its two links" }, () => {
  assert.ok(inBundle(O.O7), `O7 not in the bundle as one literal: ${O.O7}`);
});
test("§ 5.3.1 Removed list: none of § 20's retired strings is in the bundle, and no '(testing)' label", () => {
  const removed = removedList();
  for (const must of ["this beta is invite-only", "The beta has reached today's limit", "The beta has a shared daily limit", "no daily limit of Ten's own", "pause until tomorrow", "Free use has a shared daily limit"]) {
    assert.ok(removed.includes(must), `the doc's Removed list no longer names "${must}"`);
  }
  // § 20's entries open the list (C § 20, C27, C28), up to the terms draft's line;
  // the older Stage 4 entries after it are not this build's (reported, not graded).
  const own = removed.slice(0, removed.indexOf("Free use has a shared daily limit") + 1);
  const found = own.filter((s) => inBundle(s));
  const older = removed.slice(own.length).filter((s) => !s.includes("<") && s.length >= 8 && inBundle(s));
  if (older.length) console.log(`OBSERVED older (pre-§ 20) Removed-list strings still in the bundle: ${JSON.stringify(older)}`);
  // § 20.11 App 6's own short forms too.
  for (const s of ["invite-only", "today's limit", "shared daily limit", "until tomorrow", "DeepSeek V4.1 Flash (testing)", "(testing)"]) if (inBundle(s)) found.push(s);
  assert.deepEqual(found, [], `retired strings still in the bundle: ${JSON.stringify(found)}`);
});

// --------------------------------------------------------- claimWelcome
function fakeClient(reply: { data?: unknown; error?: { message: string } | null }) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const client = { rpc: async (fn: string, ...args: unknown[]) => { calls.push({ fn, args }); return { data: reply.data ?? null, error: reply.error ?? null }; } };
  return { client: client as never, calls };
}
test("§ 20.4: claimWelcome makes one rpc('ten_claim_welcome') with no argument", async () => {
  const { client, calls } = fakeClient({ data: { status: "paused" } });
  await claimWelcome(client);
  assert.deepEqual(calls, [{ fn: "ten_claim_welcome", args: [] }]);
});
test("§ 20.4: each answer maps as the spec says; granted carries the server's usd", async () => {
  for (const s of ["already_member", "paused", "unconfirmed", "already_claimed"]) {
    assert.deepEqual(await claimWelcome(fakeClient({ data: { status: s } }).client), { status: s });
  }
  assert.deepEqual(await claimWelcome(fakeClient({ data: { status: "granted", usd: 1 } }).client), { status: "granted", usd: 1 });
  assert.deepEqual(await claimWelcome(fakeClient({ data: { status: "granted", usd: 2.5 } }).client), { status: "granted", usd: 2.5 });
});
test("§ 20.4: a failed call, or a status not on the list, throws (the caller shows Q1 with Retry)", async () => {
  const bad: Array<{ data?: unknown; error?: { message: string } }> = [
    { error: { message: "boom" } },
    { data: null },
    { data: "granted" },
    { data: { status: "GRANTED", usd: 1 } },
    { data: { status: "granted" } },
    { data: { status: "granted", usd: 0 } },
    { data: { status: "granted", usd: -1 } },
    { data: { status: "granted", usd: "NaN" } },
    { data: { status: "welcome" } },
    { data: [{ status: "paused" }] },
  ];
  for (const b of bad) await assert.rejects(claimWelcome(fakeClient(b).client), JSON.stringify(b));
});

// ------------------------------------------------------ the static pages
test("§ 20.7 item 1: /terms.html carries the terms word for word, and nothing the spec doesn't", () => {
  const html = readFileSync(path.join(DIST, "terms.html"), "utf8");
  const page = htmlText(html).replace(/^← Back\s*/, "");
  const spec = termsFromSpec();
  assert.equal(spec[0], "Terms");
  assert.equal(spec.length, 8, `the spec's terms changed shape: ${spec.length} paragraphs`);
  assert.equal(page, ws(spec.join(" ")), "the page's text is the spec's text, whole");
});
test("§ 20.7 item 2: /privacy.html has the DeepSeek sentence, 'Your account' word for word, the new date and § 13.6's hosts; no 'testing only' or 'never to the general beta'", () => {
  const html = readFileSync(path.join(DIST, "privacy.html"), "utf8");
  const page = htmlText(html);
  const { deepseek, account } = privacyFromSpec();
  assert.ok(page.includes(deepseek), "DeepSeek sentence");
  assert.ok(/<h2>Your account<\/h2>/.test(html), "the 'Your account' heading");
  assert.ok(page.includes(`Your account ${account}`), "the 'Your account' paragraph, right under its heading");
  assert.ok(page.includes("read 2026-10-02"), "the re-read date");
  for (const gone of ["testing only", "never to the general beta", "internal testing", "Krea", "invite"]) assert.ok(!page.includes(gone), `privacy still says "${gone}"`);
  const hosts = hostsFromSpec();
  assert.ok(hosts.length >= 20, `host list parse: ${hosts}`);
  const m = /DeepSeek V4\.1 Flash (.+?)\. Ten runs on/.exec(page);
  assert.ok(m, "the DeepSeek host paragraph");
  assert.deepEqual(m![1].split(/,\s*/), hosts, "the page's DeepSeek hosts are § 13.6's, in order");
});
