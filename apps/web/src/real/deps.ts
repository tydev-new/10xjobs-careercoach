// Builds the real Deps (docs/design-web-agent.md § 1) for `createCoach` in
// the browser (plan step 5b, item 1): model = the OpenRouter provider
// through ten-model-proxy; workspace = SupabaseWorkspaceStore; gate = the
// Supabase-backed Gate; balance() = ten_balance(); scripts = the real
// ScriptRunner (just-bash + packages/checkers); skills = the build-time
// SkillBundle; webSearch via the proxy's fixed plugin; checkLanguage is
// left UNSET so the tool's own default (packages/agent/src/tools/index.ts)
// runs — "a fresh-context model call" using `deps.model`, which already
// routes through the proxy, so this is "check_language per § 4 through the
// same model" with no separate wiring; fetch = the browser's own fetch,
// used only for fetch_job's board API calls (§ 4).
import { createCoach } from "../../../../packages/agent/src/index.ts";
import type { Deps } from "../../../../packages/agent/src/types.ts";
import { DEFAULT_WEB_SEARCH_COST_MAX_USD, MODEL_COST_TABLE } from "../../../../packages/agent/src/estimate-cost.ts";
import { CLAUDE_COACH_MODEL } from "../backend/coach-model.ts";
import { createBalanceFn } from "../backend/balance.ts";
import { createSupabaseGate } from "../backend/gate.ts";
import { createCoachModel } from "../backend/model.ts";
import { createRealScriptRunner } from "../backend/script-runner.ts";
import { buildSkillBundle } from "../backend/skills-bundle.ts";
import { createSupabaseWorkspaceStore } from "../backend/supabase-workspace-store.ts";
import { createWebSearch } from "../backend/web-search.ts";
import type { TenEnv } from "../backend/env.ts";

export interface RealDepsOptions {
  env: TenEnv;
  userId: string;
  accessToken: () => Promise<string>;
}

/** Built once per signed-in session (memoized by the caller — RealApp.tsx —
 *  since the SkillBundle read and every adapter here are cheap to build but
 *  the CoachInstance itself should stay stable across turns in the same
 *  chat, per § 1's "one loop"). */
export function buildRealDeps(opts: RealDepsOptions): Deps {
  const skills = buildSkillBundle();
  const workspace = createSupabaseWorkspaceStore({
    url: opts.env.supabaseUrl,
    anonKey: opts.env.supabaseAnonKey,
    userId: opts.userId,
    accessToken: opts.accessToken,
  });
  const gate = createSupabaseGate({
    url: opts.env.supabaseUrl,
    anonKey: opts.env.supabaseAnonKey,
    accessToken: opts.accessToken,
  });
  const balance = createBalanceFn({
    url: opts.env.supabaseUrl,
    anonKey: opts.env.supabaseAnonKey,
    accessToken: opts.accessToken,
  });
  // § 13.2: the active model — env.coachModel, resolved once by
  // readEnv() from VITE_COACH_MODEL (Claude if unset/blank; readEnv
  // itself already refused an unrecognized value, so this is always one
  // of the two ids by the time it gets here). The `?? CLAUDE_COACH_MODEL`
  // is only for a caller that builds a TenEnv by hand without it (a test
  // fixture predating § 13, `as any`-cast) — readEnv() itself never
  // omits the field, so production always takes the left side.
  const modelId = (opts.env.coachModel ?? CLAUDE_COACH_MODEL).id;
  const model = createCoachModel({
    modelId,
    proxyUrl: opts.env.modelProxyUrl,
    getAccessToken: opts.accessToken,
  });
  // § 13.1's per-model search-cost fallback (§ 13.3): the ACTIVE model's
  // own highest measured/derived search cost, not always Claude's.
  const searchDefaultUsd = MODEL_COST_TABLE[modelId]?.searchMaxUsd ?? DEFAULT_WEB_SEARCH_COST_MAX_USD;
  const webSearch = createWebSearch({
    modelId,
    proxyUrl: opts.env.modelProxyUrl,
    getAccessToken: opts.accessToken,
    defaultUsd: searchDefaultUsd,
  });
  const scripts = createRealScriptRunner();

  return {
    model,
    workspace,
    skills,
    gate,
    balance,
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    clock: { now: () => new Date() },
    scripts,
    webSearch,
    logger: {
      info: (e) => console.info("[agent]", e),
      warn: (e) => console.warn("[agent]", e),
      error: (e) => console.error("[agent]", e),
    },
  };
}

export function buildRealCoach(opts: RealDepsOptions) {
  return createCoach(buildRealDeps(opts));
}
