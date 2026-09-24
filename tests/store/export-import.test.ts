// Tester-owned export/import checks (step 2 exits: "a round trip (import a
// fixture workspace -> export) is byte-identical"; "an exported fixture
// workspace works in local Claude Code with the local skills, unchanged").
// Contract: docs/design-web-agent.md § 2 "Export, import, delete (rule 9)".
// Every round trip runs on three stores: in-memory, local-folder, and
// SupabaseWorkspaceStore over the PGlite stand-in (the applied migration).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { WorkspaceStore } from "../../packages/agent/src/types.ts";
import { createInMemoryWorkspaceStore } from "../../packages/agent/src/workspace/in-memory-store.ts";
import { createLocalFolderWorkspaceStore } from "../../packages/agent/src/workspace/local-folder-store.ts";
import { createRootClaudeMd, createSupabaseWorkspaceStore } from "../../apps/web/src/backend/supabase-workspace-store.ts";
import { WorkspaceImportError, WorkspaceImportPartialError, exportWorkspace, importWorkspace } from "../../apps/web/src/backend/workspace-export.ts";
import { ANON, REPO, SUPABASE_URL, createBackend } from "./pglite-backend.ts";

const req = createRequire(path.join(REPO, "apps/web/package.json"));
const { zipSync, unzipSync } = req("fflate") as typeof import("fflate");

const enc = (s: string) => new TextEncoder().encode(s);

function readTree(dir: string, prefix = ""): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) Object.assign(out, readTree(abs, rel));
    else out[rel] = new Uint8Array(readFileSync(abs));
  }
  return out;
}

/** The named step 2 fixture, read from disk (§ 2). */
function step2Fixture(): Record<string, Uint8Array> {
  const t = readTree(path.join(REPO, "tests/always-on/fixtures/apply"));
  t["profile.md"] = new Uint8Array(readFileSync(path.join(REPO, "tests/always-on/fixtures/profile.md")));
  t["criteria.md"] = new Uint8Array(readFileSync(path.join(REPO, "tests/always-on/fixtures/criteria.md")));
  return t;
}

/** Binaries covering every byte value, and NFC unicode names. */
function extras(): Record<string, Uint8Array> {
  const all = new Uint8Array(4096);
  for (let i = 0; i < all.length; i++) all[i] = (i * 131 + 7) & 0xff;
  return {
    "documents/Lebenslauf-M\u00fcller.pdf": new Uint8Array([...enc("%PDF-1.7\n"), ...all]),
    "documents/r\u00e9sum\u00e9 (final).docx": new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...all.slice(0, 1000)]),
    "notes/caf\u00e9-\u65e5\u672c\u8a9e-\u{1F600}.md": enc("# Caf\u00e9 \u65e5\u672c\u8a9e \u{1F600}\n\nna\u00efve \u2014 \u201cquotes\u201d\n"),
    "applications/acme/resume.html": enc("<!doctype html><meta charset=utf-8><p>R\u00e9sum\u00e9</p>\n"),
    "applications/acme/meta.json": enc('{"a": "\u00e9", "n": 1}\n'),
    "jd-inbox/crlf.txt": enc("line one\r\nline two\r\n"),
    "notes/empty.md": new Uint8Array(),
  };
}

type Maker = { label: string; make: () => Promise<WorkspaceStore> };
const makers: Maker[] = [
  { label: "in-memory", make: async () => createInMemoryWorkspaceStore() },
  { label: "local-folder", make: async () => createLocalFolderWorkspaceStore(mkdtempSync(path.join(tmpdir(), "tester-lf-"))) },
  {
    label: "supabase(PGlite)",
    make: async () => {
      const be = await createBackend();
      const uid = await be.newUser({ member: true });
      return createSupabaseWorkspaceStore({ url: SUPABASE_URL, anonKey: ANON, userId: uid, accessToken: async () => `jwt:${uid}`, fetchImpl: be.fetchImpl });
    },
  },
];

function assertSameTree(out: Record<string, Uint8Array>, want: Record<string, Uint8Array>, label: string) {
  assert.deepEqual(Object.keys(out).sort(), Object.keys(want).sort(), `${label}: entry set differs`);
  for (const [k, v] of Object.entries(want)) {
    assert.ok(Buffer.from(out[k]).equals(Buffer.from(v)), `${label}: ${k} is not byte-identical`);
  }
}

// ---------------------------------------------------------------- round trip

