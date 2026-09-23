// Mirrors tests/test_check_files.py against the JS port's pure/io-injected
// functions. Schema-loading tests that read the real skills/ tree use
// io-node against the repo's actual skills/ directory (this test file is
// Node-only by nature — a dev-time test, not the ported runtime logic);
// isolated-scenario tests use the in-memory fake io.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as cf from "../../src/check-files.mjs";
import { nodeIo } from "../../src/io-node.mjs";
import { makeFakeIo } from "./fake-io.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const SKILLS = REPO_ROOT + "skills";

const FULL_PROFILE = `# P
## Snapshot
## Experience
## Intake findings
### Positioning strengths
### Likely interviewer concerns
### Career-narrative gaps
### Story seeds
## Interview history
## Constraints
## Application defaults
`;
const TIER1 = "| date | round | driver | scored vs FIXED | what changed |";

// --skills points at the REAL repo skills/ tree for these CLI-level tests
// (matching how test_check_files.py's `run()` always passes the repo's real
// skills dir); --workspace's files come from the fake, in-memory map. This
// hybrid delegates by path prefix so one io serves both.
function makeHybridIo(fakeFiles) {
  const fake = makeFakeIo(fakeFiles);
  const isFake = (p) => p.startsWith("/ws");
  return {
    exists: (p) => (isFake(p) ? fake.exists(p) : nodeIo.exists(p)),
    readFile: (p) => (isFake(p) ? fake.readFile(p) : nodeIo.readFile(p)),
    writeFile: (p, c) => (isFake(p) ? fake.writeFile(p, c) : nodeIo.writeFile(p, c)),
    mtimeMs: (p) => (isFake(p) ? fake.mtimeMs(p) : nodeIo.mtimeMs(p)),
    isDir: (p) => (isFake(p) ? fake.isDir(p) : nodeIo.isDir(p)),
    readdir: (p) => (isFake(p) ? fake.readdir(p) : nodeIo.readdir(p)),
  };
}

async function runCli(files) {
  const io = makeHybridIo(files);
  return cf.run(["--workspace", "/ws", "--skills", SKILLS], io);
}

test("a conforming profile.md passes", async () => {
  const r = await runCli({ "/ws/profile.md": FULL_PROFILE });
  assert.equal(r.exitCode, 0, r.stdout);
});

test("a missing required section FAILs", async () => {
  const r = await runCli({ "/ws/profile.md": "# P\n## Snapshot\n" });
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /missing required section/);
});

test("a foreign section FAILs with its owner named (the cross-contamination class)", async () => {
  const r = await runCli({
    "/ws/criteria.md": `# C
## Targets
## Level
## Geo
## Compensation
## Dealbreakers
## Target companies
## Retired
## Interview history
`,
  });
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /belongs to profile\.md/);
});

test("an unknown section only WARNs", async () => {
  const r = await runCli({ "/ws/profile.md": FULL_PROFILE + "## Wildcard\n" });
  assert.equal(r.exitCode, 0, r.stdout);
  assert.match(r.stdout, /WARN/);
  assert.match(r.stdout, /Wildcard/);
});

test("the escape hatch's contents are not policed", async () => {
  const r = await runCli({ "/ws/profile.md": FULL_PROFILE + "## Other notes\n### Anything At All\n" });
  assert.equal(r.exitCode, 0, r.stdout);
  assert.ok(!r.stdout.includes("Anything At All"));
});

test("singular/plural folds — 'Target' resolves to criteria's 'Targets'", async () => {
  const r = await runCli({ "/ws/profile.md": FULL_PROFILE + "## Target\n" });
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /belongs to criteria\.md/);
});

test("an absent file is not an error", async () => {
  const r = await runCli({});
  assert.equal(r.exitCode, 0, r.stdout);
});

test("a prose mention in another skill cannot clobber a schema", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  assert.ok("criteria.md" in schemas);
  assert.ok(schemas["criteria.md"].sections.length >= 7);
});

