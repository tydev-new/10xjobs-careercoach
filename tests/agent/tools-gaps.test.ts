// Tester-owned: the contract gaps the coder filled (item 7 of the review
// brief) and the § 4 tool edges they touch. Each test names the contract
// line it checks.
import assert from "node:assert/strict";
import test from "node:test";

import { CardBuilder, VersionTracker, createTools } from "../../packages/agent/src/index.ts";
import { createCoach } from "../../packages/agent/src/coach.ts";
import { createInMemoryGate } from "../../packages/agent/src/gate.ts";
import { createFakeScriptRunner } from "../../packages/agent/src/tools/fake-script-runner.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import { dataChunks, makeCoach, realBundle, recordingGate, runTurn, scriptedModel, textStep, toolStep, user } from "./_support.ts";

// Real minimal files: an OOXML zip and a PDF with a Flate content stream,
// both carrying the text "Jane Candidate, Analytics Engineer".
const DOCX = Buffer.from("UEsDBBQAAAAIAEhvN13mdcR+0gAAAIsBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvVLDMAzHX8XnlasVGBh6SToAKzD0BXSOkvjw11luad++Sls6cIVR+n/8ZLebQ/BqT4Vdip1+NI3e9O32mImVKJE7Pdea1wBsZwrIJmWKooypBKwylgky2i+cCJ6a5hlsipViXdWlQ/ftK42481W9HWR9oRTyrNXLxbiwOo05e2exig77OPyirK4EI8mzh2eX+UEMGu4SFuVvwDX3Ic8ubiD1iaW+YxAXfKcywJDsLkjS/F9z5840js7SLb+05ZIsMbs4BW9uSkAXf+6H83f3J1BLAwQUAAAACABIbzddXzOVUpUAAAAHAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0Q+QJ0yMKCmXVi6Ii4QJW5T0TzkhNftycBAEQOjf//6LHfDw6/iRpyXGBS0jYSh70606lKD7JaURW2ErMCVkg6I2TjyOjcxUaibKbLXpY48Y9LmomfCnZR75E8DtqYYrQIebQvi/Ez0jx2naTF0jObqKZQfJ74aVdY8U1Fwj2zRvuOmsoB9h5sX+xdQSwMEFAAAAAgASG83XYQ3vtmvAAAA7AAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWPsW7DMAxEf4XwXFhuhwyG46ApsuQvaIl1BEiUIDJx8veR3KHLOxwOvAOn0zMGeFARn/jYffZDd5qnbXTJ3iOxQo1Zxu3Y3VTzaIzYG0WUPmXimv2mElGrLavZUnG5JEsintcYzNcwHExEz12rXJJ7Nc0NpUHnKzLBD7LzDpU+4JsxvNRbgQuvnolKD+e7DwpuUYjJURCom2AD+ihQr7CfTKtqLDvzzr858//K/AZQSwECFAMUAAAACABIbzdd5nXEftIAAACLAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAEhvN11fM5VSlQAAAAcBAAALAAAAAAAAAAAAAACAAQMBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAEhvN12EN77ZrwAAAOwAAAARAAAAAAAAAAAAAACAAcEBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAACfAgAAAAA=", "base64");
const PDF = Buffer.from("JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA3MSAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KeJxzClHQdzNUMDRSCElTMDcCIgOFkBQFDa/EvFQF58S8lMyUxJJUHQXHvMScypLM5GIF17z0zLzU1CJNhZAsBdcQAEDGEzgKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzODkgMDAwMDAgbiAKdHJhaWxlciA8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0NTkKJSVFT0YK", "base64");

function toolsFor(store: any, extra: any = {}) {
  const writes: any[] = [];
  const ctx: any = {
    chatId: "c1", writer: { write: (c: any) => writes.push(c), merge: () => {} },
    versionTracker: new VersionTracker(), cardBuilder: new CardBuilder(),
    turnState: { measuredSteps: [], spentSoFarUsd: 0 },
    gateGrammarMd: realBundle()["skills/coach/references/gate-grammar.md"], idFor: () => crypto.randomUUID(),
  };
  const deps: any = { workspace: store, skills: realBundle(), gate: createInMemoryGate(), balance: async () => 5,
    fetch: async () => { throw new Error("no net"); }, clock: { now: () => new Date() }, scripts: createFakeScriptRunner([]), ...extra };
  const tools: any = createTools(deps, ctx);
  return { call: (n: string, input: any) => tools[n].execute(input, { toolCallId: "x", messages: [] }), writes, ctx };
}

const garbage = (s: string) => /�|[\u0000-\u0008\u000E-\u001F]/.test(s);

