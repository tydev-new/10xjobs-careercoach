// L3 (fix round 2): amounts render with at least 2 decimals, never
// rounded down — `toFixed(2)` would truncate e.g. $0.567 to "$0.57"
// (rounded) or a bare `.567` never gets zero-padded; this keeps whichever
// is longer: 2 decimals or the number's own. Used for the cost card
// (design-web-ui.md § 2.6): estimate_cost's own numbers, shown straight,
// never widened or rounded off.
export function formatUsd(n: number): string {
  const raw = n.toString();
  const decimals = (raw.split(".")[1] ?? "").length;
  return n.toFixed(Math.max(2, decimals));
}

// S2/N3 (docs/reviews/proxy-change-review.md): the balance CHIP is a
// different number with a different rule — it must never show more money
// than the candidate actually has. So it rounds DOWN to the cent (never
// up, unlike formatUsd's decimal padding above), and a balance at or
// below zero reads $0.00, never a negative figure (design-web-ui.md § 1.1,
// design-web-agent.md § 8: "the chip rounds down to cents; a negative
// balance shows $0.00"). Only the header's balance chip uses this —
// every other dollar figure (the cost card's range and balance) is
// formatUsd, unrounded.
export function formatBalanceUsd(n: number): string {
  const clamped = Math.max(0, n);
  const flooredCents = Math.floor(clamped * 100 + 1e-9); // +epsilon: floor of a float like 4.2*100 must not slip to 419
  return (flooredCents / 100).toFixed(2);
}
