// Tests for ten-feedback, run with `deno test` (docs/design-feedback.md § 17.2,
// items 11 to 16). handler.ts is driven with fake `deps`; rpc.ts is driven
// against a local stub server. No real network, no live Supabase project.

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { handleRequest, type FeedbackDeps, type FeedbackOutcome } from "./handler.ts";
import { type FeedbackArgs } from "./core.ts";
import { addFeedback, buildDeps } from "./rpc.ts";

const PROD_ORIGIN = "https://ten.example.com";
const ENV = { TEN_APP_ORIGIN: PROD_ORIGIN } satisfies Record<string, string>;
const URL_OK = "http://localhost/functions/v1/ten-feedback";
const ID = "3f9c0a7e5b2d4c18a6e0f1b2c3d4e5f6";

function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "bug",
    comment: "the letter check keeps flagging dates that are right",
    rating: null,
    skill: "apply",
    step: "Tailoring",
    version: "0.9.2",
    host: "local",
    installationId: ID,
    ...over,
  };
}

function post(body: unknown, headers: Record<string, string> = {}, url = URL_OK): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

interface Fake {
  deps: FeedbackDeps;
  calls: FeedbackArgs[];
  statuses: number[];
}

function fake(outcome: FeedbackOutcome | Error | "hang" = "sent", timeoutMs?: number): Fake {
  const calls: FeedbackArgs[] = [];
  const statuses: number[] = [];
  const deps: FeedbackDeps = {
    addFeedback: (args) => {
      calls.push(args);
      if (outcome === "hang") return new Promise(() => {});
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome);
    },
    logStatus: (s) => statuses.push(s),
    timeoutMs,
  };
  return { deps, calls, statuses };
}

/** Records every console call made while `fn` runs. */
async function withConsoleSpy<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const names = ["log", "info", "warn", "error", "debug"] as const;
  const saved = names.map((n) => console[n]);
  for (const n of names) {
    console[n] = (...a: unknown[]) => { lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  }
  try {
    return { result: await fn(), lines };
  } finally {
    names.forEach((n, i) => { console[n] = saved[i]; });
  }
}

// ---------------------------------------------------------------- 11. routing and CORS

Deno.test("11. OPTIONS from an allowed origin gets the CORS headers; an unlisted origin gets no allow header", async () => {
  const f = fake();
  for (const origin of [PROD_ORIGIN, "http://localhost:5173"]) {
    const res = await handleRequest(new Request(URL_OK, { method: "OPTIONS", headers: { origin } }), f.deps, ENV);
    assertEquals(res.status, 204);
    assertEquals(res.headers.get("access-control-allow-origin"), origin);
    assert(res.headers.get("access-control-allow-methods")?.includes("POST"));
    assert(res.headers.get("access-control-allow-headers")?.includes("content-type"));
  }
  const bad = await handleRequest(new Request(URL_OK, { method: "OPTIONS", headers: { origin: "https://evil.example.org" } }), f.deps, ENV);
  assertEquals(bad.headers.get("access-control-allow-origin"), null);
  const none = await handleRequest(new Request(URL_OK, { method: "OPTIONS" }), f.deps, ENV);
  assertEquals(none.headers.get("access-control-allow-origin"), null);
  assertEquals(f.calls.length, 0);
});

Deno.test("11. CORS rides on real answers too, and a node caller with no Origin needs none", async () => {
  const f = fake();
  const withOrigin = await handleRequest(post(valid(), { origin: PROD_ORIGIN }), f.deps, ENV);
  assertEquals(withOrigin.status, 201);
  assertEquals(withOrigin.headers.get("access-control-allow-origin"), PROD_ORIGIN);
  const without = await handleRequest(post(valid()), f.deps, ENV);
  assertEquals(without.status, 201);
  assertEquals(without.headers.get("access-control-allow-origin"), null);
  const unlisted = await handleRequest(post(valid(), { origin: "https://evil.example.org" }), f.deps, ENV);
  assertEquals(unlisted.headers.get("access-control-allow-origin"), null);
});

