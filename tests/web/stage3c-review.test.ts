// Tester-owned: workspace Stage 3c, the Home page — docs/design-web-ui.md
// § 5.9 Stage 3c's exit ("the four existing tables C § 18 names pass
// unchanged; C § 18's waitingRows parity test and its new table; Home's
// counts equal load()'s rows by stage; § 5.2 rules 4, 5 and 6"; the restore
// ruling adds "C § 18.1's table and round-trip tests; § 5.3's last-reply
// table test and its e2e case; the minutes-sum table; § 5.2 rule 1's check
// that pages and the rail receive only messages and status, with a spy on
// every function useChat returns"), § 5.1 (landing), § 5.3 Home (Shows,
// Reads, Empty), § 5.3.1's Home rows (H1-H18, P3, F35, F40-F42, L1-L20),
// § 5.4 (Continue with Ten, amended), and docs/design-web-agent.md § 18 /
// § 18.1 (readPlanBoard, splitPlanMinutes, budgetMinutesPerDay).
//
// Every expected value is read from the spec text; written independently
// of the builder's own packages/agent/test/plan-board*.test.ts and
// apps/web/src/workspace/home-*.test.ts.
//
// Browser half: tests/web/stage3c-review/harness.tsx — the REAL
// RealChatShell (Frame, Home, SidePanel) on the real in-memory
// WorkspaceStore behind a spy (write/upload throw), a stubbed model proxy
// (every hit counted), and the real useChat behind use-chat-spy.ts (every
// function it returns counted). Fixture: apps/web/fixtures/
// workspace-pages.json (§ 5.7), plus small seeds written here. No model
// calls, no real workspace.
//
// Run: node --test tests/web/stage3c-review.test.ts
// Screenshots: STAGE3C_SHOTS=<dir>.
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
import { budgetMinutesPerDay, readPlanBoard, splitPlanMinutes } from "../../packages/agent/src/plan-board.ts";
import { parsePlanTodo } from "../../packages/agent/src/helpers.ts";
import * as agentIndex from "../../packages/agent/src/index.ts";
import { WorkspaceError as AgentWorkspaceError } from "../../packages/agent/src/types.ts";
import { WorkspaceError as WebWorkspaceError } from "../../apps/web/src/types.ts";
import { isMissingError } from "../../apps/web/src/workspace/store-io.ts";
import { lastReply, minutesSum } from "../../apps/web/src/workspace/home-reader.ts";
// @ts-expect-error - plain .mjs, no type declarations
import { waitingRows } from "../../skills/coach/scripts/lib/check-closeout.mjs";
// @ts-expect-error - plain .mjs, no type declarations
import { restoreLineSeparators, universalNewlines } from "../../skills/profile/scripts/lib/py-text.mjs";
// @ts-expect-error - plain .mjs, no type declarations
import { load as loadJobs, STAGES } from "../../skills/search/scripts/lib/jobs-md.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO, "apps/web");
const HARNESS = path.join(REPO, "tests/web/stage3c-review");
const DOC = readFileSync(path.join(REPO, "docs/design-web-ui.md"), "utf8");
const SHOTS = process.env.STAGE3C_SHOTS;
const fx = (n: string) => JSON.parse(readFileSync(path.join(WEB, "fixtures", `${n}.json`), "utf8"));
const FIX = fx("workspace-pages");
const FILES = FIX.files as Record<string, string>;
const MESSAGES = FIX.messages as any[];

// ---------------------------------------------------------------- spec text

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const ROWS: { id: string; page: string; where: string; str: string }[] = [];
for (const line of DOC.split("\n")) {
  const m = line.match(/^\| ([A-Z]+\d+) \| ([^|]+) \| ([^|]+) \| `([^`]*)` \|/);
  if (m) ROWS.push({ id: m[1], page: m[2].trim(), where: m[3].trim(), str: m[4] });
}
const find = (page: RegExp, where: RegExp) => {
  const hits = ROWS.filter((r) => page.test(r.page) && where.test(r.where));
  assert.equal(hits.length, 1, `§ 5.3.1: one row for ${page} / ${where}, found ${JSON.stringify(hits)}`);
  return hits[0].str;
};
const S = {
  lastReplyLabel: find(/^Home$/, /^label over Ten's last reply$/), // H1
  ellipsis: find(/^Home$/, /^added where the quote is cut/), // H2
  continue: find(/^Home$/, /^the band's button/), // H3
  bandNoReply: find(/^Home$/, /^the band's label when no reply shows/), // H4
  waiting: ROWS.filter((r) => r.page === "Home" && r.where === "plan section heading").map((r) => r.str), // H5, H6
  nothingRightNow: find(/^Home$/, /^a plan section with no items$/), // H7
  minutesSum: find(/^Home$/, /^To do's header/), // H8
  emptyFirst: find(/^Home$/, /^empty state, first sentence$/), // H17
  emptyRest: find(/^Home$/, /^empty state, rest$/), // H18
  talkToTen: find(/Home when no conversation is saved/, /^empty state's button$/), // P3
  working: find(/^Home, Jobs, Applications, Documents$/, /while a turn runs$/), // F35
  cantRead: find(/^Home, Jobs, Applications, Documents$/, /^a file that can't be read/), // F40
  retry: find(/^Home, Jobs, Applications, Documents$/, /^the button beside F40$/), // F41
  unreadable: find(/^Home, Jobs, Applications, Documents$/, /^above lines a reader can't parse/), // F42
  pill: find(/^Home, Applications$/, /^the minutes pill/), // P18
  dismissed: find(/^Home, Jobs, Applications$/, /^Home count cell, Jobs group \(closed\)/), // P16
};
// sanity: the strings this suite depends on are the ones the spec gives
assert.equal(S.continue, "Continue with Ten");
assert.equal(S.talkToTen, "Talk to Ten");
assert.deepEqual(S.waiting, ["Waiting on you", "To do"]);
/** § 5.3.1 L1-L19: the finished-step words, keyed by tool or `bash: <script>`. */
const L_WORDS = new Map<string, string>();
let L_OTHER = "";
for (const r of ROWS.filter((x) => /^L\d+$/.test(x.id))) {
  const m = r.where.match(/^a finished step, `([^`]+)`$/);
  if (m) L_WORDS.set(m[1], r.str);
  if (/^a finished step, any other tool or script$/.test(r.where)) L_OTHER = r.str;
}

// ---------------------------------------------------------------- C § 18: readPlanBoard

const W = "Waiting on you";
const T = "To do";
const sec = (md: string, label: string) => readPlanBoard(md).sections.find((s) => s.label === label);
const texts = (md: string, label: string) => sec(md, label)?.items.map((i) => i.text);

test("C § 18 new table: a `# Plan — <name>` title above the head lines; Goal/Budget word for word, only before the first `## `; the four labels in file order; refs are § 6.2's first backticked path", () => {
  const md = [
    "# Plan — Rowan Example",
    "Goal: an offer by 2026-12-15, remote or Austin",
    "Budget: 45 min/day",
    "",
    "## Board",
    "",
    "Waiting on you",
    "- Tell me which of the two roles to keep (`jd-analysis/acme.md`)",
    "",
    "To do",
    "- Read `keep` then send the letter (`applications/acme-letter.md`) — 5 min — why",
    "Doing",
    "- a thing in progress",
    "Done",
    "- sent it",
    "",
    "## Standing floor",
    "Goal: not a head line",
  ].join("\n");
  const b = readPlanBoard(md);
  assert.equal(b.goalLine, "Goal: an offer by 2026-12-15, remote or Austin");
  assert.equal(b.budgetLine, "Budget: 45 min/day");
  assert.deepEqual(b.sections.map((s) => s.label), [W, T, "Doing", "Done"]);
  assert.deepEqual(sec(md, W)!.items, [{ text: "Tell me which of the two roles to keep (`jd-analysis/acme.md`)", ref: "jd-analysis/acme.md" }]);
  assert.deepEqual(sec(md, T)!.items, [{ text: "Read `keep` then send the letter (`applications/acme-letter.md`) — 5 min — why", ref: "applications/acme-letter.md" }]);
  assert.deepEqual(texts(md, "Doing"), ["a thing in progress"]);
  assert.deepEqual(texts(md, "Done"), ["sent it"]);
  for (const s of b.sections) assert.deepEqual(s.unreadable, [], s.label);
  // head lines only before the first `## `
  assert.equal(readPlanBoard("## Board\nGoal: late\nBudget: late\nTo do\n- x\n").goalLine, undefined);
  assert.equal(readPlanBoard("## Board\nGoal: late\nBudget: late\nTo do\n- x\n").budgetLine, undefined);
});

