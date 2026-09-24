/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** § 8: the production URL for auth's `redirectTo` (added to Supabase
   *  Auth's Redirect URLs allowlist by the owner, out of band). Unset in
   *  dev/preview builds. */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
