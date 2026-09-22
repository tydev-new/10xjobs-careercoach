// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalWorkspace, projections } from "./workspace-core.mjs";

const roots = [];

async function makeWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "ten-workspace-"));
  roots.push(root);
  await writeFile(path.join(root, "jobs.md"), "## Interviewing\n### Acme — VP Engineering\n- Score: 88\n- Updated: 2026-08-26\n");
  await writeFile(path.join(root, "plan.md"), "## Board\nWaiting on you\n\nTo do (2)\n1. Review resume: `applications/acme.md`\n2. Practice architecture story\n\nDone\n1. Earlier task\n");
  await writeFile(path.join(root, "profile.md"), "# Profile — Maya Chen\n- Name: Maya Chen\n- Résumé headline: Applied AI leader\n- Location: Bay Area\n");
  await writeFile(path.join(root, "knowledge.md"), "| Topic | Scope | Source | A | B | Status | Practice |\n| --- | --- | --- | --- | --- | --- | --- |\n| Evaluation | Systems | Target roles | | | studying | Architecture rep |\n");
  await mkdir(path.join(root, "documents"));
  return root;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("workspace projections", () => {
  it("parses numbered todo items without including Done", () => {
    const rows = projections.parsePlan("To do (2)\n1. Review resume\n2. Practice story\nDone\n1. Old task");
    expect(rows.map((row) => row.task)).toEqual(["Review resume", "Practice story"]);
  });
});

describe("local workspace", () => {
  it("projects canonical workspace files into a snapshot", async () => {
    const workspace = createLocalWorkspace(await makeWorkspace());
    const snapshot = await workspace.snapshot();
    expect(snapshot.jobs[0]).toMatchObject({ company: "Acme", stage: "Interviewing", fit: 88 });
    expect(snapshot.planItems).toHaveLength(2);
    expect(snapshot.candidate.name).toBe("Maya Chen");
    expect(snapshot.skills[0].name).toBe("Evaluation");
  });

  it("rejects traversal and symlinks outside the workspace", async () => {
    const root = await makeWorkspace();
    const outside = await mkdtemp(path.join(tmpdir(), "ten-outside-"));
    roots.push(outside);
    await writeFile(path.join(outside, "secret.md"), "secret");
    await symlink(path.join(outside, "secret.md"), path.join(root, "linked.md"));
    const workspace = createLocalWorkspace(root);
    await expect(workspace.readResource("../secret.md")).rejects.toMatchObject({ code: "invalid_ref" });
    await expect(workspace.readResource("linked.md")).rejects.toMatchObject({ code: "outside_workspace" });
  });

  it("uses versions to prevent lost updates", async () => {
    const root = await makeWorkspace();
    const workspace = createLocalWorkspace(root);
    const opened = await workspace.readResource("profile.md");
    const saved = await workspace.updateResource("profile.md", "# Updated profile\n", opened.version);
    expect(saved.content).toBe("# Updated profile\n");
    await expect(workspace.updateResource("profile.md", "# Stale\n", opened.version)).rejects.toMatchObject({ code: "version_conflict" });
    expect(await readFile(path.join(root, "profile.md"), "utf8")).toBe("# Updated profile\n");
  });

  it("uploads supported resources without overwriting", async () => {
    const workspace = createLocalWorkspace(await makeWorkspace());
    const payload = Buffer.from("# Resume\n").toString("base64");
    await workspace.uploadResource({ name: "resume.md", base64: payload });
    await expect(workspace.uploadResource({ name: "resume.md", base64: payload })).rejects.toMatchObject({ code: "already_exists" });
  });
});
