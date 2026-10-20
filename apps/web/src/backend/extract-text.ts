// Deps.extractText for the web app (design-web-agent.md § 4, read_file):
// the text of an uploaded .pdf or .docx, so the coach can read a résumé
// the candidate attached instead of asking them to paste it.
//
// .pdf: unpdf ships a pdf.js build that runs in the browser and in Node
// with no worker setup — the same module serves the web app and the
// headless runner. It is ~1.6 MB, so it is imported on first use rather
// than at load: a chat that never reads a PDF never downloads it.
//
// .docx: a zip of XML parts. fflate (already the workspace export's zip
// library) unzips it, and the paragraph text is read straight out of
// WordprocessingML — headers first (résumé templates often put the name
// and contact line there), then the body.

import { unzipSync } from "fflate";

const DOCX_PART_RE = /^word\/(header\d*|document)\.xml$/;
// A 10 MB upload can inflate a lot; an XML part bigger than this is not a
// résumé, and is refused rather than held in memory.
const MAX_DOCX_PART_BYTES = 50 * 1024 * 1024;

export async function extractText(path: string, bytes: Uint8Array): Promise<string | null> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return extractPdf(bytes);
  if (lower.endsWith(".docx")) return extractDocx(bytes);
  return null;
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText: extractPdfText } = await import("unpdf");
  // pdf.js takes ownership of (and detaches) the buffer it's given; copy so
  // the caller's bytes stay usable.
  const { text } = await extractPdfText(new Uint8Array(bytes), { mergePages: false });
  return text.map((page) => page.trim()).filter(Boolean).join("\n\n");
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const parts = unzipSync(bytes, {
    filter: (f) => {
      if (!DOCX_PART_RE.test(f.name)) return false;
      if (f.originalSize > MAX_DOCX_PART_BYTES) throw new Error(`${f.name} is too large to read`);
      return true;
    },
  });
  const body = parts["word/document.xml"];
  if (!body) throw new Error("not a Word document: word/document.xml is missing");
  const headers = Object.keys(parts)
    .filter((name) => name !== "word/document.xml")
    .sort()
    .map((name) => parts[name]);
  const decoder = new TextDecoder();
  return [...headers, body]
    .map((xml) => wordXmlText(decoder.decode(xml)))
    .filter(Boolean)
    .join("\n\n");
}

/** The text of one WordprocessingML part, in document order: a newline
 *  at each paragraph end, tabs and line breaks kept. One token scan rather
 *  than paragraph matching, so a text box's paragraphs nested inside a
 *  paragraph don't cut it short. Deleted tracked changes are w:delText and
 *  never match; inserted ones are ordinary w:t runs and are kept. */
function wordXmlText(xml: string): string {
  const content = xml
    // Text boxes are stored twice — the modern mc:Choice and a legacy VML
    // mc:Fallback copy. Keep one.
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "")
    // Tab-stop definitions are <w:tab .../> too; they aren't text.
    .replace(/<w:tabs\b[\s\S]*?<\/w:tabs>/g, "");
  let out = "";
  for (const [tag, text] of content.matchAll(/<w:t\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:t>)|<w:(?:tab|br|cr)\b[^>]*\/>|<\/w:p>/g)) {
    if (tag === "</w:p>") out += "\n";
    else if (tag.startsWith("<w:tab")) out += "\t";
    else if (tag.startsWith("<w:t")) out += decodeXmlEntities(text ?? "");
    else out += "\n";
  }
  return out
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex, dec, named) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[(named as string).toLowerCase() as "amp"];
  });
}
