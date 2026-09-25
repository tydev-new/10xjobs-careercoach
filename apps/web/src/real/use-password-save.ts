// The shared password-save state machine (design-web-ui.md § 1.10: "the
// menu dialog and the recovery screen share it") — the form fields and the
// reauthentication code step, wrapping the pure `savePassword`/
// `resendReauthenticationCode` orchestration (password-save-flow.ts, unit-
// tested on its own with a fake client) in React state. Cleared "on
// success, Cancel, sign-out and unmount" (§ 16.2) — `reset()` covers
// Cancel/sign-out, the unmount effect covers the rest.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthClientLike } from "../backend/auth.ts";
import { resendReauthenticationCode, savePassword } from "./password-save-flow.ts";

export type PasswordSavePhase = "form" | "code" | "success";

interface PasswordSaveState {
  phase: PasswordSavePhase;
  password: string;
  confirm: string;
  showPassword: boolean;
  code: string;
  error: string | undefined;
  info: string | undefined;
  saving: boolean;
  resending: boolean;
}

export interface PasswordSaveApi extends PasswordSaveState {
  setPassword: (v: string) => void;
  setConfirm: (v: string) => void;
  setCode: (v: string) => void;
  toggleShow: () => void;
  submit: () => Promise<void>;
  resend: () => Promise<void>;
  /** § 16.2: clears the password and code from state — call on Cancel and
   *  on sign-out. */
  reset: () => void;
}

const INITIAL: PasswordSaveState = {
  phase: "form",
  password: "",
  confirm: "",
  showPassword: false,
  code: "",
  error: undefined,
  info: undefined,
  saving: false,
  resending: false,
};

export function usePasswordSave(client: AuthClientLike, email: string): PasswordSaveApi {
  const [state, setState] = useState<PasswordSaveState>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  const reset = useCallback(() => setState(INITIAL), []);

  // § 16.2 — cleared on unmount too, not only on an explicit Cancel/sign-out.
  useEffect(() => {
    return () => setState(INITIAL);
  }, []);

  const submit = useCallback(async () => {
    const { password, confirm, phase, code } = stateRef.current;
    // No form is ever shown once `phase` is "success" (both screens swap
    // to a Done/Continue button), so this is unreachable in practice —
    // guarded only so `savePassword`'s narrower phase type checks.
    if (phase === "success") return;
    setState((s) => ({ ...s, saving: true, error: undefined, info: undefined }));
    const outcome = await savePassword(client, { password, confirm, phase, code });
    switch (outcome.kind) {
      case "invalid":
        setState((s) => ({ ...s, saving: false, error: outcome.error }));
        return;
      case "saved":
        setState((s) => ({ ...s, saving: false, phase: "success", password: "", confirm: "", code: "" }));
        return;
      case "needs-code":
        setState((s) => ({ ...s, saving: false, phase: outcome.sent ? "code" : s.phase, error: outcome.sent ? undefined : outcome.error }));
        return;
      case "error":
        setState((s) => ({ ...s, saving: false, error: outcome.error }));
        return;
    }
  }, [client]);

  const resend = useCallback(async () => {
    setState((s) => ({ ...s, resending: true, error: undefined, info: undefined }));
    const sent = await resendReauthenticationCode(client);
    if (sent.ok) {
      setState((s) => ({ ...s, resending: false, info: `A new code is on its way to ${email}. Use the newest one.` }));
    } else {
      setState((s) => ({ ...s, resending: false, error: sent.error }));
    }
  }, [client, email]);

  return {
    ...state,
    setPassword: (v) => setState((s) => ({ ...s, password: v, error: undefined })),
    setConfirm: (v) => setState((s) => ({ ...s, confirm: v, error: undefined })),
    setCode: (v) => setState((s) => ({ ...s, code: v, error: undefined })),
    toggleShow: () => setState((s) => ({ ...s, showPassword: !s.showPassword })),
    submit,
    resend,
    reset,
  };
}