for (const [name, bytes] of [["resume.docx", DOCX], ["resume.pdf", PDF]] as const) {
  test(`read_file on a real ${name}: returns the text, or an honest error — never binary garbage to the model (§ 4 "extracts the text")`, async () => {
    const store = createInMemoryWorkspaceStore();
    await store.upload(`documents/${name}`, new Uint8Array(bytes));
    const { call } = toolsFor(store);
    const out = await call("read_file", { path: `documents/${name}` });
    if (out.error) return; // an explicit "can't extract yet" is acceptable
    const fffd = (out.text.match(/�/g) ?? []).length;
    assert.ok(!garbage(out.text), `${name}: ${out.text.length} chars, ${fffd} U+FFFD, document text visible: ${out.text.includes("Jane Candidate")}`);
    assert.ok(out.text.includes("Jane Candidate"), "the document's text is what the model gets");
  });
}

test("read_file on a large upload is bounded (a 9 MB .pdf must not become ~9 MB of model input)", async () => {
  const store = createInMemoryWorkspaceStore();
  const big = new Uint8Array(9 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = 32 + (i % 90);
  await store.upload("documents/big.pdf", big);
  const { call } = toolsFor(store);
  const out = await call("read_file", { path: "documents/big.pdf" });
  const len = out.error ? 0 : (out.text ?? out.content ?? "").length;
  assert.ok(len <= 200_000, `read_file returned ${len} chars`);
});

test("web_search: results capped at 5 (§ 4 'maxResults? (≤ 5)') whatever the seam returns or the model asks", async () => {
  const seen: any[] = [];
  const webSearch = async (input: any) => { seen.push(input); return { results: Array.from({ length: 10 }, (_, i) => ({ url: `https://e.com/${i}`, title: "t", excerpt: "e" })) }; };
  const { call } = toolsFor(createInMemoryWorkspaceStore(), { webSearch });
  const out = await call("web_search", { query: "acme layoffs", maxResults: 50 });
  assert.ok(out.results.length <= 5, `${out.results.length} results; seam got maxResults=${seen[0].maxResults}`);
});

test("allowance counts check_language's own model spend: once crossed, the gate opens and NO further step runs (§ 4)", async () => {
  // Ruling (tester, fix round 1): the loop can only act at a step boundary, so
  // the step that requested check_language plus the tool's own cost may cross
  // the allowance. What must hold: that spend is counted, a logged gate opens
  // at the next boundary, and nothing further is spent without a typed yes.
  const STEP = 0.05, TOOL = 0.97;
  const rg = recordingGate();
  const steps = [toolStep([{ name: "check_language", input: { files: ["letter.md"] } }], { costUsd: STEP }),
    ...Array.from({ length: 5 }, () => toolStep([{ name: "list_files", input: {} }], { costUsd: STEP }))];
  const m = scriptedModel(steps);
  const checkLanguage = async () => ({ report: "fine", usd: TOOL });
  const coach = createCoach({ model: m.model, workspace: createInMemoryWorkspaceStore({ "letter.md": "x" }), skills: realBundle(), gate: rg.gate,
    balance: async () => 5, fetch: (async () => { throw new Error("x"); }) as any, clock: { now: () => new Date() },
    scripts: createFakeScriptRunner([]), checkLanguage } as any);
  const { chunks } = await runTurn(coach, "c1", [user("u1", "check my letter")]);
  const spent = TOOL + m.used * STEP;
  const opens = rg.events.filter((e) => e.op === "open");
  assert.equal(m.used, 1, `no model step after the allowance was crossed (ran ${m.used}, spent $${spent.toFixed(2)})`);
  assert.equal(opens.length, 1, "a gate was logged");
  assert.equal(rg.rows.get(opens[0].args[0].gateId)!.status, "pending");
  assert.ok(spent <= 1.0 + STEP + TOOL + 1e-9, `overshoot bounded by one step + the tool's own cost; spent $${spent.toFixed(2)}`);
  const g = dataChunks(chunks, "data-gate")[0]?.data;
  assert.ok(g && g.amountUsd >= STEP + TOOL - 1e-9, `the gate's amount includes the counted spend: ${g?.amountUsd}`);
});

test("gate line never overstates by a float cent: $1.10 shows as $1.10 (rule 8, lead ruling L2)", async () => {
  const { buildGateLine } = await import("../../packages/agent/src/gate.ts");
  const grammar = realBundle()["skills/coach/references/gate-grammar.md"];
  const bad = [1.1, 0.29, 0.57, 2.26, 1.15].filter((x) => !buildGateLine(grammar, x).includes(`$${x.toFixed(2)} `));
  assert.deepEqual(bad.map((x) => `${x} -> ${buildGateLine(grammar, x).match(/\$\d+\.\d{2}/)![0]}`), []);
  assert.ok(buildGateLine(grammar, 1.0025).includes("$1.01 "), "and 1.0025 still rounds up");
});

test("estimate_cost prices from this CHAT's measured steps after turn 1 (§ 4 'so far in this chat')", async () => {
  const m = scriptedModel([
    toolStep([{ name: "list_files", input: {} }], { costUsd: 0.05 }),
    toolStep([{ name: "list_files", input: {} }], { costUsd: 0.05 }),
    textStep("done", { costUsd: 0.05 }),
    toolStep([{ name: "estimate_cost", input: { action: "next run", steps: 10, webSearches: 0 } }]),
    textStep("ok"),
  ]);
  const { coach } = makeCoach({ model: m.model });
  const t1 = await runTurn(coach, "c1", [user("u1", "look around")]);
  const t2 = await runTurn(coach, "c1", [user("u1", "look around"), t1.message, user("u2", "estimate the next run")]);
  const out = t2.chunks.find((c: any) => c.type === "tool-output-available")?.output;
  assert.ok(out, "estimate_cost ran");
  assert.ok(out.highUsd >= 10 * 0.05 - 1e-9, `highUsd $${out.highUsd} via "${out.method}"; this chat's steps cost $0.05 each`);
});

test("gate line 'up to $X' never understates the amount (rule 8): X >= amountUsd", async () => {
  const probe = scriptedModel([toolStep([{ name: "estimate_cost", input: { action: "probe", steps: 1, webSearches: 0 } }])]);
  const p = await runTurn(makeCoach({ model: probe.model }).coach, "p", [user("u", "x")]);
  const perStep = p.chunks.find((c: any) => c.type === "tool-output-available").output.highUsd;
  const steps = Math.ceil(1.0001 / perStep); // lands just over $1.00, e.g. $1.0025
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: { action: "run", steps, webSearches: 0 } }])]);
  const { chunks } = await runTurn(makeCoach({ model: m.model }).coach, "c1", [user("u1", "x")]);
  const g = dataChunks(chunks, "data-gate")[0].data;
  const shown = Number(g.gateLine.match(/\$(\d+\.\d{2})/)![1]);
  assert.ok(shown >= g.amountUsd, `line says "up to $${shown.toFixed(2)}"; amountUsd is ${g.amountUsd}`);
});