Deno.test("11. GET, other methods and any other path are 404", async () => {
  const f = fake();
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD"]) {
    const res = await handleRequest(new Request(URL_OK, { method }), f.deps, ENV);
    assertEquals(res.status, 404, method);
  }
  for (const path of [
    "http://localhost/functions/v1/ten-feedback/extra",
    "http://localhost/functions/v1/ten-feedback/admin",
    "http://localhost/functions/v1/other",
    "http://localhost/elsewhere",
    "http://localhost/ten-feedbackx",
  ]) {
    const res = await handleRequest(post(valid(), {}, path), f.deps, ENV);
    assertEquals(res.status, 404, path);
    const opt = await handleRequest(new Request(path, { method: "OPTIONS", headers: { origin: PROD_ORIGIN } }), f.deps, ENV);
    assertEquals(opt.status, 404, `OPTIONS ${path}`);
  }
  assertEquals(f.calls.length, 0);
});

Deno.test("11. the function's own address works as deployed, as named, and invoked directly", async () => {
  for (const url of ["http://localhost/functions/v1/ten-feedback", "http://localhost/ten-feedback", "http://localhost/ten-feedback/", "http://localhost/"]) {
    const f = fake();
    const res = await handleRequest(post(valid(), {}, url), f.deps, ENV);
    assertEquals(res.status, 201, url);
  }
});

// ---------------------------------------------------------------- 12. size

Deno.test("12. an 8,193-byte body streamed with no Content-Length is 413 and the database is never called", async () => {
  const f = fake();
  const enc = new TextEncoder();
  const chunk = enc.encode("x".repeat(1000));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= 8193) return c.close();
      const n = Math.min(1000, 8193 - sent);
      c.enqueue(chunk.slice(0, n));
      sent += n;
    },
  });
  const req = new Request(URL_OK, { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  assertEquals(req.headers.get("content-length"), null);
  const res = await handleRequest(req, f.deps, ENV);
  assertEquals(res.status, 413);
  assertEquals(await res.json(), { status: "invalid" });
  assertEquals(f.calls.length, 0);
});

Deno.test("12. a body is cut off while streaming: the handler stops reading past the cap", async () => {
  const f = fake();
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled += 1;
      c.enqueue(new Uint8Array(4096).fill(120));
    },
  });
  const req = new Request(URL_OK, { method: "POST", body: stream, duplex: "half" } as RequestInit);
  const res = await handleRequest(req, f.deps, ENV);
  assertEquals(res.status, 413);
  assert(pulled < 10, `read ${pulled} chunks of an endless body`);
  assertEquals(f.calls.length, 0);
});

Deno.test("12. a declared length over the cap is refused too, and exactly 8,192 bytes is read", async () => {
  const f = fake();
  const big = await handleRequest(post("x".repeat(9000)), f.deps, ENV);
  assertEquals(big.status, 413);
  assertEquals(f.calls.length, 0);

  const base = JSON.stringify(valid());
  const padded = base + " ".repeat(8192 - new TextEncoder().encode(base).length);
  assertEquals(new TextEncoder().encode(padded).length, 8192);
  const ok = await handleRequest(post(padded), f.deps, ENV);
  assertEquals(ok.status, 201);
  const over = await handleRequest(post(padded + " "), f.deps, ENV);
  assertEquals(over.status, 413);
  assertEquals(f.calls.length, 1);
});

// ---------------------------------------------------------------- 13. shape

