// ONE shared store test suite (§ 2's "Proved by"), run against both the
// in-memory and local-folder backends. Each backend gets a fresh store per
// test via `makeStore(seed)`.
import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceStore } from "../src/types.ts";

export function runWorkspaceStoreSuite(
  label: string,
  makeStore: (seed?: Record<string, string>) => Promise<WorkspaceStore> | WorkspaceStore,
) {
  test(`[${label}] list/read a seeded file`, async () => {
    const store = await makeStore({ "plan.md": "Goal: x\n" });
    const listed = await store.list();
    assert.ok(listed.some((f) => f.path === "plan.md"));
    const read = await store.read("plan.md");
    assert.equal(read.binary, false);
    if (!read.binary) assert.equal(read.content, "Goal: x\n");
    assert.equal(read.editable, true);
    assert.ok(read.version);
  });

  test(`[${label}] write with expectedVersion=null creates a new file`, async () => {
    const store = await makeStore();
    const info = await store.write("notes.md", "hello", null);
    assert.equal(info.path, "notes.md");
    const read = await store.read("notes.md");
    if (!read.binary) assert.equal(read.content, "hello");
  });

  test(`[${label}] create-write on an existing path fails already_exists`, async () => {
    const store = await makeStore({ "notes.md": "x" });
    await assert.rejects(store.write("notes.md", "y", null), (err: any) => err.code === "already_exists");
  });

  test(`[${label}] a stale expectedVersion is rejected with version_conflict`, async () => {
    const store = await makeStore({ "notes.md": "x" });
    const before = await store.read("notes.md");
    await store.write("notes.md", "y", before.version); // advances the version
    await assert.rejects(
      store.write("notes.md", "z", before.version), // stale now
      (err: any) => err.code === "version_conflict",
    );
  });

  test(`[${label}] writing with the current version succeeds and advances it`, async () => {
    const store = await makeStore({ "notes.md": "x" });
    const before = await store.read("notes.md");
    const after = await store.write("notes.md", "y", before.version);
    assert.notEqual(after.version, before.version);
    const read = await store.read("notes.md");
    if (!read.binary) assert.equal(read.content, "y");
  });

  test(`[${label}] writing a path that has never been seen (no version, non-null expected) fails resource_missing`, async () => {
    const store = await makeStore();
    await assert.rejects(
      store.write("nope.md", "y", "1"),
      (err: any) => err.code === "resource_missing",
    );
  });

  test(`[${label}] reading a missing file fails resource_missing`, async () => {
    const store = await makeStore();
    await assert.rejects(store.read("missing.md"), (err: any) => err.code === "resource_missing");
  });

  test(`[${label}] path rules: no .., no dotfile segment, no absolute path`, async () => {
    const store = await makeStore({ "plan.md": "x" });
    for (const bad of ["../outside.md", "a/../../etc/passwd", ".hidden.md", "a/.git/config", "/etc/passwd"]) {
      await assert.rejects(store.read(bad), (err: any) => err.code === "invalid_ref" || err.code === "outside_workspace", bad);
    }
  });

  test(`[${label}] CLAUDE.md at the root is not writable by the agent`, async () => {
    const store = await makeStore({ "CLAUDE.md": "guardrails" });
    await assert.rejects(
      store.write("CLAUDE.md", "hacked", (await store.read("CLAUDE.md")).version),
      (err: any) => err.code === "not_editable",
    );
  });

  test(`[${label}] skills/ is not writable by the agent`, async () => {
    const store = await makeStore({ "skills/apply/SKILL.md": "# apply" });
    await assert.rejects(
      store.write("skills/apply/SKILL.md", "hacked", (await store.read("skills/apply/SKILL.md")).version),
      (err: any) => err.code === "not_editable",
    );
    // also refuses a brand-new file under skills/
    await assert.rejects(
      store.write("skills/new.md", "x", null),
      (err: any) => err.code === "not_editable",
    );
  });

  test(`[${label}] .pdf/.docx are not editable via write()`, async () => {
    const store = await makeStore();
    await assert.rejects(store.write("documents/resume.pdf", "not text", null), (err: any) => err.code === "not_editable");
  });

  test(`[${label}] upload() accepts .pdf/.docx, create-only`, async () => {
    const store = await makeStore();
    const bytes = new TextEncoder().encode("%PDF-1.4 fixture");
    const info = await store.upload("documents/resume.pdf", bytes);
    assert.equal(info.path, "documents/resume.pdf");
    const read = await store.read("documents/resume.pdf");
    assert.equal(read.binary, true);
    await assert.rejects(store.upload("documents/resume.pdf", bytes), (err: any) => err.code === "already_exists");
  });

  test(`[${label}] upload() refuses a non-upload extension`, async () => {
    const store = await makeStore();
    await assert.rejects(
      store.upload("documents/resume.md", new TextEncoder().encode("x")),
      (err: any) => err.code === "unsupported_type",
    );
  });

  test(`[${label}] list() is recursive with depth <= 3`, async () => {
    const store = await makeStore({
      "a.md": "x",
      "documents/b.md": "x",
      "applications/c/d.md": "x",
      "one/two/three/four/deep.md": "x", // depth 4 from root, out of range
    });
    const listed = await store.list();
    const paths = listed.map((f) => f.path);
    assert.ok(paths.includes("a.md"));
    assert.ok(paths.includes("documents/b.md"));
    assert.ok(paths.includes("applications/c/d.md"));
    assert.ok(!paths.includes("one/two/three/four/deep.md"));
  });
}
