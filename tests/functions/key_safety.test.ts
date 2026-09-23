// deno-lint-ignore-file no-explicit-any
// § 8 "Prevents: a model key in the browser". The OpenRouter key (a canary) must
// never appear in any response body, response header, error, log line, ledger
// row, or request to Supabase; upstream it rides ONLY in the Authorization header.
// The upstream stub is hostile: it echoes the Authorization header back in error
// bodies and response headers.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { baseBody, call, DEL, harness, member, OPENROUTER_KEY, preq, PROD_ORIGIN, sse, okStream, t } from "./_harness.ts";

const KEY_FRAGMENT = OPENROUTER_KEY.slice(10, 40); // catch partial/truncated echoes too

t("key safety: the canary never reaches the client, logs, ledger or Supabase across every path", async () => {
  const h = await harness();
  h.reset();
  const seen: string[] = []; // everything a client or operator could observe
  const [uid, tok] = await member(h);
  const [broke, brokeTok] = await member(h);
  call(h.st, broke, 5, new Date(Date.now() - 2 * 86400_000));

  const echo = (status: number) => (hit: { headers: Headers }) =>
    new Response(JSON.stringify({ error: { message: `bad key ${hit.headers.get("authorization")}` } }), {
      status,
      headers: { "x-echo-auth": hit.headers.get("authorization") ?? "", "content-type": "application/json" },
    });
  const scripts: Array<[string, (hit: any) => Response | Promise<Response>]> = [
    ["ok", (hit) => {
      const r = sse(okStream("gen-key-ok"));
      r.headers.set("x-echo-auth", hit.headers.get("authorization") ?? "");
      return r;
    }],
    ["400", echo(400)],
    ["401", echo(401)],
    ["402", echo(402)],
    ["429", echo(429)],
    ["500", echo(500)],
    ["503", echo(503)],
    ["throws", () => {
      throw new Error("stub crashed");
    }],
    ["reset", () => sse([`data: {"id":"gen-key-reset"}`], { errorAfter: true, delayMs: 20 })],
  ];

  const collect = async (res: Response) => {
    let body = "";
    try {
      body = await res.text();
    } catch (e) {
      body = String(e);
    }
    seen.push(`${res.status} ${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${body}`);
  };

  for (const [, s] of scripts) {
    h.setUpstream(s);
    await collect(await h.proxy(preq(baseBody(), { token: tok, origin: PROD_ORIGIN })));
  }
  // refusal paths
  for (const r of [
    preq(baseBody(), { origin: PROD_ORIGIN }),
    preq(baseBody(), { token: brokeTok, origin: PROD_ORIGIN }),
    preq({ ...baseBody(), model: "x" }, { token: tok }),
    preq(undefined, { token: tok, raw: "x".repeat(300 * 1024) }),
    preq(baseBody(), { token: tok, method: "GET" }),
    new Request(`${DEL}`, { method: "POST", headers: { authorization: `Bearer ${brokeTok}` } }),
  ]) {
    try {
      await collect(await (r.url.startsWith(DEL) ? h.del : h.proxy)(r));
    } catch (e) {
      seen.push(`THREW ${String(e)} ${(e as Error).stack ?? ""}`);
    }
  }
  // RPC failure paths (the handler throws; what it throws is what Deno.serve logs)
  for (const k of ["ten_balance_for", "ten_beta_spend_today", "ten_is_member", "ten_usage_ledger", "/auth/v1/user"]) {
    h.st.fail = { [k]: 500 };
    try {
      await collect(await h.proxy(preq(baseBody(), { token: tok })));
    } catch (e) {
      seen.push(`THREW ${String(e)} ${(e as Error).stack ?? ""}`);
    }
    await h.drain();
  }
  h.st.fail = {};
  await h.drain();

  const everything = [
    ...seen,
    ...h.logs,
    JSON.stringify(h.st.ledger),
    ...h.st.requests.map((r) => `${r.method} ${r.path} ${r.auth} ${r.body}`),
  ].join("\n----\n");
  assert(everything.length > 1000, "captured something");
  assertEquals(everything.includes(OPENROUTER_KEY), false, "full key leaked");
  assertEquals(everything.includes(KEY_FRAGMENT), false, "key fragment leaked");
  assertEquals(seen.join("\n").includes(h.serviceKey), false, "service-role key reached a client");
  assert(h.st.ledger.some((r) => r.user_id === uid && r.kind === "call"), "control: calls did happen " + JSON.stringify(h.st.ledger) + h.logs.join("|"));

  // Upstream: key only in Authorization; nothing of the client's credentials forwarded.
  assert(h.upstreamHits.length >= 8);
  for (const hit of h.upstreamHits) {
    assertEquals(hit.headers.get("authorization"), `Bearer ${OPENROUTER_KEY}`);
    assertEquals(hit.bodyText.includes(OPENROUTER_KEY), false);
    assertEquals(hit.bodyText.includes(tok), false, "client JWT must not go upstream");
    for (const [k, v] of hit.headers) {
      if (k === "authorization") continue;
      assertEquals(v.includes(OPENROUTER_KEY) || v.includes(tok), false, `header ${k}`);
    }
    assertEquals(hit.headers.get("origin"), null);
    assertEquals(hit.headers.get("cookie"), null);
  }
});

t("key safety: no external host is ever contacted by the functions under test", async () => {
  const h = await harness();
  assertEquals(h.externalAttempts, []);
});
