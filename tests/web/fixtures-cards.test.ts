// Tester-owned: fixtures vs docs/design-web-agent.md § 6.2 (card build
// table), § 3 (gate), and docs/design-web-ui.md § 4 (refs must exist).
// Each card is re-derived from the tool result that precedes it; the
// fixture's card must equal what the table says, word for word.
// Run: node --test tests/web/fixtures-cards.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parsePlanTodo } from "../../apps/web/src/agent-helpers.ts";

const DIR = new URL("../../apps/web/fixtures/", import.meta.url);
const NAMES = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const load = (f: string) => JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
const SPEND_LINE = readFileSync(new URL("../../skills/coach/references/gate-grammar.md", import.meta.url), "utf8")
  .match(/Spends: "([^"]+)"/)![1];

function* assistantParts(fx: any) {
  for (const m of fx.messages) if (m.role === "assistant") for (const p of m.parts) yield { m, p };
}

// check_materials stdout grammar, § 6.2 row 3
function parseChecker(stdout: string) {
  const cards: any[] = [];
  let cur: any = null;
  for (const line of stdout.split("\n")) {
    const h = line.match(/^(\S+) (.+): (pass|FAIL) \((\d+) fail, (\d+) warn\)$/);
    if (h) {
      cur = { label: h[1], name: h[2], status: h[3], failCount: +h[4], warnCount: +h[5], findings: [] };
      cards.push(cur);
      continue;
    }
    const f = line.match(/^  \[(\w+)\] (.*)$/);
    if (f && cur) cur.findings.push({ level: f[1], message: f[2] });
  }
  return cards;
}