for (const m of makers) {
  test(`R1 [${m.label}] fixture + unicode names + binaries: import -> export is byte-identical`, async () => {
    const want = { ...step2Fixture(), ...extras() };
    const store = await m.make();
    await importWorkspace(store, zipSync(want));
    const out = unzipSync(await exportWorkspace(store));
    assertSameTree(out, want, m.label);
    // and export -> import -> export is stable
    const store2 = await m.make();
    await importWorkspace(store2, await exportWorkspace(store));
    assertSameTree(unzipSync(await exportWorkspace(store2)), want, `${m.label} (second hop)`);
  });
}

test("R2 SPEC: a UTF-8 BOM at the start of a .md survives the round trip (byte-identical)", async () => {
  const want = { "notes/bom.md": new Uint8Array([0xef, 0xbb, 0xbf, ...enc("# Notes\n")]) };
  const store = createInMemoryWorkspaceStore();
  await importWorkspace(store, zipSync(want));
  assertSameTree(unzipSync(await exportWorkspace(store)), want, "BOM");
});

test("R3 SPEC: a .txt that is not valid UTF-8 is refused, not silently rewritten", async () => {
  const bad = new Uint8Array([...enc("caf"), 0xe9, ...enc(" latin-1\n")]);
  const store = createInMemoryWorkspaceStore();
  let refused = false;
  try {
    await importWorkspace(store, zipSync({ "notes/latin1.txt": bad }));
  } catch {
    refused = true;
  }
  if (!refused) {
    const out = unzipSync(await exportWorkspace(store));
    assert.ok(Buffer.from(out["notes/latin1.txt"]).equals(Buffer.from(bad)), `silently rewritten: ${JSON.stringify([...out["notes/latin1.txt"]])}`);
  }
});

// ---------------------------------------------------------------- refusals

test("I1 import refuses a non-empty workspace (every backend) and writes nothing", async () => {
  for (const m of makers) {
    const store = await m.make();
    await store.write("existing.md", "x", null);
    await assert.rejects(importWorkspace(store, zipSync({ "new.md": enc("y") })), /not empty/, m.label);
    assert.deepEqual((await store.list()).map((f) => f.path), ["existing.md"], m.label);
  }
});

const BAD_ENTRIES: [string, Uint8Array, string][] = [
  ["../evil.md", enc("x"), "zip-slip ../"],
  ["a/../../evil.md", enc("x"), "zip-slip nested ../"],
  ["..\\evil.md", enc("x"), "zip-slip backslash"],
  ["/etc/evil.md", enc("x"), "absolute"],
  ["C:/evil.md", enc("x"), "drive-absolute"],
  [".hidden.md", enc("x"), "hidden file"],
  ["a/.git/config.md", enc("x"), "hidden segment"],
  ["skills/apply/SKILL.md", enc("x"), "skills/"],
  ["Skills/x.md", enc("x"), "Skills/ (case)"],
  ["notes/CLAUDE.md", enc("x"), "nested CLAUDE.md"],
  ["notes/claude.md", enc("x"), "nested claude.md"],
  ["notes/a\u200Bb.md", enc("x"), "zero-width"],
  ["notes/a\u202Eb.md", enc("x"), "RTL override"],
  ["notes/a\u0001b.md", enc("x"), "control char"],
  ["notes/a\u0085b.md", enc("x"), "C1 control (U+0085 NEL)"],
  ["n/" + "a".repeat(510) + ".md", enc("x"), "> 512 chars"],
  ["tool.exe", enc("MZ"), "unsupported type"],
  ["big.md", new Uint8Array(2 * 1024 * 1024 + 1).fill(0x61), "text > 2 MB"],
  ["documents/big.pdf", new Uint8Array(10 * 1024 * 1024 + 1).fill(0x25), "binary > 10 MB"],
  ["documents/empty.pdf", new Uint8Array(), "empty binary"],
  ["plan.md/child.md", enc("x"), "file/folder clash with plan.md"],
];

for (const m of makers) {
  test(`I2 [${m.label}] one bad entry refuses the WHOLE import: nothing written, for every bad-entry kind`, async () => {
    const partial: string[] = [];
    const accepted: string[] = [];
    for (const [name, bytes, why] of BAD_ENTRIES) {
      if (m.label === "local-folder" && name.length > 255) continue; // a local disk can't hold a 510-char segment anyway
      const store = await m.make();
      let threw = false;
      try {
        // good entries FIRST, so a partial import is visible
        await importWorkspace(store, zipSync({ "plan.md": enc("# plan\n"), "documents/cv.pdf": enc("%PDF ok"), [name]: bytes }));
      } catch {
        threw = true;
      }
      const left = (await store.list()).map((f) => f.path);
      if (!threw) accepted.push(why);
      else if (left.length) partial.push(`${why} -> left ${JSON.stringify(left)}`);
    }
    assert.deepEqual({ accepted, partial }, { accepted: [], partial: [] });
  });
}

