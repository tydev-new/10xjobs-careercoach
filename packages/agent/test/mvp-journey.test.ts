// A scripted end-to-end run with a MockLanguageModel that walks the MVP
// journey (evaluate verdict -> tailor -> check -> plan) against the
// in-memory store, asserting the emitted UI stream parts match § 6's
// kinds and the card shapes apps/web/fixtures/mvp-journey.json pins
// (built from real script stdout) — the cards come from code, never the
// model. Intake/profile isn't re-scripted here (covered by tools.test.ts
// and cards.test.ts); this test's job is the MULTI-TURN, MULTI-STEP loop
// end to end, with the version tracker and card builder state carried
// across turns in the SAME chat.
import assert from "node:assert/strict";
import test from "node:test";
import { readUIMessageStream } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { createCoach } from "../src/coach.ts";
import { createInMemoryGate } from "../src/gate.ts";
import { createFakeScriptRunner, type CannedScript } from "../src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../src/workspace/in-memory-store.ts";
import type { AppMessage } from "../src/types.ts";
import { loadRealSkillBundle } from "./support.ts";

function userMsg(id: string, text: string): AppMessage {
  return { id, role: "user", parts: [{ type: "text", text }], metadata: { origin: "typed" } } as AppMessage;
}

function flagsOf(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return flags;
}

// step chunk builders -----------------------------------------------------

function toolCallStep(toolName: string, input: unknown, toolCallId: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-input-start", id: toolCallId, toolName },
        { type: "tool-input-delta", id: toolCallId, delta: JSON.stringify(input) },
        { type: "tool-input-end", id: toolCallId },
        { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
      ] as any, // loosely-typed mock chunk script, see gate-flow.test.ts's note.
    }),
  };
}

function textStep(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      ] as any,
    }),
  };
}

