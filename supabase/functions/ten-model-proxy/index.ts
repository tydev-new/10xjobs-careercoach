// supabase/functions/ten-model-proxy/index.ts
// Deploy-time entry point (docs/design-web-agent.md § 8). All the logic
// lives in handler.ts/core.ts, which import no Deno/Edge-Runtime global —
// this file is the only place that touches `Deno.env`, `Deno.serve`, and
// `EdgeRuntime.waitUntil`, so the rest stays testable outside the Edge
// Runtime. NOT deployed by this change (see supabase/functions/README.md).

import { UPSTREAM_URL } from "./core.ts";
import { handleRequest, type ProxyDeps } from "./handler.ts";
import {
  balanceFor,
  betaSpendToday,
  envFromDeno,
  insertLedgerCall,
  isMember,
  verifyUser,
} from "../_shared/supabase.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const env = envFromDeno((name) => Deno.env.get(name));
// The upstream key: an environment/secret only, never logged, never in the
// allowlisted request body (§ 8's "never logged" rule).
const OPENROUTER_KEY = Deno.env.get("TEN_OPENROUTER_API_KEY") ?? "";

const deps: ProxyDeps = {
  verifyUser: (token) => verifyUser(env, token),
  isMember: (token) => isMember(env, token),
  balanceFor: (uid) => balanceFor(env, uid),
  betaSpendToday: () => betaSpendToday(env),
  insertLedgerCall: (row) => insertLedgerCall(env, row),
  fetchUpstream: (body) =>
    fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  waitUntil: (p) => {
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime) {
      EdgeRuntime.waitUntil(p);
    } else {
      // Local `deno run`/tests without the Edge Runtime global: still run
      // it, just without the platform's post-response guarantee.
      p.catch(() => {});
    }
  },
  randomId: () => crypto.randomUUID(),
  log: {
    warn: (e) => console.warn(e),
  },
};

Deno.serve((req) => handleRequest(req, deps, Deno.env.toObject()));