for (const name of NAMES) {
  const fx = load(name);

  test(`${name}: every card ref / item ref / read_file / write_file path exists in files (ui § 4)`, () => {
    const missing: string[] = [];
    for (const { p } of assistantParts(fx)) {
      if (p.type === "data-card") {
        if (p.data.ref && !(p.data.ref in fx.files)) missing.push(`card ref ${p.data.ref}`);
        for (const it of p.data.props.items ?? []) if (it.ref && !(it.ref in fx.files)) missing.push(`item ref ${it.ref}`);
        if (p.data.props.htmlPath && !(p.data.props.htmlPath in fx.files)) missing.push(`htmlPath ${p.data.props.htmlPath}`);
      }
      if ((p.type === "tool-read_file" || p.type === "tool-write_file") && !(p.input.path in fx.files)) missing.push(`${p.type} ${p.input.path}`);
    }
    assert.deepEqual(missing, []);
  });

  test(`${name}: every user message carries metadata.origin (ui § 4)`, () => {
    for (const m of fx.messages) if (m.role === "user") assert.ok(["typed", "ui"].includes(m.metadata?.origin), m.id);
  });

  test(`${name}: cards follow the § 6.2 build table`, () => {
    const problems: string[] = [];
    let lastTool: any = null;
    const pendingCheckers: any[] = [];
    let expectedVerdicts = 0, verdictCards = 0;
    const latestChecker = new Map<string, string>();
    for (const { p } of assistantParts(fx)) {
      if (p.type.startsWith("tool-")) {
        lastTool = p;
        if (p.type === "tool-bash" && /check_materials\.py/.test(p.input.command)) pendingCheckers.push(...parseChecker(p.output.stdout));
        if (p.type === "tool-bash" && /record_verdict\.py/.test(p.input.command) && p.output?.exitCode === 0) expectedVerdicts++;
        continue;
      }
      if (p.type !== "data-card") continue;
      const { card, props, ref } = p.data;
      if (card === "cost") {
        const est = [...assistantParts(fx)].map((x) => x.p).filter((x) => x.type === "tool-estimate_cost");
        const src = est.find((e) => e.input.action === props.action);
        if (!src) { problems.push(`cost card with no estimate_cost for "${props.action}"`); continue; }
        const want = { action: src.input.action, lowUsd: src.output.lowUsd, highUsd: src.output.highUsd, balanceUsd: src.output.balanceUsd };
        try { assert.deepEqual(props, want); } catch { problems.push(`cost props ${JSON.stringify(props)} != ${JSON.stringify(want)}`); }
        if (ref !== undefined) problems.push("cost card has a ref (spec: -)");
      }
      if (card === "checker") {
        const want = pendingCheckers.shift();
        if (!want) { problems.push(`checker card ${props.name} with no check_materials stdout block`); continue; }
        try { assert.deepEqual(props, want); } catch { problems.push(`checker props ${JSON.stringify(props)}\n   != parsed stdout ${JSON.stringify(want)}`); }
        if (!ref || !ref.endsWith(props.name)) problems.push(`checker ref ${ref} is not the checked file ${props.name}`);
        latestChecker.set(ref, props.status === "pass" ? "clean" : "fail");
      }
      if (card === "document") {
        const rr = [...assistantParts(fx)].map((x) => x.p).filter((x) => x.type === "tool-bash" && /render_resume\.py/.test(x.input.command) && x.output.exitCode === 0);
        const src = rr.find((x) => x.input.command.includes(`--md ${ref}`));
        if (!src) { problems.push(`document card for ${ref} with no exit-0 render_resume --md ${ref}`); continue; }
        const w = src.output.stdout.match(/^words: (\d+)  ->  (\S+)/m);
        if (!w || +w[1] !== props.words) problems.push(`document words ${props.words} != stdout ${w?.[1]}`);
        if (w && props.htmlPath !== w[2]) problems.push(`document htmlPath ${props.htmlPath} != ${w[2]}`);
        const badge = latestChecker.get(ref) ?? "not-run";
        if (props.checker !== badge) problems.push(`document badge ${props.checker} != latest checker ${badge}`);
      }
      if (card === "verdict") {
        verdictCards++;
        const cmd = [...assistantParts(fx)].map((x) => x.p).find((x) => x.type === "tool-bash" && /record_verdict\.py/.test(x.input.command) && x.input.command.includes(`--company ${props.company}`) || (x.type === "tool-bash" && x.input.command?.includes(`--company "${props.company}"`)));
        if (!cmd) problems.push(`verdict card ${props.company} with no record_verdict call`);
        else {
          const jd = cmd.input.command.match(/--jd-file (\S+)/)?.[1];
          if (jd !== ref) problems.push(`verdict ref ${ref} != --jd-file ${jd}`);
          const v = cmd.input.command.match(/--verdict (\S+)/)?.[1];
          if (v !== props.verdict) problems.push(`verdict ${props.verdict} != --verdict ${v}`);
          const r = cmd.input.command.match(/--reasons "([^"]*)"/)?.[1];
          if (r !== props.reason) problems.push(`verdict reason not word for word: ${JSON.stringify(props.reason)} vs ${JSON.stringify(r)}`);
        }
      }
      if (card === "plan") {
        const cc = lastTool;
        if (!(cc?.type === "tool-bash" && /check_closeout\.py/.test(cc.input.command) && cc.output.exitCode === 0)) problems.push("plan card not right after an exit-0 check_closeout");
        const stage = cc?.input.command.match(/--stage (\S+)/)?.[1];
        if (props.stage !== stage) problems.push(`plan stage ${props.stage} != --stage ${stage}`);
        try { assert.deepEqual(props.items, parsePlanTodo(fx.files["plan.md"])); } catch { problems.push("plan items != parsePlanTodo(files['plan.md'])"); }
        if (ref !== "plan.md") problems.push(`plan ref ${ref}`);
      }
    }
    if (pendingCheckers.length) problems.push(`${pendingCheckers.length} check_materials result(s) with no checker card: ${pendingCheckers.map((c) => c.name)}`);
    if (expectedVerdicts !== verdictCards) problems.push(`${expectedVerdicts} exit-0 record_verdict call(s) but ${verdictCards} verdict card(s)`);
    assert.deepEqual(problems, []);
  });

  test(`${name}: each gate is built by code from estimate_cost (§ 3)`, () => {
    const parts = [...assistantParts(fx)].map((x) => x.p);
    for (const [i, p] of parts.entries()) {
      if (p.type !== "data-gate") continue;
      const est = parts.slice(0, i).reverse().find((x) => x.type === "tool-estimate_cost");
      assert.ok(est && est.output.needsGate === true, "gate not preceded by estimate_cost needsGate:true");
      const g = p.data;
      assert.equal(g.kind, "spend");
      assert.equal(g.label, est.input.action);
      assert.equal(g.amountUsd, est.output.highUsd);
      assert.equal(g.gateLine, SPEND_LINE.replace("$<amount>", `$${g.amountUsd.toFixed(2)}`));
      assert.ok(g.text.startsWith(est.input.action + "\n" + (est.input.items ?? []).join("\n")), "text = action then items");
      assert.equal(g.textHash, "sha256:" + createHash("sha256").update(g.text, "utf8").digest("hex"));
      const next = parts[i + 1];
      assert.deepEqual(next?.type === "data-gate-status" && next.data, { gateId: g.gateId, status: "pending" });
    }
    for (const [i, p] of parts.entries()) {
      if (p.type === "tool-estimate_cost" && p.output.needsGate) assert.ok(parts.slice(i).some((x) => x.type === "data-gate"), "needsGate:true with no gate");
    }
  });

  test(`${name}: data-error is one of the five codes`, () => {
    for (const { p } of assistantParts(fx)) if (p.type === "data-error")
      assert.ok(["over_balance", "model_error", "tool_error", "offline", "step_cap"].includes(p.data.code));
  });
}
