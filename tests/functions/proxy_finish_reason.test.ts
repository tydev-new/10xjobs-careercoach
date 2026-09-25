// Tester-owned: docs/design-web-agent.md § 9.5 (the cap and its ceiling)
// and § 9.6 (recording why each call ended) — § 9.8 items (v) and (vi),
// amended 2026-09-24 (0d8588a; § 9.6 deadline rule amended at 7c1b1be). Written from the spec.
//
// Every case runs the DEPLOYED entry (index.ts, via the harness) against
// the tester's mock Supabase, which refuses an unknown column (PGRST204) and
// enforces the column's check (≤ 32 chars) — so "the insert carries the key
// and succeeds" is checked against what PostgREST would do, from the RAW
// insert body, not the handler's own view of it. The meter-deadline case
// needs a short deadline, so it drives handler.ts with the same real
// _shared/supabase.ts deps index.ts wires, pointed at the same mock.
//
// Run: deno test --allow-net=127.0.0.1 tests/functions/proxy_finish_reason.test.ts
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { CEILING_USD, MAX_TOKENS_CAP } from "../../supabase/functions/ten-model-proxy/core.ts";
import { handleRequest, type ProxyDeps } from "../../supabase/functions/ten-model-proxy/handler.ts";
import { balanceFor, betaSpendToday, envFromDeno, insertLedgerCall, isMember, verifyUser } from "../../supabase/functions/_shared/supabase.ts";
import { baseBody, callRows, harness, member, preq, PROD_ORIGIN, sse, t, type Harness } from "./_harness.ts";

const FORMULA = 64_000 * 2e-6 + 8_192 * 1e-5 + 0.007; // § 14.2 (was § 9.5's 5 × 0.004), = 0.21692

const line = (o: unknown) => `data: ${JSON.stringify(o)}`;
const content = (id: string, text: string, finish: unknown = null, extra: Record<string, unknown> = {}) =>
  line({ id, choices: [{ index: 0, delta: { content: text }, finish_reason: finish, ...extra }] });
const usageLine = (id: string, cost = 0.0123) =>
  line({ id, choices: [], usage: { prompt_tokens: 100, completion_tokens: 8192, total_tokens: 8292, cost } });

/** The raw JSON body of every ledger insert the proxy sent to (mock) PostgREST. */
function ledgerInserts(h: Harness): any[] {
  return h.st.requests
    .filter((r) => r.method === "POST" && r.path.startsWith("/rest/v1/ten_usage_ledger"))
    .map((r) => JSON.parse(r.body));
}

async function meter(chunks: string[], opts: { errorAfter?: boolean; delayMs?: number } = {}) {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  h.setUpstream(() => sse(chunks, opts));
  const res = await h.proxy(preq(baseBody(), { token: tok }));
  await res.text().catch(() => "");
  await h.drain();
  const rows = callRows(h.st);
  const inserts = ledgerInserts(h).filter((b) => b.kind === "call");
  return { h, rows, inserts };
}

/** Every case: exactly one call row landed, and its insert body NAMED the key. */
function assertRowWithKey(rows: any[], inserts: any[], want: string | null, label: string) {
  assertEquals(rows.length, 1, `${label}: one call row written (the insert never fails because of finish_reason)`);
  assert(inserts.length >= 1 && inserts.every((b) => Object.hasOwn(b, "finish_reason")), `${label}: the insert carries the finish_reason key: ${JSON.stringify(inserts)}`);
  assertEquals(rows[0].finish_reason, want, label);
  assertEquals(inserts.at(-1).finish_reason, want, `${label} (raw insert)`);
}

// ------------------------------------------------------------------ (v)

t("(v) MAX_TOKENS_CAP is 8,192 and CEILING_USD = 64,000×2e-6 + 8,192×1e-5 + 0.007 = 0.21692 (§ 14.2)", async () => {
  assertEquals(MAX_TOKENS_CAP, 8192);
  assertAlmostEquals(CEILING_USD, 0.21692, 1e-9);
  assertAlmostEquals(CEILING_USD, FORMULA, 1e-12);
});

