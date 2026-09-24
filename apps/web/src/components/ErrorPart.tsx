import type { ReactElement } from "react";
// data-error, rendered exactly as the envelope carries it (design-web-ui.md
// § 2.7). nextStep copy is a small UI-owned lookup keyed by code, since the
// part carries no such field.
import type { DataErrorData, ErrorCode } from "../types";

// L2 (fix round 2): each line states only what happened / what the
// candidate can do — never a promise of what the agent itself will do
// next (that's the model's own next turn to say, from the files, not the
// UI's to guess).
//
// S2 (docs/reviews/proxy-change-review.md): `over_balance` and
// `model_error` have NO entry here anymore. `data.message` for these two
// is now the server's own literal sentence (design-web-ui.md § 2.7,
// design-web-agent.md § 8), and it already says what to do — repeating it
// would be the boilerplate rule 8 rules out. It also can't be one static
// line: `model_error` alone covers at least two different real messages
// ("The beta has reached today's limit. Try again tomorrow." vs. "The
// model is temporarily unavailable. Try again.", handler.ts's own
// MESSAGES) — a fixed `nextStep` would contradict whichever one didn't
// apply. There is no "add funds" step in the beta (one shared app key,
// no per-candidate spend), so the old over_balance line is gone outright,
// not reworded. `cut_off` (§ 9.3, amended 2026-09-24) is its own code,
// not a `model_error` cause any more — the old § 8 cut-off `model_error`
// sentence this comment used to cite here is retired; its own fixed
// message already says what to do, so it has no entry below either.
const NEXT_STEP: Partial<Record<ErrorCode, string>> = {
  tool_error: "A tool call failed.",
  offline: "Check your connection and try again.",
  // Amended 2026-09-24 (closing drift review of issue #2, follow-up A):
  // this used to claim a step_cap stop opens a "Continue this run" gate,
  // but coach.ts's step_cap check (the hard step cap) writes the error
  // and ends the turn — it opens no gate. Only the SEPARATE mid-run
  // allowance stop (C § 4) opens that gate, and it carries no step_cap
  // error. The line now says only what's true and what the candidate
  // can do next: no gate, no "type yes".
  step_cap: "Send another message to pick up where it left off.",
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