test("storybank.md schema is registered and enforced", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  assert.ok("storybank.md" in schemas);
  assert.equal(schemas["storybank.md"].owner, "storybank");
  const ok = "# Storybank\n\n## Coverage\n\n- FDE org design [source: jd-analysis]\n\n## Stories\n\n| ID | Title |\n|---|---|\n";
  let r = await runCli({ "/ws/storybank.md": ok });
  assert.equal(r.exitCode, 0, r.stdout);
  const missingCoverage = "# Storybank\n\n## Stories\n\n| ID | Title |\n|---|---|\n";
  r = await runCli({ "/ws/storybank.md": missingCoverage });
  assert.equal(r.exitCode, 1);
  assert.match(r.stdout, /Coverage/);
});

test("pitch.md schema is registered with the right required sections", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  assert.ok("pitch.md" in schemas);
  assert.equal(schemas["pitch.md"].owner, "profile");
  const required = new Set(schemas["pitch.md"].sections.filter((s) => !s.optional).map((s) => s.name));
  for (const n of ["Core statement", "Variants", "Messages rubric"]) assert.ok(required.has(n));
  const all = new Set(schemas["pitch.md"].sections.map((s) => s.name));
  assert.ok(!all.has("Version history"), "history lives in pitch-history.md now");
  assert.ok(all.has("Other notes"));
  assert.ok("pitch-brief.md" in schemas);
});

test("knowledge.md schema is registered", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  assert.ok("knowledge.md" in schemas);
  assert.equal(schemas["knowledge.md"].owner, "learn");
  const required = new Set(schemas["knowledge.md"].sections.filter((s) => !s.optional).map((s) => s.name));
  assert.ok(required.has("Map") && required.has("Assessment log"));
});

test("brief schemas are registered with FIXED + LIVING", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  for (const f of ["base-resume-brief.md", "pitch-brief.md"]) {
    assert.ok(f in schemas, f);
    const names = new Set(schemas[f].sections.map((s) => s.name));
    assert.ok(names.has("FIXED") && names.has("LIVING"));
  }
});

test("a brief missing LIVING FAILs", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  const io = makeFakeIo({ "/ws/pitch-brief.md": "# Brief\n\n## FIXED\n- x\n" });
  const res = await cf.checkFile(io, "/ws/pitch-brief.md", schemas["pitch-brief.md"], schemas, "pitch-brief.md");
  assert.ok(res.some(([lvl, m]) => lvl === "FAIL" && m.includes("LIVING")));
});

test("history header is enforced (missing, then a malformed append)", async () => {
  const io = makeFakeIo({ "/ws/pitch-history.md": "# H\n\n| date | round | notes |\n|---|---|---|\n| a | b | c |\n" });
  let res = await cf.checkHistory(io, "/ws/pitch-history.md", TIER1);
  assert.ok(res.some(([lvl, m]) => lvl === "FAIL" && m.includes("header")));

  await io.writeFile("/ws/pitch-history.md", "# H\n\n" + TIER1 + "\n|---|---|---|---|---|\n| a | b | c | d | e |\n");
  assert.deepEqual(await cf.checkHistory(io, "/ws/pitch-history.md", TIER1), []);

  const prev = await io.readFile("/ws/pitch-history.md");
  await io.writeFile("/ws/pitch-history.md", prev + "| a | b | c | d |\n");
  res = await cf.checkHistory(io, "/ws/pitch-history.md", TIER1);
  assert.ok(res.some(([lvl, m]) => lvl === "FAIL" && m.includes("cells")));
});

test("the heading-form schema declaration parses (references/schema.md)", async () => {
  const io = makeFakeIo({
    "/root/x/SKILL.md": "# x\n",
    "/root/x/references/schema.md":
      "# Shapes\n\n" +
      "## `alpha.md` — a thing *(free-form body)*\n\n" +
      "- `## Keep` — required\n\n" +
      "Prose after the bullets ends the block harmlessly.\n\n" +
      "## `beta.md` — another\n\n" +
      "- `## Only` \n",
  });
  const s = await cf.loadSchemas(io, "/root");
  assert.deepEqual(new Set(Object.keys(s)), new Set(["alpha.md", "beta.md"]));
  assert.equal(s["alpha.md"].freeform, true);
  assert.deepEqual(s["beta.md"].sections.map((x) => x.name), ["Only"]);
});