t("(v) clamp through the deployed proxy: 8,192 stays; 8,193, absent and garbage give 8,192", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const out: Record<string, unknown> = {};
  for (const [label, v] of [["8192", 8192], ["8193", 8193], ["absent", undefined], ["garbage-string", "lots"], ["garbage-object", { n: 1 }], ["NaN-as-null", null]] as const) {
    h.upstreamHits.length = 0;
    const body: Record<string, unknown> = { ...baseBody() };
    if (v === undefined) delete body.max_tokens;
    else body.max_tokens = v;
    const res = await h.proxy(preq(body, { token: tok }));
    await res.text();
    await h.drain();
    out[label] = h.upstreamHits[0]?.body?.max_tokens;
  }
  assertEquals(out, { "8192": 8192, "8193": 8192, absent: 8192, "garbage-string": 8192, "garbage-object": 8192, "NaN-as-null": 8192 });
});

t("(v) a meter with no readable cost records the § 14.2 ceiling, $0.21692", async () => {
  const { rows } = await meter([content("gen-nocost", "hi", "stop"), "data: [DONE]"]);
  assertEquals(rows.length, 1);
  assertAlmostEquals(rows[0].usd, 0.21692, 1e-6);
});

// ------------------------------------------------------------------ (vi) parse

t("(vi) 'length' on a content chunk, then a usage chunk with EMPTY choices -> 'length'", async () => {
  const { rows, inserts } = await meter([content("gen-len", "…the four verdi", "length"), usageLine("gen-len"), "data: [DONE]"]);
  assertRowWithKey(rows, inserts, "length", "length then usage");
  assertAlmostEquals(rows[0].usd, 0.0123, 1e-9, "the rest of the row is written as today");
  assertEquals(rows[0].tokens_out, 8192);
});

t("(vi) the LAST non-null finish_reason wins; later nulls/absent never blank it", async () => {
  const { rows, inserts } = await meter([
    content("gen-last", "a", "tool_calls"),
    content("gen-last", "b", "length"),
    content("gen-last", "c", null),
    line({ id: "gen-last", choices: [{ index: 0, delta: {} }] }),
    usageLine("gen-last"),
    "data: [DONE]",
  ]);
  assertRowWithKey(rows, inserts, "length", "last non-null");
});

t("(vi) OpenRouter's normalized finish_reason is kept, not native_finish_reason", async () => {
  const { rows, inserts } = await meter([content("gen-native", "x", "length", { native_finish_reason: "max_tokens" }), usageLine("gen-native"), "data: [DONE]"]);
  assertRowWithKey(rows, inserts, "length", "normalized");
});

t("(vi) only choices[0] counts", async () => {
  const { rows, inserts } = await meter([
    line({ id: "gen-c1", choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }, { index: 1, delta: {}, finish_reason: "length" }] }),
    usageLine("gen-c1"),
    "data: [DONE]",
  ]);
  assertRowWithKey(rows, inserts, null, "choices[1] ignored");
});

const BAD: Array<[string, unknown]> = [
  ["none at all", undefined],
  ["a number", 5],
  ["empty string", ""],
  ["33 characters", "x".repeat(33)],
  ["boolean", true],
  ["object", { reason: "length" }],
  ["array", ["length"]],
];
for (const [label, fr] of BAD) {
  t(`(vi) finish_reason ${label} -> null, and the row is still written`, async () => {
    const first = fr === undefined
      ? line({ id: `gen-bad`, choices: [{ index: 0, delta: { content: "x" } }] })
      : content("gen-bad", "x", fr);
    const { rows, inserts } = await meter([first, usageLine("gen-bad"), "data: [DONE]"]);
    assertRowWithKey(rows, inserts, null, label);
    assertAlmostEquals(rows[0].usd, 0.0123, 1e-9);
  });
}

t("(vi) boundaries kept: 1 and 32 characters", async () => {
  for (const fr of ["x", "y".repeat(32)]) {
    const { rows, inserts } = await meter([content("gen-edge", "x", fr), usageLine("gen-edge"), "data: [DONE]"]);
    assertRowWithKey(rows, inserts, fr, `${fr.length} chars`);
  }
});

