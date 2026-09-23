// L3 (fix round 2): amounts render with at least 2 decimals, never
// rounded down — `toFixed(2)` would truncate e.g. $0.567 to "$0.57"
// (rounded) or a bare `.567` never gets zero-padded; this keeps whichever
// is longer: 2 decimals or the number's own.
export function formatUsd(n: number): string {
  const raw = n.toString();
  const decimals = (raw.split(".")[1] ?? "").length;
  return n.toFixed(Math.max(2, decimals));
}