test("storybank-history.md uses its own header (per-story, not per-driver)", async () => {
  const sb = cf.HISTORY_HEADERS["storybank-history.md"];
  assert.notEqual(sb, cf.HISTORY_HEADERS["base-resume-history.md"]);
  const io = makeFakeIo({
    "/ws/storybank-history.md": "# H\n\n" + sb + "\n|---|---|---|---|---|\n| 2026-08-20 | S001 | 1 | added stakes | 3 |\n",
  });
  assert.deepEqual(await cf.checkHistory(io, "/ws/storybank-history.md", sb), []);
  assert.ok((await cf.checkHistory(io, "/ws/storybank-history.md", cf.HISTORY_HEADERS["base-resume-history.md"])).length);
});

test("history headers stay in sync with the owning skill's own prose (loud-fail duplicate)", async () => {
  for (const [skill, hist] of [
    ["profile", "base-resume-history.md"],
    ["profile", "pitch-history.md"],
    ["storybank", "storybank-history.md"],
  ]) {
    const files = await allMdUnder(`${SKILLS}/${skill}`);
    let prose = "";
    for (const f of files) prose += await nodeIo.readFile(f);
    assert.ok(prose.includes(cf.HISTORY_HEADERS[hist]), `${skill} header drifted from checker`);
  }
});

async function allMdUnder(dir) {
  const { walkFilesRecursive } = await import("../../src/fs-walk.mjs");
  return walkFilesRecursive(nodeIo, dir, ".md");
}

test("a stray file/dir WARNs but never FAILs", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  const io = makeFakeIo({
    "/ws/profile.md": "# ok\n",
    "/ws/Old_Master_Resume.md": "# stray\n",
    "/ws/random-notes/.keep": "",
  });
  const res = await cf.checkStrays(io, "/ws", schemas);
  assert.ok(res.some(([lvl, m]) => lvl === "WARN" && m.includes("Old_Master_Resume.md")));
  assert.ok(res.some(([lvl, m]) => lvl === "WARN" && m.includes("random-notes")));
  assert.ok(!res.some(([lvl]) => lvl === "FAIL"), "strays must never FAIL");
});

test("manifest and schema files are not strays; the drop folder never is", async () => {
  const schemas = await cf.loadSchemas(nodeIo, SKILLS);
  const io = makeFakeIo({
    "/ws/profile.md": "x\n",
    "/ws/jobs.md": "x\n",
    "/ws/CLAUDE.md": "x\n",
    "/ws/pitch-history.md": "x\n",
    "/ws/applications/.keep": "",
    "/ws/documents/old-resume.pdf": "x",
  });
  assert.deepEqual(await cf.checkStrays(io, "/ws", schemas), []);
  await io.writeFile("/ws/Random_Notes.md", "x\n");
  const res = await cf.checkStrays(io, "/ws", schemas);
  assert.ok(res.some(([, m]) => m.includes("documents/")));
});

test("a candidate's own *-history.md is not policed (stray at most, never FAIL)", async () => {
  const r = await runCli({ "/ws/interview-history.md": "# My interviews\n\nnotes in prose\n" });
  assert.equal(r.exitCode, 0, r.stdout);
  assert.ok(!r.stdout.includes("header"));
  assert.match(r.stdout, /stray/);
});

test("an escaped pipe in a history cell is text, not a column boundary", async () => {
  const io = makeFakeIo({
    "/ws/pitch-history.md": "# H\n\n" + TIER1 + "\n|---|---|---|---|---|\n| d | 1 | drafts A \\| B compared | ok | none |\n",
  });
  assert.deepEqual(await cf.checkHistory(io, "/ws/pitch-history.md", TIER1), []);
});

