// The stage steps' own pure logic (design-web-ui.md § 5.3, "Pieces the
// pages share"; § 5.9 3d's own exit: "the stage-steps table (no check
// marks, no dates)"). The StageSteps component (../components/
// StageSteps.tsx) only renders what this function returns — kept
// separate so the "exactly one current step, every other step drawn
// alike" rule has its own table test, the same posture documents.ts/
// home-reader.ts already use for their own components. Reuses the
// jobs_md port's own STAGES array and stage words rather than a second
// copy (rule 12; the same words Home's pipeline cells and the Jobs
// groups use, P11-P15 § 5.3.1). No window/document/localStorage/
// Node-only API.
// @ts-expect-error - plain .mjs, no type declarations (script-runner.ts's
// own posture for a skills/*/scripts/lib import).
import { STAGES } from "../../../../skills/search/scripts/lib/jobs-md.mjs";

export const STAGE_LABELS: string[] = STAGES;

export interface StageStep {
  label: string;
  /** `aria-current="step"` on exactly the row's own stage — "only the
   *  current step is marked; every other step is drawn the same, before
   *  or after it" (§ 5.3). Never a check mark, never a date: `jobs.md`
   *  records only the CURRENT stage, not which ones a row passed through
   *  or when. */
  current: boolean;
}

/** `stage` is the row's own `jobs.md` stage word (one of STAGE_LABELS).
 *  A stage this port doesn't know (should not happen — `jobs.md`'s own
 *  writers only ever write STAGES' words) marks no step as current,
 *  rather than guessing one — the row's own word is still shown
 *  elsewhere (the row/detail header), so nothing is hidden either way. */
export function stageSteps(stage: string): StageStep[] {
  return STAGE_LABELS.map((label) => ({ label, current: label === stage }));
}
