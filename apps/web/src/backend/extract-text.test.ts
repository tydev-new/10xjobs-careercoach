import assert from "node:assert/strict";
import test from "node:test";
import { extractText } from "./extract-text.ts";

// A minimal, valid PDF with one text line per page (Helvetica, with a
// correct xref table), so the test exercises the real unpdf parse with no
// binary fixture checked in.
function minimalPdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((line, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

test("extractText: a .pdf comes back as its text, pages in order", async () => {
  const bytes = minimalPdf(["Jordan Rivera, Staff Product Manager", "Skills: SQL, pricing"]);
  const text = await extractText("documents/resume.pdf", bytes);
  assert.ok(text !== null);
  assert.match(text, /Jordan Rivera, Staff Product Manager/);
  assert.match(text, /Skills: SQL, pricing/);
  assert.ok(text.indexOf("Jordan") < text.indexOf("Skills"));
});

test("extractText: the caller's bytes are left usable (pdf.js detaches what it's given)", async () => {
  const bytes = minimalPdf(["Hello"]);
  const before = bytes.length;
  await extractText("documents/a.pdf", bytes);
  assert.equal(bytes.length, before);
  assert.match((await extractText("documents/a.pdf", bytes)) ?? "", /Hello/);
});

test("extractText: .PDF in capitals is still a PDF", async () => {
  assert.match((await extractText("documents/CV.PDF", minimalPdf(["Hi there"]))) ?? "", /Hi there/);
});

test("extractText: a PDF with no text layer extracts to an empty string", async () => {
  assert.equal(await extractText("documents/scan.pdf", minimalPdf([""])), "");
});

test("extractText: .docx has no extractor yet — null", async () => {
  assert.equal(await extractText("documents/resume.docx", new Uint8Array([1, 2, 3])), null);
});

test("extractText: bytes that aren't a PDF throw", async () => {
  await assert.rejects(extractText("documents/bad.pdf", new TextEncoder().encode("not a pdf")));
});