function app(io, body) {
  return io.writeFile("/ws/applications/acme-role.md", body);
}

test("coverage enums are enforced but never block", async () => {
  const io = makeFakeIo();
  await app(
    io,
    "# A\n\n" +
      cf.COVERAGE_HEADER +
      "\n|---|---|---|---|\n| Python | have | bullet 3 | answered |\n| Payments | sort of | — | maybe |\n"
  );
  const res = await cf.checkTable(io, "/ws/applications/acme-role.md", cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS);
  const msgs = res.map(([, m]) => m).join(" ");
  assert.match(msgs, /sort of/);
  assert.match(msgs, /maybe/);
  assert.ok(res.every(([lvl]) => lvl === "WARN"), "enum drift must not block delivery");
});

test("a valid coverage table is silent", async () => {
  const io = makeFakeIo();
  await app(
    io,
    "# A\n\n" +
      cf.COVERAGE_HEADER +
      "\n|---|---|---|---|\n| Python | have | bullet 3 | answered |\n| Payments | gap | — | skipped |\n| RAG | shown-but-unnamed | Northwind Labs bullet | open |\n"
  );
  assert.deepEqual(await cf.checkTable(io, "/ws/applications/acme-role.md", cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS), []);
});

test("selection table enums and cell count", async () => {
  const io = makeFakeIo();
  await app(
    io,
    "# A\n\n" +
      cf.SELECTION_HEADER +
      "\n|---|---|---|---|---|---|---|\n" +
      "| 1 | Northwind Labs | Built the deployment machine | in | base | 42 | keeps org scale |\n" +
      "| 2 | Cheetah | Ad platform | dropped | invented | 22 |\n" +
      "| 3 | Peel | short row |\n"
  );
  const res = await cf.checkTable(io, "/ws/applications/acme-role.md", cf.SELECTION_HEADER, cf.SELECTION_ENUMS);
  const msgs = res.map(([, m]) => m).join(" ");
  assert.match(msgs, /dropped/);
  assert.match(msgs, /invented/);
  assert.match(msgs, /cells/);
});

test("an absent table is silent — not every application has a proposal yet", async () => {
  const io = makeFakeIo();
  await app(io, "# A\n\nJust prose, no tables.\n");
  assert.deepEqual(await cf.checkTable(io, "/ws/applications/acme-role.md", cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS), []);
});

test("a realistic multi-table application is silent (walks only the contiguous block)", async () => {
  const io = makeFakeIo();
  await app(
    io,
    "# Acme — Staff Engineer\n\n## Coverage\n\n" +
      cf.COVERAGE_HEADER +
      "\n|---|---|---|---|\n| Python | have | bullet 3 | answered |\n| Payments | gap | — | skipped |\n\n" +
      "## Selection\n\n" +
      cf.SELECTION_HEADER +
      "\n|---|---|---|---|---|---|---|\n" +
      "| 1 | Northwind Labs | Built the deployment machine | in | base | 42 | org scale |\n" +
      "| 2 | Cheetah | Ad platform features | out | base | 35 | furthest from posting |\n\n" +
      "## Screening answers\n\n| question | answer |\n|---|---|\n| Why Acme? | see the cover letter |\n\n" +
      "## Submission record\n\nNot yet submitted.\n"
  );
  assert.deepEqual(await cf.checkTable(io, "/ws/applications/acme-role.md", cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS), []);
  assert.deepEqual(await cf.checkTable(io, "/ws/applications/acme-role.md", cf.SELECTION_HEADER, cf.SELECTION_ENUMS), []);
});

test("a broken relative link FAILs (earned 2026-08-19: one ../ short)", async () => {
  const io = makeFakeIo({
    "/root/profile/references/engine.md": "# engine\n",
    "/root/apply/references/t.md": "Read `../profile/references/engine.md` first.\n",
  });
  const res = await cf.checkSkillProse(io, "/root");
  assert.ok(res.some(([lvl, m]) => lvl === "FAIL" && m.includes("does not resolve")));
});