test("gate text's cost line: plain money, no internal jargon shown to the candidate", async () => {
  const m = scriptedModel([toolStep([{ name: "estimate_cost", input: { action: "Evaluate six roles", steps: 900, webSearches: 3 } }])]);
  const { chunks } = await runTurn(makeCoach({ model: m.model }).coach, "c1", [user("u1", "x")]);
  const g = dataChunks(chunks, "data-gate")[0].data;
  const costLine = g.text.split("\n").pop();
  console.log(`[tester] cost line as shown: ${JSON.stringify(costLine)}`);
  assert.ok(!/dated-constant|measured \(this chat/.test(costLine), costLine);
});

test("estimate_cost rejects nonsense inputs rather than print a negative or NaN cost (rule 8)", async () => {
  const { call } = toolsFor(createInMemoryWorkspaceStore());
  for (const bad of [{ steps: -400, webSearches: 0 }, { steps: Number.NaN, webSearches: 0 }, { steps: 1, webSearches: -50 }]) {
    const out = await call("estimate_cost", { action: "x", ...bad });
    assert.ok(out.error || (out.lowUsd >= 0 && Number.isFinite(out.highUsd)), JSON.stringify(out));
  }
});

test("estimate_cost enforces action ≤ 6 words, items ≤ 8, each ≤ 12 words", async () => {
  const { call } = toolsFor(createInMemoryWorkspaceStore());
  assert.ok((await call("estimate_cost", { action: "one two three four five six seven", steps: 1, webSearches: 0 })).error);
  assert.ok((await call("estimate_cost", { action: "ok", steps: 1, webSearches: 0, items: Array(9).fill("a") })).error);
  assert.ok((await call("estimate_cost", { action: "ok", steps: 1, webSearches: 0, items: ["a b c d e f g h i j k l m"] })).error);
  assert.ok(!(await call("estimate_cost", { action: "one two three four five six", steps: 1, webSearches: 0, items: Array(8).fill("a b c d e f g h i j k l") })).error);
});

test("fetch_job: only the four boards' exact shapes reach fetch; lookalike hosts are unsupported_url", async () => {
  const urls: string[] = [];
  const fetch = async (u: string) => { urls.push(String(u)); return new Response(JSON.stringify({ title: "PM", content: "<p>Build <b>things</b></p>", company_name: "Acme", location: { name: "Remote" } }), { status: 200 }); };
  const { call } = toolsFor(createInMemoryWorkspaceStore(), { fetch });
  for (const bad of ["https://boards.greenhouse.io.evil.com/acme/jobs/1", "https://evil.com/boards.greenhouse.io/acme/jobs/1", "https://www.linkedin.com/jobs/view/1", "file:///etc/passwd", "https://jobs.lever.co.evil.io/a/b"]) {
    assert.equal((await call("fetch_job", { url: bad })).error?.code, "unsupported_url", bad);
  }
  assert.equal(urls.length, 0, "no fetch for refused URLs");
  const ok = await call("fetch_job", { url: "https://boards.greenhouse.io/acme/jobs/123", saveTo: "jd-inbox/acme.md" });
  assert.deepEqual(urls, ["https://boards-api.greenhouse.io/v1/boards/acme/jobs/123"]);
  assert.equal(ok.text, "Build things");
  assert.equal(ok.savedTo, "jd-inbox/acme.md");
});
