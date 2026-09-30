// The stage steps (design-web-ui.md § 5.3, "Pieces the pages share" —
// "the mockup's `.stepper` shape with `jobs.md`'s stage words"). All the
// logic ("exactly one current step, no check marks, no dates") lives in
// ../workspace/stage-steps.ts, with its own table test; this component
// only renders what that function returns. A dismissed row gets no
// steps at all — the caller decides that (it never calls this
// component for one).
import type { ReactElement } from "react";
import { stageSteps } from "../workspace/stage-steps.ts";

export function StageSteps({ stage }: { stage: string }): ReactElement {
  return (
    <ol className="stage-steps" aria-label="Stage">
      {stageSteps(stage).map((step) => (
        <li
          key={step.label}
          className={`stage-step${step.current ? " stage-step--current" : ""}`}
          aria-current={step.current ? "step" : undefined}
        >
          <span className="stage-step-dot" aria-hidden="true" />
          <span className="stage-step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
