// Home's pipeline counts (design-web-ui.md § 5.3, "The pipeline in
// numbers"; § 5.9 3c's exit: "Home's counts equal load()'s rows by
// stage"). A table test against the real jobs_md port's `load()`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReadOnlyIo } from "./store-io.ts";
import { pipelineCounts } from "./pipeline.ts";

function fakeIo(files: Record<string, string>): ReadOnlyIo {
  return {
    exists: async (p) => p in files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`no such file: ${p}`);
      return files[p];
    },
    writeFile: async () => {
      throw new Error("read-only");
    },
  };
}

const JOBS_MD = [
  "# Pipeline",
  "",
  "## To Review",
  "",
  "### Acme — Staff PM",
  "- URL: https://acme.example/jobs/1",
  "",
  "## Interested",
  "",
  "### Beta — PM",
  "- URL: https://beta.example/jobs/1",
  "",
  "### Gamma — Senior PM",
  "- URL: https://gamma.example/jobs/1",
  "",
  "## Interviewing",
  "",
  "### Delta — PM",
  "- URL: https://delta.example/jobs/1",
  "",
  "## Dismissed",
  "",
  "### Epsilon — PM",
  "- Was: To Review",
  "- Dismissed: not a fit",
  "",
].join("\n");

test("pipelineCounts: one count per active stage in jobs.md's own order, plus dismissed", async () => {
  const counts = await pipelineCounts(fakeIo({ "jobs.md": JOBS_MD }));
  assert.deepEqual(counts.stages, [
    { label: "To Review", count: 1 },
    { label: "Interested", count: 2 },
    { label: "Applied", count: 0 },
    { label: "Interviewing", count: 1 },
    { label: "Offer", count: 0 },
  ]);
  assert.equal(counts.dismissed, 1);
});

test("pipelineCounts: no jobs.md -> every stage 0, dismissed 0 (missing is empty, never an error)", async () => {
  const counts = await pipelineCounts(fakeIo({}));
  assert.deepEqual(
    counts.stages.map((s) => s.count),
    [0, 0, 0, 0, 0],
  );
  assert.equal(counts.dismissed, 0);
});

test("pipelineCounts: an unreadable jobs.md (a real read failure) propagates, never silently 0", async () => {
  const io: ReadOnlyIo = {
    exists: async () => true,
    readFile: async () => {
      throw new Error("boom");
    },
    writeFile: async () => {
      throw new Error("read-only");
    },
  };
  await assert.rejects(() => pipelineCounts(io));
});
