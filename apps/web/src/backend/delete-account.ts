// Calls the `ten-delete-account` Edge Function (docs/design-web-agent.md §
// 8; design-web-ui.md § 1.7). A signed-in user only (not membership) —
// the function itself enforces that; this module just carries the current
// JWT and reports back exactly what the function returned.
//
// Browser-safe: only `fetch`. No window/document/localStorage/node:*.
export interface DeleteAccountSummary {
  message: string;
  deleted: {
    storageObjects: number;
    textFiles: number;
    gateLogRows: number;
    creditRows: number;
  };
}

export interface DeleteAccountOptions {
  /** The Supabase project URL, e.g. https://xxxx.supabase.co. */
  url: string;
  /** Returns the current session's access token. */
  accessToken: () => Promise<string>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export async function deleteBetaAccount(opts: DeleteAccountOptions): Promise<DeleteAccountSummary> {
  const token = await opts.accessToken();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${opts.url.replace(/\/+$/, "")}/functions/v1/ten-delete-account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && (body as any).error?.message
        ? String((body as any).error.message)
        : `ten-delete-account failed: HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as DeleteAccountSummary;
}
