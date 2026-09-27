// Mirrors tests/test_jobs_md.py's assertions against the JS port directly
// (jobs_md.py has no CLI of its own — see README.md "Coverage map" — so its
// parity is proved here, in-process, rather than by subprocess diffing).
import test from "node:test";
import assert from "node:assert/strict";
import * as jm from "../../src/jobs-md.mjs";
import { makeFakeIo } from "./fake-io.mjs";

function rows2() {
  return [
    {
      company: "Cursor", title: "Regional Director, Forward Deployed Engineering",
      stage: "To Review", dismissed: false, url: "https://x/1", location: "SF",
      posted_at: "2026-08-01", seen_at: "2026-08-14", updated_at: "2026-08-14",
    },
    {
      company: "Anthropic", title: "Manager of Applied AI Architecture, Startups",
      stage: "Applied", dismissed: false, url: "https://x/2",
      fit_verdict: "strong", fit_score: 88, fit_reason: "exact function match",
    },
    {
      company: "OpenAI", title: "AI Deployment Manager",
      stage: "To Review", dismissed: true, dismiss_reason: "delisted (gone 2026-08-10)",
    },
  ];
}

test("roundtrip preserves everything", async () => {
  const io = makeFakeIo();
  await jm.save(io, "/ws", rows2());
  const back = await jm.load(io, "/ws");
  assert.equal(back.length, 3);
  const c = back.find((r) => r.company === "Cursor");
  assert.equal(c.stage, "To Review");
  assert.equal(c.url, "https://x/1");
  assert.ok(!c.dismissed);
  const a = back.find((r) => r.company === "Anthropic");
  assert.equal(a.fit_score, 88);
  assert.equal(a.fit_verdict, "strong");
  assert.equal(a.stage, "Applied");
  const o = back.find((r) => r.company === "OpenAI");
  assert.ok(o.dismissed);
  assert.match(o.dismiss_note || "", /delisted/);
});

test("duplicate key is a hard error", async () => {
  const io = makeFakeIo();
  const rows = [...rows2(), {
    company: "Cursor, Inc", title: "Regional Director, Forward Deployed Engineering",
    stage: "To Review", dismissed: false,
  }];
  await assert.rejects(() => jm.save(io, "/ws", rows), jm.DuplicateKeyError);
});

test("find: exact beats substring", () => {
  const rows = [
    { company: "A", title: "Manager, FDE", stage: "To Review", dismissed: false },
    { company: "A", title: "Platform Engineering Manager, FDE", stage: "To Review", dismissed: false },
  ];
  const hits = jm.find(rows, "A", "Manager, FDE");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "Manager, FDE");
});

test("find: ambiguous returns all", () => {
  const rows = [
    { company: "A", title: "Director One", stage: "To Review", dismissed: false },
    { company: "A", title: "Director Two", stage: "To Review", dismissed: false },
  ];
  assert.equal(jm.find(rows, "A", "Director").length, 2);
});

test("stage sections render in board order", async () => {
  const io = makeFakeIo();
  await jm.save(io, "/ws", rows2());
  const text = await io.readFile(jm.path("/ws"));
  assert.ok(text.indexOf("## To Review") < text.indexOf("## Applied"));
  assert.ok(text.indexOf("## Applied") < text.indexOf("## Dismissed"));
  assert.match(text, /\*\*Active: 2\*\*/);
});

test("notes survive saves and never parse as roles", async () => {
  const io = makeFakeIo();
  await jm.save(io, "/ws", rows2());
  await jm.appendNote(io, "/ws", "**Fractional (lane C):** Go Fractional, Bolster — attended channels.");
  await jm.save(io, "/ws", await jm.load(io, "/ws")); // a plain re-save must preserve the notes
  assert.match(await jm.loadNotes(io, "/ws"), /Go Fractional/);
  assert.equal((await jm.load(io, "/ws")).length, 3); // the note's headers did not become roles
  const text = await io.readFile(jm.path("/ws"));
  assert.ok(text.indexOf("## Dismissed") < text.indexOf("## Search notes"));
});

