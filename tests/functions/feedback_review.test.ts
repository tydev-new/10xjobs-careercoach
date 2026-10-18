// deno-lint-ignore-file no-explicit-any
// Independent review (tester, 2026-10-17) of ten-feedback: docs/design-feedback.md
// § 9 (and § 10's rules it mirrors), stage 1, amended 2026-10-17 (71991e0: a web
// note may carry a random id). Written from the doc, not the code.
//
// What is different from supabase/functions/ten-feedback/handler.test.ts: the
// handler is served for real (Deno.serve on 127.0.0.1) and called over HTTP, so a
// body can stream in with no Content-Length; every console method is captured; the
// real rpc.ts is pointed at a local fake PostgREST; and the skill's own lib is run
// against the function's validation, so a note the script would send is never a
// note the function refuses.
//
//   deno test --allow-net=127.0.0.1 tests/functions/feedback_review.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleRequest, type FeedbackDeps, type FeedbackOutcome } from "../../supabase/functions/ten-feedback/handler.ts";
import { validateBody, type FeedbackArgs } from "../../supabase/functions/ten-feedback/core.ts";
import { addFeedback, buildDeps } from "../../supabase/functions/ten-feedback/rpc.ts";
// @ts-ignore: a plain .mjs module, typed loosely here
import * as lib from "../../skills/feedback/scripts/lib/feedback.mjs";

const APP = "https://ten-app.example.com";
const ENV = { TEN_APP_ORIGIN: APP };
const ID = "3f9c0a7e5b2d4c18a6e0f1b2c3d4e5f6";
const good = (o: Record<string, unknown> = {}) => ({ kind: "bug", comment: "the letter check keeps flagging dates that are right", rating: null, skill: "apply", step: "Tailoring", version: "0.9.2", host: "local", installationId: ID, ...o });

interface Rig { deps: FeedbackDeps; calls: FeedbackArgs[]; statuses: number[] }
function rig(answer: FeedbackOutcome | "throw" | "hang" | string = "sent", timeoutMs?: number): Rig {
  const calls: FeedbackArgs[] = [];
  const statuses: number[] = [];
  return {
    calls,
    statuses,
    deps: {
      addFeedback: (a) => {
        calls.push(a);
        if (answer === "throw") return Promise.reject(new Error("db down: " + JSON.stringify(a)));
        if (answer === "hang") return new Promise(() => {});
        return Promise.resolve(answer as FeedbackOutcome);
      },
      logStatus: (s) => statuses.push(s),
      ...(timeoutMs ? { timeoutMs } : {}),
    },
  };
}

/** Serves one rig on 127.0.0.1 and gives back its base URL and a stopper. */
function serve(r: Rig, env: Record<string, string | undefined> = ENV) {
  const ac = new AbortController();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} }, (req) => handleRequest(req, r.deps, env));
  const port = (server.addr as Deno.NetAddr).port;
  return { base: `http://127.0.0.1:${port}`, stop: async () => { ac.abort(); await server.finished; } };
}

/** Every console method, captured for the length of `fn`. */
async function captureConsole<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const keep: Record<string, any> = {};
  for (const m of ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const) {
    keep[m] = (console as any)[m];
    (console as any)[m] = (...a: unknown[]) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  }
  try {
    return { value: await fn(), lines };
  } finally {
    for (const [m, f] of Object.entries(keep)) (console as any)[m] = f;
  }
}

