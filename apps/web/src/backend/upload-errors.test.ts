import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceError, type WorkspaceStore } from "../../../../packages/agent/src/types.ts";
import { classifyGenericStorageError, uploadErrorMessage, uploadWithClashRenumber } from "./upload-errors.ts";

function storeThatAlwaysThrows(err: unknown): WorkspaceStore {
  return {
    list: async () => [],
    read: async () => {
      throw new Error("not implemented");
    },
    write: async () => {
      throw new Error("not implemented");
    },
    upload: async () => {
      throw err;
    },
  };
}

test("uploadWithClashRenumber: first attempt succeeds writes documents/<name> unchanged", async () => {
  const calls: string[] = [];
  const store: WorkspaceStore = {
    list: async () => [],
    read: async () => {
      throw new Error("nope");
    },
    write: async () => {
      throw new Error("nope");
    },
    upload: async (path) => {
      calls.push(path);
      return { path, version: "v1", size: 3, updatedAt: "now", editable: false };
    },
  };
  const out = await uploadWithClashRenumber(store, "resume.pdf", new Uint8Array([1, 2, 3]));
  assert.equal(out.ok, true);
  assert.equal(out.path, "documents/resume.pdf");
  assert.deepEqual(calls, ["documents/resume.pdf"]);
});

test("uploadWithClashRenumber: a clash (already_exists) retries as -2, then -3", async () => {
  const calls: string[] = [];
  const store: WorkspaceStore = {
    list: async () => [],
    read: async () => {
      throw new Error("nope");
    },
    write: async () => {
      throw new Error("nope");
    },
    upload: async (path) => {
      calls.push(path);
      if (calls.length < 3) throw new WorkspaceError("already_exists", "clash");
      return { path, version: "v1", size: 3, updatedAt: "now", editable: false };
    },
  };
  const out = await uploadWithClashRenumber(store, "resume.pdf", new Uint8Array([1]));
  assert.equal(out.ok, true);
  assert.equal(out.path, "documents/resume-3.pdf");
  assert.deepEqual(calls, ["documents/resume.pdf", "documents/resume-2.pdf", "documents/resume-3.pdf"]);
});

test("uploadWithClashRenumber: exhausting maxAttempts on repeated clashes still fails with a plain message", async () => {
  const store = storeThatAlwaysThrows(new WorkspaceError("already_exists", "clash"));
  const out = await uploadWithClashRenumber(store, "resume.pdf", new Uint8Array([1]), 3);
  assert.equal(out.ok, false);
  assert.match(out.message!, /already exists/);
});

test("uploadWithClashRenumber: a non-clash refusal never retries", async () => {
  const calls: string[] = [];
  const store: WorkspaceStore = {
    list: async () => [],
    read: async () => {
      throw new Error("nope");
    },
    write: async () => {
      throw new Error("nope");
    },
    upload: async (path) => {
      calls.push(path);
      throw new WorkspaceError("unsupported_type", "nope");
    },
  };
  const out = await uploadWithClashRenumber(store, "resume.exe", new Uint8Array([1]));
  assert.equal(out.ok, false);
  assert.equal(calls.length, 1);
  assert.match(out.message!, /isn't a file type Ten can use yet/);
});

test("uploadErrorMessage: every § 2 WorkspaceError code has a plain, candidate-facing message", () => {
  const cases: [WorkspaceError["code"], RegExp][] = [
    ["unsupported_type", /file type/],
    ["upload_too_large", /10 MB/],
    ["not_a_member", /private beta/],
    ["path_conflict", /clashes with an existing file/],
    ["workspace_full", /file limit/],
  ];
  for (const [code, re] of cases) {
    const msg = uploadErrorMessage("resume.pdf", new WorkspaceError(code, "raw"));
    assert.match(msg, re, `code=${code}`);
    assert.doesNotMatch(msg, /WorkspaceError|raw|\[object/);
  }
});

test("classifyGenericStorageError: maps the documented Storage HTTP statuses to plain text", () => {
  assert.match(classifyGenericStorageError("r.pdf", "upload failed: HTTP 403 {}")!, /private beta/);
  assert.match(classifyGenericStorageError("r.pdf", "upload failed: HTTP 413 {}")!, /10 MB/);
  assert.match(classifyGenericStorageError("r.pdf", "upload failed: HTTP 400 {}")!, /couldn't be uploaded/);
  assert.equal(classifyGenericStorageError("r.pdf", "upload failed: HTTP 500 {}"), null);
});

test("uploadErrorMessage: an unrecognized plain Error still gets a safe fallback, never the raw text", () => {
  const msg = uploadErrorMessage("resume.pdf", new Error("some internal detail nobody should see"));
  assert.equal(msg, "Couldn't upload resume.pdf. Try again.");
});
