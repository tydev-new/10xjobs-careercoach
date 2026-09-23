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
      "- JD: jd-analysis/acme-staff-pm.md",
      "",
    ].join("\n"),
  });
  const cards = await cb.forToolResult(
    "bash",
    { command: 'python3 evaluate/scripts/record_verdict.py --workspace . --company Acme --title "Staff PM" --verdict strong --score 82 --track A --reasons "x" --jd-file jd-analysis/acme-staff-pm.md' },
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

test("bash record_verdict.py: no jd_file row -> card has no ref (never guesses a path)", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore({
    "jobs.md": ["### Beta — PM", "- Verdict: weak", "- Score: 40", "- Reason: no fit", ""].join("\n"),
  });
  const cards = await cb.forToolResult(
    "bash",
    { command: "python3 evaluate/scripts/record_verdict.py --company Beta --title PM --verdict weak" },
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
    { command: "python3 apply/scripts/check_materials.py --workspace . --resume applications/acme-staff-pm-resume.md --letter applications/acme-staff-pm-cover-letter.md --base base-resume.md" },
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
    { command: "python3 apply/scripts/render_resume.py --md applications/r.md --html applications/r.html" },
    { stdout: "words: 109  ->  applications/r.html", stderr: "", exitCode: 0, changed: ["applications/r.html"] },
    ws,
  );
  assert.deepEqual(cards, [{ card: "document", ref: "applications/r.md", props: { words: 109, htmlPath: "applications/r.html", checker: "not-run" } }]);

  // after a clean checker card for the SAME .md, the badge is "clean"
  await cb.forToolResult(
    "bash",
    { command: "python3 apply/scripts/check_materials.py --resume applications/r.md" },
    { stdout: "RESUME r.md: pass (0 fail, 0 warn)\n", stderr: "", exitCode: 0, changed: [] },
    ws,
  );
  cards = await cb.forToolResult(
    "bash",
    { command: "python3 apply/scripts/render_resume.py --md applications/r.md --html applications/r.html" },
    { stdout: "words: 112  ->  applications/r.html", stderr: "", exitCode: 0, changed: ["applications/r.html"] },
    ws,
  );
  assert.equal((cards[0].props as any).checker, "clean");
});

test("bash check_closeout.py, exit 0 -> plan card via parsePlanTodo(plan.md), ref plan.md", async () => {
  const cb = new CardBuilder();
  const ws = createInMemoryWorkspaceStore({
    "plan.md": ["Goal: x", "", "To do", "- Send it (`applications/x.md`) — 5 min", "", "Doing", "", "Done", ""].join("\n"),
  });
  const cards = await cb.forToolResult(
    "bash",
    { command: "python3 coach/scripts/check_closeout.py --workspace . --stage applying" },
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
    { command: "python3 coach/scripts/check_closeout.py --stage applying" },
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
