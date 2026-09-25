// Tester-owned fake of `@supabase/supabase-js` (not product code). The
// password harness build aliases the package to this file, so the REAL
// RealApp / auth.ts / SignIn / RecoveryScreen / SetPasswordDialog run
// against a client whose answers and auth events the test scripts
// (docs/design-web-agent.md § 16.4: "A fake AuthClientLike for units").
//
// The script comes from `window.__cfg` (set by the test before the page
// loads). Every call is recorded in `window.__calls`, in order. These
// recorded arguments ARE "the body of Supabase Auth's own calls" (C §
// 16.2): the no-leak test allows the sentinel password there and nowhere
// else.
type Json = Record<string, any>;

export interface FakeError {
  message: string;
  code?: string;
  status?: number;
  reasons?: string[];
  name?: string;
}

export interface FakeCfg {
  email?: string;
  /** a session exists at load (the recovery link signed the user in, or a stored session) */
  signedIn?: boolean;
  /** auth events delivered to each listener, in order, each after `delay` ms (from subscribe) */
  events?: { event: string; delay?: number }[];
  member?: boolean;
  rpcDelay?: number;
  /** "ok" (secure change off / fresh session), "reauth" (secure change on, older session), or a fixed error */
  updateUser?: "ok" | "reauth" | { error: FakeError };
  /** the right code for "reauth" mode */
  code?: string;
  /** reauthenticate()'s answers, in order (last one repeats); default ok */
  reauthenticate?: ({ error: FakeError } | "ok")[];
  /** resetPasswordForEmail's answer; default ok */
  reset?: "ok" | { error: FakeError };
}

declare global {
  interface Window {
    __cfg?: FakeCfg;
    __calls: { fn: string; args: unknown[] }[];
  }
}

const RAW = (code: string) => `RAW-SUPABASE-TEXT for ${code}: do not show me`;

export function rawMessageFor(code: string): string {
  return RAW(code);
}

function cfg(): FakeCfg {
  return window.__cfg ?? {};
}

export function createClient(_url: string, _key: string, _opts?: unknown): any {
  window.__calls ??= [];
  const rec = (fn: string, ...args: unknown[]) => window.__calls.push({ fn, args: JSON.parse(JSON.stringify(args ?? [])) });
  const email = cfg().email ?? "member@example.com";
  const makeSession = () => ({ access_token: "fake-access-token", refresh_token: "fake-refresh", token_type: "bearer", expires_in: 3600, user: { id: "user-1", email } });
  let session: Json | null = cfg().signedIn ? makeSession() : null;
  const listeners = new Set<(event: string, s: Json | null) => void>();
  const emit = (event: string) => {
    for (const l of listeners) l(event, session);
  };
  const err = (e: FakeError) => ({ name: "AuthApiError", ...e, message: e.message || RAW(e.code ?? String(e.status)) });
  let reauthCalls = 0;

  return {
    auth: {
      onAuthStateChange(cb: (event: string, s: Json | null) => void) {
        rec("onAuthStateChange");
        listeners.add(cb);
        for (const ev of cfg().events ?? [{ event: "INITIAL_SESSION" }]) {
          setTimeout(() => {
            if (listeners.has(cb)) cb(ev.event, session);
          }, ev.delay ?? 0);
        }
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async getSession() {
        rec("getSession");
        return { data: { session }, error: null };
      },
      async signInWithOtp(a: unknown) {
        rec("signInWithOtp", a);
        return { data: {}, error: null };
      },
      async signInWithPassword(a: unknown) {
        rec("signInWithPassword", a);
        session = makeSession();
        setTimeout(() => emit("SIGNED_IN"), 0);
        return { data: { session }, error: null };
      },
      async signUp(a: unknown) {
        rec("signUp", a);
        return { data: {}, error: null };
      },
      async signOut() {
        rec("signOut");
        session = null;
        setTimeout(() => emit("SIGNED_OUT"), 0);
        return { error: null };
      },
      async resetPasswordForEmail(e: string, opts: unknown) {
        rec("resetPasswordForEmail", e, opts);
        const r = cfg().reset ?? "ok";
        return r === "ok" ? { data: {}, error: null } : { data: null, error: err(r.error) };
      },
      async updateUser(attrs: Json) {
        rec("updateUser", attrs);
        const mode = cfg().updateUser ?? "ok";
        let e: FakeError | undefined;
        if (mode === "reauth") {
          if (attrs.nonce === undefined) e = { message: RAW("reauthentication_needed"), code: "reauthentication_needed", status: 400 };
          else if (attrs.nonce !== (cfg().code ?? "123456")) e = { message: RAW("reauthentication_not_valid"), code: "reauthentication_not_valid", status: 400 };
        } else if (mode !== "ok") e = mode.error;
        if (e) return { data: { user: null }, error: err(e) };
        // like auth-js: a saved user fires USER_UPDATED to every listener
        setTimeout(() => emit("USER_UPDATED"), 0);
        return { data: { user: session?.user ?? null }, error: null };
      },
      async reauthenticate() {
        rec("reauthenticate");
        const list = cfg().reauthenticate ?? ["ok"];
        const r = list[Math.min(reauthCalls++, list.length - 1)];
        return r === "ok" ? { data: { user: null, session: null }, error: null } : { data: { user: null, session: null }, error: err(r.error) };
      },
    },
    async rpc(fn: string, args?: unknown) {
      rec("rpc", fn, args ?? null);
      const d = cfg().rpcDelay ?? 0;
      if (d) await new Promise((r) => setTimeout(r, d));
      if (fn === "ten_is_member") return { data: cfg().member === true, error: null };
      return { data: null, error: { message: "fake: no rpc " + fn } };
    },
  };
}
