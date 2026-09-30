// § 6.2 — feeds REAL-shaped script stdout (matching apps/web/fixtures'
// mvp-journey.json, which was captured by running the actual scripts)
// through the card builder and checks the table's props/ref mapping.
import assert from "node:assert/strict";
import test from "node:test";
import { CardBuilder } from "../src/cards.ts";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";

test("estimate_cost always produces a cost card from the result", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore();
  const cards = await cb.forToolResult(
    "estimate_cost",
    { action: "evaluate 6 roles", steps: 6, webSearches: 6 },
    { action: "evaluate 6 roles", lowUsd: 0.4, highUsd: 1.2, balanceUsd: 4.2, needsGate: true, method: "measured" },
    ws,
  );
  assert.deepEqual(cards, [
    { card: "cost", props: { action: "evaluate 6 roles", lowUsd: 0.4, highUsd: 1.2, balanceUsd: 4.2 } },
  ]);
});

test("bash record_verdict.py, exit 0 -> verdict card from the jobs.md row it wrote", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore({
    "jobs.md": [
      "# Pipeline",
      "",
      "## To Review",
      "",
      "### Acme — Staff PM",
      "- URL: https://boards.greenhouse.io/acme/jobs/4102938",
      "- Verdict: strong",
      "- Score: 82",
      "- Reason: 8 years of B2B SaaS platform PM experience matches the core ask",
      "- Track: A",
      // design-web-search.md § 7.1 (S1): `Analysis` is the field the
      // verdict card's `ref` reads now, never `JD` (the raw posting).
      "- Analysis: jd-analysis/acme-staff-pm.md",
      "",
    ].join("\n"),
  });
  const cards = await cb.forToolResult(
    "bash",
    { command: 'node evaluate/scripts/record_verdict.mjs --workspace . --company Acme --title "Staff PM" --verdict strong --score 82 --track A --reasons "x" --analysis-file jd-analysis/acme-staff-pm.md' },
    { stdout: "recorded (created NEW role): Acme — Staff PM → strong (82)", stderr: "", exitCode: 0, changed: ["jobs.md"] },
    ws,
  );
  assert.deepEqual(cards, [
    {
      card: "verdict",
      ref: "jd-analysis/acme-staff-pm.md",
      props: {
        company: "Acme",
        title: "Staff PM",
        verdict: "strong",
        score: 82,
        track: "A",
        reason: "8 years of B2B SaaS platform PM experience matches the core ask",
        dealbreakers: undefined,
      },
    },
  ]);
});

test("bash record_verdict.py: no analysis_file row -> card has no ref (never guesses a path)", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore({
    // A stage heading is required for the real port's load() to parse a
    // row at all (S2 review blocker 4: the verdict card now reads jobs.md
    // through skills/search/scripts/lib/jobs-md.mjs, not the retired
    // stub's lenient regex) — a real jobs.md always has one.
    "jobs.md": ["## To Review", "", "### Beta — PM", "- Verdict: weak", "- Score: 40", "- Reason: no fit", ""].join("\n"),
  });
  const cards = await cb.forToolResult(
    "bash",
    { command: "node evaluate/scripts/record_verdict.mjs --company Beta --title PM --verdict weak" },
    { stdout: "recorded", stderr: "", exitCode: 0, changed: ["jobs.md"] },
    ws,
  );
  assert.equal(cards.length, 1);
  assert.equal("ref" in cards[0], false);
});

test("bash check_materials.py -> one checker card per checked file, findings word for word", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore();
  const stdout = [
    "structure tier, base résumé loaded for the verbatim check",
    "",
    "RESUME acme-staff-pm-resume.md: FAIL (1 fail, 0 warn)",
    "  [FAIL] Experience bullet not verbatim: \"led the migration\" vs base \"owned the migration\"",
    "",
    "LETTER acme-staff-pm-cover-letter.md: pass (0 fail, 0 warn)",
    "",
  ].join("\n");
  const cards = await cb.forToolResult(
    "bash",
    { command: "node apply/scripts/check_materials.mjs --workspace . --resume applications/acme-staff-pm-resume.md --letter applications/acme-staff-pm-cover-letter.md --base base-resume.md" },
    { stdout, stderr: "", exitCode: 0, changed: [] },
    ws,
  );
  assert.deepEqual(cards, [
    {
      card: "checker",
      ref: "applications/acme-staff-pm-resume.md",
      props: {
        label: "RESUME",
        name: "acme-staff-pm-resume.md",
        status: "FAIL",
        failCount: 1,
        warnCount: 0,
        findings: [{ level: "FAIL", message: 'Experience bullet not verbatim: "led the migration" vs base "owned the migration"' }],
      },
    },
    {
      card: "checker",
      ref: "applications/acme-staff-pm-cover-letter.md",
      props: {
        label: "LETTER",
        name: "acme-staff-pm-cover-letter.md",
        status: "pass",
        failCount: 0,
        warnCount: 0,
        findings: [],
      },
    },
  ]);
});