const req = (method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1" + path, { method, headers: body === undefined ? headers : { "content-type": "application/json", ...headers }, body });

// ============================================================ routes and methods

Deno.test("V1 routes: POST and OPTIONS on the function's address; every other method there, and every other address, is 404 with the database never called", async () => {
  const seen: string[] = [];
  for (const path of ["/ten-feedback", "/functions/v1/ten-feedback", "/ten-feedback/", "/ten-feedback?x=1", "/", "/other/ten-feedback", "/ten-feedback/x", "/ten-feedbackx", "/functions/v1/ten-feedback-old", "/rest/v1/rpc/ten_feedback_add", "/ten-feedback/../ten-feedback"]) {
    for (const method of ["POST", "OPTIONS", "GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
      const r = rig();
      const body = method === "POST" || method === "PUT" || method === "PATCH" ? JSON.stringify(good()) : undefined;
      const res = await handleRequest(req(method, path, body, { origin: APP }), r.deps, ENV);
      await res.body?.cancel();
      seen.push(`${method} ${path} -> ${res.status}${r.calls.length ? " (db)" : ""}`);
      const own = ["/ten-feedback", "/functions/v1/ten-feedback", "/ten-feedback/", "/ten-feedback?x=1"].includes(path);
      if (!["POST", "OPTIONS"].includes(method)) {
        assertEquals(res.status, 404, `${method} ${path}`);
        assertEquals(r.calls.length, 0, `${method} ${path}`);
      }
      if (own && method === "POST") assertEquals(res.status, 201, `${method} ${path}`);
      if (own && method === "OPTIONS") assertEquals(res.status, 204, `${method} ${path}`);
      if (["/ten-feedback/x", "/ten-feedbackx", "/functions/v1/ten-feedback-old", "/rest/v1/rpc/ten_feedback_add"].includes(path)) {
        assertEquals(res.status, 404, `${method} ${path}`);
        assertEquals(r.calls.length, 0);
      }
    }
  }
  console.log("  [V1] " + seen.filter((s) => / (\/|\/other\/ten-feedback|\/ten-feedback\/\.\.\/ten-feedback) /.test(s) && /POST|OPTIONS/.test(s)).join(" | "));
});

// ============================================================ size, over real HTTP

Deno.test("V2 size, over HTTP: 8,192 bytes go; 8,193 bytes are 413 with a Content-Length, and also streamed in chunks with none; the database is never called for an oversize body; the count is bytes, not characters", async () => {
  const r = rig();
  const s = serve(r);
  try {
    const pad = (n: number) => { const base = JSON.stringify(good({ comment: "x" })); return base.slice(0, -1) + " ".repeat(n - base.length) + "}"; };
    const exact = pad(8192);
    assertEquals(new TextEncoder().encode(exact).length, 8192);
    let res = await fetch(s.base + "/ten-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: exact });
    assertEquals([res.status, await res.json()], [201, { status: "sent" }]);
    const over = pad(8193);
    res = await fetch(s.base + "/ten-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: over });
    assertEquals([res.status, await res.json()], [413, { status: "invalid" }]);
    // streamed, no Content-Length: 9 chunks of 1,000 bytes
    const bytes = new TextEncoder().encode(pad(9000));
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < bytes.length; i += 1000) c.enqueue(bytes.slice(i, i + 1000)); c.close(); },
    });
    res = await fetch(s.base + "/ten-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    assertEquals([res.status, await res.json()], [413, { status: "invalid" }]);
    // a never-ending stream is cut off, not read forever
    let sentBytes = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) { if (sentBytes > 2_000_000) { c.close(); return; } sentBytes += 4096; c.enqueue(new Uint8Array(4096).fill(32)); },
    });
    res = await fetch(s.base + "/ten-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: endless, duplex: "half" } as RequestInit).catch((e) => ({ status: -1, json: async () => String(e) }) as any);
    assert([413, -1].includes(res.status), `endless body: ${res.status}`);
    if (res.status === 413) await res.json();
    console.log(`  [V2] the endless body: answered ${res.status} after the client had produced ${sentBytes} bytes`);
    // 2,000 four-byte characters: a valid note of about 8,1xx bytes
    const emoji = JSON.stringify(good({ comment: "😀".repeat(2000) }));
    res = await fetch(s.base + "/ten-feedback", { method: "POST", headers: { "content-type": "application/json" }, body: emoji });
    console.log(`  [V2] a 2,000-emoji note is ${new TextEncoder().encode(emoji).length} bytes: ${res.status}`);
    await res.body?.cancel();
    assertEquals(r.calls.length, emoji.length <= 8192 && new TextEncoder().encode(emoji).length <= 8192 ? 2 : 1, "database calls: only the bodies within the cap");
  } finally {
    await s.stop();
  }
});

// ============================================================ shapes

