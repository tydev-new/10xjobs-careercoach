// supabase/functions/ten-feedback/index.ts
// Deploy-time entry point (docs/design-feedback.md § 9). Logic lives in
// handler.ts, which imports no Deno/Edge-Runtime global. Deploy with
// `--no-verify-jwt`: the local script has no key to send (§ 9.1). NOT
// deployed by this change; production is owner-only (see
// supabase/functions/README.md, "Owner checklist for feedback").

import { handleRequest } from "./handler.ts";
import { buildDeps } from "./rpc.ts";
import { envFromDeno } from "../_shared/supabase.ts";

const deps = buildDeps(envFromDeno((name) => Deno.env.get(name)));

Deno.serve((req) => handleRequest(req, deps, Deno.env.toObject()));