Deno.test("13. not JSON, an array, a ninth key, a missing key, a wrong type, and each field rule broken: 400, database never called", async () => {
  const f = fake();
  const without = (k: string) => { const o = valid(); delete o[k]; return o; };
  const bodies: Array<[string, unknown]> = [
    ["empty body", ""],
    ["not JSON", "not json {"],
    ["JSON null", "null"],
    ["a string", '"hello"'],
    ["a number", "7"],
    ["an array", "[]"],
    ["an array of an object", JSON.stringify([valid()])],
    ["a ninth key", valid({ extra: 1 })],
    ["a ninth key that looks like an address", valid({ ip: "203.0.113.9" })],
    ...["kind", "comment", "rating", "skill", "step", "version", "host", "installationId"].map((k): [string, unknown] => [`missing ${k}`, without(k)]),
    ["kind not a string", valid({ kind: 1 })],
    ["kind outside the two", valid({ kind: "praise" })],
    ["kind in a different case", valid({ kind: "Bug" })],
    ["comment not a string", valid({ comment: 5 })],
    ["comment null", valid({ comment: null })],
    ["comment over 2,000 characters", valid({ comment: "x".repeat(2001) })],
    ["comment with a NUL", valid({ comment: "a\u0000b" })],
    ["comment with a lone surrogate", valid({ comment: "a\ud800b" })],
    ["rating a string", valid({ rating: "3" })],
    ["rating 0", valid({ rating: 0 })],
    ["rating 6", valid({ rating: 6 })],
    ["rating 2.5", valid({ rating: 2.5 })],
    ["rating negative", valid({ rating: -1 })],
    ["rating a boolean", valid({ rating: true })],
    ["skill not a string", valid({ skill: null })],
    ["skill in upper case", valid({ skill: "Apply" })],
    ["skill with a digit first", valid({ skill: "1apply" })],
    ["skill of 31 characters", valid({ skill: "a".repeat(31) })],
    ["skill with an underscore", valid({ skill: "job_search" })],
    ["step not a string", valid({ step: 1 })],
    ["step of 61 characters", valid({ step: "x".repeat(61) })],
    ["step with @", valid({ step: "a@b" })],
    ["step with a slash", valid({ step: "a/b" })],
    ["step with a backslash", valid({ step: "a\\b" })],
    ["step with a line break", valid({ step: "a\nb" })],
    ["step with a carriage return", valid({ step: "a\rb" })],
    ["version empty", valid({ version: "" })],
    ["version of 41 characters", valid({ version: "v".repeat(41) })],
    ["version with a space", valid({ version: "1 0" })],
    ["version not a string", valid({ version: 1 })],
    ["host outside the two", valid({ host: "mobile" })],
    ["host not a string", valid({ host: null })],
    ["installationId in upper case", valid({ installationId: ID.toUpperCase() })],
    ["installationId of 31 characters", valid({ installationId: ID.slice(1) })],
    ["installationId not hex", valid({ installationId: "z".repeat(32) })],
    ["installationId a number", valid({ installationId: 5 })],
    ["installationId with a newline after a good id", valid({ installationId: ID + "\n" })],
    ["a bug with no words", valid({ kind: "bug", comment: "", rating: 4 })],
    ["no words and no rating", valid({ kind: "comment", comment: "", rating: null })],
  ];
  for (const [name, body] of bodies) {
    const res = await handleRequest(post(body), f.deps, ENV);
    assertEquals(res.status, 400, name);
    assertEquals(await res.json(), { status: "invalid" }, name);
  }
  assertEquals(f.calls.length, 0, "the database was never called");
});

Deno.test("13. the boundary values pass", async () => {
  const cases: Record<string, unknown>[] = [
    valid({ comment: "x".repeat(2000) }),
    valid({ comment: "\u{1F600}".repeat(2000) }),
    valid({ kind: "comment", comment: "", rating: 1 }),
    valid({ kind: "comment", comment: "", rating: 5 }),
    valid({ skill: "" , step: "" }),
    valid({ skill: "a" + "b".repeat(29) }),
    valid({ step: "x".repeat(60) }),
    valid({ version: "1".repeat(40) }),
    valid({ host: "web", installationId: null }),
    valid({ host: "web", installationId: ID }),
    valid({ host: "local", installationId: null }),
    valid({ comment: "a long note\twith a tab and trailing words  " }),
  ];
  for (const body of cases) {
    const f = fake();
    const res = await handleRequest(post(body), f.deps, ENV);
    assertEquals(res.status, 201, JSON.stringify(body).slice(0, 80));
    assertEquals(f.calls.length, 1);
  }
});