Deno.test("V3 shapes: every malformed body is 400 {status: invalid} and the database is never called; NUL and lone surrogates are refused; valid edge values pass; a web note with an id is accepted (amended 2026-10-17)", async () => {
  const bad: [string, string][] = [
    ["not JSON", "{kind:"], ["empty", ""], ["array", "[]"], ["null", "null"], ["a string", '"hi"'], ["a number", "5"],
    ["nine keys", JSON.stringify({ ...good(), extra: 1 })], ["seven keys", JSON.stringify((({ step: _s, ...o }) => o)(good()))],
    ["__proto__ as a ninth key", JSON.stringify(good()).slice(0, -1) + ',"__proto__":{"x":1}}'],
    ["kind Bug", JSON.stringify(good({ kind: "Bug" }))], ["kind praise", JSON.stringify(good({ kind: "praise" }))],
    ["comment a number", JSON.stringify(good({ comment: 5 }))], ["comment 2,001", JSON.stringify(good({ comment: "x".repeat(2001) }))],
    ["comment NUL", JSON.stringify(good()).replace("right", "rig\\u0000ht")], ["comment lone high surrogate", JSON.stringify(good()).replace("right", "rig\\ud800ht")],
    ["comment lone low surrogate", JSON.stringify(good()).replace("right", "rig\\udc00ht")], ["comment reversed pair", JSON.stringify(good()).replace("right", "\\udc00\\ud800")],
    ["comment ends in a high surrogate", JSON.stringify(good()).replace("right", "right\\ud83d")],
    ["rating 0", JSON.stringify(good({ rating: 0 }))], ["rating 6", JSON.stringify(good({ rating: 6 }))], ["rating 2.5", JSON.stringify(good({ rating: 2.5 }))],
    ["rating '3'", JSON.stringify(good({ rating: "3" }))], ["rating true", JSON.stringify(good({ rating: true }))],
    ["skill Apply", JSON.stringify(good({ skill: "Apply" }))], ["skill 31 chars", JSON.stringify(good({ skill: "a".repeat(31) }))], ["skill -x", JSON.stringify(good({ skill: "-x" }))],
    ["step 61", JSON.stringify(good({ step: "s".repeat(61) }))], ["step @", JSON.stringify(good({ step: "a@b" }))], ["step /", JSON.stringify(good({ step: "a/b" }))],
    ["step \\", JSON.stringify(good({ step: "a\\b" }))], ["step LF", JSON.stringify(good({ step: "a\nb" }))], ["step CR", JSON.stringify(good({ step: "a\rb" }))], ["step NUL", JSON.stringify(good()).replace("Tailoring", "Tail\\u0000oring")],
    ["version empty", JSON.stringify(good({ version: "" }))], ["version 41", JSON.stringify(good({ version: "1".repeat(41) }))], ["version space", JSON.stringify(good({ version: "1 2" }))], ["version null", JSON.stringify(good({ version: null }))],
    ["host Local", JSON.stringify(good({ host: "Local" }))], ["host missing value", JSON.stringify(good({ host: "" }))],
    ["id uppercase", JSON.stringify(good({ installationId: ID.toUpperCase() }))], ["id 31", JSON.stringify(good({ installationId: ID.slice(1) }))], ["id a number", JSON.stringify(good({ installationId: 5 }))],
    ["no words, no rating", JSON.stringify(good({ kind: "comment", comment: "", rating: null }))], ["bug, no words", JSON.stringify(good({ kind: "bug", comment: "", rating: 4 }))],
  ];
  for (const [what, body] of bad) {
    const r = rig();
    const res = await handleRequest(req("POST", "/ten-feedback", body), r.deps, ENV);
    assertEquals([res.status, await res.json()], [400, { status: "invalid" }], what);
    assertEquals(r.calls.length, 0, what);
  }
  const ok: [string, Record<string, unknown>][] = [
    ["2,000 characters", good({ comment: "x".repeat(2000) })], ["2,000 emoji (code points)", good({ comment: "😀".repeat(2000) })],
    ["step 60 emoji", good({ step: "😀".repeat(60) })], ["rating only", good({ kind: "comment", comment: "", rating: 5 })],
    ["empty skill and step", good({ skill: "", step: "" })], ["no id", good({ installationId: null })], ["version 40", good({ version: "a".repeat(40) })],
    ["web, no id", good({ host: "web", installationId: null })], ["rating 1.0 (a whole number in JSON)", good({ rating: 1.0 })],
  ];
  for (const [what, body] of ok) {
    const r = rig();
    const res = await handleRequest(req("POST", "/ten-feedback", JSON.stringify(body)), r.deps, ENV);
    assertEquals(res.status, 201, what);
    assertEquals(r.calls.length, 1, what);
  }
  // the owner's 2026-10-17 ruling: a web note carries a random id (§ 10.1, § 12.2)
  {
    const r = rig();
    const res = await handleRequest(req("POST", "/ten-feedback", JSON.stringify(good({ host: "web" }))), r.deps, ENV);
    await res.body?.cancel();
    console.log(`  [V3] a web note with an id: ${res.status}`);
    assertEquals(res.status, 201, "a web note with a random id is refused (design 71991e0 § 10.1 drops that check)");
  }
});

