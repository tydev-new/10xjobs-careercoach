// The testable core of ten-delete-account (docs/design-web-agent.md § 8,
// as amended by the fix-round-1 lead ruling S5/S6/S7): requires a
// SIGNED-IN user only, not membership — an ex-member (their credit spent
// or removed) must still be able to erase their own beta data. Deletes the
// caller's beta data: Storage objects under users/{uid}/ (via the Storage
// API, service role, paged — see N2 in _shared/supabase.ts — SQL deletes
// are refused by `storage.protect_delete` and would orphan the backend
// files), then `ten_ws_files`, `ten_gate_log`, and the caller's 'credit'
// ledger rows only. 'call' ledger rows are KEPT: they are cost records
// with no file content, and removing them would let a self-delete erase
// the user's own history from today's beta-wide $5 ceiling (fix-round-1
// SHOULD). Idempotent: a second call finds nothing left and still returns
// 200 with a zeroed summary. The shared auth user is kept. No
// `window`/`document`/`localStorage`/`node:` API here, so this runs the
// same in tests and on the Edge Runtime.

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";

export const BUCKET = "ten-workspaces";

export const SUMMARY_MESSAGE =
  "This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited.";

export interface DeleteDeps {
  verifyUser(token: string): Promise<{ id: string } | null>;
  listAllObjects(bucket: string, prefix: string): Promise<string[]>;
  removeObjects(bucket: string, paths: string[]): Promise<void>;
  /** `extraFilter`, when given, is ANDed with `user_id` (e.g. `kind=eq.credit`). */
  deleteOwnRows(table: string, uid: string, extraFilter?: string): Promise<number>;
  log?: { warn(e: unknown): void };
}

function jsonError(status: number, code: string, message: string, cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export async function handleRequest(
  req: Request,
  deps: DeleteDeps,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, allowedOrigins(env));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Not found", { status: 404 });
  }

  // JWT: a signed-in user, or 401. The anon/publishable key alone fails
  // verifyUser (it isn't a user access token) and also gets 401 here.
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!token) {
    return jsonError(401, "not_signed_in", "Sign in required.", cors);
  }
  const user = await deps.verifyUser(token);
  if (!user) {
    return jsonError(401, "not_signed_in", "Sign in required.", cors);
  }

  // No membership check (lead ruling, fix round 1): a signed-in user erases
  // their own beta data whether or not they still hold a credit row.

  // 1. Storage first (through the API — see the header note), acting only
  // on this user's own prefix.
  const prefix = `users/${user.id}`;
  let objects: string[] = [];
  try {
    objects = await deps.listAllObjects(BUCKET, prefix);
    if (objects.length > 0) {
      await deps.removeObjects(BUCKET, objects);
    }
  } catch (e) {
    deps.log?.warn({ msg: "ten-delete-account: storage delete failed", err: String(e) });
    return jsonError(503, "delete_failed", "Could not delete your files. Try again.", cors);
  }

  // 2. Then the beta data rows, acting only on this user's own rows (§ 8).
  // ten_usage_ledger last, and filtered to 'credit' rows only — 'call' rows
  // (cost records, no content) are kept so the beta ceiling and the user's
  // own cost history survive a self-delete.
  let files = 0;
  let gateLog = 0;
  let creditRows = 0;
  try {
    files = await deps.deleteOwnRows("ten_ws_files", user.id);
    gateLog = await deps.deleteOwnRows("ten_gate_log", user.id);
    creditRows = await deps.deleteOwnRows("ten_usage_ledger", user.id, "kind=eq.credit");
  } catch (e) {
    deps.log?.warn({ msg: "ten-delete-account: row delete failed", err: String(e) });
    return jsonError(503, "delete_failed", "Could not delete your data. Try again.", cors);
  }

  return new Response(
    JSON.stringify({
      message: SUMMARY_MESSAGE,
      deleted: {
        storageObjects: objects.length,
        textFiles: files,
        gateLogRows: gateLog,
        creditRows,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...cors } },
  );
}
