// Tester-owned: workspace Stage 3b, the Jobs page — docs/design-web-ui.md
// § 5.9 Stage 3b's exit and tester checks, § 5.3 "Jobs: the pipeline
// record" (the list, the detail, "Reads"/"Parsed by", the store adapter),
// § 5.3 "Pieces the pages share" (`splitSections`), § 5.2 rules 1, 2, 4,
// 6, 7 and 8, § 5.3.1's J, P, H and F rows, § 5.4 ("Ask Ten about this",
// "Open application"), § 5.5 at 375 and § 5.7's fixture. Every expected
// value is read from the spec text or computed here from the fixture's raw
// files by this file's own spec-derived parsing — independently of the
// builder's apps/web/src/workspace/jobs*.test.ts and sections.test.ts.
//
// Two layers:
//   - node-only: the store adapter (`store-io.ts`) on the stores the app
//     really runs on, `splitSections`' table, § 5.2 rule 7's table, `load()`
//     over the fixture field by field, the verdict card's `ref` (C § 6.2);
//   - headless Chromium: the REAL RealChatShell (Frame, JobsPage,
//     SidePanel) on the real packages/agent in-memory WorkspaceStore behind
//     a spy (tests/web/stage3b-review/harness.tsx, a copy of 3a's), and the
//     mock preview build for the bundle check.
//
// Run: node --test tests/web/stage3b-review.test.ts
// Screenshots: STAGE3B_SHOTS=<dir> (1440x900 and 375x812).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "../../apps/web/node_modules/playwright/index.mjs";
import { textReply } from "../agent/_openrouter_stub.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import { WorkspaceError as AgentWorkspaceError } from "../../packages/agent/src/types.ts";
import { CardBuilder } from "../../packages/agent/src/cards.ts";
import { WorkspaceError as WebWorkspaceError } from "../../apps/web/src/types.ts";
import { storeIo } from "../../apps/web/src/workspace/store-io.ts";
import { pickSection, splitSections } from "../../apps/web/src/workspace/sections.ts";
import { dismissedRows, groupJobsByStage, loadFieldFile, loadJobsRows, safeHref } from "../../apps/web/src/workspace/jobs.ts";
import { buildAskTenDraft } from "../../apps/web/src/workspace/ask-ten.ts";
import { matchGateReply } from "../../packages/agent/src/helpers.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const HARNESS = path.join(REPO, "tests/web/stage3b-review");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.STAGE3B_SHOTS;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const fx = (n: string) => JSON.parse(readFileSync(path.join(WEB, "fixtures", `${n}.json`), "utf8"));
const FILES = fx("workspace-pages").files as Record<string, string>;

// ---------------------------------------------------------------- spec text

/** § 5.3.1's table rows: # | Page | Where it shows | String. */
const ROWS = new Map<string, string>();
for (const line of DOC.split("\n")) {
  const m = line.match(/^\| ([A-Z]\d+) \| [^|]+ \| [^|]+ \| `([^`]*)` \|/);
  if (m) ROWS.set(m[1], m[2]);
}
const S = (id: string) => {
  const s = ROWS.get(id);
  assert.ok(s !== undefined, `§ 5.3.1 has no row ${id}`);
  return s!;
};
/** § 5.3: STAGES, "the port's own order", spelled in the spec. */
const STAGES_SPEC = DOC.match(/`STAGES`: (To Review, Interested, Applied, Interviewing, Offer)\)/)![1].split(", ");
/** § 2.1 / § 5.6 tier pills (P5-P8), keyed by record_verdict's enum. */
const TIER: Record<string, string> = { strong: S("P5"), investable_stretch: S("P6"), long_shot: S("P7"), weak: S("P8") };
/** § 5.2 rule 6's loud line (F40) and its button (F41). */
const COULDNT = (p: string) => S("F40").replace("<path>", p);
const MISSING_LINE = (p: string) => S("J13").replace("<path>", p);

// ---------------------------------------------------------------- the file, read by the spec

interface SpecRow {
  heading: string;
  company: string;
  title: string;
  group: string; // the `## ` heading it sits under
  fields: Map<string, string>;
}
/** The raw `jobs.md`, read the way § 5.9's exit words it: every `### ` role
 *  under a stage heading (and the Dismissed heading), with its
 *  `- Label: value` lines. Deliberately not `load()`. */
function specRows(md: string): SpecRow[] {
  const out: SpecRow[] = [];
  let group = "";
  let cur: SpecRow | null = null;
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      group = h2[1].trim();
      cur = null;
      continue;
    }
    const h3 = line.match(/^### (.+?) — (.+)$/);
    if (h3) {
      cur = { heading: `${h3[1]} — ${h3[2]}`, company: h3[1], title: h3[2], group, fields: new Map() };
      out.push(cur);
      continue;
    }
    const f = line.match(/^- ([^:]+): (.*)$/);
    if (f && cur) cur.fields.set(f[1], f[2]);
  }
  return out.filter((r) => STAGES_SPEC.includes(r.group) || r.group === "Dismissed");
}
const JOBS = specRows(FILES["jobs.md"]);
const datePart = (iso: string | undefined) => (iso ? iso.slice(0, 10) : undefined);

/** What § 5.3 says a row shows, as strings that must each appear in it. */
function rowStrings(r: SpecRow): { must: string[]; mustNot: string[] } {
  const f = r.fields;
  const must = [r.heading];
  const mustNot: string[] = [];
  const v = f.get("Verdict");
  must.push(v ? (TIER[v] ?? v) : S("J1"));
  if (f.get("Score")) must.push(S("P10").replace("<n>", f.get("Score")!));
  if (f.get("Location")) must.push(f.get("Location")!);
  if (f.get("Posted")) must.push(`${S("J4")} ${datePart(f.get("Posted"))}`);
  if (f.get("Reason")) must.push(f.get("Reason")!);
  if (f.get("Reason")?.startsWith("quick-scan:")) must.push(S("P9"));
  else mustNot.push(S("P9"));
  if (v) must.push(S("J2"), f.get("Dealbreakers") ?? S("J3"));
  if (f.get("Seen")) must.push(`${S("H12")} ${datePart(f.get("Seen"))}`);
  if (f.get("Updated")) must.push(`${S("H13")} ${datePart(f.get("Updated"))}`);
  if (r.group === "Dismissed") {
    if (f.get("Dismissed")) must.push(f.get("Dismissed")!);
    must.push(S("J5").replace("<stage>", f.get("Was") ?? "To Review"));
  }
  must.push(f.get("Analysis") ? S("J6") : S("J7"));
  must.push(S("P1"));
  return { must, mustNot };
}

/** § 5.3 "Pieces the pages share", from the spec text alone: a section
 *  starts at a `## ` line; its heading is the rest, trimmed; its body is
 *  every line after it up to the next `## ` or `# ` line or the end;
 *  CRLF normalised. */