test("nowIso matches Python's datetime.isoformat(timespec='seconds') shape", () => {
  const iso = jm.nowIso(() => new Date(Date.UTC(2026, 8, 23, 12, 34, 56)));
  assert.equal(iso, "2026-09-23T12:34:56+00:00");
});

test("canon strips inc/llc/labs but not a bare 'AI' — the duplicate-avoidance guidance in the script's own docstring", () => {
  assert.notEqual(jm.canon("Baseten AI"), jm.canon("Baseten"));
  assert.equal(jm.canon("Cursor, Inc"), jm.canon("Cursor"));
});

// ---- B2: sanitising (design-web-search.md § 4.3/§ 4.4) -----------------

test("save collapses whitespace and trims every field and heading", async () => {
  const io = makeFakeIo();
  const row = {
    company: "  Acme\tCorp  ", title: " Staff\n\nEngineer ",
    stage: "To Review", dismissed: false,
    location: "  San Francisco,  CA  ",
    url: "\thttps://x/1\r\n",
  };
  await jm.save(io, "/ws", [row]);
  const text = await io.readFile(jm.path("/ws"));
  assert.ok(text.includes("### Acme Corp — Staff Engineer"));
  assert.ok(text.includes("- Location: San Francisco, CA"));
  assert.ok(text.includes("- URL: https://x/1"));
  const back = (await jm.load(io, "/ws"))[0];
  assert.equal(back.company, "Acme Corp");
  assert.equal(back.title, "Staff Engineer");
});

test("save rewrites an em dash in company to a hyphen", async () => {
  const io = makeFakeIo();
  await jm.save(io, "/ws", [{ company: "A — B", title: "Role", stage: "To Review", dismissed: false }]);
  const text = await io.readFile(jm.path("/ws"));
  assert.ok(text.includes("### A - B — Role"));
  const back = (await jm.load(io, "/ws"))[0];
  assert.equal(back.company, "A - B");
  assert.equal(back.title, "Role");
});

test("save never cleans the Search notes block", async () => {
  const io = makeFakeIo();
  const notes = "line one\n\n  line two, indented\n### 2026-01-01\nmulti\nline block  ";
  await jm.save(io, "/ws", rows2(), { notes });
  const before = await io.readFile(jm.path("/ws"));
  await jm.save(io, "/ws", await jm.load(io, "/ws")); // a plain re-save must byte-for-byte preserve the notes block
  const after = await io.readFile(jm.path("/ws"));
  assert.equal(before, after);
});

