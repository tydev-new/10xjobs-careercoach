import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
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

test("extractText: a file type with no extractor is null", async () => {
  assert.equal(await extractText("documents/notes.odt", new Uint8Array([1, 2, 3])), null);
});

// A .docx is a zip of WordprocessingML parts; build one in memory with
// only the parts the extractor reads (plus one it must ignore).
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function docx(parts: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, enc.encode(xml)])));
}
const para = (inner: string) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${inner}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

test("extractText: a .docx comes back as its text — header first, one line per paragraph", async () => {
  const bytes = docx({
    "[Content_Types].xml": "<Types/>",
    "word/styles.xml": `<w:styles ${W}>${para(run("STYLE TEXT, NOT CONTENT"))}</w:styles>`,
    "word/header1.xml": `<w:hdr ${W}>${para(run("Jordan Rivera") + run(" · jordan@example.com"))}</w:hdr>`,
    "word/document.xml": `<w:document ${W}><w:body>${para(run("Staff Product Manager"))}${para(run("Acme") + "<w:r><w:tab/></w:r>" + run("2021&#8211;2024"))}${para("")}${para(run("Skills: SQL &amp; pricing"))}</w:body></w:document>`,
  });
  assert.equal(
    await extractText("documents/resume.docx", bytes),
    "Jordan Rivera · jordan@example.com\n\nStaff Product Manager\nAcme\t2021\u20132024\n\nSkills: SQL & pricing",
  );
});

test("extractText: .docx — text after a text box, deleted changes, fallback copies and tab stops", async () => {
  const textbox = `<w:r><mc:AlternateContent><mc:Choice><w:txbxContent>${para(run("In the box"))}</w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent>${para(run("In the box"))}</w:txbxContent></mc:Fallback></mc:AlternateContent></w:r>`;
  const bytes = docx({
    "word/document.xml": `<w:document ${W}><w:body>` +
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr>${run("Before")}${textbox}${run("After")}</w:p>` +
      para(`${run("Kept")}<w:del><w:r><w:delText>Deleted</w:delText></w:r></w:del><w:ins>${run(" inserted")}</w:ins><w:r><w:br/></w:r>${run("next line")}`) +
      `</w:body></w:document>`,
  });
  assert.equal(await extractText("documents/r.docx", bytes), "BeforeIn the box\nAfter\nKept inserted\nnext line");
});

test("extractText: a .docx with no text extracts to an empty string", async () => {
  assert.equal(await extractText("documents/blank.docx", docx({ "word/document.xml": `<w:document ${W}><w:body>${para("")}</w:body></w:document>` })), "");
});

test("extractText: a .docx that isn't a zip, or has no document part, throws", async () => {
  await assert.rejects(extractText("documents/bad.docx", new TextEncoder().encode("not a zip")));
  await assert.rejects(extractText("documents/bad.docx", docx({ "word/styles.xml": "<w:styles/>" })), /document\.xml is missing/);
});

test("extractText: bytes that aren't a PDF throw", async () => {
  await assert.rejects(extractText("documents/bad.pdf", new TextEncoder().encode("not a pdf")));
});
