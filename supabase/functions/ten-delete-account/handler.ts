// The testable core of ten-delete-account (docs/design-web-agent.md § 8).
// JWT + membership, then deletes the caller's beta data only: Storage
// objects under users/{uid}/ (via the Storage API, service role — SQL
// deletes are refused by `storage.protect_delete` and would orphan the
// backend files), then `ten_ws_files`, `ten_gate_log`, `ten_usage_ledger`
// rows. The shared auth user is kept. No `window`/`document`/`localStorage`/
// `node:` API here, so this runs the same in tests and on the Edge Runtime.

import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";

export const BUCKET = "ten-workspaces";

export const SUMMARY_MESSAGE =
  "This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited.";

export interface DeleteDeps {
  verifyUser(token: string): Promise<{ id: string } | null>;
  isMember(token: string): Promise<boolean>;
  listAllObjects(bucket: string, prefix: string): Promise<string[]>;
  removeObjects(bucket: string, paths: string[]): Promise<void>;
  deleteOwnRows(table: string, uid: string): Promise<number>;
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

  // Membership.
  const member = await deps.isMember(token);
  if (!member) {
    return jsonError(
      403,
      "not_a_member",
      "Ten is in a private beta. Ask the person who invited you for access.",
      cors,
    );
  }

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
  let files = 0;
  let gateLog = 0;
  let ledger = 0;
  try {
    files = await deps.deleteOwnRows("ten_ws_files", user.id);
    gateLog = await deps.deleteOwnRows("ten_gate_log", user.id);
    ledger = await deps.deleteOwnRows("ten_usage_ledger", user.id);
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
        ledgerRows: ledger,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...cors } },
  );
}
