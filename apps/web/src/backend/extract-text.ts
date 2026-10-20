// Deps.extractText for the web app (design-web-agent.md § 4, read_file):
// the text of an uploaded .pdf, so the coach can read a résumé the
// candidate attached instead of asking them to paste it.
//
// unpdf ships a pdf.js build that runs in the browser and in Node with no
// worker setup — the same module serves the web app and the headless
// runner. It is ~1 MB, so it is imported on first use rather than at load:
// a chat that never reads a PDF never downloads it.
//
// .docx has no extractor yet: null tells read_file to refuse it.

export async function extractText(path: string, bytes: Uint8Array): Promise<string | null> {
  if (!path.toLowerCase().endsWith(".pdf")) return null;
  const { extractText: extractPdfText } = await import("unpdf");
  // pdf.js takes ownership of (and detaches) the buffer it's given; copy so
  // the caller's bytes stay usable.
  const { text } = await extractPdfText(new Uint8Array(bytes), { mergePages: false });
  return text.map((page) => page.trim()).filter(Boolean).join("\n\n");
}