test("a correct relative link is silent", async () => {
  const io = makeFakeIo({
    "/root/profile/references/engine.md": "# engine\n",
    "/root/apply/references/t.md": "Read `../../profile/references/engine.md` first.\n",
  });
  assert.deepEqual(await cf.checkSkillProse(io, "/root"), []);
});

test("a cross-skill link without ./ or ../ is now MATCHED (the widening) and correctly reported as unresolved", async () => {
  // The 2026-08-19 widening made the regex match bare `apply/scripts/x.py`
  // links too (six of them shipped invisible to the old ./-or-../-only
  // pattern). Resolution itself only ever tries `here` or the REFERRING
  // file's OWN skill root — never the repo's skills_root — so a bare
  // cross-skill reference correctly FAILs even when the target file exists
  // in the other skill's directory. (The fix's job was to make this
  // visible, not to make it resolve — a real cross-skill pointer needs
  // `../`.)
  const io = makeFakeIo({
    "/root/apply/scripts/check.py": "#\n",
    "/root/profile/references/v.md": "Run `apply/scripts/check.py` before delivery.\n",
  });
  const res = await cf.checkSkillProse(io, "/root");
  assert.ok(res.some(([lvl, m]) => lvl === "FAIL" && m.includes("does not resolve")));
});

test("a skill-root-relative link (references/x.md from SKILL.md) is silent", async () => {
  const io = makeFakeIo({
    "/root/apply/references/x.md": "# x\n",
    "/root/apply/SKILL.md": "Depth lives in `references/x.md`.\n",
  });
  assert.deepEqual(await cf.checkSkillProse(io, "/root"), []);
});

test("a schema placeholder (<slug>) is not treated as a link", async () => {
  const io = makeFakeIo({
    "/root/evaluate/SKILL.md": "Writes `jd-analysis/<company_key>-<title_key>.md`.\n",
  });
  assert.deepEqual(await cf.checkSkillProse(io, "/root"), []);
});

test("a link that escapes the skill tree FAILs", async () => {
  const io = makeFakeIo({
    "/outer/docs/receipts.md": "# r\n",
    "/outer/skills/apply/references/t.md": "Incidents live in `../../../docs/receipts.md`.\n",
  });
  const res = await cf.checkSkillProse(io, "/outer/skills");
  assert.ok(res.some(([lvl, m]) => lvl === "FAIL" && m.includes("escapes")));
});

test("an orphan table cell WARNs, never FAILs", async () => {
  const io = makeFakeIo({
    "/root/apply/SKILL.md": "| Do | Never |\n|---|---|\n| a | b |\n| c | d | upstream |\n",
  });
  const res = await cf.checkSkillProse(io, "/root");
  assert.ok(res.some(([lvl, m]) => lvl === "WARN" && m.includes("cells")));
  assert.ok(!res.some(([lvl]) => lvl === "FAIL"));
});

test("§-section pointers are deliberately not checked", async () => {
  const io = makeFakeIo({
    "/root/apply/SKILL.md": "See `base-resume.md § Claim rules` and § Nowhere At All.\n",
  });
  assert.deepEqual(await cf.checkSkillProse(io, "/root"), []);
});

test("an inlined Rounds table inside base-resume.md is enforced", async () => {
  const body =
    "# Base\n## Experience\n- Staff Eng\n## Claim rules\n- x\n## Rounds\n" +
    TIER1 +
    "\n|---|---|---|---|---|\n| 2026-08-24 | 1 | improve | 5/5 held | trimmed intro |\n";
  let r = await runCli({ "/ws/base-resume.md": body });
  assert.equal(r.exitCode, 0, r.stdout);

  const bad = body + "| 2026-08-24 | 2 | improve | short row |\n";
  r = await runCli({ "/ws/base-resume.md": bad });
  assert.match(r.stdout, /WARN/);
  assert.match(r.stdout, /cells/);
});
