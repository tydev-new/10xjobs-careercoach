// deps.balance() (docs/design-web-agent.md § 1, § 8): "USD left to spend",
// a `security definer` wrapper (`ten_balance()`) that passes `auth.uid()`
// itself, so it takes no argument and shows only the caller's own balance.
// Browser-safe: only `fetch`. No window/document/localStorage/node:*.
export interface BalanceOptions {
  /** The Supabase project URL, e.g. https://xxxx.supabase.co. */
  url: string;
  /** The anon/publishable key. */
  anonKey: string;
  /** Returns the current session's access token; called per request. */
  accessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Builds `deps.balance()`. § 8: "read at turn end and on window focus" —
 *  this function does no caching itself; the caller (the UI's own balance
 *  chip, matching apps/web/src/ChatShell.tsx's existing refresh moments)
 *  decides when to call it. */
export function createBalanceFn(opts: BalanceOptions): () => Promise<number> {
  const url = opts.url.replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async () => {
    const token = await opts.accessToken();
    const res = await fetchImpl(`${url}/rest/v1/rpc/ten_balance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: opts.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      throw new Error(`ten_balance() failed: HTTP ${res.status} ${await res.text()}`);
    }
    const value = await res.json();
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`ten_balance() returned a non-numeric value: ${JSON.stringify(value)}`);
    }
    return n;
  };
}