test("C § 18 new table: `To do (2)` and `To do:` are labels; a label missing is absent; a file with no board has no sections; CRLF reads the same as LF", () => {
  assert.deepEqual(texts("To do (2)\n- a\n- b\n", T), ["a", "b"]);
  assert.deepEqual(texts("To do:\n- a\n", T), ["a"]);
  assert.equal(sec("Waiting on you\n- q\n", T), undefined);
  assert.deepEqual(readPlanBoard("Goal: g\nBudget: 30 min/day\n\nJust prose, no board.\n").sections, []);
  const lf = "Goal: g\nBudget: 45 min/day\n\n## Board\n\nWaiting on you\n- q (`a/b.md`)\n  more\n\nTo do\n- x — 5 min — y\n1. z\n";
  assert.deepEqual(readPlanBoard(lf.replace(/\n/g, "\r\n")), readPlanBoard(lf));
  assert.equal(readPlanBoard(lf.replace(/\n/g, "\r\n")).goalLine, "Goal: g");
});

test("C § 18 behaviour-change table, every row (readPlanBoard's To do and parsePlanTodo agree on each)", () => {
  const cases: [string, string, string[] | undefined, string[]?][] = [
    ["`to do` (lower case) is not a label", "to do\n- x\n", undefined],
    ["`  To do` (indented) is not a label", "  To do\n- x\n", undefined],
    ["`## To do` is not a label", "## To do\n- x\n", undefined],
    ["`To do:` is a label", "To do:\n- x\n", ["x"]],
    ["`To do list` is a label", "To do list\n- x\n", ["x"]],
    ["a prose line starting `To do` inside another section starts To do", "Doing\n- a\nTo do the rest later\n- b\n", ["b"]],
    ["`  - x` (indented bullet) is an item", "To do\n  - x\n", ["x"]],
    ["`• x` is an item", "To do\n• x\n", ["x"]],
    ["a numbered bullet is an item", "To do\n1. x\n2. y\n", ["x", "y"]],
    ["a non-bullet line after an item joins it", "To do\n- x\nmore words\n", ["x more words"]],
    ["a non-bullet line before the first item is unreadable; later items still read", "To do\nsome prose first\n- x\n", ["x"], ["some prose first"]],
    ["a `# ` line inside To do ends the section", "To do\n- x\n# Heading\n- y\n", ["x"]],
    ["an undefined plain-text heading after items joins as a continuation; its bullets are To do items", "To do\n- x\nLater\n- y\n", ["x Later", "y"]],
  ];
  const bad: string[] = [];
  for (const [name, md, want, unreadable] of cases) {
    const s = sec(md, T);
    const got = s?.items.map((i) => i.text);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    if (JSON.stringify(s?.unreadable ?? []) !== JSON.stringify(unreadable ?? [])) bad.push(`${name}: unreadable ${JSON.stringify(s?.unreadable)}`);
    const todo = parsePlanTodo(md);
    if (JSON.stringify(todo) !== JSON.stringify(s ? s.items : [])) bad.push(`${name}: parsePlanTodo ${JSON.stringify(todo)} is not the To do section's items`);
  }
  assert.deepEqual(bad, []);
  // the doing section of the "prose line starting To do" case ends at that line
  assert.deepEqual(texts("Doing\n- a\nTo do the rest later\n- b\n", "Doing"), ["a"]);
});

test("C § 18 'Unreadable': Waiting on you under a label form waitingRows rejects (`Waiting on you (1)`) shows every non-blank line as unreadable, never an empty list", () => {
  const md = "Waiting on you (1)\n- tell me the comp floor\n\nTo do\n- x\n";
  const s = sec(md, W)!;
  assert.ok(s, "no Waiting on you section");
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.unreadable, ["- tell me the comp floor"]);
});

test("C § 18 'Unreadable is only a non-blank line before a section's first item' — in Waiting on you too: a prose line before its first bullet is unreadable, not silently dropped", () => {
  const md = "Waiting on you\nA note I wrote before the list\n- tell me the comp floor\n\nTo do\n- x\n";
  const s = sec(md, W)!;
  assert.deepEqual(s.items.map((i) => i.text), ["tell me the comp floor"]);
  assert.deepEqual(s.unreadable, ["A note I wrote before the list"], "the prose line vanished: Home shows neither the line nor the loud notice (§ 5.2 rule 6)");
});

test("C § 18 section end: 'The other three sections run from their label to the next board label' — a later repeat of a label still ends the section above it", () => {
  const md = "To do\n- a\nDone\n- d\nTo do\n- x\n";
  assert.deepEqual(texts(md, "Done"), ["d"], "Done ran on past the next board label");
});

test("C § 18 parity: for every check_closeout case with a plan.md, readPlanBoard's Waiting on you texts equal waitingRows(universalNewlines(text)) (each through restoreLineSeparators, as § 18 returns every string)", () => {
  const dir = path.join(REPO, "tests/checkers/cases/check_closeout");
  const bad: string[] = [];
  let n = 0;
  let sentinel = 0;
  const named = ["extra-r2-cc-lone-cr-plan.json", "extra-r2-cc-bom-waiting.json"];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const plan = c.before?.["plan.md"];
    if (typeof plan !== "string") continue;
    n++;
    const want = (waitingRows(universalNewlines(plan)) as string[]).map((r) => restoreLineSeparators(r));
    if (want.some((r, i) => r !== (waitingRows(universalNewlines(plan)) as string[])[i])) sentinel++;
    const got = (sec(plan, W)?.items ?? []).map((i) => i.text);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${f}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
  for (const f of named) assert.ok(existsSync(path.join(dir, f)), `named case ${f} is missing`);
  console.log(`# parity over ${n} check_closeout cases with a plan.md (${sentinel} carry U+2028/U+2029)`);
  assert.ok(n >= 10, `only ${n} cases — vacuous`);
  assert.deepEqual(bad, []);
});

test("C § 18 'these existing tables pass unchanged': tests/web/helpers.test.ts, apps/web/src/agent-helpers.test.ts, tests/agent/cards.test.ts, packages/agent/test/cards.test.ts carry no diff against origin/main", () => {
  const files = ["tests/web/helpers.test.ts", "apps/web/src/agent-helpers.test.ts", "tests/agent/cards.test.ts", "packages/agent/test/cards.test.ts"];
  const d = spawnSync("git", ["diff", "--stat", "origin/main", "--", ...files], { cwd: REPO, encoding: "utf8" });
  assert.equal(d.status, 0, d.stderr);
  assert.equal(d.stdout.trim(), "", `changed: ${d.stdout}`);
});

test("C § 18/§ 18.1: readPlanBoard, splitPlanMinutes and budgetMinutesPerDay are exports of packages/agent", () => {
  for (const n of ["readPlanBoard", "splitPlanMinutes", "budgetMinutesPerDay", "parsePlanTodo"]) assert.equal(typeof (agentIndex as any)[n], "function", n);
});

// ---------------------------------------------------------------- C § 18.1

