// Tester-owned: the § 11 / § 12 sentences, read from THE CONTRACT
// (docs/design-web-agent.md § 11–§ 12, owner-approved at 6641e1a) — never
// copied from the code — so tests compare the code's text to the spec's.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = readFileSync(path.join(REPO, "docs/design-web-agent.md"), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

function between(a: string, b: string): string {
  const i = DOC.indexOf(a);
  const j = DOC.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`spec slice not found: ${a} .. ${b}`);
  return DOC.slice(i, j);
}
function quoteAfter(sec: string, marker: string): string {
  const at = sec.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const out: string[] = [];
  let started = false;
  for (const raw of sec.slice(at + marker.length).split("\n")) {
    const l = raw.trim();
    if (l.startsWith(">")) {
      started = true;
      out.push(l.replace(/^>\s?/, ""));
    } else if (started) break;
  }
  if (!out.length) throw new Error(`no blockquote after ${marker}`);
  return flat(out.join(" "));
}

const S113 = between("### 11.3 What is saved", "### 11.4");
const S122 = between("### 12.2 A refusal: `too_large`", "### 12.3");

/** § 11.3's stub template with N as the placeholder, word for word. */
export const STUB_TEMPLATE = quoteAfter(S113, "the removed length:");
/** The stub for a removed length n. */
export const stub = (n: number) => STUB_TEMPLATE.replace(/\bN\b/, String(n));
/** § 11.3: the fixed errorText for a tool part saved in any unfinished state. */
export const STOPPED_TEXT = (() => {
  const m = flat(S113).match(/saved as `output-error`, `errorText` "([^"]+)"/);
  if (!m) throw new Error("§ 11.3 stopped text not found");
  return m[1];
})();
/** § 12.2: too_large's fixed message. */
export const TOO_LARGE_MESSAGE = (() => {
  const m = flat(S122).match(/Message, fixed: "([^"]+)"/);
  if (!m) throw new Error("§ 12.2 message not found");
  return m[1];
})();
/** § 12.2: the third § 9.4 note. */
export const TOO_LARGE_NOTE = quoteAfter(S122, "after `step_cap`, word for word:");
