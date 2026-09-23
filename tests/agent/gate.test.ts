// Tester-owned: § 3 gate protocol + § 4 allowance, derived from
// docs/design-web-agent.md (committed r3), NOT from packages/agent/test.
// Step 4 exit: "a gate test: no send, submit, or spend happens without a
// logged typed yes".
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { matchGateReply, statusOf } from "../../packages/agent/src/index.ts";
import { dataChunks, makeCoach, realBundle, recordingGate, runTurn, scriptedModel, textStep, toolStep, user, assistantText } from "./_support.ts";

const BUNDLE = realBundle();
const GRAMMAR = BUNDLE["skills/coach/references/gate-grammar.md"];

/** The spend sentence, read by THIS test from the bundled file. */
function bundledSpendSentence(): string {
  const line = GRAMMAR.split("\n").find((l) => /^\s*-\s*Spends:/.test(l));
  assert.ok(line, "gate-grammar.md has a Spends: line");
  const m = line!.match(/"([^"]+)"/);
  assert.ok(m, "the Spends line quotes its sentence");
  return m![1];
}

/** Lead ruling L2: the gate line rounds UP to the cent (float-safe: 1.10 stays 1.10). */
const ceilCents = (x: number) => (Math.ceil(Math.round(x * 1e6) / 1e4) / 100).toFixed(2);

const sha = (s: string) => "sha256:" + createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// ------------------------------------------------------------ matchGateReply table