test("C § 18.1 splitPlanMinutes table (the mvp-journey fixture's three To do lines and every named case) and the round trip over every case that returns", () => {
  const mvpPlan = fx("mvp-journey").files["plan.md"] as string;
  const todo = sec(mvpPlan, T)!.items.map((i) => i.text);
  assert.equal(todo.length, 3, "the mvp-journey fixture's To do lines");
  const cases: [string, { action: string; minutes: number; why?: string } | undefined][] = [
    [todo[0], { action: "Send the Acme cover letter (`applications/acme-staff-pm-cover-letter.md`)", minutes: 5, why: "the automatic checks are clean; the wording check hasn't run" }],
    [todo[1], { action: "Submit the Acme application yourself once you've sent the letter (`applications/acme-staff-pm-application.md`)", minutes: 10, why: "I can't submit applications for you yet" }],
    [todo[2], { action: "Tell me if you want me to keep looking for more Senior/Staff PM roles", minutes: 2, why: "one search pass takes about that long" }],
    ["Prep the loop — 10 min", { action: "Prep the loop", minutes: 10 }],
    ["Prep the loop — 999 min — a long one", { action: "Prep the loop", minutes: 999, why: "a long one" }],
    ["Prep the loop — 1 min — why — with a dash in it", { action: "Prep the loop", minutes: 1, why: "why — with a dash in it" }],
    ["Prep the loop — 5 minutes — why", undefined],
    ["Prep the loop — 5-10 min — why", undefined],
    ["Prep the loop - 5 min - why", undefined],
    ["Prep the loop – 5 min – why", undefined],
    ["Prep the loop — ~5 min — why", undefined],
    ["Prep — 5 min — then — 10 min", undefined],
    ["Prep the loop — 0 min", undefined],
    ["Prep the loop — 05 min", undefined],
    ["Prep the loop — 1000 min", undefined],
    ["Prep the loop, no minutes at all", undefined],
    [" — 5 min — why", undefined],
    ["   — 5 min — why", undefined],
    ["Prep the loop 5 min — why", undefined],
  ];
  const bad: string[] = [];
  for (const [text, want] of cases) {
    const got = splitPlanMinutes(text);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(text)}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    if (got) {
      const back = got.action + " — " + got.minutes + " min" + (got.why === undefined ? "" : " — " + got.why);
      if (back !== text) bad.push(`round trip: ${JSON.stringify(back)} != ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("C § 18.1 budgetMinutesPerDay: 45, 60, undefined, undefined, 45, undefined for the six named inputs", () => {
  const got = ["Budget: 45 min/day", "Budget: 60 min/day floor.", "Budget: 30 min per session, 3x a week", "Budget: 45 min a day", "Budget:45min/day", undefined].map((b) => budgetMinutesPerDay(b));
  assert.deepEqual(got, [45, 60, undefined, undefined, 45, undefined]);
});

test("§ 5.3 'The minutes sum' table: every item with minutes sums; one without, a per-session budget, an empty or unreadable To do show nothing; `Budget: 60 min/day floor.` sums; N > M is shown as is", () => {
  const todo = (md: string) => sec(md, T);
  const all = "To do\n- a — 5 min — w\n- b — 15 min\n- c — 10 min — w\n";
  assert.deepEqual(minutesSum(todo(all), "Budget: 45 min/day"), { n: 30, m: 45 });
  assert.equal(minutesSum(todo("To do\n- a — 5 min — w\n- b, no minutes\n"), "Budget: 45 min/day"), undefined);
  assert.equal(minutesSum(todo(all), "Budget: 30 min per session, 3x a week"), undefined);
  assert.deepEqual(minutesSum(todo(all), "Budget: 60 min/day floor."), { n: 30, m: 60 });
  assert.deepEqual(minutesSum(todo("To do\n- a — 50 min\n- b — 40 min\n"), "Budget: 45 min/day"), { n: 90, m: 45 });
  assert.equal(minutesSum(todo("To do\n"), "Budget: 45 min/day"), undefined);
  assert.equal(minutesSum(todo("To do\nprose first\n- a — 5 min\n"), "Budget: 45 min/day"), undefined);
  assert.equal(minutesSum(undefined, "Budget: 45 min/day"), undefined);
  assert.equal(minutesSum(todo(all), undefined), undefined);
  // Waiting on you's minutes are never summed
  assert.deepEqual(minutesSum(todo("Waiting on you\n- q — 99 min\n\nTo do\n- a — 5 min\n"), "Budget: 45 min/day"), { n: 5, m: 45 });
});

// ---------------------------------------------------------------- § 5.3 Ten's last reply

/** § 5.3 "The quote", written from the spec's words. */
function specQuote(raw: string): string {
  const t = raw.trim();
  const cps = Array.from(t);
  if (cps.length <= 280) return t;
  let cut = -1;
  for (let i = 279; i >= 0; i--) if (/\s/.test(cps[i])) {
    cut = i;
    break;
  }
  return (cut === -1 ? cps.slice(0, 280) : cps.slice(0, cut)).join("") + S.ellipsis;
}
const U = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] }) as any;
const A = (id: string, ...parts: any[]) => ({ id, role: "assistant", parts }) as any;
const txt = (text: string) => ({ type: "text", text });

test("§ 5.3 last-reply table: plain reply; > 280 code points cut before whitespace; 300 with no whitespace; whitespace-only last text part; the reconcile message last; a user message last; a data-error part; no text part; status error; each running status", () => {
  const long = ("word ".repeat(80) + "tail").trim(); // 324 code points
  const noWs = "x".repeat(300);
  const q = (ms: any[], st: any = "ready") => lastReply(ms, st)?.quote;
  const bad: string[] = [];
  const eq = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  };
  eq("plain", q([U("u", "hi"), A("a", txt("  Here's the plan.  "))]), "Here's the plan.");
  const cut = q([U("u", "hi"), A("a", txt(long))])!;
  eq("long ends with …", cut.endsWith(S.ellipsis), true);
  const shown = cut.slice(0, -S.ellipsis.length);
  eq("long: shown is a prefix", long.startsWith(shown), true);
  eq("long: ends before whitespace", /\s/.test(long[shown.length] ?? ""), true);
  eq("long: at most 280 code points", Array.from(shown).length <= 280, true);
  eq("long", cut, specQuote(long));
  eq("300 no whitespace", q([A("a", txt(noWs))]), "x".repeat(280) + S.ellipsis);
  eq("300 astral, no whitespace: code points, not UTF-16 units", q([A("a", txt("😀".repeat(300)))]), "😀".repeat(280) + S.ellipsis);
  eq("exactly 280", q([A("a", txt("y".repeat(280)))]), "y".repeat(280));
  eq("last text part only whitespace -> the one before it", q([A("a", txt("First part."), { type: "tool-read_file", toolCallId: "c", state: "output-available", input: {}, output: {} }, txt("   \n "))]), "First part.");
  eq("reconcile message last (data parts only)", q([U("u", "yes"), A("a", txt("Done — started.")), A("gate-reconcile-1", { type: "data-gate", data: { id: "g", status: "approved" } })]), "Done — started.");
  eq("a user message last", q([A("a", txt("old reply")), U("u", "and now?")]), undefined);
  eq("a data-error part", q([U("u", "hi"), A("a", txt("I was halfway thr"), { type: "data-error", data: { code: "model_error" } })]), undefined);
  eq("no text part at all", q([U("u", "hi"), A("a", { type: "tool-read_file", toolCallId: "c", state: "output-available", input: {}, output: {} })]), undefined);
  eq("no messages", q([]), undefined);
  eq("status error", q([U("u", "hi"), A("a", txt("reply"))], "error"), undefined);
  eq("status submitted", q([U("u", "hi"), A("a", txt("reply"))], "submitted"), undefined);
  eq("status streaming", q([U("u", "hi"), A("a", txt("reply"))], "streaming"), undefined);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.2 rule 6: isMissingError

test("§ 5.2 rule 6 'How code tells missing': isMissingError over each class's resource_missing (true), each class's other codes (false), and a plain Error (false)", () => {
  const codes = ["resource_missing", "not_found", "read_only", "unsupported_type", "too_large", "invalid_path"];
  const bad: string[] = [];
  for (const [name, C] of [["apps/web", WebWorkspaceError], ["packages/agent", AgentWorkspaceError]] as const) {
    for (const code of codes) {
      const got = isMissingError(new (C as any)(code, "x"));
      if (got !== (code === "resource_missing")) bad.push(`${name} ${code}: ${got}`);
    }
  }
  for (const e of [new Error("resource_missing"), new Error("x"), null, undefined, "resource_missing", { message: "resource_missing" }]) if (isMissingError(e)) bad.push(`${String(e)}: true`);
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 6: store-io.ts's isMissingError is byte-identical to origin/feat/workspace-stage3d's (the two builds merge without disagreeing)", () => {
  const g = spawnSync("git", ["show", "origin/feat/workspace-stage3d:apps/web/src/workspace/store-io.ts"], { cwd: REPO, encoding: "utf8" });
  assert.equal(g.status, 0, g.stderr);
  const fn = (s: string) => s.match(/export function isMissingError[\s\S]*?\n}\n/)?.[0];
  const here = fn(readFileSync(path.join(WEB, "src/workspace/store-io.ts"), "utf8"));
  assert.ok(here, "no isMissingError here");
  assert.equal(here, fn(g.stdout));
});

// Lead ruling, Stage 3c review round 1: the viewer's two hits (ChatShell.tsx,
// RealChatShell.tsx) are Stage 4's — design-web-ui.md § 5.2 rule 6, "The
// viewer's missing state" (lead ruling 2026-09-29) names it a Stage 4 build
// item, and stage3a-review.test.ts:804 pins today's viewer empty state until
// the Stage 4 tester changes it. The assertion stays; it is marked todo.
test("§ 5.2 rule 6: a grep finds no `instanceof WorkspaceError` in page, viewer or adapter code", { todo: "Stage 4: § 5.2 rule 6 'The viewer's missing state' (lead ruling 2026-09-29); stage3a-review.test.ts:804 pins today's viewer" }, () => {
  const files = ["src/components/Home.tsx", "src/components/PlanItem.tsx", "src/components/UnreadableLines.tsx", "src/components/DocumentsPage.tsx", "src/components/SidePanel.tsx", "src/components/Frame.tsx", "src/workspace/store-io.ts", "src/workspace/pipeline.ts", "src/workspace/home-reader.ts", "src/ChatShell.tsx", "src/real/RealChatShell.tsx"];
  const bad: string[] = [];
  for (const f of files) {
    const p = path.join(WEB, f);
    if (!existsSync(p)) continue;
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/instanceof\s+WorkspaceError/.test(line.replace(/\/\/.*$/, ""))) bad.push(`apps/web/${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- static: rules 1, 4 and the pure view

test("§ 5.2 rules 1, 2 and 4 (static half): Home's code calls no write/upload/send and no browser storage; HomeView (the pure view, § 5.3) touches no store, hook or useChat", () => {
  const bad: string[] = [];
  for (const f of ["src/components/Home.tsx", "src/components/PlanItem.tsx", "src/components/UnreadableLines.tsx", "src/workspace/home-reader.ts", "src/workspace/pipeline.ts", "src/workspace/store-io.ts"]) {
    const src = readFileSync(path.join(WEB, f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    for (const re of [/\.write\(|\.upload\(|\.remove\(|\.delete\(/, /sendMessage|\.send\(|fetch\(/, /localStorage|sessionStorage|indexedDB/]) if (re.test(src)) bad.push(`${f}: ${re}`);
  }
  const home = readFileSync(path.join(WEB, "src/components/Home.tsx"), "utf8");
  const a = home.indexOf("export function HomeView");
  assert.ok(a >= 0, "no exported HomeView");
  const b = home.indexOf("\nexport function ", a + 10);
  const view = home.slice(a, b < 0 ? undefined : b).replace(/^\s*(\/\/|\*).*$/gm, "");
  for (const re of [/\bstore\b/, /useEffect|useState|useCallback/, /useChat/, /\.read\(|\.list\(/]) if (re.test(view)) bad.push(`HomeView: ${re}`);
  assert.deepEqual(bad, []);
});

test("§ 5.3 'The activity line': one exported function returns the whole collapsed line — no second copy of its words (the `ran ` prefix is glued in one place only)", () => {
  const where = ["src/components/ToolRun.tsx", "src/workspace/home-reader.ts", "src/components/tool-run-summary.ts", "src/components/Home.tsx"].filter((f) => /(>|`|")ran \{|`ran \$\{|"ran "/.test(readFileSync(path.join(WEB, f), "utf8")));
  assert.ok(where.length <= 1, `the line's "ran " is written in ${where.length} places: ${where.join(", ")}`);
});

// ---------------------------------------------------------------- jobs.md counts (node half)

const nodeIo = (files: Record<string, string>) => ({
  exists: async (p: string) => p in files,
  readFile: async (p: string) => universalNewlines(files[p]),
  writeFile: async () => {
    throw new Error("read-only");
  },
});
async function loadCounts(jobsMd: string) {
  const rows = (await loadJobs(nodeIo({ "jobs.md": jobsMd }), "")) as any[];
  const by = (STAGES as string[]).map((s) => rows.filter((r) => !r.dismissed && r.stage === s).length);
  return [...by, rows.filter((r) => r.dismissed).length];
}
const role = (co: string, extra = "") => `### ${co} — Staff PM\n- URL: https://${co.toLowerCase()}.example.com/j\n- Location: Remote (US)\n- Seen: 2026-09-20T00:00:00+00:00\n- Updated: 2026-09-21T00:00:00+00:00\n${extra}`;
/** Uneven stages, a lying bold `Active:` line, and a fake row after `## Search notes`. */
const EDGE_JOBS = [
  "# Pipeline",
  "",
  "**Active: 99** · dismissed: 7 · updated 2026-09-29",
  "",
  "## To Review",
  "",
  role("Alder"),
  role("Birch"),
  "## Interested",
  "",
  "## Applied",
  "",
  role("Cedar"),
  role("Dogwood"),
  role("Elm"),
  "## Interviewing",
  "",
  role("Fir"),
  "## Offer",
  "",
  "## Dismissed",
  "",
  role("Gum", "- Was stage: Applied\n"),
  role("Hazel"),
  "## Search notes",
  "",
  "## Offer",
  role("Fake"),
].join("\n");

// ---------------------------------------------------------------- browser

let browser: Browser;
const servers: Server[] = [];
const tmp: string[] = [];
let realBase = "";
const external: string[] = [];
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
  const link = path.join(HARNESS, "node_modules");
  if (!existsSync(link)) symlinkSync("../../../apps/web/node_modules", link);
  const hOut = mkdtempSync(path.join(tmpdir(), "ten-stage3c-review-real-"));
  tmp.push(hOut);
  const { build } = (await import(path.join(WEB, "node_modules/vite/dist/node/index.js"))) as typeof import("vite");
  await build({
    root: HARNESS,
    configFile: path.join(WEB, "vite.config.ts"),
    logLevel: "error",
    resolve: { alias: [{ find: /^@ai-sdk\/react$/, replacement: path.join(HARNESS, "use-chat-spy.ts") }] },
    build: { outDir: hOut, emptyOutDir: true },
  });
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
async function ctxFor(vp: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: "light", reducedMotion: "reduce", hasTouch: vp.width < 500, timezoneId: "America/Los_Angeles" });
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) external.push(r.url());
  });
  return ctx;
}

interface Real {
  page: Page;
  proxyHits: number;
  release: () => void;
}
async function openReal(ctx: BrowserContext, files: Record<string, string>, opts: { seed?: "none" | "saved"; messages?: any[]; holdTurns?: boolean; reply?: string } = {}): Promise<Real> {
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
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: textReply(opts.reply ?? "Here's the plan.", 0.001).body() });
  });
  await page.route("**/version.json", async (route: Route) => {
    const own = await page.evaluate(() => (window as any).__builtId as string).catch(() => "");
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: own }) });
  });
  await page.route("**/seed.json", (route: Route) => route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ files, seed: opts.seed ?? "saved", messages: opts.messages }) }));
  await page.goto(realBase);
  await page.locator(".frame").waitFor();
  await page.waitForTimeout(300);
  return r;
}
const spy = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as any).__spy)));
const title = (page: Page) => page.locator(".app-header-title").innerText();
async function go(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const nav = page.locator(".rail, .tabbar").filter({ visible: true }).first();
  const label = name === "Talk to Ten" && (await page.locator(".tabbar").isVisible()) ? "Ten" : name;
  await nav.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await page.waitForTimeout(250);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
const pane = (page: Page) => page.locator(".frame-page:not(.frame-page--hidden):not(.frame-page--talk)").first();
const idle = (page: Page) => page.waitForFunction(() => !/thinking|working/.test(document.querySelector(".avatar")?.className ?? ""), null, { timeout: 30000 });

/** What Home shows, read from the DOM. */
async function readHome(page: Page) {
  await page.waitForTimeout(200);
  return pane(page).evaluate((root) => {
    const t = (e: Element | null | undefined) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
    const cols = Array.from(root.querySelectorAll(".home-plan-column")).map((c) => ({
      heading: t(c.querySelector("h2, h3")),
      sum: c.querySelector(".home-minutes-sum") ? t(c.querySelector(".home-minutes-sum")) : null,
      empty: t(c.querySelector(".home-plan-empty")),
      items: Array.from(c.querySelectorAll(".plan-item")).map((li) => ({
        action: li.querySelector(".plan-item-action") ? li.querySelector(".plan-item-action")!.textContent : null,
        pill: li.querySelector(".plan-item-pill") ? t(li.querySelector(".plan-item-pill")) : null,
        why: li.querySelector(".plan-item-why") ? li.querySelector(".plan-item-why")!.textContent : null,
        text: li.querySelector(".plan-item-text") ? li.querySelector(".plan-item-text")!.textContent : null,
        chip: li.querySelector(".plan-item-chip") ? t(li.querySelector(".plan-item-chip")) : null,
      })),
      unreadable: c.querySelector(".unreadable-lines") ? (c.querySelector(".unreadable-lines") as HTMLElement).innerText : null,
    }));
    return {
      text: (root as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      goal: t(root.querySelector(".home-goal")),
      budget: t(root.querySelector(".home-budget")),
      cells: Array.from(root.querySelectorAll(".home-pipeline-cell")).map((c) => [t(c.querySelector(".home-pipeline-label")), t(c.querySelector(".home-pipeline-count"))]),
      cols,
      quote: root.querySelector(".home-last-reply-quote") ? root.querySelector(".home-last-reply-quote")!.textContent : null,
      activity: Array.from(root.querySelectorAll(".home-activity-line")).map((e) => t(e)),
      buttons: Array.from(root.querySelectorAll("button")).map((b) => t(b)),
      empty: !!root.querySelector(".page-empty"),
    };
  });
}
/** § 5.3 plan item: action / pill / why exact when the line carries minutes; the line as written otherwise; chip = ref. */
function checkItems(label: string, got: any[], items: { text: string; ref?: string }[]): string[] {
  const bad: string[] = [];
  if (got.length !== items.length) bad.push(`${label}: ${got.length} items shown, the file has ${items.length}`);
  items.forEach((it, i) => {
    const g = got[i];
    if (!g) return;
    const sp = splitPlanMinutes(it.text);
    if (sp) {
      if (g.action !== sp.action) bad.push(`${label}[${i}] action ${JSON.stringify(g.action)} != the line's own ${JSON.stringify(sp.action)}`);
      if (g.pill !== S.pill.replace("<n>", String(sp.minutes))) bad.push(`${label}[${i}] pill ${JSON.stringify(g.pill)}`);
      if ((g.why ?? undefined) !== sp.why) bad.push(`${label}[${i}] why ${JSON.stringify(g.why)} != ${JSON.stringify(sp.why)}`);
    } else {
      if (g.text !== it.text) bad.push(`${label}[${i}] text ${JSON.stringify(g.text)} != the line as written ${JSON.stringify(it.text)}`);
      if (g.pill !== null) bad.push(`${label}[${i}] a pill on a line with no minutes`);
    }
    if ((g.chip ?? undefined) !== it.ref) bad.push(`${label}[${i}] chip ${JSON.stringify(g.chip)} != ref ${JSON.stringify(it.ref)}`);
  });
  return bad;
}

// ---------------------------------------------------------------- the § 5.7 fixture

test("§ 5.7 fixture holds what Home's tests need: Goal, Budget per day, lines under Waiting on you and To do (one without minutes), a To do path to an application file, and a last reply over 280 characters with tool parts", () => {
  const b = readPlanBoard(FILES["plan.md"]);
  assert.ok(b.goalLine && b.budgetLine);
  assert.equal(budgetMinutesPerDay(b.budgetLine), 45);
  assert.ok(sec(FILES["plan.md"], W)!.items.length > 0);
  const todo = sec(FILES["plan.md"], T)!.items;
  assert.ok(todo.some((i) => !splitPlanMinutes(i.text)) && todo.some((i) => splitPlanMinutes(i.text)));
  assert.ok([...sec(FILES["plan.md"], W)!.items, ...todo].some((i) => i.ref?.startsWith("applications/")));
  const last = MESSAGES[MESSAGES.length - 1];
  assert.equal(last.role, "assistant");
  assert.ok(last.parts.some((p: any) => p.type === "text" && p.text.length > 280));
  assert.ok(last.parts.some((p: any) => p.type.startsWith("tool-")));
});

test("§ 5.3 Home on the § 5.7 fixture (real shell, saved conversation, 1440): lands on Home (§ 5.1); Goal and Budget word for word; six counts in jobs.md's order equal load()'s rows by stage; Waiting on you then To do, each item through the plan item; no sum (a To do line has no minutes); Ten's last reply, its label, the cut quote; Continue with Ten", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const landed = await title(r.page);
  const h = await readHome(r.page);
  await shot(r.page, "home-fixture-1440");
  const s = await spy(r.page);
  // Home's own reads: leave and come back, and look only at what that show read
  // (the shell itself may read a card's ref for the viewer at load).
  await go(r.page, "Documents");
  const n0 = (await spy(r.page)).reads.length;
  await go(r.page, "Home");
  await r.page.waitForTimeout(300);
  const homeReads = (await spy(r.page)).reads.slice(n0);
  await ctx.close();
  const bad: string[] = [];
  if (landed !== "Home") bad.push(`landed on "${landed}", § 5.1 says Home for a saved conversation with no pending gate`);
  const b = readPlanBoard(FILES["plan.md"]);
  if (h.goal !== b.goalLine) bad.push(`goal ${JSON.stringify(h.goal)}`);
  if (h.budget !== b.budgetLine) bad.push(`budget ${JSON.stringify(h.budget)}`);
  const want = await loadCounts(FILES["jobs.md"]);
  const labels = [...(STAGES as string[]), S.dismissed];
  if (JSON.stringify(h.cells) !== JSON.stringify(labels.map((l, i) => [l, String(want[i])]))) bad.push(`counts ${JSON.stringify(h.cells)} != load() ${JSON.stringify(labels.map((l, i) => [l, want[i]]))}`);
  if (JSON.stringify(h.cols.map((c: any) => c.heading)) !== JSON.stringify([W, T])) bad.push(`plan headings ${JSON.stringify(h.cols.map((c: any) => c.heading))}`);
  bad.push(...checkItems(W, h.cols[0]?.items ?? [], sec(FILES["plan.md"], W)!.items));
  bad.push(...checkItems(T, h.cols[1]?.items ?? [], sec(FILES["plan.md"], T)!.items));
  if (h.cols[1]?.sum !== null) bad.push(`a minutes sum "${h.cols[1]?.sum}" with a To do line that has no minutes`);
  const lastText = MESSAGES[MESSAGES.length - 1].parts.filter((p: any) => p.type === "text" && p.text.trim()).pop().text;
  if (h.quote !== specQuote(lastText)) bad.push(`quote ${JSON.stringify(h.quote?.slice(-40))} != ${JSON.stringify(specQuote(lastText).slice(-40))}`);
  if (!h.text.includes(S.lastReplyLabel)) bad.push(`no "${S.lastReplyLabel}" label`);
  if (!h.buttons.includes(S.continue)) bad.push(`no "${S.continue}" button: ${JSON.stringify(h.buttons)}`);
  if (s.writes.length || s.uploads.length || r.proxyHits || s.saves) bad.push(`writes ${s.writes} uploads ${s.uploads} model ${r.proxyHits} saves ${s.saves}`);
  const readsOther = homeReads.filter((p: string) => !["plan.md", "jobs.md"].includes(p));
  if (readsOther.length) bad.push(`Home read files beyond § 5.3's plan.md and jobs.md: ${JSON.stringify(readsOther)}`);
  assert.deepEqual(bad, []);
});

test("§ 5.3 'The plan item' / § 5.2 rule 3: 'Backticked paths inside the action stay as written' — a path mid-sentence is not cut out of the line (the chip is added, the words are not taken away)", async () => {
  const plan = "Goal: g\nBudget: 45 min/day\n\n## Board\n\nWaiting on you\n- Tell me if `company/acme.md` is still right\n\nTo do\n- Read `applications/acme-letter.md` before the call — 5 min — so you know what you sent\n";
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "plan.md": plan });
  const h = await readHome(r.page);
  await shot(r.page, "home-mid-line-path-1440");
  await ctx.close();
  const bad = [...checkItems(W, h.cols[0]?.items ?? [], sec(plan, W)!.items), ...checkItems(T, h.cols[1]?.items ?? [], sec(plan, T)!.items)];
  assert.deepEqual(bad, []);
});