// ---------------------------------------------------------------- 14. arguments come only from the body

Deno.test("14. a valid body is exactly one addFeedback call, whose arguments are the body's", async () => {
  const f = fake();
  const res = await handleRequest(post(valid({ rating: 4 })), f.deps, ENV);
  assertEquals(res.status, 201);
  assertEquals(f.calls.length, 1);
  assertEquals(f.calls[0], {
    p_kind: "bug",
    p_comment: "the letter check keeps flagging dates that are right",
    p_rating: 4,
    p_skill: "apply",
    p_step: "Tailoring",
    p_version: "0.9.2",
    p_host: "local",
    p_installation_id: ID,
  });
  assertEquals(Object.keys(f.calls[0]).length, 8);
});

Deno.test("14. sentinels in Authorization, apikey, x-forwarded-for, user-agent and cookie reach neither the arguments nor any console call", async () => {
  const f = fake();
  const S = {
    authorization: "Bearer SENTINEL-AUTH-7f3c",
    apikey: "SENTINEL-APIKEY-91ab",
    "x-forwarded-for": "SENTINEL-ADDR-203",
    "x-real-ip": "SENTINEL-REALIP-1",
    "cf-connecting-ip": "SENTINEL-CF-2",
    "user-agent": "SENTINEL-UA-5e5e",
    cookie: "session=SENTINEL-COOKIE-33",
    origin: PROD_ORIGIN,
  };
  const { result, lines } = await withConsoleSpy(async () => {
    const wired = buildDeps({ url: "http://127.0.0.1:1", anonKey: "a", serviceRoleKey: "s" });
    // the real deps' logStatus goes to console; the fake database stays fake
    const deps: FeedbackDeps = { addFeedback: f.deps.addFeedback, logStatus: wired.logStatus };
    return await handleRequest(post(valid(), S), deps, ENV);
  });
  assertEquals(result.status, 201);
  const seen = JSON.stringify(f.calls) + "\n" + lines.join("\n") + "\n" + JSON.stringify([...result.headers]) + await result.text();
  assertFalse(/SENTINEL/.test(seen), "a header value leaked");
  assert(lines.length >= 1, "the status line was logged");
  for (const l of lines) assertEquals(l, "ten-feedback: 201");
});

Deno.test("14. the one thing logged is the status code, never a body", async () => {
  const f = fake();
  const WORDS = "SENTINEL-WORDS-the-user-typed-this";
  const seen: string[] = [];
  const deps: FeedbackDeps = {
    addFeedback: f.deps.addFeedback,
    logStatus: (n) => seen.push(String(n)),
  };
  await handleRequest(post(valid({ comment: WORDS })), deps, ENV);
  await handleRequest(post("not json " + WORDS), deps, ENV);
  assertEquals(seen, ["201", "400"]);
});

// ---------------------------------------------------------------- 15. answers

Deno.test("15. sent is 201; limited and closed are 429 with Retry-After 3600 and busy; every body has only status", async () => {
  for (const [outcome, status, body] of [
    ["sent", 201, "sent"],
    ["limited", 429, "busy"],
    ["closed", 429, "busy"],
  ] as const) {
    const f = fake(outcome);
    const res = await handleRequest(post(valid()), f.deps, ENV);
    assertEquals(res.status, status, outcome);
    const json = await res.json();
    assertEquals(json, { status: body }, outcome);
    assertEquals(Object.keys(json), ["status"]);
    assertEquals(res.headers.get("retry-after"), status === 429 ? "3600" : null, outcome);
    assertEquals(res.headers.get("content-type"), "application/json");
  }
});

