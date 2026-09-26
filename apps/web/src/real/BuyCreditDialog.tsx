// design-web-ui.md § 1.11 — the Buy-credit dialog. Mechanism:
// design-web-agent.md § 17. Members only (RealChatShell never mounts this
// for a non-member — § 1.6 has none), opened only from the balance chip or
// "Buy credit" in the ⋯ menu (Header.tsx), NEVER from a card, the chat, or
// any model output (§ 17.2: "no tool, card or model output opens the
// dialog or calls ten-paypal"). Close or Esc shuts it.
//
// The PayPal JS SDK is loaded lazily, ONLY once this dialog actually opens
// (§ 17.1 step 1) — never at app boot, never for a non-member. This file
// uses `window`/`document` freely: it's apps/web UI code, not
// packages/agent or a ported checker (the no-window/no-document rule is
// about those two, docs/ARCHITECTURE.md's "system map").
import { useEffect, useRef, useState, type ReactElement } from "react";
import { capturePaypalOrder, createPaypalOrder, type CaptureResult, type PackId } from "../backend/paypal.ts";

export interface BuyCreditDialogProps {
  supabaseUrl: string;
  accessToken: () => Promise<string>;
  /** VITE_PAYPAL_CLIENT_ID — the PUBLIC client id only, never a secret. An
   *  empty string (unset) renders the "can't start a payment" copy instead
   *  of ever trying to load the SDK. */
  paypalClientId: string;
  onClose: () => void;
  /** Called once a capture returns "credited" — the caller (RealChatShell)
   *  re-reads deps.balance() so the header chip reflects it (§ 1.11: "The
   *  chip refreshes."). */
  onCredited: () => void;
}

const PACKS: PackId[] = ["10", "20", "40"];

type Phase =
  | { kind: "picking" }
  | { kind: "processing" }
  | { kind: "credited"; grossUsd: string; feeUsd: string; creditedUsd: string }
  | { kind: "pending" }
  | { kind: "declined" }
  | { kind: "window_closed" }
  | { kind: "create_failed" }
  | { kind: "not_credited" };

// deno-lint-ignore no-explicit-any
type PaypalSdk = any;

// One SDK load per client id, cached — a second dialog open (or a second
// pack pick) never injects a second <script> tag (which would double-
// register buttons). Module-level, deliberately: the SDK script itself is
// meant to be loaded once per page, same as the old app's own usage.
let sdkPromise: Promise<PaypalSdk> | undefined;
let sdkPromiseClientId: string | undefined;