test("§ 5.3 'The activity line' on the § 5.7 fixture: Home's lines under the last reply are exactly the collapsed lines Talk to Ten shows for that message, one per tool group, in order", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const h = await readHome(r.page);
  await go(r.page, "Talk to Ten");
  const talk = await r.page.locator(".bubble--assistant").last().evaluate((e) => Array.from(e.querySelectorAll(".tool-run-toggle")).map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim()));
  await ctx.close();
  assert.ok(talk.length > 0, "Talk to Ten shows no tool line for the last message");
  assert.deepEqual(h.activity, talk);
});

// Lead ruling, Stage 3c review round 1: Stage 4. § 5.3's activity line says
// Home and Talk to Ten change together when the § 3 amendment lands
// (TOOL_LABELS in packages/agent/src/helpers.ts). 3c's requirement is one
// function and no words of Home's own (the "ran " test above). Kept, todo.
test("§ 5.3 'The activity line' in § 5.3.1's words (L1-L20, § 3: `Read its instructions · Searched the web ×3`) on the § 5.7 fixture's last message", { todo: "Stage 4: § 5.3 activity line — Home and Talk to Ten change together when the § 3 amendment (TOOL_LABELS) lands" }, async () => {
  const last = MESSAGES[MESSAGES.length - 1];
  const lines: string[] = [];
  let group: string[] = [];
  const flush = () => {
    if (!group.length) return;
    const out: string[] = [];
    for (let i = 0; i < group.length; ) {
      let n = 1;
      while (group[i + n] === group[i]) n++;
      out.push(n > 1 ? `${group[i]} ×${n}` : group[i]);
      i += n;
    }
    lines.push(out.join(" · "));
    group = [];
  };
  for (const p of last.parts) {
    if (!p.type.startsWith("tool-")) {
      flush();
      continue;
    }
    const name = p.type.slice(5);
    let key = name;
    if (name === "bash") key = `bash: ${(String(p.input?.command ?? "").match(/([a-z_]+)\.(?:mjs|py)\b/) ?? [])[1]}`;
    group.push(L_WORDS.get(key) ?? L_OTHER);
  }
  flush();
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const h = await readHome(r.page);
  await ctx.close();
  assert.deepEqual(h.activity, lines);
});

