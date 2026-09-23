// Thin REST/PostgREST/Storage-API client for the two Ten Edge Functions.
// No supabase-js dependency: both functions talk to Supabase over plain
// `fetch`, which is what makes them runnable and testable outside the Edge
// Runtime (this file uses no `window`/`document`/`localStorage`/`node:` API).
//
// Every function here takes `fetchImpl` so tests can point it at a local
// stub server instead of a real Supabase project (docs/design-web-agent.md § 8).

export interface SupabaseEnv {
  url: string; // SUPABASE_URL, auto-injected by the Edge Runtime
  anonKey: string; // SUPABASE_ANON_KEY, auto-injected
  serviceRoleKey: string; // SUPABASE_SERVICE_ROLE_KEY, auto-injected
}

export interface AuthedUser {
  id: string;
  role?: string;
}

/** Resolves the signed-in user from a bearer token via Supabase Auth's
 * `GET /auth/v1/user`. Returns null on any failure — an invalid token, an
 * expired session, or the anon/publishable key itself (which that endpoint
 * refuses because it is not a user access token). */
export async function verifyUser(
  env: SupabaseEnv,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthedUser | null> {
  if (!token) return null;
  try {
    const res = await fetchImpl(`${env.url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.anonKey },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const body = await res.json();
    if (!body || typeof body.id !== "string") return null;
    return { id: body.id, role: body.role };
  } catch {
    return null;
  }
}

/** Beta membership, checked as the user (their own JWT), via the
 * `ten_is_member()` RPC (granted to `authenticated`, security invoker —
 * reads `auth.uid()` from the JWT, so the caller can only ever learn their
 * own membership). */
export async function isMember(
  env: SupabaseEnv,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(`${env.url}/rest/v1/rpc/ten_is_member`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.anonKey,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return false;
  }
  const body = await res.json();
  return body === true;
}

/** Any user's derived balance, service-role only (`ten_balance_for`, § 8). */
export async function balanceFor(
  env: SupabaseEnv,
  uid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(`${env.url}/rest/v1/rpc/ten_balance_for`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_user: uid }),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`ten_balance_for failed: ${res.status}`);
  }
  const n = Number(await res.json());
  return Number.isFinite(n) ? n : 0;
}

/** The beta-wide $/day ceiling sum, service-role only (`ten_beta_spend_today`, § 8). */
export async function betaSpendToday(
  env: SupabaseEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(`${env.url}/rest/v1/rpc/ten_beta_spend_today`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`ten_beta_spend_today failed: ${res.status}`);
  }
  const n = Number(await res.json());
  return Number.isFinite(n) ? n : 0;
}

export interface LedgerCallRow {
  user_id: string;
  kind: "call";
  request_id: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  usd: number;
}

/** Inserts the one `ten_usage_ledger` 'call' row for a proxy request
 * (service role; `request_id` is unique, so a retried meter never double
 * counts — the second insert is rejected and only logged). Throws on
 * failure so the caller can decide whether to log or ignore. */
export async function insertLedgerCall(
  env: SupabaseEnv,
  row: LedgerCallRow,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${env.url}/rest/v1/ten_usage_ledger`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ten_usage_ledger insert failed: ${res.status} ${text}`);
  }
  await res.body?.cancel().catch(() => {});
}

// Deletes every row the caller owns in `table` (service role), returning
// the count deleted via `Prefer: count=exact` (a `Content-Range: star/N`
// shaped response header). Used by ten-delete-account for `ten_ws_files`,
// `ten_gate_log`, `ten_usage_ledger`.
export async function deleteOwnRows(
  env: SupabaseEnv,
  table: string,
  uid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(
    `${env.url}/rest/v1/${table}?user_id=eq.${encodeURIComponent(uid)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.serviceRoleKey}`,
        apikey: env.serviceRoleKey,
        Prefer: "count=exact",
      },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`delete ${table} failed: ${res.status} ${text}`);
  }
  const range = res.headers.get("content-range"); // "*/N"
  const n = range ? Number(range.split("/")[1]) : NaN;
  await res.body?.cancel().catch(() => {});
  return Number.isFinite(n) ? n : 0;
}

export interface StorageEntry {
  name: string;
  id: string | null; // null = a folder
}

/** One page of `POST /storage/v1/object/list/{bucket}` at `prefix` (not
 * recursive — Storage only lists one level per call). */
async function listOnePage(
  env: SupabaseEnv,
  bucket: string,
  prefix: string,
  fetchImpl: typeof fetch,
): Promise<StorageEntry[]> {
  const res = await fetchImpl(`${env.url}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`storage list failed: ${res.status} ${text}`);
  }
  const body = await res.json();
  return body;
}

/** Recursively lists every object under `prefix` (folders have `id: null`
 * in Supabase Storage's list response), returning full object paths. */
export async function listAllObjects(
  env: SupabaseEnv,
  bucket: string,
  prefix: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const page = await listOnePage(env, bucket, prefix, fetchImpl);
  const out: string[] = [];
  for (const entry of page) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      out.push(...(await listAllObjects(env, bucket, full, fetchImpl)));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Bulk-removes objects via the Storage API (never SQL — the migration's
 * header notes `storage.protect_delete` refuses direct SQL deletes and it
 * would orphan the backend files anyway). */
export async function removeObjects(
  env: SupabaseEnv,
  bucket: string,
  paths: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (paths.length === 0) return;
  const res = await fetchImpl(`${env.url}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env.serviceRoleKey}`,
      apikey: env.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`storage remove failed: ${res.status} ${text}`);
  }
  await res.body?.cancel().catch(() => {});
}

export function envFromDeno(getEnv: (name: string) => string | undefined): SupabaseEnv {
  return {
    url: getEnv("SUPABASE_URL") ?? "",
    anonKey: getEnv("SUPABASE_ANON_KEY") ?? "",
    serviceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  };
}