test("injection: a title with a newline and a fake Offer heading stays one line, no forged Verdict", async () => {
  const io = makeFakeIo();
  const evilTitle = "Engineer\n## Offer\n### Evil Co — Row\n- URL: https://evil.example";
  await jm.save(io, "/ws", [{ company: "RealCo", title: evilTitle, stage: "To Review", dismissed: false }]);
  const rows = await jm.load(io, "/ws");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, "RealCo");
  assert.ok(!rows[0].title.includes("\n"));
  assert.equal(rows[0].fit_verdict, undefined);
  const text = await io.readFile(jm.path("/ws"));
  // "## Offer" now sits mid-line (harmless text inside the one heading
  // line), never at the START of a line — so it never parses as a
  // section heading. That's the invariant, not the raw substring's
  // absence (the merged single line legitimately still contains it).
  assert.ok(!/^## Offer/m.test(text));
  assert.equal((text.match(/^### /gm) || []).length, 1); // exactly one real row heading (line-start), never the embedded "### Evil Co" text
});

test("save rewrites a trailing em dash in company to a hyphen", async () => {
  // S1 review, finding 8 (LEAD spec amendment): a company ENDING in ` —`
  // (no character after the dash) would otherwise make the heading read
  // `### Acme — — Role` — two ` — ` runs, so the FIRST one (the
  // company's own trailing dash) is what load() would split on.
  const io = makeFakeIo();
  await jm.save(io, "/ws", [{ company: "Acme —", title: "Role", stage: "To Review", dismissed: false }]);
  const text = await io.readFile(jm.path("/ws"));
  assert.ok(text.includes("### Acme - — Role"));
  assert.equal((text.match(/^### /gm) || []).length, 1);
  const back = (await jm.load(io, "/ws"))[0];
  assert.equal(back.company, "Acme -");
  assert.equal(back.title, "Role");
});

test("save refuses an empty company or title after cleaning", async () => {
  // S1 review, finding 6 (LEAD spec amendment): save() refuses loudly;
  // the writer exits 2 (EmptyFieldError, mapped by every CLI caller) and
  // jobs.md is unchanged.
  const io = makeFakeIo();
  for (const row of [
    { company: "   ", title: "Role", stage: "To Review", dismissed: false },
    { company: "Acme", title: "\t\n", stage: "To Review", dismissed: false },
  ]) {
    await assert.rejects(() => jm.save(io, "/ws", [row]), jm.EmptyFieldError);
  }
  assert.equal(await io.exists(jm.path("/ws")), false); // jobs.md unchanged (never existed)
  // unchanged when a PRIOR jobs.md already exists, too
  await jm.save(io, "/ws", rows2());
  const before = await io.readFile(jm.path("/ws"));
  await assert.rejects(
    () => jm.save(io, "/ws", [...rows2(), { company: "", title: "Role", stage: "To Review", dismissed: false }]),
    jm.EmptyFieldError
  );
  const after = await io.readFile(jm.path("/ws"));
  assert.equal(before, after);
});

test("save writes back an untouched legacy row byte-identical", async () => {
  // LEAD ruling (S1 review, third pass): the empty-name refusal applies
  // only to the row THIS call writes; a pre-existing row is written back
  // exactly as it was read, even a legacy heading with no ` — `
  // separator at all (so its "title" parses as empty) — an old row must
  // never lock every write.
  const io = makeFakeIo();
  const seed = "# Pipeline\n\n**Active: 1** · dismissed: 0 · updated 2026-01-01\n\n" +
    "## To Review\n\n### Acme Staff Engineer\n- Seen: 2026-01-01T00:00:00+00:00\n\n";
  await io.writeFile(jm.path("/ws"), seed);
  const rows = await jm.load(io, "/ws");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, "Acme Staff Engineer");
  assert.equal(rows[0].title, "");
  const k = jm.key({ company: "Beta", title: "PM" });
  rows.push({ company: "Beta", title: "PM", stage: "To Review", dismissed: false, seen_at: "2026-01-02T00:00:00+00:00" });
  await jm.save(io, "/ws", rows, { writeKey: k }); // no throw: the legacy row is never the target
  const text = await io.readFile(jm.path("/ws"));
  assert.ok(text.includes("### Acme Staff Engineer\n- Seen: 2026-01-01T00:00:00+00:00"));
  assert.ok(text.includes("### Beta — PM"));
  const back = new Set((await jm.load(io, "/ws")).map((r) => `${r.company}|${r.title}`));
  assert.ok(back.has("Acme Staff Engineer|"));
  assert.ok(back.has("Beta|PM"));
});

test("Analysis field is distinct from JD and round-trips", async () => {
  const io = makeFakeIo();
  const row = {
    company: "Acme", title: "PM", stage: "To Review", dismissed: false,
    jd_file: "jd-inbox/acme-pm.md", analysis_file: "jd-analysis/acme-pm.md",
  };
  await jm.save(io, "/ws", [row]);
  const text = await io.readFile(jm.path("/ws"));
  assert.ok(text.includes("- JD: jd-inbox/acme-pm.md"));
  assert.ok(text.includes("- Analysis: jd-analysis/acme-pm.md"));
  const back = (await jm.load(io, "/ws"))[0];
  assert.equal(back.jd_file, "jd-inbox/acme-pm.md");
  assert.equal(back.analysis_file, "jd-analysis/acme-pm.md");
});