test("§ 5.3 counts by code (rule 14): on a jobs.md with uneven stages, a lying `**Active: 99**` line and a fake row after `## Search notes`, Home's six counts equal load()'s rows by stage; a 0 shows as 0", async () => {
  const want = await loadCounts(EDGE_JOBS);
  assert.deepEqual(want, [2, 0, 3, 1, 0, 2], "load() itself (the fixture's intent)");
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "jobs.md": EDGE_JOBS, "plan.md": FILES["plan.md"] });
  const h = await readHome(r.page);
  await ctx.close();
  const labels = [...(STAGES as string[]), S.dismissed];
  assert.deepEqual(h.cells, labels.map((l, i) => [l, String(want[i])]));
  assert.ok(!h.text.includes("99"), "the bold Active: line leaked onto Home");
});

test("§ 5.3 'The minutes sum' on the page: every To do item with minutes and `Budget: 45 min/day` shows H8 '<N> of your <M> min a day' in To do's header; N > M is shown as is, not amber or red", async () => {
  const mvp = fx("mvp-journey").files["plan.md"] as string;
  const over = "Goal: g\nBudget: 20 min/day\n\n## Board\n\nWaiting on you\n- q — 99 min\n\nTo do\n- a — 15 min — w\n- b — 10 min\n";
  const bad: string[] = [];
  for (const [plan, n, m] of [[mvp, 17, 45], [over, 25, 20]] as const) {
    const ctx = await ctxFor(DESK);
    const r = await openReal(ctx, { "plan.md": plan });
    const h = await readHome(r.page);
    const want = S.minutesSum.replace("<N>", String(n)).replace("<M>", String(m));
    if (h.cols[1]?.sum !== want) bad.push(`To do header sum ${JSON.stringify(h.cols[1]?.sum)} != ${JSON.stringify(want)}`);
    if (h.cols[0]?.sum !== null) bad.push(`Waiting on you carries a sum ${JSON.stringify(h.cols[0]?.sum)}`);
    const color = await pane(r.page).locator(".home-minutes-sum").evaluate((e) => getComputedStyle(e).color).catch(() => "");
    const tokens = await r.page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".app-root") ?? document.documentElement);
      return ["--amber", "--red"].map((v) => cs.getPropertyValue(v).trim());
    });
    const probe = await r.page.evaluate((vals) => vals.map((v) => {
      const d = document.createElement("div");
      d.style.color = v;
      document.body.appendChild(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    }), tokens.filter(Boolean));
    if (probe.includes(color)) bad.push(`N=${n} > M=${m}: the sum is drawn in ${color} (amber/red)`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.3 Empty and the band

test("§ 5.3 Home Empty with no conversation saved (P3): H17 + H18, and the one button reads 'Talk to Ten'; it opens Talk to Ten", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, {}, { seed: "none" });
  const landed = await title(r.page);
  await go(r.page, "Home");
  const h = await readHome(r.page);
  await shot(r.page, "home-empty-no-conversation-1440");
  const btn = pane(r.page).locator(".page-empty button");
  const label = squash((await btn.first().textContent().catch(() => "")) ?? "");
  await btn.first().click().catch(() => {});
  await r.page.waitForTimeout(200);
  const t = await title(r.page);
  const focused = await r.page.evaluate(() => !!document.activeElement?.closest(".composer"));
  const draft = await r.page.locator(".composer-input").inputValue();
  await ctx.close();
  const bad: string[] = [];
  if (landed !== "Talk to Ten") bad.push(`first run landed on "${landed}" (§ 5.1: Talk to Ten when no conversation is saved)`);
  if (!h.text.includes(`${S.emptyFirst} ${S.emptyRest}`)) bad.push(`empty text: ${h.text.slice(0, 160)}`);
  if (label !== S.talkToTen) bad.push(`the empty state's button reads "${label}"; § 5.3 Empty / § 5.3.1 P3: "${S.talkToTen}" when no conversation is saved yet`);
  if (h.buttons.includes(S.continue)) bad.push(`"${S.continue}" shows with no conversation saved`);
  if (t !== "Talk to Ten") bad.push(`the button opened "${t}"`);
  if (focused) bad.push("P3 focused the composer (§ 5.4 amended: only Continue with Ten focuses it)");
  if (draft !== "") bad.push(`P3 put a draft in the composer: ${JSON.stringify(draft)}`);
  assert.deepEqual(bad, []);
});

