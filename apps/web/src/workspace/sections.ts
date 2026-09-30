// splitSections (design-web-ui.md § 5.3, "Pieces the pages share",
// restore ruling; § 5.9 Stage 3b, "READER (new)"). Web-only. The Jobs
// detail uses it to show named parts of evaluate's two prose files
// (jd-analysis/<key>.md, company/<key>.md). Evaluate's schema says "no
// script parses this file — every consumer reads it as prose"; this
// function doesn't parse the prose either. It only finds where each
// `## ` section starts and ends; each body is still shown whole, through
// MarkdownView. No window/document/localStorage/Node-only API.
import { restoreLineSeparators, universalNewlines } from "../../../../skills/profile/scripts/lib/py-text.mjs";

export interface Section {
  heading: string;
  body: string;
}

/** A section starts at a line that begins `## ` (two `#` and a space).
 *  Its `heading` is the rest of that line, trimmed. Its `body` is every
 *  line after it, word for word, up to the next line that begins `## `
 *  or `# `, or the end of the file. `### ` lines stay inside the body.
 *  Lines before the first `## ` belong to no section.
 *
 *  Line endings go through `universalNewlines` first and every returned
 *  string through `restoreLineSeparators`, as `readPlanBoard` does (C
 *  § 18) — so a real U+2028/U+2029 the file held survives byte for byte.
 *
 *  Known limit: a `## ` line inside a fenced code block still starts a
 *  section. Evaluate's schema puts no fenced blocks in either file. */
export function splitSections(md: string): Section[] {
  const text: string = universalNewlines(md);
  const lines = text.split("\n");
  const sections: Section[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith("## ")) {
      const heading = restoreLineSeparators(lines[i].slice(3).trim());
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("## ") && !lines[i].startsWith("# ")) {
        bodyLines.push(lines[i]);
        i++;
      }
      const body = restoreLineSeparators(bodyLines.join("\n"));
      sections.push({ heading, body });
    } else {
      i++;
    }
  }
  return sections;
}

/** The first section whose heading starts with `prefix`, case-sensitive,
 *  or `undefined`. `## Fit assessment (Track A lens)` is found by the
 *  prefix `Fit assessment` — the heading's own rest is left in `heading`
 *  for a caller that wants it, but § 5.3's Jobs detail (C4) never shows
 *  it. */
export function pickSection(sections: Section[], prefix: string): Section | undefined {
  return sections.find((s) => s.heading.startsWith(prefix));
}