// ============================================================ headers never used

Deno.test("V4 with and without auth headers the answer is the same; sentinels in Authorization, apikey, cookie, every address header, user-agent and referer reach neither the database arguments nor any console line; the note's words are never logged; the log is the status code alone", async () => {
  const SENT = "HDRSENTINEL5150";
  const headerSets: Record<string, string>[] = [
    {},
    { authorization: `Bearer ${SENT}` },
    { apikey: SENT },
    { authorization: `Bearer ${SENT}`, apikey: SENT, cookie: `sb=${SENT}`, "x-forwarded-for": `203.0.113.7, ${SENT}`, "x-real-ip": SENT, "cf-connecting-ip": SENT, forwarded: `for=${SENT}`, "true-client-ip": SENT, "user-agent": SENT, referer: `https://x.example/${SENT}`, "x-client-info": SENT },
  ];
  const WORDS = "WORDSENTINEL the letter check is wrong";
  for (const h of headerSets) {
    for (const answer of ["sent", "limited", "closed", "throw", "weird"]) {
      const r = rig(answer);
      const { value: res, lines } = await captureConsole(() => handleRequest(req("POST", "/ten-feedback", JSON.stringify(good({ comment: WORDS })), h), r.deps, ENV));
      const status = res.status;
      await res.body?.cancel();
      const expected = answer === "sent" ? 201 : answer === "limited" || answer === "closed" ? 429 : 503;
      assertEquals(status, expected, `${answer} with ${Object.keys(h)}`);
      assertEquals(r.calls.length, 1);
      assert(!JSON.stringify(r.calls).includes(SENT), "a header reached the database arguments");
      assertEquals(Object.keys(r.calls[0]).sort(), ["p_comment", "p_host", "p_installation_id", "p_kind", "p_rating", "p_skill", "p_step", "p_version"]);
      assert(!lines.join("\n").includes(SENT) && !lines.join("\n").includes("WORDSENTINEL"), `logged: ${lines}`);
      assertEquals(r.statuses, [expected]);
    }
  }
  // the real deps' log line
  const logged: string[] = [];
  const deps = buildDeps({ url: "http://127.0.0.1:9", anonKey: "a", serviceRoleKey: "s" }, (async () => new Response('{"status":"sent"}', { status: 200 })) as typeof fetch, (l) => logged.push(l));
  const res = await handleRequest(req("POST", "/ten-feedback", JSON.stringify(good({ comment: WORDS })), { authorization: `Bearer ${SENT}` }), deps, ENV);
  await res.body?.cancel();
  assertEquals(logged, ["ten-feedback: 201"]);
  assertEquals(Object.keys(deps).sort(), ["addFeedback", "logStatus"], "one database member");
});

// ============================================================ CORS

