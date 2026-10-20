#!/usr/bin/env node
// Builds the step-trace run's résumé PDF at run time (docs/design-fewer-steps.md
// § 1.2 item 5): one text line per line of the invented Alex Chen résumé, in a
// minimal valid PDF (Helvetica, a correct xref table), the same method as
// apps/web/src/backend/extract-text.test.ts, so no binary is checked in.
//
//   node make_resume_pdf.mjs <resume.md> <out.pdf>
//
// The caller writes the output to the trial folder, never into a workspace.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LINES_PER_PAGE = 50;

// Helvetica's WinAnsi set has no em dash or middle dot in plain ASCII; keep
// the PDF ASCII so its offsets are byte offsets.
function ascii(line) {
  return line
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, "|")
    .replace(/[^\x20-\x7E]/g, "?");
}

const escapeText = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** @param {string} text the résumé's text, one PDF text line per line
 *  @returns {Uint8Array} */
export function buildResumePdf(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((l) => escapeText(ascii(l)));
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  if (pages.length === 0) pages.push([""]);

  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((pageLines, i) => {
    const stream = `BT /F1 9 Tf 11 TL 36 756 Td ${pageLines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error("usage: node make_resume_pdf.mjs <resume.md> <out.pdf>");
    process.exit(2);
  }
  writeFileSync(dest, buildResumePdf(readFileSync(src, "utf8")));
}
