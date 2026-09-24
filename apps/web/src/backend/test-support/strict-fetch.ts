// A test double simulating Firefox/WebKit's actual native `fetch`: it
// throws `TypeError: Illegal invocation` unless called with exactly
// `this === globalThis` — the real-world check a stored-then-later-called
// bare `fetch` reference fails, and a bound one (`fetch.bind(globalThis)`,
// or an arrow wrapper `(...a) => fetch(...a)`) passes. Used to prove fix
// round 1 item 1's fix (`boundFetch()`) actually works, and to catch a
// regression to the unbound `?? fetch` pattern.
export function makeStrictFetch(impl: typeof fetch): typeof fetch {
  function strictFetch(this: unknown, ...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    if (this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
    return impl(...args);
  }
  return strictFetch as typeof fetch;
}
