// Tester-owned: re-verification of the coder's fix round 1 against the lead's
// rulings (M3 per § 3.2; H5 unsupported_type; cost line "Estimated cost: $X
// to $Y."), for the points the first suite did not pin exactly.
import assert from "node:assert/strict";
import test from "node:test";

import { CardBuilder, VersionTracker, createTools } from "../../packages/agent/src/index.ts";
import { createCoach } from "../../packages/agent/src/coach.ts";
import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { createFakeScriptRunner } from "../../packages/agent/src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import { dataChunks, makeCoach, realBundle, recordingGate, runTurn, scriptedModel, textStep, toolStep, user } from "./_support.ts";

const BIG = { action: "Evaluate six saved roles", steps: 500, webSearches: 6, items: ["Nimbus Robotics — Analytics Engineer"] };
const promptText = (call: any) => JSON.stringify(call.prompt);

test("M3 (§ 3.2): a typed non-yes reply reaches the model WITH a not-approved note; gate stays pending; loop stops after that one step", async () => {
  const rg = recordingGate();
  const m = scriptedModel([
    toolStep([{ name: "estimate_cost", input: BIG }]),
    toolStep([{ name: "list_files", input: {} }]), // the model answers AND tries to keep working
    textStep("SHOULD NOT RUN"),
  ]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "c1", [user("u1", "evaluate all six")]);
  const gateId = dataChunks(t1.chunks, "data-gate")[0].data.gateId;
  const before = m.used;
  const t2 = await runTurn(coach, "c1", [user("u1", "evaluate all six"), t1.message, user("u2", "what would only three cost?")]);
  assert.equal(m.used - before, 1, "exactly one model step while the gate is pending");
  assert.match(promptText(m.calls[before]), /did not approve it|not approved/i, "the model is told the gate is not approved");
  assert.equal(rg.rows.get(gateId)!.status, "pending");
  assert.ok(!rg.events.some((e) => e.op === "decide" && e.args[0] === gateId));
  assert.deepEqual(dataChunks(t2.chunks, "data-gate-status").map((c) => c.data), [{ gateId, status: "pending" }]);
});

test("M3: a ui-origin 'yes' and a ui-origin 'no' short-circuit (no model call, no decision)", async () => {
  const rg = recordingGate();
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("x")]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "c1", [user("u1", "go")]);
  const gateId = dataChunks(t1.chunks, "data-gate")[0].data.gateId;
  for (const t of ["yes", "no"]) {
    await runTurn(coach, "c1", [user("u1", "go"), t1.message, user("u2", t, "ui")]);
  }
  assert.equal(m.used, 1);
  assert.equal(rg.rows.get(gateId)!.status, "pending");
});

test("H2: web_search's own spend is counted — once the allowance is crossed, a gate opens and no further step runs", async () => {
  const rg = recordingGate();
  const webSearch = async () => ({ results: [{ url: "https://e.com", title: "t", excerpt: "e" }], usd: 0.97 });
  const m = scriptedModel([toolStep([{ name: "web_search", input: { query: "acme" } }], { costUsd: 0.05 }),
    ...Array.from({ length: 5 }, () => toolStep([{ name: "list_files", input: {} }], { costUsd: 0.05 }))]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate, webSearch });
  await runTurn(coach, "c1", [user("u1", "research acme")]);
  assert.equal(m.used, 1, `ran ${m.used} steps`);
  assert.equal(rg.events.filter((e) => e.op === "open").length, 1);
});

test("L3: the gate's cost line is exactly 'Estimated cost: $X to $Y.'", async () => {
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }])]);
  const { chunks } = await runTurn(makeCoach({ model: m.model }).coach, "c1", [user("u1", "x")]);
  const g = dataChunks(chunks, "data-gate")[0].data;
  assert.match(g.text.split("\n").pop(), /^Estimated cost: \$\d+\.\d{2} to \$\d+\.\d{2}\.$/);
});

test("H5: read_file on .pdf/.docx -> unsupported_type telling the model to ask for pasted text", async () => {
  const store = createInMemoryWorkspaceStore();
  await store.upload("documents/r.pdf", new Uint8Array([37, 80, 68, 70, 0, 255]));
  const ctx: any = { chatId: "c1", writer: { write() {}, merge() {} }, versionTracker: new VersionTracker(), cardBuilder: new CardBuilder(),
    turnState: { measuredSteps: [], spentSoFarUsd: 0 }, chatMeasuredSteps: [], gateGrammarMd: realBundle()["skills/coach/references/gate-grammar.md"], idFor: () => "g" };
  const tools: any = createTools({ workspace: store, skills: realBundle(), gate: createInMemoryGate(), balance: async () => 5,
    fetch: async () => { throw new Error("x"); }, clock: { now: () => new Date() }, scripts: createFakeScriptRunner([]) } as any, ctx);
  const out = await tools.read_file.execute({ path: "documents/r.pdf" }, { toolCallId: "x", messages: [] });
  assert.equal(out.error?.code, "unsupported_type");
  assert.match(out.error.message, /paste/i);
});

test("L8: a record_verdict call with single-quoted flags still yields its verdict card", async () => {
  const jobs = "# Pipeline\n\n## To Review\n\n### Acme Labs — Data Analyst\n- Verdict: long_shot\n- Score: 40\n- Reason: stretch on python\n";
  const runner = createFakeScriptRunner([{ name: "record_verdict.py", run: () => ({ result: { stdout: "recorded\n", stderr: "", exitCode: 0 }, changedFiles: { "jobs.md": jobs } }) }]);
  const m = scriptedModel([toolStep([{ name: "bash", input: { command: "python3 record_verdict.py --workspace . --company 'Acme Labs' --title 'Data Analyst' --verdict long_shot --score 40" } }]), textStep("ok")]);
  const { chunks } = await runTurn(makeCoach({ model: m.model, scripts: runner, files: { "jobs.md": "# Pipeline\n" } }).coach, "c1", [user("u1", "x")]);
  const v = dataChunks(chunks, "data-card").filter((c) => c.data.card === "verdict");
  assert.equal(v.length, 1);
  assert.equal(v[0].data.props.company, "Acme Labs");
});
