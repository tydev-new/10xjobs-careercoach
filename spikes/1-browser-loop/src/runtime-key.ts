// KEY NOT BAKED (review B11 rework, item 3): the key must be read at
// RUNTIME, from a value the page picks up after load — never through
// `import.meta.env.VITE_*`, which Vite substitutes at BUILD time and
// bakes literally into the bundled JS.
//
// The harness (verify.mjs) sets these globals via Playwright's
// `page.addInitScript`, which runs in the page BEFORE any bundled script,
// so from this module's point of view they are indistinguishable from
// e.g. a value typed into a settings field after the app loaded. Nothing
// here, and nothing in the built output, contains a key literal — grep
// dist/ (verify.mjs does this) to confirm.
export function getRuntimeInterceptKey(): string | undefined {
  return (globalThis as any).__OPENROUTER_RUNTIME_KEY__;
}

export function getRuntimeRealKey(): string | undefined {
  return (globalThis as any).__OPENROUTER_REAL_KEY__;
}