test("bash render_resume.py, exit 0 -> document card; badge from the chat's latest checker result for that .md", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore();
  // no checker has run yet for this .md -> not-run
  let cards = await cb.forToolResult(
    "bash",
    { command: "node apply/scripts/render_resume.mjs --md applications/r.md --html applications/r.html" },
    { stdout: "words: 109  ->  applications/r.html", stderr: "", exitCode: 0, changed: ["applications/r.html"] },
    ws,
  );
  assert.deepEqual(cards, [{ card: "document", ref: "applications/r.md", props: { words: 109, htmlPath: "applications/r.html", checker: "not-run" } }]);

  // after a clean checker card for the SAME .md, the badge is "clean"
  await cb.forToolResult(
    "bash",
    { command: "node apply/scripts/check_materials.mjs --resume applications/r.md" },
    { stdout: "RESUME r.md: pass (0 fail, 0 warn)\n", stderr: "", exitCode: 0, changed: [] },
    ws,
  );
  cards = await cb.forToolResult(
    "bash",
    { command: "node apply/scripts/render_resume.mjs --md applications/r.md --html applications/r.html" },
    { stdout: "words: 112  ->  applications/r.html", stderr: "", exitCode: 0, changed: ["applications/r.html"] },
    ws,
  );
  assert.equal((cards[0].props as any).checker, "clean");
});

test("bash check_materials.py, pass with a warning -> document badge is \"warn\" with warnCount, never \"clean\" (design-honest-ceilings.md § 6A)", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore();
  await cb.forToolResult(
    "bash",
    { command: "node apply/scripts/check_materials.mjs --resume applications/w.md" },
    { stdout: "RESUME w.md: pass (0 fail, 1 warn)\n  [WARN] letter is 127 words\n", stderr: "", exitCode: 0, changed: [] },
    ws,
  );
  const cards = await cb.forToolResult(
    "bash",
    { command: "node apply/scripts/render_resume.mjs --md applications/w.md --html applications/w.html" },
    { stdout: "words: 109  ->  applications/w.html", stderr: "", exitCode: 0, changed: ["applications/w.html"] },
    ws,
  );
  assert.equal((cards[0].props as any).checker, "warn");
  assert.equal((cards[0].props as any).warnCount, 1);

  // a pass with NO warnings still gives "clean" (unchanged)
  const cb2 = new CardBuilder();
  const ws2 = createInMemoryWorkspaceStore();
  await cb2.forToolResult(
    "bash",
    { command: "node apply/scripts/check_materials.mjs --resume applications/c.md" },
    { stdout: "RESUME c.md: pass (0 fail, 0 warn)\n", stderr: "", exitCode: 0, changed: [] },
    ws2,
  );
  const cleanCards = await cb2.forToolResult(
    "bash",
    { command: "node apply/scripts/render_resume.mjs --md applications/c.md --html applications/c.html" },
    { stdout: "words: 109  ->  applications/c.html", stderr: "", exitCode: 0, changed: ["applications/c.html"] },
    ws2,
  );
  assert.equal((cleanCards[0].props as any).checker, "clean");
  assert.equal((cleanCards[0].props as any).warnCount, undefined);
});

test("bash check_closeout.py, exit 0 -> plan card via parsePlanTodo(plan.md), ref plan.md", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore({
    "plan.md": ["Goal: x", "", "To do", "- Send it (`applications/x.md`) — 5 min", "", "Doing", "", "Done", ""].join("\n"),
  });
  const cards = await cb.forToolResult(
    "bash",
    { command: "node coach/scripts/check_closeout.mjs --workspace . --stage applying" },
    { stdout: "close-out clean", stderr: "", exitCode: 0, changed: [] },
    ws,
  );
  assert.deepEqual(cards, [
    {
      card: "plan",
      ref: "plan.md",
      props: { stage: "applying", items: [{ text: "Send it (`applications/x.md`) — 5 min", ref: "applications/x.md" }] },
    },
  ]);
});

test("a non-zero exit produces no card", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore();
  const cards = await cb.forToolResult(
    "bash",
    { command: "node coach/scripts/check_closeout.mjs --stage applying" },
    { stdout: "", stderr: "FAIL", exitCode: 1, changed: [] },
    ws,
  );
  assert.deepEqual(cards, []);
});

test("model output cannot produce a card: only estimate_cost/bash tool results reach the builder", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore();
  const cards = await cb.forToolResult("write_file", { path: "x.md", content: "hi" }, { path: "x.md", written: true }, ws);
  assert.deepEqual(cards, []);
});
