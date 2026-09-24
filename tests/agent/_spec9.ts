// Tester-owned: the § 9 sentences, read from THE CONTRACT
// (docs/design-web-agent.md § 9, amended at 7c1b1be) — never copied from the
// code — so a test compares the code's text to the spec's, word for word.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = readFileSync(path.join(REPO, "docs/design-web-agent.md"), "utf8");

function section(title: string): string {
  const start = DOC.indexOf(title);
  if (start < 0) throw new Error(`spec section not found: ${title}`);
  const next = DOC.indexOf("\n### ", start + title.length);
  return DOC.slice(start, next < 0 ? undefined : next);
}

/** The first `>` blockquote after `marker` in `sec`, unwrapped: lines joined
 *  with single spaces, the `> ` prefixes and indentation dropped. */
function quoteAfter(sec: string, marker: string): string {
  const at = sec.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const lines = sec.slice(at + marker.length).split("\n");
  const out: string[] = [];
  let started = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith(">")) {
      started = true;
      out.push(l.replace(/^>\s?/, ""));
    } else if (started) break;
  }
  if (!out.length) throw new Error(`no blockquote after: ${marker}`);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

const S91 = section("### 9.1 Detection");
const S92 = section("### 9.2 One continuation per turn");
const S93 = section("### 9.3 A visible stop");
const S94 = section("### 9.4 The next turn knows");

/** § 9.1 (amended 7c1b1be): the "closing text" every tool call in a
 *  cut-off step is closed with (UI errorText and synthesized tool result). */
export const TOOL_CLOSE_TEXT = quoteAfter(S91, "`errorText` = the **closing\ntext**:");
/** § 9.2: the continuation's user-role note. */
export const CONTINUATION_NOTE = quoteAfter(S92, "one **user-role** message with this note, word for word:");
/** § 9.3: the fixed cut_off message. */
export const CUT_OFF_MESSAGE = quoteAfter(S93, "The\nmessage is fixed:");
/** § 9.4: the next-turn system-prompt note. */
export const NEXT_TURN_NOTE = quoteAfter(S94, "when both apply):");
