import type { ReactElement } from "react";
// The spend gate (design-web-ui.md § 2.5, C § 3). The complete text, the
// gate line, and an instruction to type yes — NO approve button, ever
// (rule 7). Status comes only from the latest data-gate-status part.
import type { GateRequest, GateStatus } from "../types";

export function GateCard({
  gate,
  status,
}: {
  gate: GateRequest;
  status: GateStatus;
}): ReactElement {
  return (
    <div className={`card card--gate card--gate-${status}`} data-gate-id={gate.gateId}>
      <div className="card-kicker">Needs your word</div>
      <div className="card-title">{gate.label}</div>
      <pre className="gate-text">{gate.text}</pre>
      <p className="gate-line">{gate.gateLine}</p>
      <p className="card-meta">
        Status: <span className={`badge badge--gate-${status}`}>{status}</span>
      </p>
      {status === "pending" ? (
        <p className="gate-instruction">Type <strong>yes</strong> below to go ahead. There is no button.</p>
      ) : null}
    </div>
  );
}
