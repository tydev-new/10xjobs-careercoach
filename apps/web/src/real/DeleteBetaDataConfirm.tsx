// design-web-ui.md § 1.7 — the ⋯ menu's one irreversible action. Renders
// in the gate's own shape (complete thing named, one plain sentence, the
// candidate's typed yes, the report-back) even though C § 3 keeps "gate"
// for the spend gate alone: this is its OWN component (design-web-ui.md §
// 1.7's "open for the architect" note — no `data-gate` part, no `gateId`,
// never touches `ten_gate_log`), not a reuse of GateCard. No button fires
// it, ever — only an exact typed "yes", matched the SAME way a spend
// gate's reply is (matchGateReply), so "yes but", "y", "sure", or a
// pasted "yes" inside other text all leave it open exactly like a spend
// gate would.
import { useState, type FormEvent, type ReactElement } from "react";
import { matchGateReply } from "../../../../packages/agent/src/helpers.ts";
import { deleteBetaAccount, type DeleteAccountSummary } from "../backend/delete-account.ts";

export interface DeleteBetaDataConfirmProps {
  supabaseUrl: string;
  accessToken: () => Promise<string>;
  onClose: () => void;
  /** Performs the actual sign-out; called from the report-back's own OK
   *  button (the tester's e2e — tests/e2e-real/e2e.ts "delete: typed yes
   *  -> the function ran -> the report-back line" — waits for the
   *  report-back TEXT the instant ten-delete-account returns, then
   *  separately clicks OK and waits for the sign-in screen: showing the
   *  report-back only AFTER an awaited sign-out would unmount this dialog,
   *  from its OWN parent unmounting on the resulting SIGNED_OUT event,
   *  before the report-back could ever render — so sign-out stays gated
   *  on the explicit OK click, same as before this fix round). */
  onDeleted: () => Promise<void>;
}

const COMPLETE_THING = "your workspace files, your gate log, and your credit";
// C § 8's own wording, word for word (design-web-ui.md § 1.7, point 2).
const ONE_SENTENCE =
  "This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited. " +
  "Your usage records, which show only amounts spent and no content, are kept.";

type Phase = "confirming" | "declined" | "deleting" | "error" | "done";

export function DeleteBetaDataConfirm({
  supabaseUrl,
  accessToken,
  onClose,
  onDeleted,
}: DeleteBetaDataConfirmProps): ReactElement {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("confirming");
  const [error, setError] = useState<string | undefined>(undefined);
  const [summary, setSummary] = useState<DeleteAccountSummary | undefined>(undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // origin is always "typed" here — there is no other way to reach this
    // form (no button submits it; Enter/click-submit both carry the same
    // typed text), matching the spend gate's own "no approve button" rule.
    const reply = matchGateReply(typed, "typed");
    if (reply === "decline") {
      setPhase("declined");
      return;
    }
    if (reply !== "approve") {
      // "none": stays open, same as a spend gate's off-script reply.
      return;
    }
    setPhase("deleting");
    setError(undefined);
    try {
      const result = await deleteBetaAccount({ url: supabaseUrl, accessToken });
      setSummary(result);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const [signingOut, setSigningOut] = useState(false);
  const handleOk = () => {
    setSigningOut(true);
    void onDeleted(); // RealApp's SIGNED_OUT listener unmounts this dialog once it resolves.
  };

  if (phase === "declined") {
    return (
      <div className="delete-confirm-overlay" role="dialog" aria-modal="true">
        <div className="delete-confirm-card">
          <p>Declined — nothing was deleted.</p>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (phase === "done" && summary) {
    return (
      <div className="delete-confirm-overlay" role="dialog" aria-modal="true">
        <div className="delete-confirm-card">
          {/* § 1.7 point 4: the report-back, once ten-delete-account
              returns. OK is what actually signs out (handleOk) — the
              sentence itself already states what OK is about to do. */}
          <p>Deleted. You're signed out of Ten — your sign-in for the older app is untouched.</p>
          <button type="button" onClick={handleOk} disabled={signingOut}>
            {signingOut ? "Signing out…" : "OK"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="delete-confirm-overlay" role="dialog" aria-modal="true">
      <div className="delete-confirm-card">
        <h2>Delete my beta data</h2>
        {/* § 1.7 point 1: the complete thing, named, not summarized. */}
        <p className="delete-confirm-scope">This deletes {COMPLETE_THING}.</p>
        {/* § 1.7 point 2: C § 8's own wording, word for word. */}
        <p className="delete-confirm-sentence">{ONE_SENTENCE}</p>
        {error ? <p className="delete-confirm-error">{error} Nothing more was deleted than the summary above — try again.</p> : null}
        <form onSubmit={submit}>
          <label>
            {/* Fix round 1, item 8: this form DOES have a Submit button —
                claiming "there is no button" next to one was self-
                contradicting. The button only ever submits whatever was
                actually TYPED (matchGateReply decides, same as a spend
                gate); it never approves anything by itself. */}
            Type <strong>yes</strong>, then press Enter or Submit.
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={phase === "deleting"}
              autoFocus
            />
          </label>
          <div className="delete-confirm-actions">
            <button type="submit" disabled={phase === "deleting"}>
              {phase === "deleting" ? "Deleting…" : "Submit"}
            </button>
            <button type="button" onClick={onClose} disabled={phase === "deleting"}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
