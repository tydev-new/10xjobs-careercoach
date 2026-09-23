// Unit tests for export/import (docs/design-web-agent.md § 2), against the
// in-memory WorkspaceStore (no network) — the byte-identical round trip on
// the REAL fixtures (tests/always-on/fixtures/apply/ + profile.md,
// criteria.md) is tested separately in workspace-export.fixtures.test.ts,
// which also runs check_files.py on the exported folder.
import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, zipSync } from "fflate";
import { createInMemoryWorkspaceStore } from "../../../../packages/agent/src/workspace/in-memory-store.ts";
import { WorkspaceImportError, exportWorkspace, importWorkspace } from "./workspace-export.ts";

test("exportWorkspace() produces a zip with one entry per file, bytes as stored", async () => {
  const store = createInMemoryWorkspaceStore({ "plan.md": "# Plan\n", "documents/notes.txt": "hi" });
  await store.upload("documents/resume.pdf", new TextEncoder().encode("%PDF-1.4 x"));
  const zip = await exportWorkspace(store);
  const entries = unzipSync(zip);
  assert.deepEqual(Object.keys(entries).sort(), ["documents/notes.txt", "documents/resume.pdf", "plan.md"]);
  assert.equal(new TextDecoder().decode(entries["plan.md"]), "# Plan\n");
  assert.equal(new TextDecoder().decode(entries["documents/notes.txt"]), "hi");
  assert.equal(new TextDecoder().decode(entries["documents/resume.pdf"]), "%PDF-1.4 x");
});

test("exportWorkspace() walks past a single list() call's depth cap by re-listing discovered subdirectories", async () => {
  const store = createInMemoryWorkspaceStore({
    "a.md": "x",
    "one/marker.md": "shallow", // depth 1 from root — discovered by the root list() call, revealing "one/"
    "one/two/three/four/deep.md": "deep", // depth 4 from root, but depth 3 (the cap) from "one" — found by re-listing "one"
  });
  const zip = await exportWorkspace(store);
  const entries = unzipSync(zip);
  assert.deepEqual(Object.keys(entries).sort(), ["a.md", "one/marker.md", "one/two/three/four/deep.md"]);
});

test("importWorkspace() into an empty store writes every entry", async () => {
  const store = createInMemoryWorkspaceStore();
  const zip = zipSync({
    "plan.md": new TextEncoder().encode("# Plan\n"),
    "documents/notes.txt": new TextEncoder().encode("hi"),
    "documents/resume.pdf": new TextEncoder().encode("%PDF-1.4 x"),
  });
  const written = await importWorkspace(store, zip);
  assert.equal(written.length, 3);
  const read = await store.read("plan.md");
  if (!read.binary) assert.equal(read.content, "# Plan\n");
  const pdf = await store.read("documents/resume.pdf");
  assert.equal(pdf.binary, true);
});

test("importWorkspace() into a NON-empty store refuses (plain Error, not WorkspaceImportError)", async () => {
  const store = createInMemoryWorkspaceStore({ "existing.md": "x" });
  const zip = zipSync({ "plan.md": new TextEncoder().encode("y") });
  await assert.rejects(importWorkspace(store, zip), (e: Error) => !(e instanceof WorkspaceImportError) && /not empty/.test(e.message));
});

test("importWorkspace() refuses the WHOLE import on one bad entry (zip-slip blocked), writing nothing", async () => {
  const store = createInMemoryWorkspaceStore();
  const zip = zipSync({
    "plan.md": new TextEncoder().encode("good"),
    "../outside.md": new TextEncoder().encode("bad"),
  });
  await assert.rejects(importWorkspace(store, zip), (e: unknown) => e instanceof WorkspaceImportError);
  const listed = await store.list();
  assert.deepEqual(listed, []); // nothing partially written
});

test("importWorkspace() refuses on an unsupported extension, writing nothing", async () => {
  const store = createInMemoryWorkspaceStore();
  const zip = zipSync({
    "plan.md": new TextEncoder().encode("good"),
    "notes.exe": new TextEncoder().encode("bad"),
  });
  await assert.rejects(importWorkspace(store, zip), (e: unknown) => e instanceof WorkspaceImportError);
  assert.deepEqual(await store.list(), []);
});

test("importWorkspace() skips a root CLAUDE.md entry (the app owns creating it separately, § 7)", async () => {
  const store = createInMemoryWorkspaceStore();
  const zip = zipSync({
    "plan.md": new TextEncoder().encode("good"),
    "CLAUDE.md": new TextEncoder().encode("guardrails"),
  });
  const written = await importWorkspace(store, zip);
  assert.deepEqual(written.map((f) => f.path), ["plan.md"]);
  await assert.rejects(store.read("CLAUDE.md"), (e: any) => e.code === "resource_missing");
});

test("import -> export round trip is byte-identical for a small synthetic workspace", async () => {
  const original: Record<string, Uint8Array> = {
    "plan.md": new TextEncoder().encode("# Plan\n\n## To do\n- write the résumé\n"),
    "criteria.md": new TextEncoder().encode("- Target: Foo\n"),
    "documents/cv.pdf": new TextEncoder().encode("%PDF-1.4 fixture bytes"),
  };
  const zipIn = zipSync(original);
  const store = createInMemoryWorkspaceStore();
  await importWorkspace(store, zipIn);
  const zipOut = await exportWorkspace(store);
  const entriesOut = unzipSync(zipOut);
  assert.deepEqual(Object.keys(entriesOut).sort(), Object.keys(original).sort());
  for (const [path, bytes] of Object.entries(original)) {
    assert.deepEqual([...entriesOut[path]], [...bytes], `${path} not byte-identical`);
  }
});