test("I3 over the 50-object cap: the import is refused whole, not half-written (Supabase)", async () => {
  const want: Record<string, Uint8Array> = { "plan.md": enc("x") };
  for (let i = 0; i < 51; i++) want[`documents/d${String(i).padStart(2, "0")}.pdf`] = enc(`%PDF ${i}`);
  const store = await makers[2].make();
  let threw = false;
  try {
    await importWorkspace(store, zipSync(want));
  } catch {
    threw = true;
  }
  const left = (await store.list()).length;
  assert.ok(threw, "import of 51 objects resolved");
  assert.equal(left, 0, `half-written: ${left} files left after a refused import`);
});

test("I4 zip bomb: a small zip that inflates to 400 MB is refused by a cap BEFORE inflating (peak RSS stays low)", () => {
  // Run in a child so its peak RSS is its own. The zip is ~400 KB.
  const dir = mkdtempSync(path.join(tmpdir(), "tester-bomb-"));
  const zipPath = path.join(dir, "bomb.zip");
  const script = path.join(dir, "bomb.mts");
  try {
    const bomb = zipSync({ "plan.md": enc("x"), "notes/bomb.md": new Uint8Array(400 * 1024 * 1024).fill(0x61) }, { level: 9 });
    writeFileSync(zipPath, bomb);
    writeFileSync(
      script,
      `import { readFileSync } from "node:fs";
import { importWorkspace } from ${JSON.stringify(path.join(REPO, "apps/web/src/backend/workspace-export.ts"))};
import { createInMemoryWorkspaceStore } from ${JSON.stringify(path.join(REPO, "packages/agent/src/workspace/in-memory-store.ts"))};
const store = createInMemoryWorkspaceStore();
let outcome = "resolved";
const t = Date.now();
try { await importWorkspace(store, new Uint8Array(readFileSync(${JSON.stringify(zipPath)}))); } catch (e) { outcome = "refused: " + String(e.message).slice(0, 80); }
const left = (await store.list()).map((f) => f.path);
console.log(JSON.stringify({ outcome, left, ms: Date.now() - t, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) }));`,
    );
    const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
    const r = JSON.parse(out.trim().split("\n").at(-1)!);
    console.log(`zip bomb (${bomb.byteLength} bytes zipped): ${JSON.stringify(r)}`);
    assert.match(r.outcome, /^refused/, "a 400 MB entry was accepted");
    assert.deepEqual(r.left, [], "partial import");
    assert.ok(r.maxRssMB < 250, `inflated before refusing: peak RSS ${r.maxRssMB} MB`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("I5 a workspace holding only the app's root CLAUDE.md (§ 7: created 'at first run or import') can still take an import", async () => {
  const be = await createBackend();
  const uid = await be.newUser({ member: true });
  const opts = { url: SUPABASE_URL, anonKey: ANON, userId: uid, accessToken: async () => `jwt:${uid}`, fetchImpl: be.fetchImpl };
  await createRootClaudeMd(opts, "# Ten guardrails\n");
  const store = createSupabaseWorkspaceStore(opts);
  await importWorkspace(store, zipSync({ "plan.md": enc("x") }));
});

// ---------------------------------------------------------------- local Claude Code parity (lead's accepted proof)

function checkFiles(dir: string): { code: number; out: string } {
  try {
    const out = execFileSync("python3", [path.join(REPO, "skills/profile/scripts/check_files.py"), "--workspace", dir, "--skills", path.join(REPO, "skills")], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    const x = e as { status: number; stdout: string };
    return { code: x.status, out: x.stdout };
  }
}
function writeTree(dir: string, t: Record<string, Uint8Array>) {
  for (const [k, v] of Object.entries(t)) {
    mkdirSync(path.dirname(path.join(dir, k)), { recursive: true });
    writeFileSync(path.join(dir, k), v);
  }
}

test("P1 exported via the SUPABASE store: check_files.py output on the export == on the raw fixture (zero new failures)", async () => {
  const want = step2Fixture();
  const store = await makers[2].make();
  await importWorkspace(store, zipSync(want));
  const out = unzipSync(await exportWorkspace(store));
  const raw = mkdtempSync(path.join(tmpdir(), "tester-raw-"));
  const exp = mkdtempSync(path.join(tmpdir(), "tester-exp-"));
  try {
    writeTree(raw, want);
    writeTree(exp, out);
    const a = checkFiles(raw);
    const b = checkFiles(exp);
    console.log(`check_files raw exit=${a.code} export exit=${b.code}; raw FAIL lines=${(a.out.match(/FAIL/g) ?? []).length}`);
    assert.equal(b.code, a.code);
    assert.equal(b.out.replaceAll(exp, "<ws>"), a.out.replaceAll(raw, "<ws>"));
  } finally {
    rmSync(raw, { recursive: true, force: true });
    rmSync(exp, { recursive: true, force: true });
  }
});

test("P2 a schema-conformant workspace (from skills/profile/references/schema.md) passes check_files.py after a SUPABASE round trip", async () => {
  const conformant: Record<string, Uint8Array> = {
    "profile.md": enc(
      "# Profile\n\n## Snapshot\n- Analytics engineer, 6 years\n\n## Experience\n- Nimbus: dbt\n\n## Intake findings\n\n### Positioning strengths\n- x\n\n### Likely interviewer concerns\n- x\n\n### Career-narrative gaps\n- x\n\n### Story seeds\n- x\n\n## Interview history\n\n## Constraints\n\n## Application defaults\n\n",
    ),
    "criteria.md": enc("# Criteria\n\n## Targets\n- x\n\n## Level\n- x\n\n## Geo\n- x\n\n## Compensation\n- x\n\n## Dealbreakers\n- x\n\n## Target companies\n- x\n\n## Retired\n\n"),
    "documents/cv.pdf": enc("%PDF-1.4 x"),
  };
  const store = await makers[2].make();
  await importWorkspace(store, zipSync(conformant));
  const dir = mkdtempSync(path.join(tmpdir(), "tester-conf-"));
  try {
    writeTree(dir, unzipSync(await exportWorkspace(store)));
    const r = checkFiles(dir);
    assert.equal(r.code, 0, r.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- fix round 1 additions

for (const m of makers) {
  test(`I2b [${m.label}] an NFD entry name is accepted and stored as NFC (lead's M3 ruling)`, async () => {
    const store = await m.make();
    await importWorkspace(store, zipSync({ "notes/café.md": enc("x"), "documents/résumé.pdf": enc("%PDF x") }));
    const paths = (await store.list()).map((f) => f.path).sort();
    assert.deepEqual(paths, ["documents/résumé.pdf", "notes/café.md"]);
    for (const p of paths) assert.equal(p, p.normalize("NFC"));
    const out = Object.keys(unzipSync(await exportWorkspace(store))).sort();
    assert.deepEqual(out, ["documents/résumé.pdf", "notes/café.md"], "export entry names are NFC");
  });
}

/** Rewrites the declared uncompressed size of `name` in both the local
 *  header and the central directory of a fflate-built zip (no zip64). */
function lieAboutSize(zip: Uint8Array, name: string, declared: number): Uint8Array {
  const z = zip.slice();
  const dv = new DataView(z.buffer);
  const nameBytes = enc(name);
  let hits = 0;
  for (let i = 0; i + 4 < z.length; i++) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x04034b50 || sig === 0x02014b50) {
      const central = sig === 0x02014b50;
      const nlen = dv.getUint16(i + (central ? 28 : 26), true);
      const nstart = i + (central ? 46 : 30);
      if (nlen === nameBytes.length && Buffer.from(z.subarray(nstart, nstart + nlen)).equals(Buffer.from(nameBytes))) {
        dv.setUint32(i + (central ? 24 : 22), declared, true);
        hits++;
      }
    }
  }
  assert.equal(hits, 2, "patched local + central header");
  return z;
}

test("I6 a STORED entry that under-declares its size (3 MB declared as 10 bytes) is refused whole, nothing written", async () => {
  for (const m of makers) {
    const zip = lieAboutSize(zipSync({ "plan.md": enc("# plan\n"), "notes/big.md": new Uint8Array(3 * 1024 * 1024).fill(0x61) }, { level: 0 }), "notes/big.md", 10);
    const store = await m.make();
    let err: unknown = null;
    try {
      await importWorkspace(store, zip);
    } catch (e) {
      err = e;
    }
    const left = (await store.list()).map((f) => f.path);
    assert.ok(err, `${m.label}: resolved`);
    assert.deepEqual(left, [], `${m.label}: partial import (${(err as Error)?.name}): ${JSON.stringify(left)}`);
  }
});

// FIXED (fix round 2, M-new-2/I7): the second import pass verifies each
// entry's CRC32 against the central directory's own declared value, which
// catches exactly this case (a DEFLATEd entry silently truncated to a
// forged declared size).
test("I7 a DEFLATED entry that under-declares its size is refused (not silently truncated to the declared size)", async () => {
  const real = new Uint8Array(3 * 1024 * 1024).fill(0x61);
  const zip = lieAboutSize(zipSync({ "plan.md": enc("# plan\n"), "notes/big.md": real }, { level: 9 }), "notes/big.md", 100);
  const store = createInMemoryWorkspaceStore();
  let outcome = "resolved";
  try {
    await importWorkspace(store, zip);
  } catch (e) {
    outcome = `refused: ${(e as Error).name}`;
  }
  if (outcome === "resolved") {
    const r = await store.read("notes/big.md");
    assert.fail(`imported with ${r.size} of ${real.byteLength} bytes (silently truncated)`);
  }
});

test("I8 a CLAUDE.md entry in the zip is skipped with a note, and the app's own root CLAUDE.md is untouched (Supabase)", async () => {
  const be = await createBackend();
  const uid = await be.newUser({ member: true });
  const opts = { url: SUPABASE_URL, anonKey: ANON, userId: uid, accessToken: async () => `jwt:${uid}`, fetchImpl: be.fetchImpl };
  await createRootClaudeMd(opts, "# Ten guardrails\n");
  const store = createSupabaseWorkspaceStore(opts);
  const res = await importWorkspace(store, zipSync({ "CLAUDE.md": enc("# hostile\n"), "plan.md": enc("x") }));
  assert.equal(res.notes.length, 1, JSON.stringify(res.notes));
  const r = await store.read("CLAUDE.md");
  assert.ok(!r.binary && r.content === "# Ten guardrails\n");
  assert.deepEqual((await store.list()).map((f) => f.path).sort(), ["CLAUDE.md", "plan.md"]);
});

// FIXED (fix round 2, I9): the pre-check now seeds the existing root
// CLAUDE.md as an already-claimed path before validating the zip, so a
// clash with it is a WorkspaceImportError up front, not a
// WorkspaceImportPartialError mid-write.
test("I9 entries that clash with the app's existing root CLAUDE.md (CLAUDE.md/x.md, claude.md) refuse the whole import, nothing written (Supabase)", async () => {
  const obs: string[] = [];
  for (const bad of ["CLAUDE.md/x.md", "claude.md", "Claude.md"]) {
    const be = await createBackend();
    const uid = await be.newUser({ member: true });
    const opts = { url: SUPABASE_URL, anonKey: ANON, userId: uid, accessToken: async () => `jwt:${uid}`, fetchImpl: be.fetchImpl };
    await createRootClaudeMd(opts, "# g\n");
    const store = createSupabaseWorkspaceStore(opts);
    let name = "resolved";
    try {
      await importWorkspace(store, zipSync({ "plan.md": enc("x"), [bad]: enc("y") }));
    } catch (e) {
      name = (e as Error).name;
    }
    const left = (await store.list()).map((f) => f.path).filter((p) => p !== "CLAUDE.md");
    if (name !== "WorkspaceImportError" || left.length) obs.push(`${bad}: ${name}, left ${JSON.stringify(left)}`);
  }
  assert.deepEqual(obs, []);
});

test("I10 a genuine mid-import server surprise is a WorkspaceImportPartialError carrying exactly what was written", async () => {
  const inner = createInMemoryWorkspaceStore();
  let n = 0;
  const flaky = { ...inner, write: async (p: string, c: string, v: string | null) => (++n === 2 ? Promise.reject(new Error("503")) : inner.write(p, c, v)) };
  let err: unknown;
  try {
    await importWorkspace(flaky, zipSync({ "a.md": enc("1"), "b.md": enc("2"), "c.md": enc("3") }));
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof WorkspaceImportPartialError, String(err));
  const written = (err as WorkspaceImportPartialError).written.map((f) => f.path);
  assert.deepEqual(written, (await inner.list()).map((f) => f.path));
  assert.equal(written.length, 1);
  void WorkspaceImportError;
});
