// supabase/functions/ten-delete-account/index.ts
// Deploy-time entry point (docs/design-web-agent.md § 8). Logic lives in
// handler.ts, which imports no Deno/Edge-Runtime global. NOT deployed by
// this change (see supabase/functions/README.md).

import { handleRequest, type DeleteDeps } from "./handler.ts";
import { deleteOwnRows, envFromDeno, listAllObjects, removeObjects, verifyUser } from "../_shared/supabase.ts";

const env = envFromDeno((name) => Deno.env.get(name));

const deps: DeleteDeps = {
  verifyUser: (token) => verifyUser(env, token),
  listAllObjects: (bucket, prefix) => listAllObjects(env, bucket, prefix),
  removeObjects: (bucket, paths) => removeObjects(env, bucket, paths),
  deleteOwnRows: (table, uid, extraFilter) => deleteOwnRows(env, table, uid, undefined, extraFilter),
  log: { warn: (e) => console.warn(e) },
};

Deno.serve((req) => handleRequest(req, deps, Deno.env.toObject()));