t("(vi) malformed choices shapes never throw: null, a string, an object, choices[0] null -> null, row written", async () => {
  for (const choices of [null, "length", { finish_reason: "length" }, [null], ["length"], [42]]) {
    const { rows, inserts } = await meter([line({ id: "gen-shape", choices }), usageLine("gen-shape"), "data: [DONE]"]);
    assertRowWithKey(rows, inserts, null, `choices=${JSON.stringify(choices)}`);
  }
});

t("(vi) a stream cut mid-line: the last WHOLE value is kept", async () => {
  const whole = content("gen-cut", "abc", "length");
  const torn = `data: {"id":"gen-cut","choices":[{"index":0,"delta":{},"finish_reason":"sto`;
  const { rows, inserts } = await meter([whole, torn], { errorAfter: true, delayMs: 30 });
  assertRowWithKey(rows, inserts, "length", "cut after a whole value");
});

t("(vi) a stream cut mid-line with no whole value before it -> null", async () => {
  const torn = `data: {"id":"gen-cut2","choices":[{"index":0,"delta":{"content":"x"},"finish_reason":"len`;
  const { rows, inserts } = await meter([content("gen-cut2", "x", null), torn], { errorAfter: true, delayMs: 30 });
  assertRowWithKey(rows, inserts, null, "cut before any finish_reason");
});

t("(vi) credit rows never carry a finish_reason", async () => {
  const { h } = await meter([content("gen-cr", "x", "stop"), usageLine("gen-cr"), "data: [DONE]"]);
  for (const r of h.st.ledger.filter((r) => r.kind === "credit")) assertEquals(r.finish_reason, null);
});

// ------------------------------------------------------------------ (vi) the meter deadline

async function withShortDeadline(chunks: string[]) {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const env = envFromDeno((k) => ({ SUPABASE_URL: h.sbUrl, SUPABASE_ANON_KEY: h.anonKey, SUPABASE_SERVICE_ROLE_KEY: h.serviceKey } as Record<string, string>)[k]);
  const pending: Promise<unknown>[] = [];
  const deps: ProxyDeps = {
    verifyUser: (token) => verifyUser(env, token),
    isMember: (token) => isMember(env, token),
    balanceFor: (uid) => balanceFor(env, uid),
    betaSpendToday: () => betaSpendToday(env),
    insertLedgerCall: (row) => insertLedgerCall(env, row),
    fetchUpstream: async () => sse(chunks, { hangAfter: true }), // never closes
    waitUntil: (p) => void pending.push(p),
    randomId: () => crypto.randomUUID(),
    log: { warn: () => {}, error: () => {} },
    meterDeadlineMs: 250,
  };
  const res = await handleRequest(preq(baseBody(), { token: tok }), deps, { TEN_APP_ORIGIN: PROD_ORIGIN });
  const reader = res.body!.getReader();
  await reader.read(); // the client saw the first bytes, then walks away
  await reader.cancel().catch(() => {});
  for (const p of pending) await p.catch(() => {});
  return { rows: callRows(h.st), inserts: ledgerInserts(h).filter((b) => b.kind === "call") };
}

t("(vi) a meter that hit its deadline with no finish_reason seen -> null, ceiling cost, row written", async () => {
  const { rows, inserts } = await withShortDeadline([content("gen-dl0", "x", null)]);
  assertRowWithKey(rows, inserts, null, "deadline, nothing seen");
  assertAlmostEquals(rows[0].usd, FORMULA, 1e-6);
});

// § 9.6 (amended 7c1b1be, lead ruling 3): "At the meter's deadline, it
// records the last value seen before the deadline, or null if there was none."
t("(vi) a meter that hit its deadline records the last finish_reason seen before it (ceiling cost, row written)", async () => {
  const { rows, inserts } = await withShortDeadline([content("gen-dl1", "x", "tool_calls"), content("gen-dl1", "y", "length"), content("gen-dl1", "z", null)]);
  assertRowWithKey(rows, inserts, "length", "deadline after a finish_reason");
  assertAlmostEquals(rows[0].usd, FORMULA, 1e-6, "the ceiling is recorded (no usage chunk arrived)");
});

t("(vi) a meter that hit its deadline: a malformed last-seen value (33 chars) is still null", async () => {
  const { rows, inserts } = await withShortDeadline([content("gen-dl2", "x", "z".repeat(33))]);
  assertRowWithKey(rows, inserts, null, "deadline, invalid value");
});
