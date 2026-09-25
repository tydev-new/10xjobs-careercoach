// § 13.2's "ONE list, one reader": the two model ids the site may run,
// with the plain, candidate-facing names § 13.3's menu line and § 13.6's
// privacy page use, word for word. NO IMPORTS on purpose (§ 13.2's own
// words) — this is the one place both the site (env.ts's readEnv) and the
// tests that check this file against the proxy's own allowlist
// (coach-model.test.ts, which reads BOTH this file and
// supabase/functions/ten-model-proxy/core.ts) read from. Browser-safe:
// no window/document/localStorage/node:* (it's plain data).

export interface CoachModel {
  /** The exact OpenRouter model id (docs/design-web-agent.md § 13's
   *  table), sent verbatim as the request's `model` field — the proxy's
   *  allowlist (supabase/functions/ten-model-proxy/core.ts's MODEL_IDS)
   *  must hold exactly these two ids, checked by coach-model.test.ts. */
  id: string;
  /** The ⋯ menu's line (§ 13.3), word for word, WITHOUT the "Model: "
   *  prefix (Header.tsx adds that once, so the sentence lives in one
   *  place): "Claude Sonnet 5" / "DeepSeek V4.1 Flash (testing)". Also
   *  the name privacy.html (§ 13.6) uses for each model's host list. */
  name: string;
}

export const CLAUDE_COACH_MODEL: CoachModel = {
  id: "anthropic/claude-sonnet-5",
  name: "Claude Sonnet 5",
};

// § 13.6 (4): the owner kept "(testing)" in the label, word for word.
export const DEEPSEEK_COACH_MODEL: CoachModel = {
  id: "deepseek/deepseek-v4.1-flash",
  name: "DeepSeek V4.1 Flash (testing)",
};

/** Claude is always first — it's "the measured model; the fallback"
 *  (§ 13's own table), and readEnv's own default. */
export const COACH_MODELS: readonly CoachModel[] = [CLAUDE_COACH_MODEL, DEEPSEEK_COACH_MODEL];

export function coachModelFor(id: string): CoachModel | undefined {
  return COACH_MODELS.find((m) => m.id === id);
}
