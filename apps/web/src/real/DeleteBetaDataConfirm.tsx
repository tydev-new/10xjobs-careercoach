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
import { deleteBetaAccount } from "../backend/delete-account.ts";

export interface DeleteBetaDataConfirmProps {
  supabaseUrl: string;
  accessToken: () => Promise<string>;
  onClose: () => void;
  /** Called once ten-delete-account returns; performs the actual sign-out
   *  AND shows the report-back — both owned by RealApp now (fix round 2,
   *  item 3: sign out FIRST, awaited, then the report-back, which must
   *  survive this component's OWN unmount once RealApp's screen leaves
   *  "member" — so RealApp renders it, not this dialog). This component
   *  has nothing left to show once it calls this; it just awaits it so
   *  the Submit button stays disabled ("Deleting…") until then. */
  onDeleted: () => Promise<void>;
}

// Amended 2026-09-24 (C § 11.7 / ui § 1.7 point 1): "your conversation"
// added, named — not folded into "workspace files" (ten_conversations is
// its own table, C § 11.7).
const COMPLETE_THING = "your workspace files, your conversation, your gate log, and your credit";
// C § 8's own wording, word for word (design-web-ui.md § 1.7, point 2).
const ONE_SENTENCE =
  "This deletes your Ten beta data. Your sign-in stays because it's shared with the older app. Unused credit is forfeited. " +
  "Your usage records, which show only amounts spent and no content, are kept.";

type Phase = "confirming" | "declined" | "deleting" | "error";

export function DeleteBetaDataConfirm({
  supabaseUrl,
  accessToken,
  onClose,
  onDeleted,
}: DeleteBetaDataConfirmProps): ReactElement {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("confirming");
  const [error, setError] = useState<string | undefined>(undefined);

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
      // "none": stays open, same as a spend gate's own off-script reply.
      return;
    }
    setPhase("deleting");
    setError(undefined);
    try {
      await deleteBetaAccount({ url: supabaseUrl, accessToken });
      await onDeleted(); // sign-out, then RealApp shows the report-back.
    } catch (err) {
      // Fix round 2, item 2's own posture applied here too: never the raw
      // error text on screen — log it, show a plain sentence.
      console.error("[Ten] delete beta data failed:", err);
      setError("Something went wrong deleting your data.");
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