Deno.test("V5 CORS: the app origin and localhost:5173 get the allow header on the preflight and on every answer; an unlisted origin, a look-alike, 'null' and no Origin get none; without TEN_APP_ORIGIN only localhost:5173 is allowed", async () => {
  const cases: [string | null, boolean, Record<string, string | undefined>][] = [
    [APP, true, ENV], ["http://localhost:5173", true, ENV], ["https://evil.example", false, ENV], [APP + "/", false, ENV], [APP + ".evil.example", false, ENV],
    ["http://localhost:5174", false, ENV], ["null", false, ENV], [null, false, ENV], [APP, false, {}], ["http://localhost:5173", true, {}],
  ];
  for (const [origin, allowed, env] of cases) {
    const h: Record<string, string> = origin ? { origin } : {};
    const pre = await handleRequest(new Request("http://127.0.0.1/ten-feedback", { method: "OPTIONS", headers: { ...h, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }), rig().deps, env);
    assertEquals(pre.status, 204, `preflight ${origin}`);
    assertEquals(pre.headers.get("access-control-allow-origin"), allowed ? origin : null, `preflight ${origin}`);
    if (allowed) {
      assert((pre.headers.get("access-control-allow-headers") ?? "").includes("content-type"));
      assert((pre.headers.get("access-control-allow-methods") ?? "").includes("POST"));
      assertEquals(pre.headers.get("vary"), "Origin");
    }
    for (const [answer, body] of [["sent", JSON.stringify(good())], ["sent", "{bad"], ["limited", JSON.stringify(good())], ["throw", JSON.stringify(good())]] as const) {
      const res = await handleRequest(req("POST", "/ten-feedback", body, h), rig(answer).deps, env);
      await res.body?.cancel();
      assertEquals(res.headers.get("access-control-allow-origin"), allowed ? origin : null, `${res.status} for ${origin}`);
      assertEquals(res.headers.get("access-control-allow-credentials"), null);
    }
  }
});

// ============================================================ answers

Deno.test("V6 answers: sent 201; limited and closed 429 busy with Retry-After 3600; a thrown call, a call past the deadline and an unknown outcome 503 failed; every body has the one key status; the deadline is 10 seconds by default", async () => {
  const table: [string, number, string, string | null][] = [["sent", 201, "sent", null], ["limited", 429, "busy", "3600"], ["closed", 429, "busy", "3600"], ["throw", 503, "failed", null], ["weird", 503, "failed", null]];
  for (const [answer, status, word, retry] of table) {
    const res = await handleRequest(req("POST", "/ten-feedback", JSON.stringify(good())), rig(answer).deps, ENV);
    assertEquals(res.status, status, answer);
    assertEquals(await res.json(), { status: word }, answer);
    assertEquals(res.headers.get("retry-after"), retry, answer);
    assertEquals(res.headers.get("content-type"), "application/json");
  }
  const t0 = Date.now();
  const slow = await handleRequest(req("POST", "/ten-feedback", JSON.stringify(good())), rig("hang", 200).deps, ENV);
  assertEquals([slow.status, await slow.json()], [503, { status: "failed" }]);
  assert(Date.now() - t0 < 2000);
  // (the 10-second default is read in the file by hand: handler.ts DEFAULT_TIMEOUT_MS = 10_000, rpc.ts RPC_TIMEOUT_MS = 10_000;
  // run.py runs this suite with --allow-net only, so no file read here)
});

// ============================================================ the one database call, for real

Deno.test("V7 rpc.ts against a local fake PostgREST: one POST to /rest/v1/rpc/ten_feedback_add with the service role as Authorization and apikey, the body exactly the validated arguments; a non-2xx or an unknown status throws without the note's words in the error", async () => {
  const got: { method: string; path: string; auth: string | null; apikey: string | null; body: string }[] = [];
  let answer: [number, string] = [200, '{"status":"sent"}'];
  const ac = new AbortController();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, signal: ac.signal, onListen: () => {} }, async (r) => {
    got.push({ method: r.method, path: new URL(r.url).pathname, auth: r.headers.get("authorization"), apikey: r.headers.get("apikey"), body: await r.text() });
    return new Response(answer[1], { status: answer[0], headers: { "content-type": "application/json" } });
  });
  const base = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
  try {
    const env = { url: base, anonKey: "anon-key", serviceRoleKey: "service-role-key" };
    const checked = validateBody(good({ comment: "WORDS in the note" }));
    assert(checked.ok);
    for (const [st, text, want] of [[200, '{"status":"sent"}', "sent"], [200, '{"status":"limited"}', "limited"], [200, '{"status":"closed"}', "closed"]] as const) {
      answer = [st, text];
      assertEquals(await addFeedback(env, checked.args), want);
    }
    assertEquals(got.length, 3);
    for (const g of got) {
      assertEquals([g.method, g.path, g.auth, g.apikey], ["POST", "/rest/v1/rpc/ten_feedback_add", "Bearer service-role-key", "service-role-key"]);
      assertEquals(JSON.parse(g.body), checked.args);
    }
    for (const [st, text] of [[500, '{"message":"boom"}'], [200, '{"status":"weird"}'], [200, "[]"], [404, ""]] as const) {
      answer = [st, text];
      let err = "";
      try { await addFeedback(env, checked.args); } catch (e) { err = String(e); }
      assert(err !== "", `${st} ${text} did not throw`);
      assert(!err.includes("WORDS"), `the error carries the words: ${err}`);
    }
  } finally {
    ac.abort();
    await server.finished;
  }
});

