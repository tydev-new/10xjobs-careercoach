/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** § 8: the production URL for auth's `redirectTo` (added to Supabase
   *  Auth's Redirect URLs allowlist by the owner, out of band). Unset in
   *  dev/preview builds. */
  readonly VITE_SITE_URL?: string;
  /** Step 5b, item 5 — the production env vars. Nothing here is secret:
   *  the anon/publishable key is meant to ship in the client bundle (RLS
   *  is the actual boundary). See src/backend/env.ts. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Optional — defaults to `<VITE_SUPABASE_URL>/functions/v1/ten-model-proxy`. */
  readonly VITE_MODEL_PROXY_URL?: string;
  /** Dev/preview-only (README.md, src/components/Header.tsx's
   *  SHOW_MOCK_CONTROLS): "1" shows the fixture picker/Autoplay and keeps
   *  the app on the MOCK transport even in a built bundle. Absent (the
   *  default `npm run build`) is the real, production build. */
  readonly VITE_SHOW_MOCK_CONTROLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