test("matchGateReply: the § 3 table", () => {
  const rows: Array<[string, "typed" | "ui", string]> = [
    ["yes", "typed", "approve"],
    ["Yes.", "typed", "approve"],
    ["YES!", "typed", "approve"],
    ["  yes \n", "typed", "approve"],
    ["yes but only 3 of them", "typed", "none"],
    ["yes but…", "typed", "none"],
    ["y", "typed", "none"],
    ["sure", "typed", "none"],
    ["ok", "typed", "none"],
    ["yes..", "typed", "none"],
    ["yes!!", "typed", "none"],
    ["yes?", "typed", "none"],
    ["yes!.", "typed", "none"],
    ["yeah", "typed", "none"],
    ["Here is the posting: ... Candidates who say yes to travel ... yes", "typed", "none"],
    ["yes", "ui", "none"],
    ["Yes.", "ui", "none"],
    ["no", "typed", "decline"],
    ["No.", "typed", "decline"],
    ["don't", "typed", "decline"],
    ["cancel", "typed", "decline"],
    ["STOP!", "typed", "decline"],
    ["no thanks", "typed", "none"],
    ["no", "ui", "none"],
  ];
  const bad = rows.filter(([t, o, want]) => matchGateReply(t, o) !== want).map(([t, o, want]) => `${JSON.stringify(t)}/${o}: want ${want}, got ${matchGateReply(t, o)}`);
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------ helpers

const BIG = { action: "Evaluate six saved roles", steps: 500, webSearches: 6, items: ["Nimbus Robotics — Analytics Engineer", "Acme Labs — Data Analyst"] };

// ------------------------------------------------------------ the spend gate

test("estimate_cost over the threshold: code opens a logged pending gate, ends the turn; gate line = bundled spend sentence with the amount", async () => {
  const rg = recordingGate();
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("SHOULD NOT RUN")]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const { chunks } = await runTurn(coach, "c1", [user("u1", "evaluate all six")]);

  assert.equal(m.used, 1, "no model step after the gate opened");
  const gates = dataChunks(chunks, "data-gate");
  assert.equal(gates.length, 1);
  const g = gates[0].data;
  const opens = rg.events.filter((e) => e.op === "open");
  assert.equal(opens.length, 1, "the gate was LOGGED (open) exactly once");
  assert.equal(opens[0].args[0].gateId, g.gateId);
  assert.equal(opens[0].args[1], "c1");
  assert.equal(rg.rows.get(g.gateId)!.status, "pending");

  const out = chunks.find((c) => c.type === "tool-output-available")?.output;
  assert.ok(out && out.needsGate === true, "result says needsGate");
  assert.equal(g.kind, "spend");
  assert.equal(g.label, BIG.action, "label = the tool's action input");
  assert.equal(g.amountUsd, out.highUsd, "amountUsd = highUsd");
  const expectedLine = bundledSpendSentence().replace("$<amount>", "$" + ceilCents(out.highUsd));
  assert.equal(g.gateLine, expectedLine, "gate line word for word from the bundled gate-grammar.md");
  const lines = g.text.split("\n");
  assert.equal(lines[0], BIG.action, "text starts with action");
  assert.deepEqual(lines.slice(1, 1 + BIG.items.length), BIG.items, "then each item on its own line");
  assert.equal(lines.length, 2 + BIG.items.length, "then exactly one cost line");
  assert.equal(g.textHash, sha(g.text), "textHash = sha256 of the text as shown");
  const statuses = dataChunks(chunks, "data-gate-status");
  assert.deepEqual(statuses.map((s) => s.data), [{ gateId: g.gateId, status: "pending" }]);
});

test("threshold defaults to $1.00: highUsd just under does not gate, just over does", async () => {
  // Probe with the package's own estimate (whatever its per-step constant),
  // then scale steps to land either side of $1.00.
  const probe = scriptedModel([toolStep([{ name: "estimate_cost", input: { action: "probe", steps: 1, webSearches: 0 } }])]);
  const p = await runTurn(makeCoach({ model: probe.model }).coach, "p", [user("u", "x")]);
  const perStepHigh = p.chunks.find((c) => c.type === "tool-output-available").output.highUsd;
  assert.ok(perStepHigh > 0);
  const under = Math.floor(0.999 / perStepHigh);
  const over = Math.ceil(1.001 / perStepHigh);

  for (const [steps, want] of [[under, false], [over, true]] as const) {
    const rg = recordingGate();
    const m = scriptedModel([toolStep([{ name: "estimate_cost", input: { action: "probe", steps, webSearches: 0 } }]), textStep("done")]);
    const { chunks } = await runTurn(makeCoach({ model: m.model, gate: rg.gate }).coach, "t" + steps, [user("u", "x")]);
    const out = chunks.find((c) => c.type === "tool-output-available").output;
    assert.equal(out.needsGate, want, `steps=${steps} highUsd=${out.highUsd}`);
    assert.equal(rg.events.filter((e) => e.op === "open").length, want ? 1 : 0);
  }
});

test("a typed exact yes is LOGGED (approved + typed text) before any model spend; a ui-origin yes approves nothing", async () => {
  const log: string[] = [];
  const rg = recordingGate();
  const origDecide = rg.gate.decide;
  rg.gate.decide = async (...a: any[]) => { log.push(`decide:${a[1]}:${a[2]}`); return (origDecide as any)(...a); };
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("resuming the run")], () => log.push("model"));
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });

  const t1 = await runTurn(coach, "c1", [user("u1", "evaluate all six")]);
  const gateId = dataChunks(t1.chunks, "data-gate")[0].data.gateId;
  const hist = [user("u1", "evaluate all six"), t1.message];

  // ui-origin yes
  log.length = 0;
  const t2 = await runTurn(coach, "c1", [...hist, user("u2", "yes", "ui")]);
  assert.deepEqual(log, [], "ui-origin yes: no decide, no model call");
  assert.equal(rg.rows.get(gateId)!.status, "pending");
  assert.deepEqual(dataChunks(t2.chunks, "data-gate-status").map((c) => c.data.status), ["pending"], "re-emits pending");

  // message with no origin metadata at all
  const t2b = await runTurn(coach, "c1", [...hist, user("u2b", "yes", null)]);
  assert.deepEqual(log, [], "origin missing: treated as not typed");
  assert.equal(rg.rows.get(gateId)!.status, "pending");

  // typed exact yes
  log.length = 0;
  const t3 = await runTurn(coach, "c1", [...hist, user("u3", "Yes.")]);
  assert.equal(log[0], "decide:approved:Yes.", "the decision is logged with the typed text first");
  assert.ok(log.indexOf("model") > 0, "the model runs only after the logged yes");
  assert.equal(rg.rows.get(gateId)!.status, "approved");
  assert.equal(rg.rows.get(gateId)!.typedText, "Yes.");
  assert.deepEqual(dataChunks(t3.chunks, "data-gate-status").map((c) => c.data), [{ gateId, status: "approved" }]);
});

