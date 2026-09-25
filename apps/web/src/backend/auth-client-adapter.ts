// Adapts a real `@supabase/supabase-js` `SupabaseClient` to auth.ts's own
// `AuthClientLike` (a structural subset auth.ts's functions are written
// against, on purpose, so they stay unit-testable with a small fake — see
// that file's header). `SupabaseClient.rpc(...)` returns a
// `PostgrestFilterBuilder` — a THENABLE, not a real `Promise` (it's
// missing `.catch`/`.finally`/`Symbol.toStringTag`, so it fails
// `AuthClientLike`'s own `Promise<...>` return type structurally even
// though `await`ing it works fine at runtime) — this file's only job is
// to `await` it once so the adapter's own `rpc()` genuinely returns a
// `Promise`, with no behavior change. `auth: client.auth` is passed
// through unchanged: `resetPasswordForEmail`, `updateUser` and
// `reauthenticate` (§ 16.1's three additions to `AuthClientLike`) are
// already real Promises on the real `GoTrueClient`, unlike `rpc`.
//
// Browser-safe: no window/document/localStorage/node:*.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthClientLike } from "./auth.ts";

export function toAuthClientLike(client: SupabaseClient): AuthClientLike {
  return {
    auth: client.auth,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      const { data, error } = await client.rpc(fn, args as any);
      return { data, error };
    },
  };
}
