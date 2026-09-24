// Fix round 1, item 1 (BLOCKER): "Illegal invocation" in real browsers.
//
// `const fetchImpl = opts.fetchImpl ?? fetch;` looks harmless, but Firefox
// and WebKit's native `fetch` throws `TypeError: Illegal invocation` the
// moment it's called through a plain function reference whose receiver
// (`this`) isn't the realm's global object — which is exactly what
// happens when the bare identifier `fetch` is stored in a variable (or
// passed on as a default parameter value, as every `fetchImpl ?? fetch`
// call site in this package did) and invoked later as `fetchImpl(...)`.
// Chrome tolerates it; Firefox/WebKit do not (docs/reviews — tester's
// e2e, fix round 1, item 1).
//
// The fix: never hand out the bare `fetch` reference as a default. Every
// `fetchImpl` default in this package goes through `boundFetch()`
// instead of `fetch` directly.
export function boundFetch(): typeof fetch {
  return fetch.bind(globalThis);
}