test("§ 3.2: a non-yes reply leaves the gate open AND the model is told it is not approved", async () => {
  const rg = recordingGate();
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("answering the question")]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "c1", [user("u1", "evaluate all six")]);
  const gateId = dataChunks(t1.chunks, "data-gate")[0].data.gateId;
  await runTurn(coach, "c1", [user("u1", "evaluate all six"), t1.message, user("u2", "what if I only do three?")]);
  assert.equal(rg.rows.get(gateId)!.status, "pending", "gate stays open");
  assert.equal(m.used, 2, "contract § 3.2: 'the model is told it is not approved' — the model must get this turn (code skips the model entirely)");
});

test("a decline is final: logged declined; no model call; a later typed yes does not revive it", async () => {
  const rg = recordingGate();
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("ok, not running it")]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "c1", [user("u1", "evaluate all six")]);
  const gateId = dataChunks(t1.chunks, "data-gate")[0].data.gateId;
  const hist = [user("u1", "evaluate all six"), t1.message];
  const t2 = await runTurn(coach, "c1", [...hist, user("u2", "no")]);
  assert.equal(rg.rows.get(gateId)!.status, "declined");
  assert.equal(rg.rows.get(gateId)!.typedText, "no");
  assert.equal(m.used, 1, "decline: no model call");
  assert.deepEqual(dataChunks(t2.chunks, "data-gate-status").map((c) => c.data.status), ["declined"]);
  // later yes
  await runTurn(coach, "c1", [...hist, user("u2", "no"), t2.message, user("u3", "yes")]);
  assert.equal(rg.rows.get(gateId)!.status, "declined", "the declined row never moves again");
  assert.equal(rg.events.filter((e) => e.op === "decide" && e.args[0] === gateId && e.args[1] === "approved").length, 0);
});

test("§ 3.1: at most one gate open per chat — a new gate expires the old one (two estimate_cost calls in one step)", async () => {
  const rg = recordingGate();
  const m = scriptedModel([toolStep([
    { name: "estimate_cost", input: { ...BIG, action: "first run" } },
    { name: "estimate_cost", input: { ...BIG, action: "second run" } },
  ])]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "c1", [user("u1", "go")]);
  const pendingRows = [...rg.rows.values()].filter((r) => r.chatId === "c1" && r.status === "pending");
  assert.equal(pendingRows.length, 1, `pending rows in chat: ${pendingRows.map((r) => r.req.label).join(", ")}`);
  // and the UI status agrees with the log once the survivor is approved
  const t2 = await runTurn(coach, "c1", [user("u1", "go"), t1.message, user("u2", "yes")]);
  const msgs = [user("u1", "go"), t1.message, user("u2", "yes"), t2.message];
  assert.notEqual(statusOf(msgs as any, "ready").state, "needs-you", "status light must not show a stale pending gate");
});

test("a chat's first turn expires pending gates from older chats (logged)", async () => {
  const rg = recordingGate();
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("hello")]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "old", [user("u1", "evaluate")]);
  const gateId = dataChunks(t1.chunks, "data-gate")[0].data.gateId;
  await runTurn(coach, "new", [user("n1", "hi")]);
  assert.equal(rg.rows.get(gateId)!.status, "expired");
  // and a "yes" in the old chat now approves nothing
  await runTurn(coach, "old", [user("u1", "evaluate"), t1.message, user("u2", "yes")]);
  assert.equal(rg.rows.get(gateId)!.status, "expired");
});

// ------------------------------------------------------------ allowance (§ 4)

test("allowance: with measured step costs of $0.30, no turn spends past $1.00 without a logged typed yes", async () => {
  const rg = recordingGate();
  const COST = 0.3;
  const steps = Array.from({ length: 10 }, (_, k) => toolStep([{ name: "list_files", input: {} }], { costUsd: COST }));
  const m = scriptedModel(steps);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const { chunks } = await runTurn(coach, "c1", [user("u1", "do lots")]);
  const spent = m.used * COST;
  const gates = dataChunks(chunks, "data-gate");
  assert.equal(gates.length, 1, "the mid-run stop opened a gate");
  assert.equal(gates[0].data.label, "Continue this run");
  assert.equal(rg.rows.get(gates[0].data.gateId)!.status, "pending", "logged");
  assert.ok(spent <= 1.0 + 1e-9, `spent $${spent.toFixed(2)} over ${m.used} steps before the gate; allowance is $1.00`);
});

