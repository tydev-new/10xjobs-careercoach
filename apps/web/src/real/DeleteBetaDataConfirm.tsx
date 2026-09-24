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
  /** Called once ten-delete-account returns; performs the actual sign-out
   *  and resolves once it completes. Fix round 1, item 8: the report-back
   *  says "you're signed out" only once this has actually resolved, not
   *  the moment the delete call itself returns. */
  onDeleted: () => Promise<void>;
}

const COMPLETE_THING = "your workspace files, your gate log, and your credit";
// C § 8's own wording, word for word (design-web-ui.md § 1.7, point 2).
const ONE_SENTENCE =
  "This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited. " +
  "Your usage records, which show only amounts spent and no content, are kept.";

type Phase = "confirming" | "declined" | "deleting" | "signing-out" | "error" | "done";

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
      // Fix round 1, item 8: don't claim "you're signed out" until the
      // sign-out itself has actually completed.
      setPhase("signing-out");
      await onDeleted();
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
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
          {/* § 1.7 point 4: the report-back — shown only once the actual
              sign-out (awaited above) has completed. */}
          <p>Deleted. You're signed out of Ten — your sign-in for the older app is untouched.</p>
          <button type="button" onClick={onClose}>
            OK
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
              disabled={phase === "deleting" || phase === "signing-out"}
              autoFocus
            />
          </label>
          <div className="delete-confirm-actions">
            <button type="submit" disabled={phase === "deleting" || phase === "signing-out"}>
              {phase === "deleting" ? "Deleting…" : phase === "signing-out" ? "Signing out…" : "Submit"}
            </button>
            <button type="button" onClick={onClose} disabled={phase === "deleting" || phase === "signing-out"}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
