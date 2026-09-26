// Tester-owned: docs/design-web-agent.md § 17.2 / § 17.8 item 9 (rule 7's
// three conditions), from the spec: after a purchase (a higher balance) a
// run over the allowance still stops at a gate, exactly as before; no tool,
// card, bundled skill or the coach's prompt offers buying; nothing in the
// agent calls ten-paypal. Run: node --test tests/agent/paypal-rule7.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { AGENT, dataChunks, makeCoach, realBundle, recordingGate, REPO, runTurn, scriptedModel, textStep, toolStep, user } from "./_support.ts";

const BIG = { action: "Evaluate six saved roles", steps: 500, webSearches: 6, items: ["Nimbus Robotics — Analytics Engineer"] };
const BUYING = /paypal|ten-paypal|buy(ing)?\s+(more\s+)?credit|buy\s+more|top[\s-]?up|purchase\s+credit|add\s+(funds|credit)|BuyCredit/i;

for (const balance of [5, 45.14, 1000]) {
  test(`§ 17.2 with a balance of $${balance} (before/after a purchase) an over-allowance estimate still opens a pending spend gate and ends the turn`, async () => {
    const rg = recordingGate();
    const m = scriptedModel([toolStep([{ name: "estimate_cost", input: BIG }]), textStep("SHOULD NOT RUN")]);
    const { coach } = makeCoach({ model: m.model, gate: rg.gate, balance });
    const { chunks } = await runTurn(coach, "c1", [user("u1", "evaluate all six")]);
    assert.equal(m.used, 1, "no model step after the gate opened");
    const gates = dataChunks(chunks, "data-gate");
    assert.equal(gates.length, 1);
    assert.equal(gates[0].data.kind, "spend");
    assert.equal(rg.rows.get(gates[0].data.gateId)!.status, "pending", "never auto-approved");
    assert.equal(rg.events.filter((e) => e.op === "approve" || e.op === "resolve").length, 0, "nothing approved it");
    const text = JSON.stringify(chunks);
    assert.ok(!BUYING.test(text), "no buying pointer in the turn's output");
  });

  test(`§ 17.2 with a balance of $${balance} the mid-run allowance still stops at $1.00 with a pending gate`, async () => {
    const rg = recordingGate();
    const COST = 0.3;
    const steps = Array.from({ length: 10 }, () => toolStep([{ name: "list_files", input: {} }], { costUsd: COST }));
    const m = scriptedModel(steps);
    const { coach } = makeCoach({ model: m.model, gate: rg.gate, balance });
    const { chunks } = await runTurn(coach, "c1", [user("u1", "do lots")]);
    const gates = dataChunks(chunks, "data-gate");
    assert.equal(gates.length, 1, "the mid-run stop opened a gate");
    assert.equal(rg.rows.get(gates[0].data.gateId)!.status, "pending");
    assert.ok(m.used * COST <= 1.0 + 1e-9, `spent $${(m.used * COST).toFixed(2)} before the gate`);
  });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === "dist" || f.startsWith(".")) continue;
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test("§ 17.2 the agent can't reach buying: packages/agent (tools, cards, prompt) never mentions PayPal, ten-paypal or buying credit", () => {
  const hits: string[] = [];
  for (const f of walk(path.join(AGENT, "src"))) {
    const s = readFileSync(f, "utf8");
    s.split("\n").forEach((l, i) => {
      if (BUYING.test(l)) hits.push(`${path.relative(REPO, f)}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("§ 17.2 no bundled skill (what the coach reads) mentions PayPal or buying credit (rule 8: no upsell)", () => {
  const hits: string[] = [];
  const bundle = realBundle();
  for (const [name, text] of Object.entries(bundle)) {
    String(text).split("\n").forEach((l, i) => {
      if (BUYING.test(l)) hits.push(`${name}:${i + 1}: ${l.trim()}`);
    });
  }
  for (const f of walk(path.join(REPO, "skills"))) {
    if (!/\.(md|py|json|txt|ya?ml)$/.test(f)) continue;
    readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (BUYING.test(l)) hits.push(`${path.relative(REPO, f)}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("§ 17.2 no card, chat or model-output component opens the dialog: only Header/RealChatShell/RealApp/BuyCreditDialog reach it in apps/web/src", () => {
  const allowed = new Set([
    "apps/web/src/real/BuyCreditDialog.tsx",
    "apps/web/src/real/RealChatShell.tsx",
    "apps/web/src/real/RealApp.tsx",
    "apps/web/src/components/Header.tsx",
    "apps/web/src/backend/paypal.ts",
    "apps/web/src/backend/paypal.test.ts",
    "apps/web/src/backend/env.ts",
    "apps/web/src/backend/env.test.ts",
  ]);
  const reach = /BuyCredit|onBuyCredit|showBuyCredit|ten-paypal|createPaypalOrder|capturePaypalOrder|paypal/i;
  const hits: string[] = [];
  for (const f of walk(path.join(REPO, "apps/web/src"))) {
    const rel = path.relative(REPO, f);
    if (allowed.has(rel) || /\.css$/.test(f)) continue;
    readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (reach.test(l)) hits.push(`${rel}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
  // RealChatShell opens it only from the Header callback
  const shell = readFileSync(path.join(REPO, "apps/web/src/real/RealChatShell.tsx"), "utf8");
  const setters = [...shell.matchAll(/setShowBuyCredit\(true\)/g)].length;
  assert.equal(setters, 1, "exactly one place opens the dialog");
  assert.match(shell, /onBuyCredit=\{\(\) => setShowBuyCredit\(true\)\}/, "and it is the Header's onBuyCredit");
});

test("§ 17.2 the fixed over_balance sentence stays on the card: the next turn's model prompt never carries 'buy more' (no upsell via history)", async () => {
  const OVER = "Your credit is used up. You can buy more from your balance at the top.";
  const m = scriptedModel([textStep("Hi again.")]);
  const { coach } = makeCoach({ model: m.model });
  const history = [
    user("u1", "hello"),
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "On it." }, { type: "data-error", data: { code: "over_balance", message: OVER, retryable: false } }] },
    user("u2", "hello again"),
  ];
  await runTurn(coach, "c1", history);
  assert.equal(m.calls.length, 1);
  const prompt = JSON.stringify(m.calls[0].prompt);
  assert.ok(prompt.includes("hello again"), "the prompt was captured");
  assert.ok(!BUYING.test(prompt), "the model saw the buying pointer");
});