test("§ 5.3 Home Empty (P3 -> H3): once the first turn of a first run has ended and been saved, the empty Home's button reads Continue with Ten", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, {}, { seed: "none" });
  await r.page.locator(".composer-input").fill("hi");
  await r.page.locator(".composer-input").press("Enter");
  await idle(r.page);
  await r.page.waitForTimeout(300);
  const saves = (await spy(r.page)).saves;
  await go(r.page, "Home");
  const h = await readHome(r.page);
  await ctx.close();
  assert.equal(saves, 1, "the turn was not saved");
  assert.ok(h.buttons.includes(S.continue) && !h.buttons.includes(S.talkToTen), `buttons ${JSON.stringify(h.buttons)}`);
});

test("§ 5.3 Home Empty with a saved conversation: H17 + H18 and Continue with Ten (H3); Ten's last reply still shows above it under H1", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, {});
  const h = await readHome(r.page);
  await shot(r.page, "home-empty-saved-1440");
  await ctx.close();
  const bad: string[] = [];
  if (!h.empty) bad.push("no empty state");
  if (!h.text.includes(`${S.emptyFirst} ${S.emptyRest}`)) bad.push(`empty text: ${h.text.slice(0, 160)}`);
  if (h.buttons.filter((b: string) => b === S.continue).length !== 1) bad.push(`buttons ${JSON.stringify(h.buttons)}`);
  if (h.quote !== "Got it. Paste a posting whenever you have one.") bad.push(`quote ${JSON.stringify(h.quote)}`);
  if (!h.text.includes(S.lastReplyLabel)) bad.push("no H1 label");
  const iq = h.text.indexOf("Got it."), ie = h.text.indexOf(S.emptyFirst);
  if (!(iq >= 0 && ie > iq)) bad.push("the last reply is not above the empty state");
  assert.deepEqual(bad, []);
});

test("§ 5.3 Home Empty is 'the two files have no items and no unreadable lines between them': a plan.md with only its Goal and Budget lines and empty sections, and a jobs.md with no rows, show the empty state", async () => {
  const plan = "Goal: an offer by 2026-12-15\nBudget: 45 min/day\n\n## Board\n\nWaiting on you\n\nTo do\n\nDoing\n\nDone\n";
  const jobs = "# Pipeline\n\n**Active: 0** · dismissed: 0 · updated 2026-09-29\n\n## To Review\n\n## Interested\n\n## Applied\n\n## Interviewing\n\n## Offer\n";
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "plan.md": plan, "jobs.md": jobs });
  const h = await readHome(r.page);
  await shot(r.page, "home-empty-headlines-only-1440");
  await ctx.close();
  assert.ok(h.empty && h.text.includes(`${S.emptyFirst} ${S.emptyRest}`), `no empty state; Home shows: ${h.text.slice(0, 200)}`);
});

test("§ 5.3.1 C10: with no reply to show (a user message is last), the band reads H4 'Talk to Ten', no quote and no H1; Continue with Ten still shows", async () => {
  const msgs = [...MESSAGES, U("u-last", "one more thing — can you check the Cascadia posting?")];
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: msgs });
  const h = await readHome(r.page);
  const band = squash(await pane(r.page).locator(".home-continue-band").innerText().catch(() => ""));
  await ctx.close();
  const bad: string[] = [];
  if (h.quote !== null) bad.push(`an old reply shows as current: ${JSON.stringify(h.quote?.slice(0, 60))}`);
  if (h.text.includes(S.lastReplyLabel)) bad.push("H1 shows with no reply");
  if (!band.startsWith(S.bandNoReply)) bad.push(`band label: "${band}"`);
  if (!h.buttons.includes(S.continue)) bad.push("no Continue with Ten");
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.4 Continue with Ten

