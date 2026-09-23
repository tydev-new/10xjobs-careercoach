import type { ReactElement } from "react";
// data-error, rendered exactly as the envelope carries it (design-web-ui.md
// § 2.7). nextStep copy is a small UI-owned lookup keyed by code, since the
// part carries no such field.
import type { DataErrorData, ErrorCode } from "../types";

// L2 (fix round 2): each line states only what happened / what the
// candidate can do — never a promise of what the agent itself will do
// next (that's the model's own next turn to say, from the files, not the
// UI's to guess).
const NEXT_STEP: Record<ErrorCode, string> = {
  over_balance: "Add funds to keep going.",
  model_error: "Try again in a moment.",
  tool_error: "A tool call failed.",
  offline: "Check your connection and try again.",
  // A step_cap stop opens a "Continue this run" gate (C § 4) — the SAME
  // gate protocol as a spend gate: only a typed exact "yes" approves it,
  // never a free-text "go ahead".
  step_cap: "This opened a gate — type yes to continue the run.",
};

export function ErrorPart({ data }: { data: DataErrorData }): ReactElement {
  const nextStep = NEXT_STEP[data.code];
  return (
    <div className="card card--error">
      <div className="card-title">Error — {data.code}</div>
      <p className="card-body">{data.message}</p>
      {nextStep ? <p className="card-meta">{nextStep}</p> : null}
      {data.retryable ? <p className="card-meta">This can be retried.</p> : null}
    </div>
  );
}
