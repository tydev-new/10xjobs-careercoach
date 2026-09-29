// store-io.ts — the read-only io adapter over WorkspaceStore
// (design-web-ui.md § 5.3 Jobs "Reads", reused by Home's pipeline
// counts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceError, type WorkspaceStore } from "../types.ts";
import { storeIo } from "./store-io.ts";

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