test("allowance: mid-run gate line is the bundled sentence with the amount filled; the approving yes sets the next turn's allowance", async () => {
  const rg = recordingGate();
  const COST = 0.3;
  const steps = Array.from({ length: 20 }, () => toolStep([{ name: "list_files", input: {} }], { costUsd: COST }));
  const m = scriptedModel(steps);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate });
  const t1 = await runTurn(coach, "c1", [user("u1", "do lots")]);
  const g = dataChunks(t1.chunks, "data-gate")[0].data;
  assert.equal(g.gateLine, bundledSpendSentence().replace("$<amount>", "$" + ceilCents(g.amountUsd)));
  assert.equal(g.textHash, sha(g.text));
  const before = m.used;
  const t2 = await runTurn(coach, "c1", [user("u1", "do lots"), t1.message, user("u2", "yes")]);
  assert.equal(rg.rows.get(g.gateId)!.status, "approved");
  const spent2 = (m.used - before) * COST;
  assert.ok(spent2 <= g.amountUsd + 1e-9, `turn 2 spent $${spent2.toFixed(2)}; approved $${g.amountUsd}`);
});

test("gate line fails loudly (no gate, no spend) when the bundle has no spend line", async () => {
  const skills = { ...BUNDLE, "skills/coach/references/gate-grammar.md": "# gate grammar\n(no spend line)\n" };
  const rg = recordingGate();
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("after")]);
  const { coach } = makeCoach({ model: m.model, gate: rg.gate, skills });
  const { chunks } = await runTurn(coach, "c1", [user("u1", "go")]);
  assert.equal(rg.events.filter((e) => e.op === "open").length, 0, "no gate opened with a made-up line");
  const failed = chunks.some((c) => c.type === "tool-output-error") || chunks.some((c) => c.type === "tool-output-available" && c.output?.error);
  assert.ok(failed, "the estimate_cost call visibly failed");
});

test("no tool sends or submits: the registered tool set is exactly § 4's table", async () => {
  const m = scriptedModel([textStep("hi")]);
  await runTurn(makeCoach({ model: m.model }).coach, "c1", [user("u1", "hi")]);
  const names = (m.calls[0].tools ?? []).map((t: any) => t.name).sort();
  assert.deepEqual(names, ["bash", "check_language", "estimate_cost", "fetch_job", "list_files", "load_skill", "read_file", "web_search", "write_file"]);
});

test("step cap: defaults to 25 steps, then a step_cap data-error (§ 1 stopWhen: stepCountIs(maxSteps))", async () => {
  const steps = Array.from({ length: 40 }, () => toolStep([{ name: "list_files", input: {} }], { costUsd: 0.0001 }));
  const m = scriptedModel(steps);
  const { chunks } = await runTurn(makeCoach({ model: m.model }).coach, "c1", [user("u1", "loop")]);
  assert.equal(m.used, 25);
  assert.deepEqual(dataChunks(chunks, "data-error").map((c) => c.data.code), ["step_cap"]);
});

test("a 402 from the model ends the turn with over_balance and a fixed sentence (§ 8)", async () => {
  const { AITEST } = await import("./_support.ts");
  const model = new (AITEST as any).MockLanguageModelV4({
    doStream: async () => { const e: any = new Error("Payment Required"); e.statusCode = 402; throw e; },
  });
  const { chunks } = await runTurn(makeCoach({ model }).coach, "c1", [user("u1", "hi")]);
  const errs = dataChunks(chunks, "data-error").map((c) => c.data);
  assert.equal(errs.length, 1, JSON.stringify(chunks.map((c) => c.type)));
  assert.equal(errs[0].code, "over_balance");
  assert.equal(errs[0].retryable, false);
});
