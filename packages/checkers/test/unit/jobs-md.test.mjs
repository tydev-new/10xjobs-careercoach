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
