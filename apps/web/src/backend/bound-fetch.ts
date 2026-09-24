// Fix round 1, item 1 (BLOCKER): "Illegal invocation" in real browsers.
//
// `const fetchImpl = opts.fetchImpl ?? fetch;` looks harmless, but a
// native `fetch` throws `TypeError: Illegal invocation` the moment it's
// called through a plain function reference whose receiver (`this`)
// isn't the realm's global object — which is exactly what happens when
// the bare identifier `fetch` is stored in a variable (or passed on as a
// default parameter value, as every `fetchImpl ?? fetch` call site in
// this package did) and invoked later as `fetchImpl(...)`. Confirmed via
// the tester's own e2e in ALL THREE browsers, Chromium included (fix
// round 1's "Chrome tolerates it" note was wrong — the tester's direct
// in-page check, tests/e2e-real/e2e.ts's "browser: calling window.fetch
// as o.fetchImpl(...)", failed in Chromium too before this fix).
//
// The fix: never hand out the bare `fetch` reference as a default. Every
// `fetchImpl` default in this package goes through `boundFetch()`
// instead of `fetch` directly — verified by a static source check
// (tests/e2e-real/e2e.ts's "B1 static"), not a page-level workaround.
export function boundFetch(): typeof fetch {
  return fetch.bind(globalThis);
}