test("mvp journey: evaluate verdict -> tailor -> check -> plan, across three turns in one chat", async () => {
  const JD_URL = "https://boards.greenhouse.io/acme/jobs/4102938";

  const doStream = [
    // ---- turn 1: paste a job URL -> verdict ----
    toolCallStep("fetch_job", { url: JD_URL, saveTo: "jd-inbox/acme-staff-pm.md" }, "c1"),
    toolCallStep("write_file", { path: "jd-analysis/acme-staff-pm.md", content: "## Decode\nCore ask: own the partner ecosystem roadmap." }, "c2"),
    toolCallStep(
      "bash",
      {
        command:
          'python3 evaluate/scripts/record_verdict.py --workspace . --company Acme --title "Staff PM" --verdict strong --score 82 --track A --reasons "8 years of B2B SaaS platform PM experience matches the core ask" --url ' +
          JD_URL +
          " --jd-file jd-analysis/acme-staff-pm.md",
      },
      "c3",
    ),
    textStep("Strong Fit, recorded in jobs.md. Want me to tailor a resume and cover letter for this one?"),

    // ---- turn 2: tailor ----
    toolCallStep("write_file", { path: "applications/acme-resume.md", content: "# Jordan Alvarez\n\n## Summary\n..." }, "c4"),
    toolCallStep("write_file", { path: "applications/acme-letter.md", content: "Dear Acme Hiring Team,\n..." }, "c5"),
    toolCallStep(
      "bash",
      { command: "python3 apply/scripts/check_materials.py --workspace . --resume applications/acme-resume.md --letter applications/acme-letter.md --base base-resume.md" },
      "c6",
    ),
    toolCallStep("bash", { command: "python3 apply/scripts/render_resume.py --md applications/acme-resume.md --html applications/acme-resume.html" }, "c7"),
    textStep("Résumé is 109 words. Both files pass check_materials's mechanical checks."),

    // ---- turn 3: what's next ----
    toolCallStep(
      "write_file",
      { path: "plan.md", content: "Goal: an offer\n\n## Board\n\nWaiting on you\n\nTo do\n- Send the Acme cover letter (`applications/acme-letter.md`) — 5 min\n\nDoing\n\nDone" },
      "c8",
    ),
    toolCallStep("bash", { command: "python3 coach/scripts/check_closeout.py --workspace . --stage applying" }, "c9"),
    textStep("That's what's queued in plan.md — send the letter, and tell me if you want more roles found."),
  ];
  // loosely-typed mock chunk script (matches spike 1's own pattern);
  // runtime-verified by this whole test, not structurally typed against
  // LanguageModelV4StreamPart.
  const model = new MockLanguageModelV4({ doStream: doStream as any });

  const scripts = createFakeScriptRunner([
    {
      name: "record_verdict.py",
      run: (argv) => {
        const f = flagsOf(argv);
        const row = [
          `### ${f.company} — ${f.title}`,
          `- URL: ${f.url ?? ""}`,
          `- Verdict: ${f.verdict}`,
          `- Score: ${f.score}`,
          `- Reason: ${f.reasons}`,
          `- Track: ${f.track}`,
          `- JD: ${f["jd-file"]}`,
          "",
        ].join("\n");
        return {
          result: { stdout: `recorded (created NEW role): ${f.company} — ${f.title} → ${f.verdict} (${f.score})`, stderr: "", exitCode: 0 },
          changedFiles: { "jobs.md": `# Pipeline\n\n## To Review\n\n${row}` },
        };
      },
    },
    {
      name: "check_materials.py",
      run: (argv) => {
        const f = flagsOf(argv);
        const base = (p: string) => p.split("/").pop();
        const stdout = [
          "structure tier, base résumé loaded for the verbatim check",
          "",
          `RESUME ${base(f.resume)}: pass (0 fail, 0 warn)`,
          "",
          `LETTER ${base(f.letter)}: pass (0 fail, 0 warn)`,
          "",
        ].join("\n");
        return { result: { stdout, stderr: "", exitCode: 0 }, changedFiles: {} };
      },
    },
    {
      name: "render_resume.py",
      run: (argv) => {
        const f = flagsOf(argv);
        return {
          result: { stdout: `words: 109  ->  ${f.html}`, stderr: "", exitCode: 0 },
          changedFiles: { [f.html]: "<!doctype html><html><body>résumé</body></html>" },
        };
      },
    },
    {
      name: "check_closeout.py",
      run: (argv) => {
        const f = flagsOf(argv);
        return { result: { stdout: `close-out clean: stage ${f.stage}`, stderr: "", exitCode: 0 }, changedFiles: {} };
      },
    },
  ] satisfies CannedScript[]);

  const workspace = createInMemoryWorkspaceStore({ "base-resume.md": "# Jordan Alvarez\n\n## Summary\n8 years of B2B SaaS PM." });
  const coach = createCoach({
    model,
    workspace,
    skills: await loadRealSkillBundle(),
    gate: createInMemoryGate(),
    balance: async () => 5,
    fetch: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ title: "Staff PM", company_name: "Acme", location: { name: "Remote (US)" }, content: "<p>Own the partner ecosystem.</p>" }),
      }) as any,
    clock: { now: () => new Date("2026-09-23T00:00:00Z") },
    scripts,
  });

  const chatId = "mvp-chat";
  let history: AppMessage[] = [];
  async function runTurn(userText: string) {
    history = [...history, userMsg(`u-${history.length}`, userText)];
    const stream = coach.stream({ chatId, messages: history });
    const out: AppMessage[] = [];
    for await (const m of readUIMessageStream({ stream })) out.push(m as AppMessage);
    const last = out[out.length - 1];
    history = [...history, last];
    return last;
  }

  // ---- turn 1 ----
  const t1 = await runTurn(`found this one: ${JD_URL}`);
  const t1Kinds = t1.parts.map((p: any) => p.type);
  assert.ok(t1Kinds.includes("tool-fetch_job"));
  assert.ok(t1Kinds.includes("tool-bash"));
  assert.ok(t1Kinds.includes("data-card"));
  assert.ok(t1Kinds.includes("text"));
  const verdictCard = (t1.parts as any[]).find((p) => p.type === "data-card" && p.data.card === "verdict");
  assert.ok(verdictCard, t1Kinds.join(","));
  assert.deepEqual(verdictCard.data.props, {
    company: "Acme",
    title: "Staff PM",
    verdict: "strong",
    score: 82,
    track: "A",
    reason: "8 years of B2B SaaS platform PM experience matches the core ask",
    dealbreakers: undefined,
  });
  assert.equal(verdictCard.data.ref, "jd-analysis/acme-staff-pm.md");

  // ---- turn 2 ----
  const t2 = await runTurn("yes please");
  const t2Cards = (t2.parts as any[]).filter((p) => p.type === "data-card").map((p) => p.data);
  const checkerCards = t2Cards.filter((c) => c.card === "checker");
  assert.equal(checkerCards.length, 2);
  assert.deepEqual(
    checkerCards.map((c: any) => [c.props.label, c.ref]),
    [
      ["RESUME", "applications/acme-resume.md"],
      ["LETTER", "applications/acme-letter.md"],
    ],
  );
  const documentCard = t2Cards.find((c) => c.card === "document");
  assert.ok(documentCard);
  assert.equal(documentCard.props.words, 109);
  assert.equal(documentCard.props.checker, "clean", "badge = this chat's latest checker result for the SAME .md");
  assert.equal(documentCard.props.htmlPath, "applications/acme-resume.html");

  // ---- turn 3 ----
  const t3 = await runTurn("great, what's next?");
  const planCard = (t3.parts as any[]).find((p) => p.type === "data-card" && p.data.card === "plan");
  assert.ok(planCard);
  assert.equal(planCard.data.props.stage, "applying");
  assert.deepEqual(planCard.data.props.items, [
    { text: "Send the Acme cover letter (`applications/acme-letter.md`) — 5 min", ref: "applications/acme-letter.md" },
  ]);
  assert.equal(planCard.data.ref, "plan.md");

  // the model NEVER produced a data-card/data-gate/data-gate-status part —
  // every one came from the tool's own execute() calling writer.write().
  for (const m of history) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts as any[]) {
      assert.ok(["text", "step-start", "data-card", "data-gate", "data-gate-status"].includes(p.type) || p.type.startsWith("tool-"), p.type);
    }
  }

  // version tracking persisted across all three turns: jobs.md, written
  // by turn 1's bash call, was read again (list+read snapshot) by turn
  // 2's and turn 3's bash calls without any version_conflict anywhere —
  // proven simply by every card above having built successfully off the
  // LATEST content each time (turn 3's plan card reads plan.md, itself
  // write_file'd in turn 3 with no prior tracked version — a create, not
  // a stale write).
  const finalPlan = await workspace.read("plan.md");
  assert.ok(!finalPlan.binary && finalPlan.content.includes("Send the Acme cover letter"));
});
