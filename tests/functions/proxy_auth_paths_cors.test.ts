// § 8 ten-model-proxy: auth (point 1), paths/methods ("Any other path or method
// gets 404"), CORS ("allows only the production Vercel origin and localhost:5173").
// Derived from docs/design-web-agent.md § 8; driven through the real index.ts.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  baseBody,
  callRows,
  DEL,
  FN,
  harness,
  JWT_SECRET,
  member,
  nonMember,
  preq,
  observe,
  PROD_ORIGIN,
  signJwt,
  t,
} from "./_harness.ts";

async function expectRefused(status: number, req: Request) {
  const h = await harness();
  const res = await h.proxy(req);
  const txt = await res.text();
  assertEquals(res.status, status, txt);
  await h.drain();
  assertEquals(h.upstreamHits.length, 0, "must not reach upstream");
  assertEquals(callRows(h.st).length, 0, "no ledger row");
  return txt;
}

// ---------------------------------------------------------------- auth ----
t("auth: no Authorization header -> 401", async () => {
  const h = await harness();
  h.reset();
  await member(h);
  await expectRefused(401, preq(baseBody()));
});

t("auth: the anon key (a signed JWT, role anon, no sub) as bearer -> 401", async () => {
  const h = await harness();
  h.reset();
  await expectRefused(401, preq(baseBody(), { token: h.anonKey }));
});

t("auth: a publishable key (sb_publishable_…) as bearer -> 401", async () => {
  const h = await harness();
  h.reset();
  await expectRefused(401, preq(baseBody(), { token: "sb_publishable_abcDEF123" }));
});

t("auth: an expired JWT of a real member -> 401", async () => {
  const h = await harness();
  h.reset();
  const [uid] = await member(h);
  const tok = await signJwt({ sub: uid, role: "authenticated", exp: Math.floor(Date.now() / 1000) - 60 });
  await expectRefused(401, preq(baseBody(), { token: tok }));
});

t("auth: a forged JWT (member's sub, wrong secret) -> 401 (signature is verified, not just decoded)", async () => {
  const h = await harness();
  h.reset();
  const [uid] = await member(h);
  const tok = await signJwt({ sub: uid, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }, "not-the-secret-" + JWT_SECRET);
  await expectRefused(401, preq(baseBody(), { token: tok }));
});

t("auth: alg=none JWT with a member's sub -> 401", async () => {
  const h = await harness();
  h.reset();
  const [uid] = await member(h);
  const tok = await signJwt({ sub: uid, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }, "", "none");
  await expectRefused(401, preq(baseBody(), { token: tok }));
});

t("auth: a signed-in NON-member -> 403 not_a_member with the § 8 text", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await nonMember(h);
  const txt = await expectRefused(403, preq(baseBody(), { token: tok }));
  assert(txt.includes("Ten is in a private beta. Ask the person who invited you for access."), txt);
});

t("auth: the service-role key sent by a client grants nothing (401, no upstream, no row)", async () => {
  const h = await harness();
  h.reset();
  await member(h);
  await expectRefused(401, preq(baseBody(), { token: h.serviceKey }));
});

t("auth: a JWT for a deleted/unknown user -> 401", async () => {
  const h = await harness();
  h.reset();
  const tok = await signJwt({ sub: crypto.randomUUID(), role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 });
  await expectRefused(401, preq(baseBody(), { token: tok }));
});

t("auth: token only in apikey header / query string / Basic scheme -> 401", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  await expectRefused(401, preq(baseBody(), { headers: { apikey: tok } }));
  await expectRefused(401, preq(baseBody(), { url: `${FN}/chat/completions?access_token=${tok}` }));
  await expectRefused(401, preq(baseBody(), { headers: { authorization: `Basic ${btoa("u:" + tok)}` } }));
});

t("auth: delete-account refuses no JWT, anon, publishable, forged, expired, service-role -> 401", async () => {
  const h = await harness();
  h.reset();
  const [uid] = await member(h);
  h.st.objects.add(`ten-workspaces/users/${uid}/ws/a.pdf`);
  const forged = await signJwt({ sub: uid, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }, "x".repeat(40));
  const expired = await signJwt({ sub: uid, role: "authenticated", exp: Math.floor(Date.now() / 1000) - 5 });
  for (const tok of [undefined, h.anonKey, "sb_publishable_x", forged, expired, h.serviceKey]) {
    const res = await h.del(preq({}, { url: DEL, token: tok }));
    await res.body?.cancel();
    assertEquals(res.status, 401, `token=${String(tok).slice(0, 12)}`);
  }
  assert(h.st.objects.has(`ten-workspaces/users/${uid}/ws/a.pdf`), "nothing deleted");
  assertEquals(h.st.ledger.length, 1);
});

// ------------------------------------------------------ paths & methods ----
t("paths: only POST …/ten-model-proxy/chat/completions forwards (control)", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const res = await h.proxy(preq(baseBody(), { token: tok }));
  await res.text();
  assertEquals(res.status, 200);
  assertEquals(h.upstreamHits.length, 1);
  await h.drain();
});