Deno.test("15. a thrown call is 503 failed, with none of its text in the answer", async () => {
  const f = fake(new Error("relation public.ten_feedback violates check constraint SENTINEL-DB-TEXT"));
  const res = await handleRequest(post(valid()), f.deps, ENV);
  assertEquals(res.status, 503);
  const text = await res.text();
  assertEquals(JSON.parse(text), { status: "failed" });
  assertFalse(text.includes("SENTINEL"));
});

Deno.test("15. a call that never answers is 503 failed after the deadline, and the timer is cleared", async () => {
  const f = fake("hang", 25);
  const t0 = Date.now();
  const res = await handleRequest(post(valid()), f.deps, ENV);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { status: "failed" });
  assert(Date.now() - t0 < 2000);
});

Deno.test("15. an unknown outcome from the database is a failure, not a success", async () => {
  const f = fake("weird" as unknown as FeedbackOutcome);
  const res = await handleRequest(post(valid()), f.deps, ENV);
  assertEquals(res.status, 503);
});

Deno.test("15. every refusal also has a status-only body", async () => {
  const f = fake();
  for (const req of [post("nope"), post({ any: 1 }), post("x".repeat(9000))]) {
    const res = await handleRequest(req, f.deps, ENV);
    const json = await res.json();
    assertEquals(Object.keys(json), ["status"]);
    assertEquals(json.status, "invalid");
  }
});

// ---------------------------------------------------------------- 16. one database member

Deno.test("16. the wired deps have one database member, addFeedback, and a status log", () => {
  const deps = buildDeps({ url: "http://127.0.0.1:1", anonKey: "a", serviceRoleKey: "s" });
  assertEquals(Object.keys(deps).sort(), ["addFeedback", "logStatus"]);
});

// The file review of item 16 (no other database or auth call, no forbidden header
// read) needs file access, which this suite's --allow-net-only run does not have:
// it is in tests/feedback.test.mjs, "16. the function's files".

// ---------------------------------------------------------------- the real RPC client, against a stub

