// store-io.ts — the read-only io adapter over WorkspaceStore
// (design-web-ui.md § 5.3 Jobs "Reads", reused by Home's pipeline
// counts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceError, type WorkspaceStore } from "../types.ts";
// The REAL Supabase store throws packages/agent/src/types.ts's own
// WorkspaceError — a DIFFERENT class from apps/web/src/types.ts's, even
// though both are named "WorkspaceError" and shaped the same. Stage 3d
// review, blocking: an `instanceof` check against only one of these two
// classes silently missed every "missing" throw the OTHER class produced
// (in production, that's every one — the mock FixtureStore only ever
// throws apps/web's own class, which is why this bug never showed up
// against the fixtures). isMissingError must work for either.
import { WorkspaceError as AgentWorkspaceError } from "../../../../packages/agent/src/types.ts";
import { isMissingError, storeIo } from "./store-io.ts";

function fakeStore(files: Record<string, string>): WorkspaceStore {
  return {
    list: async () => Object.keys(files).map((path) => ({ path, version: "v1", size: 0, updatedAt: "", editable: true })),
    read: async (path: string) => {
      if (!(path in files)) throw new WorkspaceError("resource_missing", path);
      return { path, version: "v1", size: files[path].length, updatedAt: "", editable: true, binary: false, content: files[path] };
    },
    write: async () => {
      throw new Error("not implemented");
    },
    upload: async () => {
      throw new Error("not implemented");
    },
  };
}

test("store-io: exists(p) is true when read(p) succeeds", async () => {
  const io = storeIo(fakeStore({ "jobs.md": "# Pipeline" }));
  assert.equal(await io.exists("jobs.md"), true);
});

test("store-io: exists(p) is false on resource_missing", async () => {
  const io = storeIo(fakeStore({}));
  assert.equal(await io.exists("jobs.md"), false);
});

test("store-io: exists(p) rethrows any OTHER error (never silently false)", async () => {
  const store: WorkspaceStore = {
    list: async () => [],
    read: async () => {
      throw new WorkspaceError("outside_workspace", "jobs.md");
    },
    write: async () => {
      throw new Error("nope");
    },
    upload: async () => {
      throw new Error("nope");
    },
  };
  const io = storeIo(store);
  await assert.rejects(() => io.exists("jobs.md"), WorkspaceError);
});

test("store-io: readFile(p) returns the text", async () => {
  const io = storeIo(fakeStore({ "plan.md": "Goal: x\n" }));
  assert.equal(await io.readFile("plan.md"), "Goal: x\n");
});

test("store-io: writeFile always throws (pages never write, § 5.2 rule 1)", async () => {
  const io = storeIo(fakeStore({}));
  await assert.rejects(() => io.writeFile("jobs.md", "x"));
});

// ---------------------------------------------------------------------
// isMissingError — Stage 3d review, blocking fix: duck-typed on `code`,
// so "missing is empty" (§ 5.2 rule 6) holds for whichever WorkspaceError
// class actually threw, real store included.
// ---------------------------------------------------------------------

test("isMissingError: true for apps/web's own WorkspaceError('resource_missing')", () => {
  assert.equal(isMissingError(new WorkspaceError("resource_missing", "plan.md")), true);
});

test("isMissingError: true for packages/agent's WorkspaceError('resource_missing') — the real store's own class", () => {
  assert.equal(isMissingError(new AgentWorkspaceError("resource_missing", "plan.md")), true);
});

test("isMissingError: true for any plain object shaped the same (pure duck typing)", () => {
  assert.equal(isMissingError({ code: "resource_missing" }), true);
});

test("isMissingError: false for a WorkspaceError with a different code", () => {
  assert.equal(isMissingError(new WorkspaceError("outside_workspace", "plan.md")), false);
  assert.equal(isMissingError(new AgentWorkspaceError("outside_workspace", "plan.md")), false);
});

test("isMissingError: false for a plain Error, a string, null, or undefined", () => {
  assert.equal(isMissingError(new Error("boom")), false);
  assert.equal(isMissingError("resource_missing"), false);
  assert.equal(isMissingError(null), false);
  assert.equal(isMissingError(undefined), false);
});

test("store-io: exists(p) is false on the REAL store's own WorkspaceError('resource_missing') — the exact production bug (Stage 3d review)", async () => {
  const store: WorkspaceStore = {
    list: async () => [],
    read: async () => {
      throw new AgentWorkspaceError("resource_missing", "jobs.md");
    },
    write: async () => {
      throw new Error("nope");
    },
    upload: async () => {
      throw new Error("nope");
    },
  };
  const io = storeIo(store);
  assert.equal(await io.exists("jobs.md"), false, "must read as missing (empty state), never throw");
});

test("storeIo.readFile passes text through universalNewlines: a lone-CR file reads as \\n lines", async () => {
  const io = storeIo(fakeStore({ "jobs.md": "# Pipeline\r## To Review\r### A — PM\r" }));
  assert.equal(await io.readFile("jobs.md"), "# Pipeline\n## To Review\n### A — PM\n");
});
