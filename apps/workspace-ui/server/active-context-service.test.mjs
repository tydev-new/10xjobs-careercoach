// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertVisibleMessageMatches, createItemRef } from "../shared/active-context.mjs";
import { createActiveContextService, createFileActiveSelectionStore, createLocalWorkspaceIdentity } from "./active-context-service.mjs";
import { createLocalWorkspace } from "./workspace-core.mjs";

const cleanup = [];

async function setup(name = "candidate") {
  const root = await mkdtemp(path.join(tmpdir(), `${name}-workspace-`));
  const state = await mkdtemp(path.join(tmpdir(), `${name}-state-`));
  cleanup.push(root, state);
  await mkdir(path.join(root, "documents"));
  await writeFile(path.join(root, "documents", "resume.md"), "# Resume v1\n");
  await writeFile(path.join(root, "jobs.md"), "## Applied\n### Acme — VP Engineering\n- Score: 88\n");
  await writeFile(path.join(root, "plan.md"), "To do (1)\n1. Review resume\nDone\n");
  await writeFile(path.join(root, "knowledge.md"), "| Topic | Scope | Source | A | B | Status | Practice |\n| --- | --- | --- | --- | --- | --- | --- |\n| Evaluation | Systems | Jobs | | | studying | Drill |\n");
  const identity = await createLocalWorkspaceIdentity(root);
  const workspace = createLocalWorkspace(root);
  const store = createFileActiveSelectionStore(state);
  const service = createActiveContextService({ identity, workspace, store });
  return { root, state, identity, workspace, store, service };
}

afterEach(async () => Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true }))));

describe("active context service", () => {
  it("fails closed without an active selection", async () => {
    const { service } = await setup();
    await expect(service.getActiveContext()).rejects.toMatchObject({ code: "active_selection_missing" });
  });

  it("stores only the routing pointer and returns a visible message without a context id", async () => {
    const { service, state } = await setup();
    const itemRef = createItemRef("resource", "documents/resume.md");
    const activation = await service.setActiveSelection({ itemRef, action: "review_resume" });
    expect(activation.visibleMessage).toBe("Review resume: Resume using CareerCoach.");
    expect(activation.visibleMessage).not.toContain("ctx_");

    const [file] = await readdir(state);
    const record = JSON.parse(await readFile(path.join(state, file), "utf8"));
    expect(Object.keys(record).sort()).toEqual(["action", "itemRef", "schemaVersion", "workspaceId"]);
    expect(JSON.stringify(record)).not.toContain("Resume v1");
  });

  it("rereads the authoritative resource for every lookup", async () => {
    const { root, service } = await setup();
    await service.setActiveSelection({ itemRef: createItemRef("resource", "documents/resume.md"), action: "review_resume" });
    expect((await service.getActiveContext()).sources[0].content).toContain("v1");
    await writeFile(path.join(root, "documents", "resume.md"), "# Resume v2\n");
    expect((await service.getActiveContext()).sources[0].content).toContain("v2");
  });

  it("isolates selections by authenticated workspace identity", async () => {
    const first = await setup("first");
    const second = await setup("second");
    const sharedStore = createFileActiveSelectionStore(first.state);
    const firstService = createActiveContextService({ identity: first.identity, workspace: first.workspace, store: sharedStore });
    const secondService = createActiveContextService({ identity: second.identity, workspace: second.workspace, store: sharedStore });
    await firstService.setActiveSelection({ itemRef: createItemRef("resource", "documents/resume.md"), action: "review_resume" });
    await expect(secondService.getActiveContext()).rejects.toMatchObject({ code: "active_selection_missing" });
  });

  it("returns one minimal projected item with source provenance", async () => {
    const { service } = await setup();
    const itemRef = createItemRef("job", "Acme — VP Engineering");
    await service.setActiveSelection({ itemRef, action: "prepare_interview" });
    const context = await service.getActiveContext();
    expect(context.selection).toMatchObject({ itemRef, kind: "job", label: "Acme — VP Engineering" });
    expect(context.item.company).toBe("Acme");
    expect(context.sources).toEqual([expect.objectContaining({ ref: "jobs.md", selector: itemRef })]);
    expect(context.sources[0]).not.toHaveProperty("content");
  });

  it("resolves the selected item once per lookup", async () => {
    const fixture = await setup();
    let calls = 0;
    const countedWorkspace = {
      resolveContextItem: async (itemRef) => {
        calls += 1;
        return fixture.workspace.resolveContextItem(itemRef);
      },
    };
    const service = createActiveContextService({ identity: fixture.identity, workspace: countedWorkspace, store: fixture.store });
    await service.setActiveSelection({ itemRef: createItemRef("resource", "documents/resume.md"), action: "review_resume" });
    calls = 0;
    await service.getActiveContext();
    expect(calls).toBe(1);
  });

  it("fails closed when the visible message and lookup disagree", async () => {
    const { service } = await setup();
    await service.setActiveSelection({ itemRef: createItemRef("resource", "documents/resume.md"), action: "review_resume" });
    const context = await service.getActiveContext();
    expect(() => assertVisibleMessageMatches("Review resume: Resume using CareerCoach.", context)).not.toThrow();
    expect(() => assertVisibleMessageMatches("Review another file using CareerCoach.", context)).toThrow(expect.objectContaining({ code: "context_mismatch" }));
  });
});