function loadPaypalSdk(clientId: string): Promise<PaypalSdk> {
  const w = window as unknown as { paypal?: PaypalSdk };
  if (w.paypal && sdkPromiseClientId === clientId) return Promise.resolve(w.paypal);
  if (sdkPromise && sdkPromiseClientId === clientId) return sdkPromise;
  sdkPromiseClientId = clientId;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    // § 17.1 step 1: "intent=capture, currency=USD, disable-funding=paylater".
    // § 17.9: "Pay Later off."
    script.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      "&currency=USD&intent=capture&disable-funding=paylater";
    script.onload = () => {
      const loaded = (window as unknown as { paypal?: PaypalSdk }).paypal;
      if (loaded) resolve(loaded);
      else reject(new Error("PayPal SDK script loaded but window.paypal is missing"));
    };
    script.onerror = () => reject(new Error("Failed to load the PayPal SDK"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function BuyCreditDialog({
  supabaseUrl,
  accessToken,
  paypalClientId,
  onClose,
  onCredited,
}: BuyCreditDialogProps): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: "picking" });
  const [selectedPack, setSelectedPack] = useState<PackId | undefined>(undefined);
  const buttonsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!selectedPack || !paypalClientId) return;
    let cancelled = false;
    const opts = { url: supabaseUrl, accessToken };

    loadPaypalSdk(paypalClientId)
      .then((paypal) => {
        if (cancelled || !buttonsRef.current) return;
        buttonsRef.current.innerHTML = "";
        paypal
          .Buttons({
            style: { layout: "vertical" },
            createOrder: async () => {
              try {
                const { orderId } = await createPaypalOrder(opts, selectedPack);
                return orderId;
              } catch (err) {
                console.error("[Ten] create-order failed:", err);
                if (!cancelled) setPhase({ kind: "create_failed" });
                throw err;
              }
            },
            onApprove: async (data: { orderID: string }) => {
              if (cancelled) return;
              setPhase({ kind: "processing" });
              let result: CaptureResult;
              try {
                result = await capturePaypalOrder(opts, data.orderID);
              } catch (err) {
                console.error("[Ten] capture-order failed:", err);
                if (!cancelled) setPhase({ kind: "not_credited" });
                return;
              }
              if (cancelled) return;
              if (result.status === "credited") {
                setPhase({ kind: "credited", grossUsd: result.grossUsd, feeUsd: result.feeUsd, creditedUsd: result.creditedUsd });
                onCredited();
              } else {
                setPhase({ kind: result.status });
              }
            },
            // § 17.2: "Ten can capture only an order the payer approved" —
            // cancelling in PayPal's own window is the payer's choice, not
            // an error; same copy as ORDER_NOT_APPROVED ("No payment was made.").
            onCancel: () => {
              if (!cancelled) setPhase({ kind: "window_closed" });
            },
            onError: (err: unknown) => {
              console.error("[Ten] PayPal buttons error:", err);
              if (!cancelled) setPhase({ kind: "create_failed" });
            },
          })
          .render(buttonsRef.current);
      })
      .catch((err) => {
        console.error("[Ten] PayPal SDK failed to load:", err);
        if (!cancelled) setPhase({ kind: "create_failed" });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPack, paypalClientId, supabaseUrl]);

  const reset = () => {
    setSelectedPack(undefined);
    setPhase({ kind: "picking" });
  };

  return (
    <div className="buy-credit-overlay" role="dialog" aria-modal="true" aria-label="Buy credit">
      <div className="buy-credit-card">
        <button type="button" className="buy-credit-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2>Buy credit</h2>
        {/* § 1.11, word for word. */}
        <p>
          Credit pays for Ten's work. You pay in PayPal's window; Ten adds what arrives after
          PayPal's fee, a few percent plus a fixed amount. This is a one-time payment: nothing
          renews, and Ten never charges you on its own.
        </p>

        {phase.kind === "credited" ? (
          <div className="buy-credit-result">
            <p>
              Added ${phase.creditedUsd} of credit. PayPal charged ${phase.grossUsd}; its fee was $
              {phase.feeUsd}.
            </p>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : phase.kind === "pending" ? (
          <div className="buy-credit-result">
            <p>PayPal is still clearing this payment. The credit is added when it clears.</p>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : phase.kind === "declined" ? (
          <div className="buy-credit-result">
            <p>PayPal declined this payment. No money moved.</p>
            <button type="button" onClick={reset}>
              Try again
            </button>
          </div>
        ) : phase.kind === "window_closed" ? (
          <div className="buy-credit-result">
            <p>No payment was made.</p>
            <button type="button" onClick={reset}>
              Try again
            </button>
          </div>
        ) : phase.kind === "create_failed" ? (
          <div className="buy-credit-result">
            <p>Couldn't start a payment. No money moved.</p>
            <button type="button" onClick={reset}>
              Try again
            </button>
          </div>
        ) : phase.kind === "not_credited" ? (
          <div className="buy-credit-result">
            <p>
              Ten couldn't confirm the credit yet. If PayPal took your payment, it's added
              automatically, usually within minutes. If not by tomorrow, email
              support@10xjobs.co with PayPal's receipt.
            </p>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="buy-credit-packs" role="group" aria-label="Choose a credit pack">
              {PACKS.map((pack) => (
                <button
                  key={pack}
                  type="button"
                  className={`buy-credit-pack${selectedPack === pack ? " buy-credit-pack--selected" : ""}`}
                  disabled={phase.kind === "processing"}
                  onClick={() => setSelectedPack(pack)}
                >
                  ${pack}
                </button>
              ))}
            </div>
            {selectedPack ? (
              paypalClientId ? (
                <div ref={buttonsRef} className="buy-credit-buttons" />
              ) : (
                <p className="buy-credit-result">Couldn't start a payment. No money moved.</p>
              )
            ) : null}
            {phase.kind === "processing" ? <p>Confirming your payment…</p> : null}
            <p className="buy-credit-footer">
              Paid credit stays if you delete your beta data. The beta has a shared daily limit,
              so on a busy day Ten can pause until tomorrow even with credit. For a refund, email
              support@10xjobs.co.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