test("§ 5.4 Continue with Ten: at 1440 it opens Talk to Ten with the composer focused and no draft; at 375 it opens Talk to Ten unfocused, with the tab bar showing", async () => {
  const bad: string[] = [];
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const r = await openReal(ctx, FILES, { messages: MESSAGES });
    await pane(r.page).getByRole("button", { name: S.continue }).click();
    await r.page.waitForTimeout(300);
    const t = await title(r.page);
    const v = await r.page.locator(".composer-input").inputValue();
    const focused = await r.page.evaluate(() => !!document.activeElement?.closest(".composer"));
    if (t !== "Talk to Ten") bad.push(`${vp.width}: opened "${t}"`);
    if (v !== "") bad.push(`${vp.width}: a draft ${JSON.stringify(v)}`);
    if (vp === DESK && !focused) bad.push("1440: the composer is not focused");
    if (vp === PHONE && focused) bad.push("375: the composer was focused");
    if (vp === PHONE && !(await r.page.locator(".tabbar").isVisible())) bad.push("375: the tab bar is hidden");
    if (r.proxyHits) bad.push(`${vp.width}: ${r.proxyHits} model call(s)`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.2 rules 4 and 5, and the last reply's e2e case

test("§ 5.2 rules 4 and 5 + § 5.3's e2e case: while a turn runs Home shows F35 and no quote; the turn rewrites plan.md; at turn end Home shows the new lines and the new reply with no reload, and the old plan card in the conversation is unchanged", async () => {
  const oldPlan = "Goal: g\nBudget: 45 min/day\n\n## Board\n\nWaiting on you\n- Old question (`jd-analysis/old.md`)\n\nTo do\n- Old task one — 5 min — old why\n";
  const newPlan = "Goal: g\nBudget: 45 min/day\n\n## Board\n\nWaiting on you\n- New question for you\n\nTo do\n- New task A — 10 min — new why\n- New task B, a line with no minutes\n"; // no backticked path: the plan-item word-for-word finding is tested on the fixture, not here
  const oldItems = parsePlanTodo(oldPlan);
  const msgs = [U("u1", "make my plan"), A("a1", { type: "data-card", data: { card: "plan", ref: "plan.md", props: { stage: "applying", items: oldItems } } }, txt("That's your plan."))];
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "plan.md": oldPlan }, { messages: msgs, holdTurns: true, reply: "I rewrote your plan." });
  const page = r.page;
  const bad: string[] = [];
  const h0 = await readHome(page);
  bad.push(...checkItems(`before ${T}`, h0.cols[1]?.items ?? [], oldItems));
  await go(page, "Talk to Ten");
  const card0 = squash(await page.locator(".card--plan").first().innerText());
  await page.locator(".composer-input").fill("rewrite my plan");
  await page.locator(".composer-input").press("Enter");
  await page.waitForTimeout(300);
  await go(page, "Home");
  const during = await readHome(page);
  await shot(page, "home-during-turn-1440");
  if (!during.text.includes(S.working)) bad.push(`no F35 line while the turn runs: ${during.text.slice(0, 160)}`);
  if (during.quote !== null) bad.push(`a quote shows while a turn runs: ${JSON.stringify(during.quote)}`);
  const readsBefore = (await spy(page)).reads.length;
  await page.evaluate((c) => (window as any).__inner.read("plan.md").then((f: any) => (window as any).__inner.write("plan.md", c, String(f.version))), newPlan);
  r.release();
  await idle(page);
  await page.waitForTimeout(500);
  const h1 = await readHome(page);
  await shot(page, "home-after-turn-1440");
  const s = await spy(page);
  if (!s.reads.slice(readsBefore).includes("plan.md")) bad.push("no fresh read of plan.md at turn end");
  bad.push(...checkItems(`after ${W}`, h1.cols[0]?.items ?? [], sec(newPlan, W)!.items));
  bad.push(...checkItems(`after ${T}`, h1.cols[1]?.items ?? [], sec(newPlan, T)!.items));
  if (h1.text.includes(S.working)) bad.push("F35 still shows after the turn");
  if (h1.quote !== "I rewrote your plan.") bad.push(`quote after the turn ${JSON.stringify(h1.quote)}`);
  await go(page, "Talk to Ten");
  const card1 = squash(await page.locator(".card--plan").first().innerText());
  if (card1 !== card0) bad.push(`the old plan card changed: ${JSON.stringify(card0)} -> ${JSON.stringify(card1)}`);
  for (const it of oldItems) if (!card1.includes(squash(it.text).slice(0, 20))) bad.push(`old card lost ${it.text}`);
  if (s.saves !== 1) bad.push(`${s.saves} saves for one ended turn`);
  if (s.writes.length) bad.push(`writes ${s.writes}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 4 'reads when shown': leaving Home and coming back reads plan.md and jobs.md again; a file the agent wrote meanwhile shows", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const page = r.page;
  await go(page, "Documents");
  const n0 = (await spy(page)).reads.length;
  await page.evaluate(() => (window as any).__inner.read("plan.md").then((f: any) => (window as any).__inner.write("plan.md", "Goal: a brand new goal\n", String(f.version))));
  await go(page, "Home");
  const h = await readHome(page);
  const reads = (await spy(page)).reads.slice(n0);
  await ctx.close();
  assert.ok(reads.includes("plan.md") && reads.includes("jobs.md"), `reads on return: ${JSON.stringify(reads)}`);
  assert.equal(h.goal, "Goal: a brand new goal");
});

// ---------------------------------------------------------------- § 5.2 rule 6

test("§ 5.2 rule 6 on Home: a non-missing read failure of plan.md shows F40 'Couldn't read plan.md. Try again in a moment.' with Retry, never the empty state; Retry reads again and shows the plan", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const page = r.page;
  await go(page, "Documents");
  await page.evaluate(() => ((window as any).__ctl.readFail = ["plan.md"]));
  await go(page, "Home");
  const h = await readHome(page);
  await shot(page, "home-plan-read-error-1440");
  await page.evaluate(() => ((window as any).__ctl.readFail = []));
  await pane(page).getByRole("button", { name: S.retry }).first().click().catch(() => {});
  const h2 = await readHome(page);
  await ctx.close();
  const bad: string[] = [];
  const want = S.cantRead.replace("<path>", "plan.md");
  if (!h.text.includes(want)) bad.push(`no "${want}": ${h.text.slice(0, 160)}`);
  if (!h.buttons.includes(S.retry)) bad.push("no Retry");
  if (h.empty || h.text.includes(S.emptyFirst) || h.text.includes(S.nothingRightNow)) bad.push("the failure shows an empty state");
  if (h2.goal !== readPlanBoard(FILES["plan.md"]).goalLine) bad.push(`Retry did not show the plan: ${h2.text.slice(0, 120)}`);
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 6 on Home: a non-missing read failure of jobs.md shows F40 for jobs.md with Retry, never 0 counts; Retry shows the counts", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const page = r.page;
  await go(page, "Documents");
  await page.evaluate(() => ((window as any).__ctl.readFail = ["jobs.md"]));
  await go(page, "Home");
  const h = await readHome(page);
  await page.evaluate(() => ((window as any).__ctl.readFail = []));
  await pane(page).getByRole("button", { name: S.retry }).first().click().catch(() => {});
  const h2 = await readHome(page);
  await ctx.close();
  const bad: string[] = [];
  const want = S.cantRead.replace("<path>", "jobs.md");
  if (!h.text.includes(want)) bad.push(`no "${want}": ${h.text.slice(0, 160)}`);
  if (h.cells.length) bad.push(`counts shown over a failed read: ${JSON.stringify(h.cells)}`);
  if (h.empty) bad.push("the failure shows the empty state");
  if (h2.cells.length !== 6) bad.push("Retry did not show the counts");
  assert.deepEqual(bad, []);
});

test("§ 5.2 rule 6 'missing is empty' by code (the real store's packages/agent WorkspaceError class): plan.md and jobs.md both resource_missing show Home's empty state, no F40", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const page = r.page;
  await go(page, "Documents");
  await page.evaluate(() => ((window as any).__ctl.readMissing = ["plan.md", "jobs.md"]));
  await go(page, "Home");
  const h = await readHome(page);
  await ctx.close();
  const [pre] = S.cantRead.split("<path>");
  assert.ok(!h.text.includes(pre), `missing files are loud: ${h.text.slice(0, 160)}`);
  assert.ok(h.empty && h.text.includes(S.emptyFirst), `no empty state: ${h.text.slice(0, 160)}`);
});

test("§ 5.2 rule 6 unreadable lines: a plan.md with a prose line before To do's first item shows F42 'This page couldn't read these lines of plan.md:', the line as written, and a link that opens plan.md; To do's items still show; never 'Nothing here right now.' for To do", async () => {
  const plan = "Goal: g\nBudget: 45 min/day\n\n## Board\n\nWaiting on you (1)\n- Tell me the comp floor\n\nTo do\nI'll sort these after the call:\n- Prep the loop — 15 min — the screen is Thursday\n";
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "plan.md": plan, "jobs.md": FILES["jobs.md"] });
  const page = r.page;
  const h = await readHome(page);
  await shot(page, "home-unreadable-1440");
  const bad: string[] = [];
  const head = S.unreadable.replace("<path>", "plan.md");
  const [wCol, tCol] = h.cols;
  if (!tCol?.unreadable || !squash(tCol.unreadable).includes(head)) bad.push(`To do: no F42 heading: ${JSON.stringify(tCol?.unreadable)}`);
  if (!tCol?.unreadable?.includes("I'll sort these after the call:")) bad.push("To do: the line is not shown as written");
  bad.push(...checkItems(T, tCol?.items ?? [], [{ text: "Prep the loop — 15 min — the screen is Thursday" }]));
  if (tCol?.empty === S.nothingRightNow) bad.push("To do reads 'Nothing here right now.'");
  if (!wCol?.unreadable?.includes("- Tell me the comp floor")) bad.push(`Waiting on you (1): the line is not shown loudly: ${JSON.stringify(wCol)}`);
  if (wCol?.empty === S.nothingRightNow) bad.push("Waiting on you reads 'Nothing here right now.' over a line it couldn't read");
  if (tCol?.sum !== null) bad.push("a minutes sum with an unreadable line in To do");
  await pane(page).locator(".unreadable-lines").last().getByRole("button", { name: "plan.md" }).click().catch(() => bad.push("no plan.md link beside F42"));
  await page.waitForTimeout(250);
  const opened = await page.locator(".side-panel .side-panel-path").textContent().catch(() => null);
  if (opened !== "plan.md") bad.push(`the link opened ${opened}`);
  await ctx.close();
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.2 rule 8 and rules 1-2 (spies)

test("§ 5.2 rule 8 from Home: a plan item's chip opens that path in the one viewer (a .md through MarkdownView); on Home the viewer shows only while a file is open, with a ✕ that closes it", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const page = r.page;
  const bad: string[] = [];
  const before = await page.locator(".side-panel--open").count();
  const ref = sec(FILES["plan.md"], T)!.items.find((i) => i.ref)!.ref!;
  await pane(page).locator(".plan-item-chip", { hasText: ref }).first().click();
  await page.waitForTimeout(300);
  const v = await page.locator(".side-panel").evaluate((e) => ({ path: e.querySelector(".side-panel-path")?.textContent, md: !!e.querySelector(".markdown-view") }));
  await shot(page, "home-viewer-1440");
  if (before) bad.push("a viewer is open on Home with no file");
  if (v.path !== ref || !v.md) bad.push(`viewer ${JSON.stringify(v)} for ${ref}`);
  const close = page.locator(".side-panel").getByRole("button", { name: "Close" });
  if (!(await close.isVisible())) bad.push("no ✕ (Close) on Home's viewer");
  else {
    await close.click();
    await page.waitForTimeout(300);
    if (await page.locator(".side-panel--open").count()) bad.push("✕ did not close the viewer");
  }
  await ctx.close();
  assert.deepEqual(bad, []);
});

test("§ 5.2 rules 1-2 on Home and the rail (real shell, 1440 and 375): every control on Home and every rail/tab item — zero write/upload calls, zero model calls, zero saves, and zero calls to any function useChat returns", async () => {
  const plan = FILES["plan.md"].replace("To do\n", "To do\nA line this page can't read\n");
  const files = { ...FILES, "plan.md": plan };
  const bad: string[] = [];
  for (const vp of [DESK, PHONE]) {
    const ctx = await ctxFor(vp);
    const r = await openReal(ctx, files, { messages: MESSAGES });
    const page = r.page;
    const fns = await page.evaluate(() => (window as any).__chatFns as string[]);
    if (!fns.includes("sendMessage")) bad.push(`${vp.width}: the useChat spy is not in place (${JSON.stringify(fns)})`);
    await page.evaluate(() => ((window as any).__chatSpyOn = true));
    let clicks = 0;
    if ((await title(page)) !== "Home") await go(page, "Home");
    const n = await pane(page).getByRole("button").count();
    for (let i = 0; i < n; i++) {
      if ((await title(page)) !== "Home") await go(page, "Home");
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const b = pane(page).getByRole("button").nth(i);
      await b.click({ timeout: 2000 }).catch(() => {});
      clicks++;
      await page.waitForTimeout(100);
      const back = page.locator(".side-panel-back");
      if (await back.isVisible().catch(() => false)) await back.click().catch(() => {});
      const close = page.locator(".side-panel--open").getByRole("button", { name: "Close" });
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    }
    for (const name of ["Home", "Talk to Ten", "Jobs", "Applications", "Documents", "Home"]) {
      await go(page, name);
      clicks++;
    }
    await page.waitForTimeout(400);
    const s = await spy(page);
    const calls = await page.evaluate(() => (window as any).__chatCalls as string[]);
    if (s.writes.length || s.uploads.length) bad.push(`${vp.width}: write ${JSON.stringify(s.writes)} upload ${JSON.stringify(s.uploads)}`);
    if (r.proxyHits) bad.push(`${vp.width}: ${r.proxyHits} model call(s)`);
    if (s.saves) bad.push(`${vp.width}: ${s.saves} save(s)`);
    if (calls.length) bad.push(`${vp.width}: useChat functions called: ${JSON.stringify(calls)}`);
    if (clicks < 12) bad.push(`${vp.width}: only ${clicks} clicks — vacuous`);
    console.log(`# ${vp.width}: ${clicks} clicks; useChat functions spied: ${fns.join(", ")}`);
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- § 5.5 phone

test("§ 5.5 at 375px on Home (§ 5.7 fixture): no horizontal scroll; the pipeline counts form a 3 × 2 grid; the two plan cards stack", async () => {
  const ctx = await ctxFor(PHONE);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  const page = r.page;
  await page.waitForTimeout(200);
  await shot(page, "home-fixture-375");
  const lay = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>(".frame-page:not(.frame-page--hidden) .home-pipeline-cell")).map((e) => e.getBoundingClientRect());
    const cols = Array.from(document.querySelectorAll<HTMLElement>(".frame-page:not(.frame-page--hidden) .home-plan-column")).map((e) => e.getBoundingClientRect());
    return {
      sw: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      rows: [...new Set(cells.map((c) => Math.round(c.top)))].length,
      perRow: [...new Set(cells.map((c) => Math.round(c.left)))].length,
      stacked: cols.length === 2 && cols[1].top >= cols[0].bottom - 1,
    };
  });
  await ctx.close();
  const bad: string[] = [];
  if (lay.sw > lay.vw) bad.push(`scrollWidth ${lay.sw} > ${lay.vw}`);
  if (lay.rows !== 2 || lay.perRow !== 3) bad.push(`pipeline grid ${lay.perRow} × ${lay.rows}, § 5.5 says 3 × 2`);
  if (!lay.stacked) bad.push("the plan cards do not stack");
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- round 2

test("§ 5.3 'Shows' order (lead ruling, round 1: § 5.3 and § 5.6's amended 'To restore' Home bullet): the goal, the pipeline strip, the last-reply band, then Waiting on you and To do", async () => {
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, FILES, { messages: MESSAGES });
  await r.page.waitForTimeout(300);
  const tops = await pane(r.page).evaluate((root) =>
    [".home-goal", ".home-pipeline", ".home-continue-band", ".home-plan-columns"].map((sel) => {
      const e = root.querySelector(sel);
      return e ? Math.round(e.getBoundingClientRect().top) : null;
    }),
  );
  await ctx.close();
  assert.ok(tops.every((t) => t !== null), `missing a block: ${JSON.stringify(tops)}`);
  const sorted = [...(tops as number[])].sort((a, b) => a - b);
  assert.deepEqual(tops, sorted, `top edges goal/pipeline/band/plan: ${JSON.stringify(tops)}`);
});

test("§ 5.3 counts by code over the port's io: a jobs.md with lone-CR line endings counts its rows as load() does over the ports' own node io (universalNewlines)", async () => {
  const cr = EDGE_JOBS.replace(/\n/g, "\r");
  const want = await loadCounts(cr);
  assert.deepEqual(want, [2, 0, 3, 1, 0, 2]);
  const ctx = await ctxFor(DESK);
  const r = await openReal(ctx, { "jobs.md": cr, "plan.md": FILES["plan.md"] });
  const h = await readHome(r.page);
  await ctx.close();
  assert.deepEqual(h.cells.map((c: string[]) => c[1]), want.map(String));
});

test("§ 5.6 viewer close control on Home at 1440 (Home's ✕), 900 (the drawer, 'a close ✕') and 375 (the sheet's back arrow, § 5.5): a chip opens the file; the control named Close is visible and closes it; at 375 focus returns to the chip", async () => {
  const bad: string[] = [];
  for (const vp of [DESK, { width: 900, height: 800 }, PHONE]) {
    const ctx = await ctxFor(vp);
    const r = await openReal(ctx, FILES, { messages: MESSAGES });
    const page = r.page;
    const ref = sec(FILES["plan.md"], T)!.items.find((i) => i.ref)!.ref!;
    const chip = pane(page).locator(".plan-item-chip", { hasText: ref }).first();
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await page.waitForTimeout(300);
    const v = await page.locator(".side-panel").evaluate((e) => {
      const b = e.querySelector<HTMLElement>(".side-panel-back");
      const vis = (x: Element | null) => !!x && (x as HTMLElement).getClientRects().length > 0 && getComputedStyle(x).display !== "none";
      const svgs = b ? Array.from(b.querySelectorAll("svg")).filter((s) => vis(s)).length : 0;
      return { path: e.querySelector(".side-panel-path")?.textContent, open: e.classList.contains("side-panel--open"), closeVisible: vis(b), glyphs: svgs };
    });
    await shot(page, `r2-home-viewer-${vp.width}`);
    if (!v.open || v.path !== ref) bad.push(`${vp.width}: the chip did not open ${ref}: ${JSON.stringify(v)}`);
    if (!v.closeVisible) bad.push(`${vp.width}: no visible Close control`);
    if (v.glyphs !== 1) bad.push(`${vp.width}: the Close control draws ${v.glyphs} glyphs, want exactly one`);
    await page.locator(".side-panel").getByRole("button", { name: "Close" }).click().catch(() => bad.push(`${vp.width}: Close not clickable`));
    await page.waitForTimeout(400);
    if (await page.locator(".side-panel--open").count()) bad.push(`${vp.width}: Close did not close the viewer`);
    if (vp === PHONE && !(await chip.evaluate((e) => document.activeElement === e))) bad.push("375: focus did not return to the chip");
    await ctx.close();
  }
  assert.deepEqual(bad, []);
});

test("no request left this origin in any test above", () => {
  assert.deepEqual([...new Set(external)], []);
});