Deno.test("rpc: addFeedback posts the eight p_ arguments to rpc/ten_feedback_add with the service role", async () => {
  const seen: { url: string; headers: Headers; body: string }[] = [];
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    seen.push({ url: new URL(req.url).pathname, headers: req.headers, body: await req.text() });
    return new Response(JSON.stringify({ status: "sent" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const env = { url, anonKey: "anon-key", serviceRoleKey: "service-role-key" };
    const args: FeedbackArgs = {
      p_kind: "comment", p_comment: "hi", p_rating: 3, p_skill: "", p_step: "", p_version: "1", p_host: "local", p_installation_id: ID,
    };
    assertEquals(await addFeedback(env, args), "sent");
    assertEquals(seen.length, 1);
    assertEquals(seen[0].url, "/rest/v1/rpc/ten_feedback_add");
    assertEquals(JSON.parse(seen[0].body), args);
    assertEquals(seen[0].headers.get("authorization"), "Bearer service-role-key");
    assertEquals(seen[0].headers.get("apikey"), "service-role-key");
  } finally {
    await server.shutdown();
  }
});

Deno.test("rpc: limited and closed pass through; any other answer or a transport error throws", async () => {
  let answer: { status: number; body: string } = { status: 200, body: '{"status":"limited"}' };
  const server = Deno.serve({ port: 0, onListen: () => {} }, () => new Response(answer.body, { status: answer.status }));
  try {
    const url = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const env = { url, anonKey: "a", serviceRoleKey: "s" };
    const args: FeedbackArgs = { p_kind: "comment", p_comment: "hi", p_rating: null, p_skill: "", p_step: "", p_version: "1", p_host: "web", p_installation_id: null };
    assertEquals(await addFeedback(env, args), "limited");
    answer = { status: 200, body: '{"status":"closed"}' };
    assertEquals(await addFeedback(env, args), "closed");
    for (const bad of [
      { status: 200, body: '{"status":"nope"}' },
      { status: 200, body: "{}" },
      { status: 200, body: "null" },
      { status: 400, body: '{"message":"check constraint"}' },
      { status: 500, body: "boom" },
    ]) {
      answer = bad;
      let threw = false;
      try {
        await addFeedback(env, args);
      } catch (e) {
        threw = true;
        assertFalse(String((e as Error).message).includes("check constraint"), "the database's text is not carried");
      }
      assert(threw, JSON.stringify(bad));
    }
  } finally {
    await server.shutdown();
  }
  // a closed port: the transport error is thrown, not swallowed
  const args: FeedbackArgs = { p_kind: "comment", p_comment: "hi", p_rating: null, p_skill: "", p_step: "", p_version: "1", p_host: "web", p_installation_id: null };
  let threw = false;
  try {
    await addFeedback({ url: "http://127.0.0.1:1", anonKey: "a", serviceRoleKey: "s" }, args);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("end to end: handler -> real rpc client -> stub database answering sent, limited, 500", async () => {
  let respond: () => Response = () => new Response('{"status":"sent"}');
  const bodies: string[] = [];
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => { bodies.push(await req.text()); return respond(); });
  try {
    const env = { url: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`, anonKey: "a", serviceRoleKey: "s" };
    const deps = buildDeps(env, fetch, () => {});
    assertEquals((await handleRequest(post(valid()), deps, ENV)).status, 201);
    respond = () => new Response('{"status":"limited"}');
    assertEquals((await handleRequest(post(valid()), deps, ENV)).status, 429);
    respond = () => new Response("boom", { status: 500 });
    assertEquals((await handleRequest(post(valid()), deps, ENV)).status, 503);
    assertEquals(bodies.length, 3);
    for (const b of bodies) assertEquals(Object.keys(JSON.parse(b)).sort(), ["p_comment", "p_host", "p_installation_id", "p_kind", "p_rating", "p_skill", "p_step", "p_version"]);
  } finally {
    await server.shutdown();
  }
});

// ---------------------------------------------------------------- the lib and the function agree

Deno.test("the lib's output always passes the function's shape check (they cannot disagree)", async () => {
  const lib = await import("../../../skills/feedback/scripts/lib/feedback.mjs");
  const ctxLocal = { version: "0.9.2", host: "local", installationId: ID };
  const ctxWeb = { version: "web-1a2b3c", host: "web", installationId: null };
  const inputs: Array<[Record<string, unknown>, typeof ctxLocal | typeof ctxWeb]> = [
    [{ comment: "plain" }, ctxLocal],
    [{ kind: "bug", comment: "broken", rating: 2, skill: "apply", step: "Tailoring" }, ctxLocal],
    [{ rating: 5 }, ctxLocal],
    [{ comment: "x".repeat(2000) }, ctxLocal],
    [{ comment: "\u{1F600}".repeat(2000) }, ctxLocal],
    [{ comment: "line\nbreaks\tand   spaces", skill: "Not A Skill", step: "has/slash" }, ctxLocal],
    [{ comment: "mail someone@example.org or call me", step: "x".repeat(61) }, ctxLocal],
    [{ comment: "web note", rating: 1, skill: "storybank" }, ctxWeb],
    [{ comment: "stray \u0000 and \ud800 junk" }, ctxLocal],
  ];
  for (const [input, ctx] of inputs) {
    const payload = lib.buildFeedback(input, ctx);
    assertFalse("error" in payload, JSON.stringify(input).slice(0, 60));
    const f = fake();
    const res = await handleRequest(post(JSON.stringify(payload)), f.deps, ENV);
    assertEquals(res.status, 201, JSON.stringify(payload).slice(0, 120));
    assertEquals(f.calls.length, 1);
  }
});