// ============================================================ the lib and the function agree

Deno.test("V8 every note the skill's lib builds (2,000 random inputs, odd characters included) passes the function's validation, so a note the script would send is never refused by the function", () => {
  let seed = 20261017;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pool = ["a", "Z", "9", " ", "\t", "\n", "\r", "\u0000", "\u0001", "\u007f", "\u0085", " ", " ", "\ud800", "\udc00", "😀", "é", "漢", "@", "/", "\\", "\"", "'", ".", "+", "-", "_", "<", ">", "jo@x.com", "/Users/alex/x", "415-555-0100", "linkedin.com/in/x", "﻿", "​"];
  const str = (max: number) => { let s = ""; const n = Math.floor(rnd() * max); for (let i = 0; i < n; i++) s += pool[Math.floor(rnd() * pool.length)]; return s; };
  let built = 0;
  const bad: string[] = [];
  for (let i = 0; i < 2000; i++) {
    const input = {
      kind: rnd() < 0.5 ? "bug" : rnd() < 0.5 ? "comment" : undefined,
      comment: rnd() < 0.1 ? undefined : str(rnd() < 0.05 ? 2500 : 60),
      rating: rnd() < 0.5 ? null : String(1 + Math.floor(rnd() * 5)),
      skill: rnd() < 0.5 ? lib.SKILLS[Math.floor(rnd() * lib.SKILLS.length)] : str(12),
      step: rnd() < 0.5 ? "Tailoring" : str(70),
    };
    const ctx = { host: "local", version: rnd() < 0.5 ? "0.9.2" : str(45), installationId: rnd() < 0.8 ? ID : str(32) };
    const p: any = lib.buildFeedback(input, ctx);
    if (p.error) continue;
    built++;
    const v = validateBody(JSON.parse(JSON.stringify(p)));
    // V8b's one known disagreement is counted there, not here
    if (!v.ok && !/[\ud800-\udfff]/.test(p.step.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))) bad.push(JSON.stringify(p).slice(0, 200));
  }
  console.log(`  [V8] built ${built} notes; refused by the function (other than V8b's case): ${bad.length}`);
  assert(built > 500, `built ${built}`);
  assertEquals(bad, []);
});

Deno.test("V8b FINDING (tester, 2026-10-17), pinned as it is: a lone surrogate in the step passes the lib (cleanStep strips no surrogate) and the function refuses the whole note (400, so the person gets FB6). Unreachable from the local command line (argv can't carry one); reachable through stage 2's tool input. This test fails when the two are made to agree", () => {
  for (const step of ["a\ud800", "\udc00b"]) {
    const p: any = lib.buildFeedback({ comment: "hello", step }, { host: "local", version: "1", installationId: ID });
    assert(!p.error);
    assertEquals(p.step, step, "the lib keeps the lone surrogate in the step");
    assertEquals(validateBody(JSON.parse(JSON.stringify(p))).ok, false, "the function refuses it");
  }
});