function specSections(md: string): { heading: string; body: string }[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: { heading: string; body: string }[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  const flush = () => cur && out.push({ heading: cur.heading, body: cur.lines.join("\n") });
  for (const l of lines) {
    if (l.startsWith("## ")) {
      flush();
      cur = { heading: l.slice(3).trim(), lines: [] };
    } else if (l.startsWith("# ")) {
      flush();
      cur = null;
    } else if (cur) cur.lines.push(l);
  }
  flush();
  return out;
}
const specPick = (md: string, prefix: string) => specSections(md).find((s) => s.heading.startsWith(prefix));

// ================================================================= node-only

test("§ 5.3 store adapter: `exists` is false on a missing read on the stores the app runs on (packages/agent's in-memory store — the Supabase store throws the same class), false on the web's own WorkspaceError, and a failing read is thrown; readFile returns the text; writeFile throws", async () => {
  const bad: string[] = [];
  // 1. the real in-memory store (packages/agent) — RealChatShell's own store in tests,
  //    and the SAME WorkspaceError class supabase-workspace-store.ts throws in production.
  const agentStore = createInMemoryWorkspaceStore({ "jobs.md": "# Pipeline\n" });
  try {
    const e = await storeIo(agentStore as any).exists("jd-analysis/nope.md");
    if (e !== false) bad.push(`agent store, missing: exists = ${e}`);
  } catch (err) {
    bad.push(`agent store, missing: exists THREW ${(err as any).name}/${(err as any).code} — a missing file is not "false" (§ 5.3: "false on resource_missing")`);
  }
  if ((await storeIo(agentStore as any).exists("jobs.md")) !== true) bad.push("agent store: exists(jobs.md) is not true");
  if ((await storeIo(agentStore as any).readFile("jobs.md")) !== "# Pipeline\n") bad.push("readFile did not return the text");
  // 2. a store throwing the web package's own class
  const webMissing = { read: async (p: string) => { throw new WebWorkspaceError("resource_missing", `${p} does not exist.`); } };
  try {
    if ((await storeIo(webMissing as any).exists("x.md")) !== false) bad.push("web-class missing: not false");
  } catch (err) {
    bad.push(`web-class missing: THREW ${(err as any).code}`);
  }
  // 3. a failing (non-missing) read is thrown, never "false"
  for (const failing of [new Error("HTTP 500"), new AgentWorkspaceError("outside_workspace", "no"), new WebWorkspaceError("invalid_ref", "no")]) {
    const store = { read: async () => { throw failing; } };
    try {
      const e = await storeIo(store as any).exists("jobs.md");
      bad.push(`failing read (${failing.message}): exists returned ${e}, § 5.3 wants it thrown`);
    } catch (err) {
      if (err !== failing) bad.push(`failing read: a different error was thrown`);
    }
  }
  // 4. writeFile throws (pages never write, § 5.2 rule 1)
  await assert.rejects(() => storeIo(agentStore as any).writeFile("jobs.md", "x"));
  assert.deepEqual(bad, []);
});

test("§ 5.3 Jobs: `load()` over the store adapter on a workspace with NO jobs.md (packages/agent's in-memory store) is no rows, never a thrown error — 'Missing is empty' (§ 5.2 rule 6)", async () => {
  const store = createInMemoryWorkspaceStore({});
  let rows: unknown;
  try {
    rows = await loadJobsRows(storeIo(store as any));
  } catch (err) {
    assert.fail(`load() threw ${(err as any).name}/${(err as any).code} on a missing jobs.md`);
  }
  assert.deepEqual(rows, []);
});

test("§ 5.3 Jobs detail table: a field naming a missing file, a failing read, and a file with none of the headings — on the store the app runs on", async () => {
  const store = createInMemoryWorkspaceStore({ "company/plain.md": "# Plain\n\nNo sections here.\n" });
  const missing = await loadFieldFile(store as any, "jd-analysis/gone.md");
  assert.deepEqual(missing, { kind: "missing", path: "jd-analysis/gone.md" }, "a missing file must be the J13 'isn't in your workspace' case, not an error");
  // the Supabase store throws packages/agent's class; any error whose code is resource_missing is "missing"
  const agentClass = await loadFieldFile({ read: async (p: string) => { throw new AgentWorkspaceError("resource_missing", `${p} does not exist.`); } } as any, "company/x.md");
  assert.deepEqual(agentClass, { kind: "missing", path: "company/x.md" }, "packages/agent's WorkspaceError(resource_missing) must be the J13 case");
  const ducked = await loadFieldFile({ read: async () => { throw Object.assign(new Error("gone"), { code: "resource_missing" }); } } as any, "company/y.md");
  assert.deepEqual(ducked, { kind: "missing", path: "company/y.md" }, "an error whose code is resource_missing must be the J13 case");
  const failing = await loadFieldFile({ read: async () => { throw new Error("HTTP 500"); } } as any, "company/x.md");
  assert.equal(failing.kind, "error");
  const none = await loadFieldFile(store as any, "company/plain.md");
  assert.equal(none.kind, "ready");
  assert.equal((none as any).sections.length, 0);
});

test("§ 5.3 'Pieces the pages share': splitSections' table — all of evaluate's headings, a `### ` inside a section, `## Fit assessment (Track A lens)` by prefix, an absent heading, CRLF, no `## ` line, a `# ` line ending a section", () => {
  const all = [
    "# Acme — Staff PM: decode (2026-09-28)",
    "Preamble line, in no section.",
    "",
    "## Competency extraction",
    "1. Platform ownership — HIGH",
    "### A sub-heading stays inside",
    "2. Partner APIs — MEDIUM",
    "",
    "## Fit assessment (Track A lens)",
    "- Requirement coverage: Strong.",
    "",
    "## Verdict: **Strong Fit — 91/100**",
    "Reasoning.",
    "# A top-level heading ends the section",
    "tail text in no section",
    "## Snapshot",
    "- Stage: Series B (Verified: example.com)",
  ].join("\n");
  const got = splitSections(all);
  assert.deepEqual(got, specSections(all));
  assert.deepEqual(got.map((s) => s.heading), ["Competency extraction", "Fit assessment (Track A lens)", "Verdict: **Strong Fit — 91/100**", "Snapshot"]);
  assert.equal(got[0].body, "1. Platform ownership — HIGH\n### A sub-heading stays inside\n2. Partner APIs — MEDIUM\n");
  assert.equal(got[2].body, "Reasoning.");
  assert.equal(pickSection(got, "Fit assessment")?.body, "- Requirement coverage: Strong.\n");
  assert.equal(pickSection(got, "Culture & hiring signals"), undefined);
  assert.equal(pickSection(got, "fit assessment"), undefined, "case-sensitive");
  // CRLF
  const crlf = all.replace(/\n/g, "\r\n");
  assert.deepEqual(splitSections(crlf), got);
  // no `## ` line; `##` without the space is not a section
  assert.deepEqual(splitSections("# Title\n\nJust prose.\n##NoSpace\n"), []);
  // heading trimmed
  assert.equal(splitSections("##   Snapshot   \nx")[0].heading, "Snapshot");
  // U+2028 inside a body survives (restoreLineSeparators)
  assert.equal(splitSections("## A\nx y\n")[0].body, "x y\n");
});

test("§ 5.2 rule 7's table (function): only `https://` / `http://` become a link — `javascript:alert(1)`, `data:text/html,…`, ` https://x` (leading space) do not; a normal https URL does", () => {
  const table: [string, boolean][] = [
    ["javascript:alert(1)", false],
    ["data:text/html,<script>alert(1)</script>", false],
    [" https://x", false],
    ["JAVASCRIPT:alert(1)", false],
    ["https://jobs.example.com/staff-pm", true],
    ["http://jobs.example.com/staff-pm", true],
  ];
  for (const [url, link] of table) assert.equal(safeHref(url) !== undefined, link, url);
});

test("§ 5.9 3b tester check: `load()` over the § 5.7 fixture, field by field, equals the file's own `### ` roles and `- Label:` lines (read here without load())", async () => {
  const store = createInMemoryWorkspaceStore({ "jobs.md": FILES["jobs.md"] });
  const rows = (await loadJobsRows(storeIo(store as any))) as any[];
  const bad: string[] = [];
  if (rows.length !== JOBS.length) bad.push(`load() ${rows.length} rows, the file has ${JOBS.length}`);
  const FIELD: Record<string, string> = {
    URL: "url", Location: "location", Posted: "posted_at", Seen: "seen_at", Updated: "updated_at", Verdict: "fit_verdict",
    Reason: "fit_reason", Dealbreakers: "dealbreakers", Analysis: "analysis_file", "Company file": "company_file",
    Evaluated: "evaluated_at", Was: "was_stage", Dismissed: "dismiss_note",
  };
  JOBS.forEach((s, i) => {
    const r = rows[i];
    if (!r) return;
    if (r.company !== s.company || r.title !== s.title) bad.push(`#${i}: ${r.company} — ${r.title} != ${s.heading}`);
    if ((s.group === "Dismissed") !== !!r.dismissed) bad.push(`${s.heading}: dismissed ${r.dismissed}`);
    if (s.group !== "Dismissed" && r.stage !== s.group) bad.push(`${s.heading}: stage ${r.stage} != ${s.group}`);
    for (const [label, key] of Object.entries(FIELD)) {
      const want = s.fields.get(label) ?? null;
      if ((r[key] ?? null) !== want) bad.push(`${s.heading}: ${label} ${JSON.stringify(r[key])} != ${JSON.stringify(want)}`);
    }
    const score = s.fields.get("Score");
    if ((r.fit_score ?? null) !== (score === undefined ? null : Number(score))) bad.push(`${s.heading}: Score ${r.fit_score} != ${score}`);
  });
  // The page's grouping readers, on the same rows: STAGES order, file order, Dismissed apart.
  const groups = groupJobsByStage(rows as any);
  const wantGroups = STAGES_SPEC.map((st) => ({ stage: st, rows: JOBS.filter((j) => j.group === st).map((j) => j.heading) })).filter((g) => g.rows.length);
  assert.deepEqual(groups.map((g) => ({ stage: g.stage, rows: g.rows.map((r) => `${r.company} — ${r.title}`) })), wantGroups);
  assert.deepEqual(dismissedRows(rows as any).map((r) => `${r.company} — ${r.title}`), JOBS.filter((j) => j.group === "Dismissed").map((j) => j.heading));
  assert.deepEqual(bad, []);
});

test("§ 5.7 fixture holds what 3b's exit needs: a role in each of the five stages plus a dismissed one, one row without Analysis, one quick-scan row, one Analysis naming a missing file, rows whose Analysis and Company file exist", () => {
  for (const st of STAGES_SPEC) assert.ok(JOBS.some((j) => j.group === st), `no role under ${st}`);
  assert.ok(JOBS.some((j) => j.group === "Dismissed"), "no dismissed role");
  assert.ok(JOBS.some((j) => !j.fields.get("Analysis")), "no row without Analysis");
  assert.ok(JOBS.some((j) => j.fields.get("Reason")?.startsWith("quick-scan:")), "no quick-scan row");
  assert.ok(JOBS.some((j) => j.fields.get("Analysis") && !(j.fields.get("Analysis")! in FILES)), "no Analysis naming a missing file");
  assert.ok(JOBS.some((j) => j.fields.get("Analysis")! in FILES && j.fields.get("Company file")! in FILES), "no row with both files");
});

test("§ 5.9 3b exit 'the detail's sections equal the fixture files' sections, string for string' (reader level): for every row, each named section splitSections/pickSection returns equals the file's section by § 5.3's rule", () => {
  const bad: string[] = [];
  let checked = 0;
  for (const j of JOBS) {
    for (const [field, prefixes] of [["Analysis", ["Competency extraction", "Fit assessment"]], ["Company file", ["Snapshot", "Culture & hiring signals"]]] as const) {
      const p = j.fields.get(field);
      if (!p || !(p in FILES)) continue;
      for (const prefix of prefixes) {
        const want = specPick(FILES[p], prefix);
        const got = pickSection(splitSections(FILES[p]), prefix);
        if (!want) bad.push(`${p}: the fixture has no "${prefix}" section`);
        else checked++;
        if (got?.body !== want?.body) bad.push(`${p} ${prefix}: body differs`);
      }
    }
  }
  assert.ok(checked >= 8, `only ${checked} sections checked`);
  assert.deepEqual(bad, []);
});

test("C § 6.2 / § 5.9 3b: the verdict card's `ref` is the row's `analysis_file` — never its `JD` (the raw posting); no Analysis, no ref, even when JD is set", async () => {
  const cb = new CardBuilder();
  const cmd = { command: 'node evaluate/scripts/record_verdict.mjs --workspace . --company Acme --title "Staff PM" --verdict strong --score 82 --reasons "x"' };
  const out = { stdout: "recorded (created NEW role): Acme — Staff PM → strong (82)", stderr: "", exitCode: 0, changed: ["jobs.md"] };
  const row = (extra: string[]) => ["## To Review", "", "### Acme — Staff PM", "- Verdict: strong", "- Score: 82", "- Reason: x", ...extra, ""].join("\n");
  const both = await cb.forToolResult("bash", cmd, out, createInMemoryWorkspaceStore({ "jobs.md": row(["- JD: jd-inbox/acme-staff-pm.md", "- Analysis: jd-analysis/acme-staff-pm.md"]) }) as any);
  assert.equal((both[0] as any).ref, "jd-analysis/acme-staff-pm.md");
  const jdOnly = await new CardBuilder().forToolResult("bash", cmd, out, createInMemoryWorkspaceStore({ "jobs.md": row(["- JD: jd-inbox/acme-staff-pm.md"]) }) as any);
  assert.equal((jdOnly[0] as any).card, "verdict");
  assert.equal((jdOnly[0] as any).ref, undefined, "a JD-only row must not give the card a ref");
});

test("§ 5.9 3b: mvp-journey.json's record_verdict passes `--analysis-file` (not `--jd-file`), and its verdict card's ref equals it", () => {
  const f = fx("mvp-journey");
  const parts = f.messages.flatMap((m: any) => m.parts ?? []);
  const rv = parts.filter((p: any) => p.type === "tool-bash" && /record_verdict\.mjs/.test(p.input?.command ?? ""));
  assert.ok(rv.length >= 1);
  for (const p of rv) {
    assert.doesNotMatch(p.input.command, /--jd-file/);
    assert.match(p.input.command, /--analysis-file (\S+)/);
  }
  const card = parts.find((p: any) => p.type === "data-card" && p.data?.card === "verdict");
  assert.equal(card.data.ref, rv[0].input.command.match(/--analysis-file (\S+)/)[1]);
});

test("§ 5.4 'Ask Ten about this' on a role: the draft is `About <Company> — <Title>: `, one line, <= 120 characters, and never passes the gate — including a company literally named yes", () => {
  const bad: string[] = [];
  for (const j of [...JOBS.map((x) => x.heading), "yes — yes", "Yes — PM", `${"A".repeat(150)} — Staff PM`]) {
    const d = buildAskTenDraft(j);
    const want = S("P2").replace("<label>", j);
    if (want.length <= 120 && d !== want) bad.push(`${j}: ${JSON.stringify(d)}`);
    if (d.length > 120 || /\n/.test(d) || !d.startsWith("About ")) bad.push(`${j}: shape ${JSON.stringify(d)}`);
    if (matchGateReply(d, "typed") !== "none") bad.push(`${j}: passes the gate`);
  }
  assert.deepEqual(bad, []);
});

test("§ 5.2 rules 1 and 4 (static half): the Jobs code calls no write/upload/send and no browser storage", () => {
  const bad: string[] = [];
  for (const f of ["src/components/JobsPage.tsx", "src/workspace/jobs.ts", "src/workspace/sections.ts", "src/workspace/store-io.ts"]) {
    const src = readFileSync(path.join(WEB, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    for (const re of [/\.write\(|\.upload\(|\.remove\(|\.delete\(/, /sendMessage|\.send\(|fetch\(/, /localStorage|sessionStorage|indexedDB/]) if (re.test(src)) bad.push(`${f}: ${re}`);
  }
  assert.deepEqual(bad, []);
});

// ================================================================= browser

let browser: Browser;
const servers: Server[] = [];
const tmp: string[] = [];
let mockDir = "";
let realBase = "";
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function serve(dir: string): Promise<string> {
  const s = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = path.join(dir, p === "/" ? "index.html" : p);
    if (!file.startsWith(dir) || !existsSync(file) || lstatSync(file).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  servers.push(s);
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as any).port}/`)));
}

before(async () => {
  mockDir = mkdtempSync(path.join(tmpdir(), "ten-stage3b-review-mock-"));
  tmp.push(mockDir);
  const b = spawnSync(process.execPath, [path.join(WEB, "node_modules/vite/bin/vite.js"), "build", "--outDir", mockDir, "--emptyOutDir", "--logLevel", "error"], { cwd: WEB, encoding: "utf8", env: { ...process.env, VITE_SHOW_MOCK_CONTROLS: "1" } });
  assert.equal(b.status, 0, `mock build failed:\n${b.stdout}\n${b.stderr}`);
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  const hOut = mkdtempSync(path.join(tmpdir(), "ten-stage3b-review-real-"));
  tmp.push(hOut);
  const { build } = (await import(path.join(WEB, "node_modules/vite/dist/node/index.js"))) as typeof import("vite");
  await build({ root: HARNESS, configFile: path.join(WEB, "vite.config.ts"), logLevel: "error", build: { outDir: hOut, emptyOutDir: true } });
  realBase = await serve(hOut);
  browser = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => {
  await browser?.close();
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };
const ctxFor = (vp: { width: number; height: number }): Promise<BrowserContext> =>
  browser.newContext({ viewport: vp, colorScheme: "light", reducedMotion: "reduce", hasTouch: vp.width < 500, timezoneId: "America/Los_Angeles" });

interface Real {
  page: Page;
  proxyHits: number;
  release: () => void;
}
async function openReal(ctx: BrowserContext, files: Record<string, string>, opts: { holdTurns?: boolean; ctl?: { readFail?: string[]; readMissing?: string[] } } = {}): Promise<Real> {
  const page = await ctx.newPage();
  const r: Real = { page, proxyHits: 0, release: () => {} };
  let gate: Promise<void> = Promise.resolve();
  const arm = () => {
    gate = opts.holdTurns ? new Promise<void>((res) => (r.release = res)) : Promise.resolve();
  };
  arm();
  await page.route("**/stub-proxy/**", async (route: Route) => {
    r.proxyHits++;
    await gate;
    arm();
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: textReply("Done.", 0.001).body() });
  });
  await page.route("**/version.json", async (route: Route) => {
    const own = await page.evaluate(() => (window as any).__builtId as string).catch(() => "");
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: own }) });
  });
  await page.route("**/seed.json", (route: Route) => route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ files, seed: "saved" }) }));
  if (opts.ctl) await page.addInitScript((c) => ((window as any).__preCtl = c), opts.ctl);
  await page.goto(realBase);
  await page.locator(".frame").waitFor({ timeout: 30000 });
  if (opts.ctl) await page.evaluate(() => Object.assign((window as any).__ctl, (window as any).__preCtl));
  await page.waitForTimeout(150);
  return r;
}
const spy = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__spy)));
const title = (page: Page) => page.locator(".app-header-title").innerText();
async function go(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const nav = page.locator(".rail, .tabbar").filter({ visible: true }).first();
  const label = name === "Talk to Ten" && (await page.locator(".tabbar").isVisible()) ? "Ten" : name;
  await nav.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await page.waitForTimeout(300);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
const pane = (page: Page) => page.locator(".frame-page:not(.frame-page--hidden):not(.frame-page--talk)").first();
const detail = (page: Page) => pane(page).locator(".jobs-detail-pane");

/** The Jobs list as shown: each group (a `section` or `details` holding a
 *  heading) with its heading words, and each row in document order — a
 *  row is the nearest element holding both a role label and its own
 *  "Ask Ten about this" button, outside the detail. */
async function readJobs(page: Page, labels: string[], ask: string) {
  await pane(page).locator("h2, summary, .page-empty, .page-error-card").first().waitFor({ timeout: 10000 }).catch(() => {});
  return pane(page).evaluate(
    (root, { labels, ask }) => {
      const det = root.querySelector(".jobs-detail-pane");
      const rows: { label: string; group: string[]; open: boolean; text: string; links: { href: string; target: string | null; rel: string | null; text: string }[]; visible: boolean }[] = [];
      const leafs = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((e) => labels.includes((e.textContent ?? "").trim()) && !(det && det.contains(e)));
      for (const leaf of leafs) {
        let row: HTMLElement | null = leaf;
        while (row && !Array.from(row.querySelectorAll("button")).some((b) => (b.textContent ?? "").trim() === ask)) row = row.parentElement;
        if (!row || rows.some((r) => (r as any)._el === row)) continue;
        const g = row.closest("section, details");
        const h = g?.querySelector("h2, h3, summary");
        const words = Array.from(h?.querySelectorAll("*") ?? []).filter((e) => !e.childElementCount).map((e) => (e.textContent ?? "").trim()).filter(Boolean);
        const rec = {
          label: (leaf.textContent ?? "").trim(),
          group: words,
          open: g?.tagName === "DETAILS" ? (g as HTMLDetailsElement).open : true,
          text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
          links: Array.from(row.querySelectorAll("a")).map((a) => ({ href: a.getAttribute("href") ?? "", target: a.getAttribute("target"), rel: a.getAttribute("rel"), text: (a.textContent ?? "").trim() })),
          visible: (leaf as any).checkVisibility ? (leaf as any).checkVisibility() : leaf.getClientRects().length > 0,
        };
        Object.defineProperty(rec, "_el", { value: row, enumerable: false });
        rows.push(rec);
      }
      return rows;
    },
    { labels, ask },
  );
}

test("§ 5.9 3b exit on the § 5.7 fixture (real shell, 1440): every `### ` role under a stage heading shows once, in its stage, in STAGES order then file order, with its fields word for word; Dismissed is closed, with its count; each URL a web link in a new tab with rel=noopener noreferrer", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES);
  const page = r.page;
  await go(page, "Jobs");
  assert.equal(await title(page), "Jobs");
  await shot(page, "jobs-fixture-1440x900");
  const got = await readJobs(page, JOBS.map((j) => j.heading), S("P1"));
  const bad: string[] = [];
  // once each, in page order: STAGES order, file order, then Dismissed
  const wantOrder = [...STAGES_SPEC.flatMap((st) => JOBS.filter((j) => j.group === st)), ...JOBS.filter((j) => j.group === "Dismissed")].map((j) => j.heading);
  if (JSON.stringify(got.map((g) => g.label)) !== JSON.stringify(wantOrder)) bad.push(`rows ${JSON.stringify(got.map((g) => g.label))} != ${JSON.stringify(wantOrder)}`);
  for (const j of JOBS) {
    const g = got.find((x) => x.label === j.heading);
    if (!g) continue;
    const count = JOBS.filter((x) => x.group === j.group).length;
    if (g.group[0] !== j.group) bad.push(`${j.heading}: under "${g.group[0]}", the file has it under "${j.group}"`);
    if (!g.group.includes(String(count))) bad.push(`${j.group}: heading ${JSON.stringify(g.group)} has no count ${count}`);
    const { must, mustNot } = rowStrings(j);
    for (const s of must) if (!g.text.includes(s)) bad.push(`${j.heading}: missing ${JSON.stringify(s)}`);
    for (const s of mustNot) if (g.text.includes(s)) bad.push(`${j.heading}: shows ${JSON.stringify(s)}`);
    if (/\bTrack:|\(Track [AB] lens\)/.test(g.text)) bad.push(`${j.heading}: shows a Track field (§ 5.3.1 C4)`);
    const url = j.fields.get("URL");
    if (url) {
      const a = g.links.find((l) => l.href === url);
      if (!a) bad.push(`${j.heading}: URL ${url} is not a link`);
      else if (a.target !== "_blank" || a.rel !== "noopener noreferrer") bad.push(`${j.heading}: link target ${a.target} rel ${a.rel}`);
    }
    if (j.group === "Dismissed") {
      if (g.open) bad.push("Dismissed group is open by default");
      if (g.visible) bad.push(`${j.heading}: a dismissed row is visible while its group is closed`);
    }
  }
  const s = await spy(page);
  if (s.writes.length || s.uploads.length || r.proxyHits) bad.push(`writes ${s.writes} uploads ${s.uploads} model calls ${r.proxyHits}`);
  // open Dismissed for the screenshot
  await pane(page).locator("summary").filter({ hasText: "Dismissed" }).click();
  await page.waitForTimeout(150);
  await shot(page, "jobs-fixture-dismissed-open-1440x900");
  await ctx.close();
  assert.deepEqual(bad, []);
});

/** The detail's section under a § 5.3.1 label: the label's element and the
 *  HTML that follows it inside its wrapper. */
async function detailSection(page: Page, label: string) {
  return detail(page).evaluate((root, label) => {
    const h = Array.from(root.querySelectorAll<HTMLElement>("h2, h3, h4, h5, h6, dt, strong, span, p")).find((e) => (e.textContent ?? "").trim() === label && !e.childElementCount);
    if (!h) return null;
    const wrap = h.parentElement!;
    const clone = wrap.cloneNode(true) as HTMLElement;
    const hc = Array.from(clone.querySelectorAll<HTMLElement>("*")).find((e) => (e.textContent ?? "").trim() === label && !e.childElementCount);
    hc?.remove();
    return { html: clone.innerHTML, text: (clone.textContent ?? "").replace(/\s+/g, " ").trim() };
  }, label);
}
async function chooseRow(page: Page, label: string) {
  const leaf = pane(page).locator(".jobs-list-pane").getByText(label, { exact: true }).first();
  if (!(await leaf.isVisible())) await pane(page).locator("summary").filter({ hasText: "Dismissed" }).click();
  await leaf.click();
  await page.waitForTimeout(350);
}

test("§ 5.9 3b exit 'the detail's sections equal the fixture files' sections string for string', through MarkdownView (§ 5.3: 'Each section body goes through `MarkdownView`, word for word'; § 5.2 rule 8); labels J9-J12; the heading's rest and the file's own `## Verdict:` not shown", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES);
  const page = r.page;
  await go(page, "Jobs");
  const bad: string[] = [];
  let checked = 0;
  for (const j of JOBS) {
    const a = j.fields.get("Analysis");
    const c = j.fields.get("Company file");
    if (!(a && a in FILES) && !(c && c in FILES)) continue;
    await chooseRow(page, j.heading);
    const head = squash(await detail(page).innerText());
    if (!head.includes(j.heading)) bad.push(`${j.heading}: the detail does not show the chosen row`);
    const parts: [string | undefined, string, string][] = [
      [a, "Competency extraction", S("J9")],
      [a, "Fit assessment", S("J10")],
      [c, "Snapshot", S("J11").replace("<Company>", j.company)],
      [c, "Culture & hiring signals", S("J12")],
    ];
    for (const [file, prefix, label] of parts) {
      if (!file || !(file in FILES)) continue;
      const want = specPick(FILES[file], prefix);
      if (!want) continue;
      const shown = await detailSection(page, label);
      if (!shown) {
        bad.push(`${j.heading}: no "${label}" section`);
        continue;
      }
      checked++;
      const md: string = await page.evaluate((src) => (window as any).__md(src), want.body);
      if (!shown.html.includes(md)) bad.push(`${j.heading} "${label}": not the MarkdownView rendering of ${file}'s "${want.heading}" section`);
      const mdText = await page.evaluate((h) => { const d = document.createElement("div"); d.innerHTML = h; return (d.textContent ?? "").replace(/\s+/g, " ").trim(); }, md);
      if (shown.text !== mdText) bad.push(`${j.heading} "${label}": text ${JSON.stringify(shown.text.slice(0, 90))}… != ${JSON.stringify(mdText.slice(0, 90))}…`);
    }
    if (/\(Track [AB] lens\)/.test(head)) bad.push(`${j.heading}: shows the heading's rest "(Track … lens)" (C4)`);
    if (/\bVerdict:/.test(head)) bad.push(`${j.heading}: shows the analysis file's own Verdict heading`);
    if (checked === 2) await shot(page, "jobs-detail-full-1440x900");
  }
  if (checked < 8) bad.push(`only ${checked} sections found`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.3 detail on the fixture (real shell, 1440): the first row in page order is chosen at open; the verdict part from the row (tier, n/100, Reason, Dealbreakers); Posting link; a quick-scan row shows no analysis or company parts; a missing Analysis shows J13 in its place; no tag element for a claim tier (§ 5.9 3b exit)", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES);
  const page = r.page;
  await go(page, "Jobs");
  const bad: string[] = [];
  const first = [...STAGES_SPEC.flatMap((st) => JOBS.filter((j) => j.group === st))][0];
  const d0 = squash(await detail(page).innerText());
  if (!d0.includes(first.heading)) bad.push(`at open the detail is not the first row in page order (${first.heading}): ${d0.slice(0, 80)}`);
  // desktop: list and detail side by side
  const [lb, db] = await Promise.all([pane(page).locator(".jobs-list-pane").boundingBox(), detail(page).boundingBox()]);
  if (!lb || !db || db.x < lb.x + lb.width - 1) bad.push(`detail is not beside the list at 1440 (${JSON.stringify(lb)} / ${JSON.stringify(db)})`);
  for (const j of JOBS) {
    await chooseRow(page, j.heading);
    const t = squash(await detail(page).innerText());
    const f = j.fields;
    const want = [j.heading];
    if (f.get("Location")) want.push(f.get("Location")!);
    for (const [lab, key] of [["H12", "Seen"], ["H13", "Updated"], ["H14", "Evaluated"]]) if (f.get(key)) want.push(`${S(lab)} ${datePart(f.get(key))}`);
    const v = f.get("Verdict");
    want.push(v ? TIER[v] ?? v : S("J1"));
    if (f.get("Score")) want.push(S("P10").replace("<n>", f.get("Score")!));
    if (f.get("Reason")) want.push(f.get("Reason")!);
    if (v) want.push(S("J2"), f.get("Dealbreakers") ?? S("J3"));
    if (f.get("URL")) want.push(S("J8"));
    want.push(f.get("Analysis") ? S("J6") : S("J7"));
    if (f.get("Company file")) want.push(S("J14"));
    want.push(S("P1"));
    for (const s of want) if (!t.includes(s)) bad.push(`${j.heading} detail: missing ${JSON.stringify(s)}`);
    if (f.get("URL")) {
      const href = await detail(page).locator(`a[href="${f.get("URL")}"]`).first().getAttribute("rel").catch(() => null);
      if (href !== "noopener noreferrer") bad.push(`${j.heading} detail: posting link rel ${href}`);
    }
    const quick = f.get("Reason")?.startsWith("quick-scan:");
    if (quick) {
      for (const lab of [S("J9"), S("J10"), S("J12")]) if (t.includes(lab)) bad.push(`${j.heading} (quick scan): shows "${lab}"`);
      if (t.includes(S("J11").replace("<Company>", j.company))) bad.push(`${j.heading} (quick scan): shows About`);
    }
    const a = f.get("Analysis");
    if (a && !(a in FILES)) {
      if (!t.includes(MISSING_LINE(a))) bad.push(`${j.heading}: no "${MISSING_LINE(a)}" (J13); detail says ${JSON.stringify(t.slice(0, 300))}`);
      if (t.includes(COULDNT(a))) bad.push(`${j.heading}: a MISSING analysis shows the rule 6 error line instead of J13`);
      if (j.heading === first.heading) await shot(page, "jobs-detail-missing-analysis-1440x900");
    }
    // no tag element for a claim tier: tier words only inside a section's text
    const tags = await detail(page).evaluate((root) => Array.from(root.querySelectorAll<HTMLElement>("*")).filter((e) => !e.childElementCount && /^(Verified|Unknown|General knowledge|Reported)$/.test((e.textContent ?? "").trim())).map((e) => e.outerHTML));
    if (tags.length) bad.push(`${j.heading}: claim-tier tag element(s) ${tags.join(" ")}`);
  }
  const s = await spy(page);
  if (s.writes.length || s.uploads.length || r.proxyHits) bad.push(`writes ${s.writes} uploads ${s.uploads} model calls ${r.proxyHits}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.3 detail table in the page (real shell): a failing read of the company file shows F40 + Retry in that file's place only (analysis parts still show), and Retry recovers; a MISSING company file (packages/agent's resource_missing, via the spy store) shows J13; a company file with none of the headings shows none, and 'Open company notes' stays", async () => {
  const bad: string[] = [];
  const nova = JOBS.find((j) => j.fields.get("Analysis")! in FILES && j.fields.get("Company file")! in FILES)!;
  const cf = nova.fields.get("Company file")!;
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { ctl: { readFail: [cf] } });
  const page = r.page;
  await go(page, "Jobs");
  await chooseRow(page, nova.heading);
  let t = squash(await detail(page).innerText());
  if (!t.includes(COULDNT(cf))) bad.push(`failing ${cf}: no "${COULDNT(cf)}" — detail: ${t.slice(0, 400)}`);
  if (!t.includes(S("J9")) || !t.includes(S("J10"))) bad.push("failing company read hid the analysis parts");
  if (t.includes(S("J11").replace("<Company>", nova.company))) bad.push("failing company read still shows About");
  await shot(page, "jobs-detail-failing-read-1440x900");
  const retry = detail(page).getByRole("button", { name: S("F41") });
  if ((await retry.count()) !== 1) bad.push(`${await retry.count()} Retry buttons in the detail`);
  await page.evaluate(() => ((window as any).__ctl.readFail = []));
  await retry.first().click().catch(() => {});
  await page.waitForTimeout(400);
  t = squash(await detail(page).innerText());
  if (!t.includes(S("J11").replace("<Company>", nova.company))) bad.push("Retry did not bring the company sections back");
  await ctx.close();

  // a Company file that isn't there (the store's own resource_missing,
  // packages/agent's class — what the Supabase store throws in production)
  const noCompany = Object.fromEntries(Object.entries(FILES).filter(([p]) => p !== cf));
  const ctx3 = await ctxFor(DESK);
  const r3 = await openReal(ctx3, noCompany);
  await go(r3.page, "Jobs");
  await chooseRow(r3.page, nova.heading);
  const t3 = squash(await detail(r3.page).innerText());
  if (!t3.includes(MISSING_LINE(cf))) bad.push(`missing ${cf}: no "${MISSING_LINE(cf)}" (J13) — detail: ${t3.slice(0, 400)}`);
  if (t3.includes(COULDNT(cf))) bad.push(`missing ${cf}: shows the rule 6 error line instead of J13`);
  if (!t3.includes(S("J9"))) bad.push(`missing ${cf}: the analysis parts are gone too`);
  await shot(r3.page, "jobs-detail-missing-company-1440x900");
  await ctx3.close();

  const files2 = { ...FILES, [cf]: "# NovaGrid Energy — notes\n\nNo evaluate headings in this file.\n\n## Something else\ntext\n" };
  const ctx2 = await ctxFor(DESK);
  const r2 = await openReal(ctx2, files2);
  await go(r2.page, "Jobs");
  await chooseRow(r2.page, nova.heading);
  const t2 = squash(await detail(r2.page).innerText());
  if (t2.includes(S("J11").replace("<Company>", nova.company)) || t2.includes(S("J12"))) bad.push("a company file with none of the headings shows a section label");
  if (!t2.includes(S("J14"))) bad.push("no 'Open company notes' on a file with none of the headings");
  if (t2.includes("Something else")) bad.push("a non-named section is shown");
  await ctx2.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 6 on Jobs (real shell): jobs.md that can't be read shows 'Couldn't read jobs.md. Try again in a moment.' (F40) with Retry, never the empty state, and Retry recovers; a missing jobs.md shows J17 + J18 and 'Talk to Ten' (P3), never J19", async () => {
  const bad: string[] = [];
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { ctl: { readFail: ["jobs.md"] } });
  await go(r.page, "Jobs");
  let t = squash(await pane(r.page).innerText());
  if (!t.includes(COULDNT("jobs.md"))) bad.push(`failing jobs.md: F40 wants "${COULDNT("jobs.md")}", the page says ${JSON.stringify(t.slice(0, 200))}`);
  if (t.includes(S("J17"))) bad.push("failing jobs.md shows the empty state");
  await shot(r.page, "jobs-read-error-1440x900");
  await r.page.evaluate(() => ((window as any).__ctl.readFail = []));
  await pane(r.page).getByRole("button", { name: S("F41") }).click();
  await r.page.waitForTimeout(500);
  t = squash(await pane(r.page).innerText());
  if (!t.includes(JOBS[0].heading)) bad.push("Retry did not show the roles");
  await ctx.close();

  const ctx2 = await ctxFor(DESK);
  const noJobs = Object.fromEntries(Object.entries(FILES).filter(([p]) => p !== "jobs.md"));
  const r2 = await openReal(ctx2, noJobs);
  await go(r2.page, "Jobs");
  t = squash(await pane(r2.page).innerText());
  for (const s of [S("J17"), S("J18"), S("P3")]) if (!t.includes(s)) bad.push(`no jobs.md: missing ${JSON.stringify(s)} — page says ${JSON.stringify(t.slice(0, 200))}`);
  if (t.includes(S("J19"))) bad.push("no jobs.md: shows J19 before web search S5");
  await shot(r2.page, "jobs-empty-1440x900");
  // a jobs.md with no roles is the same empty state
  await r2.page.evaluate(() => (window as any).__inner.write("jobs.md", "# Pipeline\n\n## To Review\n\n## Interested\n", null));
  await go(r2.page, "Home");
  await go(r2.page, "Jobs");
  t = squash(await pane(r2.page).innerText());
  if (!t.includes(S("J17")) || !t.includes(S("J18"))) bad.push(`jobs.md with no roles: ${JSON.stringify(t.slice(0, 200))}`);
  await ctx2.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 7's URL table on the page: `javascript:` and `data:` URLs in jobs.md show as plain text, never a link; https and http become links (new tab, rel=noopener noreferrer)", async () => {
  const urls = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "https://ok.example.com/job-1", "http://plain.example.com/job-2"];
  const md = ["# Pipeline", "", "## To Review", "", ...urls.flatMap((u, i) => [`### Co${i} — Role${i}`, `- URL: ${u}`, "- Seen: 2026-09-20T00:00:00+00:00", "- Updated: 2026-09-20T00:00:00+00:00", ""])].join("\n");
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "jobs.md": md });
  await go(r.page, "Jobs");
  const got = await readJobs(r.page, urls.map((_, i) => `Co${i} — Role${i}`), S("P1"));
  const bad: string[] = [];
  urls.forEach((u, i) => {
    const g = got.find((x) => x.label === `Co${i} — Role${i}`);
    if (!g) return void bad.push(`Co${i}: not shown`);
    const link = g.links.find((l) => l.href === u);
    const safe = u.startsWith("https://") || u.startsWith("http://");
    if (safe && (!link || link.target !== "_blank" || link.rel !== "noopener noreferrer")) bad.push(`${u}: not a new-tab noopener link`);
    if (!safe && g.links.some((l) => l.href.startsWith("javascript:") || l.href.startsWith("data:"))) bad.push(`${u}: is a link`);
    if (!safe && !g.text.includes(u)) bad.push(`${u}: not shown as plain text (§ 5.2 rule 7: "Anything else shows as plain text")`);
  });
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rules 1, 2, 8 and § 5.4 on Jobs (real shell, 1440): Open analysis / Open company notes open the one viewer on that exact path; 'Ask Ten about this' puts `About <Company> — <Title>: ` in an EMPTY composer only and never sends; 'Open application' shows only on a row an application links to; zero writes, uploads, model calls", async () => {
  const bad: string[] = [];
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES);
  const page = r.page;
  await go(page, "Jobs");
  const viewers = await page.locator(".side-panel, [aria-label='File preview']").count();
  if (viewers !== 1) bad.push(`${viewers} viewers in the DOM`);
  const appKeys = new Set(Object.keys(FILES).filter((p) => p.startsWith("applications/")).map((p) => p.slice(13).replace(/(-resume\.html|-resume\.pdf|-resume\.md|-cover-letter\.md|-application\.md|\.md)$/, "")));
  for (const j of JOBS) {
    await chooseRow(page, j.heading);
    const a = j.fields.get("Analysis");
    const key = a?.match(/^jd-analysis\/(.+)\.md$/)?.[1];
    const linked = !!key && appKeys.has(key);
    const has = (await detail(page).getByRole("button", { name: S("J15") }).count()) > 0;
    if (has !== linked) bad.push(`${j.heading}: "Open application" ${has ? "shown" : "absent"}, an application ${linked ? "links" : "does not link"} to it`);
    for (const [lab, p] of [[S("J6"), a], [S("J14"), j.fields.get("Company file")]] as const) {
      if (!p || !(p in FILES)) continue;
      await detail(page).getByRole("button", { name: lab }).click();
      await page.waitForTimeout(300);
      const v = await page.locator(".side-panel").evaluate((e) => ({ path: e.querySelector(".side-panel-path")?.textContent, md: !!e.querySelector(".markdown-view") }));
      if (v.path !== p || !v.md) bad.push(`${j.heading} ${lab}: viewer shows ${v.path} (md ${v.md})`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
  }
  // Ask Ten about this, from a row: the draft, not sent
  const nova = JOBS.find((j) => j.company.startsWith("NovaGrid"))!;
  const rowAsk = pane(page).locator(".jobs-list-pane").getByText(nova.heading, { exact: true }).first().locator(`xpath=ancestor::*[.//button[normalize-space()="${S("P1")}"]][1]`).getByRole("button", { name: S("P1") }).first();
  await rowAsk.click();
  await page.waitForTimeout(300);
  if ((await title(page)) !== "Talk to Ten") bad.push(`Ask Ten opened ${await title(page)}`);
  const draft = await page.locator(".composer-input").inputValue();
  if (draft !== S("P2").replace("<label>", nova.heading)) bad.push(`draft ${JSON.stringify(draft)}`);
  // unsent text is never overwritten
  await page.locator(".composer-input").fill("my own words");
  await go(page, "Jobs");
  await detail(page).getByRole("button", { name: S("P1") }).click();
  await page.waitForTimeout(300);
  if ((await page.locator(".composer-input").inputValue()) !== "my own words") bad.push("Ask Ten overwrote unsent text");
  await page.locator(".composer-input").fill("");
  // Open application: where it lands (3d/3e choose the entry — diagnostic only)
  await go(page, "Jobs");
  await chooseRow(page, nova.heading);
  const oa = detail(page).getByRole("button", { name: S("J15") });
  if (await oa.count()) {
    await oa.click();
    await page.waitForTimeout(300);
    const landed = squash(await pane(page).innerText().catch(() => ""));
    console.log(`# Open application landed on "${await title(page)}": ${landed.slice(0, 160)}`);
  }
  const s = await spy(page);
  if (s.writes.length || s.uploads.length || r.proxyHits || s.saves) bad.push(`writes ${s.writes} uploads ${s.uploads} model calls ${r.proxyHits} saves ${s.saves}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 4 on Jobs (real shell): while a turn runs the page shows F35; at turn end it re-reads jobs.md and the chosen row's analysis file with no reload", async () => {
  const bad: string[] = [];
  const nova = JOBS.find((j) => j.company.startsWith("NovaGrid"))!;
  const af = nova.fields.get("Analysis")!;
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { holdTurns: true });
  const page = r.page;
  await go(page, "Talk to Ten");
  await page.locator(".composer-input").fill("anything new?");
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(() => /thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 10000 }).catch(() => {});
  await go(page, "Jobs");
  await chooseRow(page, nova.heading);
  const during = squash(await pane(page).innerText());
  if (!during.includes(S("F35"))) bad.push(`no "${S("F35")}" while the turn runs`);
  await page.evaluate(
    ({ af }) => {
      const inner = (window as any).__inner;
      return Promise.all([
        inner.read("jobs.md").then((f: any) => inner.write("jobs.md", f.content.replace("## Interested\n", "## Interested\n\n### Midturn Co — New Role\n- Seen: 2026-09-29T05:00:00+00:00\n- Updated: 2026-09-29T05:00:00+00:00\n"), f.version)),
        inner.read(af).then((f: any) => inner.write(af, f.content.replace("## Competency extraction\n", "## Competency extraction\nMID-TURN LINE\n"), f.version)),
      ]);
    },
    { af },
  );
  r.release();
  await page.waitForFunction(() => !/thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const afterText = squash(await pane(page).innerText());
  if (!afterText.includes("Midturn Co — New Role")) bad.push("the new jobs.md row is not shown after the turn");
  if (!squash(await detail(page).innerText()).includes("MID-TURN LINE")) bad.push("the chosen row's analysis file was not re-read at turn end");
  if (afterText.includes(S("F35"))) bad.push("F35 still showing after the turn");
  const s = await spy(page);
  if (s.writes.length || s.uploads.length) bad.push(`page writes ${s.writes} uploads ${s.uploads}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.5 / § 5.3 restore ruling at 375: Jobs opens as the list alone; choosing a row replaces the list with its detail and 'Back to Jobs' (J16) returns; no horizontal scroll; every visible Jobs control >= 44px high", async () => {
  const bad: string[] = [];
  const ctx = await ctxFor(PHONE);
  const r = await openReal(ctx, FILES);
  const page = r.page;
  await go(page, "Jobs");
  await shot(page, "jobs-list-375x812");
  const nova = JOBS.find((j) => j.company.startsWith("NovaGrid"))!;
  if (!(await pane(page).getByText(JOBS[0].heading, { exact: true }).first().isVisible())) bad.push("list not visible at open");
  if (await detail(page).isVisible()) bad.push("the detail shows beside/over the list at open on the phone");
  const hscroll = async (where: string) => {
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, pane: Math.max(...Array.from(document.querySelectorAll<HTMLElement>(".frame-page *")).filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().right)) }));
    if (w.doc > 375 || w.pane > 375.5) bad.push(`${where}: horizontal overflow (doc ${w.doc}, rightmost ${w.pane})`);
  };
  const small = async (where: string) => {
    const s = await pane(page).evaluate((root) => Array.from(root.querySelectorAll<HTMLElement>("button, a, summary")).filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => ({ t: (e.textContent ?? "").trim().slice(0, 30), h: e.getBoundingClientRect().height })).filter((x) => x.h < 44));
    if (s.length) bad.push(`${where}: controls under 44px: ${JSON.stringify(s)}`);
  };
  await hscroll("list");
  await small("list");
  await chooseRow(page, nova.heading);
  await shot(page, "jobs-detail-375x812");
  if (!(await detail(page).isVisible())) bad.push("choosing a row did not show the detail");
  if (await pane(page).locator(".jobs-list-pane").isVisible()) bad.push("the list still shows beside the detail on the phone");
  const back = pane(page).getByRole("button", { name: S("J16") });
  if (!(await back.isVisible())) bad.push(`no visible "${S("J16")}"`);
  const top = await detail(page).evaluate((e) => e.getBoundingClientRect().top);
  if (top < 0) bad.push(`detail opens scrolled (top ${top})`);
  await hscroll("detail");
  await small("detail");
  // Cascadia's missing-file line at 375
  await back.click();
  await page.waitForTimeout(300);
  if (!(await pane(page).locator(".jobs-list-pane").isVisible())) bad.push("Back to Jobs did not return to the list");
  const casc = JOBS.find((j) => j.fields.get("Analysis") && !(j.fields.get("Analysis")! in FILES));
  if (casc) {
    await chooseRow(page, casc.heading);
    await shot(page, "jobs-detail-missing-375x812");
    await pane(page).getByRole("button", { name: S("J16") }).click();
    await page.waitForTimeout(200);
  }
  await pane(page).locator("summary").filter({ hasText: "Dismissed" }).click();
  await page.waitForTimeout(200);
  await shot(page, "jobs-dismissed-375x812");
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.3.1 J19 is not in the bundle before web search S5 (C1): neither J19 nor 'Ask Ten to look for roles' appears in the built JS", () => {
  const js = readdirSync(path.join(mockDir, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(mockDir, "assets", f), "utf8")).join("\n");
  assert.ok(js.includes(S("J18")) || js.includes(S("J18").replace("'", "\\'")), "J18 is not in the bundle");
  assert.ok(!js.includes("Ask Ten to look for roles"), "J19's words are in the bundle");
});
