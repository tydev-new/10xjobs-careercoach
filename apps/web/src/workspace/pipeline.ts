// Home's pipeline counts (design-web-ui.md § 5.3, "The pipeline in
// numbers"; § 5.9 3c's own exit: "Home's counts equal load()'s rows by
// stage"). Reuses the jobs_md port's own `load()` and `STAGES` — the same
// reader the Jobs page uses (skills/search/scripts/lib/jobs-md.mjs; PR #24,
// the js-only J2 switch, moved this out of packages/checkers/src) — over
// the read-only store-io.ts adapter. Counts are rows BY STAGE, counted by
// code (rule 14); this never reads jobs.md's own bold "Active:" line,
// which would be a second source for one number.
import { load, STAGES } from "../../../../skills/search/scripts/lib/jobs-md.mjs";
import type { ReadOnlyIo } from "./store-io.ts";

export interface StageCount {
  label: string;
  count: number;
}

export interface PipelineCounts {
  stages: StageCount[]; // STAGES order: To Review, Interested, Applied, Interviewing, Offer
  dismissed: number;
}

interface JobRow {
  stage: string | null;
  dismissed: boolean;
}

export async function pipelineCounts(io: ReadOnlyIo): Promise<PipelineCounts> {
  const rows = (await load(io, "")) as JobRow[];
  const labels = STAGES as string[];
  const stages = labels.map((label) => ({
    label,
    count: rows.filter((r) => !r.dismissed && r.stage === label).length,
  }));
  const dismissed = rows.filter((r) => r.dismissed).length;
  return { stages, dismissed };
}