t("paths: GET/PUT/DELETE/PATCH/HEAD on the one path -> 404, never forwarded", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD"]) {
    const res = await h.proxy(preq(baseBody(), { token: tok, method }));
    await res.body?.cancel();
    assertEquals(res.status, 404, method);
  }
  assertEquals(h.upstreamHits.length, 0);
});

t("paths: other paths and encodings -> 404, never forwarded", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const paths = [
    "/v1/embeddings",
    "/embeddings",
    "/v1/chat/completions",
    "/chat/completions/",
    "//chat/completions",
    "/chat//completions",
    "/chat%2Fcompletions",
    "/chat/completions%2F",
    "/CHAT/COMPLETIONS",
    "/chat/completions;x=1",
    "/chat/completions%00",
    "/chat/completions/.",
    "",
    "/",
    "/models",
    "/api/v1/chat/completions",
    "-evil/chat/completions",
  ];
  const got: string[] = [];
  for (const p of paths) {
    const res = await h.proxy(preq(baseBody(), { token: tok, url: `${FN}${p}` }));
    await res.body?.cancel();
    if (res.status !== 404) got.push(`${p} -> ${res.status}`);
  }
  assertEquals(got, [], "non-404 paths");
  assertEquals(h.upstreamHits.length, 0);
});

t("paths (OBSERVED): dot-segments and a query string normalise to the one path", async () => {
  // WHATWG URL parsing collapses /v1/../ and %2e%2e before the handler sees it,
  // so these ARE the one path; the query string is not part of the path and the
  // upstream URL is hard-coded. Recorded, not a failure.
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const out: string[] = [];
  for (const p of ["/v1/../chat/completions", "/v1/%2e%2e/chat/completions", "/chat/completions?model=openai/gpt-5&stream=false"]) {
    const res = await h.proxy(preq(baseBody(), { token: tok, url: `${FN}${p}` }));
    await res.text();
    out.push(`${p} -> ${res.status}`);
  }
  await h.drain();
  observe(out);
  for (const hit of h.upstreamHits) assertEquals(hit.url.endsWith("/api/v1/chat/completions"), true);
});

// ---------------------------------------------------------------- CORS ----
async function preflight(origin: string | null, url = `${FN}/chat/completions`) {
  const h = await harness();
  const headers: Record<string, string> = {
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization, content-type",
  };
  if (origin !== null) headers.origin = origin;
  const res = await (url.startsWith(DEL) ? h.del : h.proxy)(new Request(url, { method: "OPTIONS", headers }));
  await res.body?.cancel();
  return res;
}

t("CORS: the production origin and localhost:5173 get an exact allow header on preflight", async () => {
  for (const o of [PROD_ORIGIN, "http://localhost:5173"]) {
    const res = await preflight(o);
    assert(res.status >= 200 && res.status < 300, `${o}: ${res.status}`);
    assertEquals(res.headers.get("access-control-allow-origin"), o);
    assert((res.headers.get("access-control-allow-headers") ?? "").toLowerCase().includes("authorization"));
    assertEquals(res.headers.get("access-control-allow-credentials"), null, "no credentials mode needed");
  }
});

t("CORS: unlisted, null, spoofed and near-miss origins get no allow header (proxy and delete)", async () => {
  const bad = [
    "https://evil.example",
    "null",
    "https://ten.example.com.evil.com",
    "https://evil.ten.example.com",
    "http://ten.example.com",
    "https://ten.example.com:8443",
    "https://ten.example.co",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "https://localhost:5173",
    "http://localhost:5173.evil.com",
    "*",
    "",
  ];
  const leaks: string[] = [];
  for (const o of bad) {
    for (const url of [`${FN}/chat/completions`, DEL]) {
      const res = await preflight(o, url);
      const a = res.headers.get("access-control-allow-origin");
      if (a !== null) leaks.push(`${url} ${JSON.stringify(o)} -> ${a}`);
    }
  }
  const noOrigin = await preflight(null);
  if (noOrigin.headers.get("access-control-allow-origin") !== null) leaks.push("no Origin -> allow header");
  assertEquals(leaks, []);
});

t("CORS: a real POST from an unlisted origin carries no allow header (200 stream and errors)", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await member(h);
  const ok = await h.proxy(preq(baseBody(), { token: tok, origin: "https://evil.example" }));
  await ok.text();
  assertEquals(ok.headers.get("access-control-allow-origin"), null);
  const e401 = await h.proxy(preq(baseBody(), { origin: "https://evil.example" }));
  await e401.text();
  assertEquals(e401.headers.get("access-control-allow-origin"), null);
  await h.drain();
});

t("CORS: errors to the allowed origin DO carry the allow header (so the app can read 401/402/403)", async () => {
  const h = await harness();
  h.reset();
  const [, tok] = await nonMember(h);
  for (const r of [preq(baseBody(), { origin: PROD_ORIGIN }), preq(baseBody(), { token: tok, origin: PROD_ORIGIN })]) {
    const res = await h.proxy(r);
    await res.text();
    assertEquals(res.headers.get("access-control-allow-origin"), PROD_ORIGIN, String(res.status));
  }
});
