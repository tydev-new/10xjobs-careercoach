// Small text helpers that reproduce specific Python string/regex semantics
// the ports rely on, so each port file doesn't have to re-derive them.
//
// A note on how the comments in this file spell certain characters: a
// literal BOM, U+2028 (LINE SEPARATOR), or U+2029 (PARAGRAPH SEPARATOR)
// typed directly into this source file would itself change how a JS
// parser reads the surrounding code (U+2028/U+2029 terminate a `//`
// comment early; several tools also silently substitute code-point
// escapes for the literal character when editing). Every mention below
// uses the code-point NAME/NUMBER in prose, or a `\uXXXX` escape inside an
// actual string/regex literal — never the bare character typed into a
// comment.

// Python's `\s` / str.isspace() (Unicode, default for str) vs JS's `\s`:
// both agree on ASCII whitespace, NBSP, the Unicode space separators, and
// U+2028/U+2029 (Python's isspace() counts Zl/Zp via bidi property "B") —
// but JS's `\s` (and String.trim()) ALSO treats U+FEFF (BOM / zero-width
// no-break space) as whitespace, while Python's `\s` does NOT (confirmed
// against CPython: `"﻿".isspace()` is False). A BOM Python leaves
// glued to the following character therefore has to stay glued here too
// — this is the corpus's `cm-bom-letter` case (a BOM'd salutation must
// NOT be seen as "Hello" with leading whitespace stripped). PY_S is JS's
// `\s` set minus U+FEFF.
const PY_S_CHARS = "\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const PY_S = `[${PY_S_CHARS}]`;
export const PY_NOT_S = `[^${PY_S_CHARS}]`;

// Python's `\w` (Unicode, default for str patterns) is "any Unicode
// alphanumeric character, plus underscore" — it matches a CJK ideograph.
// JS's `\b`/`\w` are ASCII-only ([A-Za-z0-9_]) even with the `u` flag (JS
// never gained a Unicode-aware `\b`). This is the design doc's named
// parity risk realized: `\b(19|20)\d{2}\b` must NOT fire on "2015" when
// it's immediately followed by "年" (CJK "year") in "2015年毕业"
// — Python's trailing `\b` fails there (both are `\w`), so no match; a
// bare JS `\b` incorrectly succeeds (`年` isn't `[A-Za-z0-9_]`).
// PY_B_START/PY_B_END are drop-in `\b`-equivalents built from a
// Unicode-aware word-character class (needs the regex `u` flag).
export const PY_B_START = "(?<![\\p{L}\\p{N}_])";
export const PY_B_END = "(?![\\p{L}\\p{N}_])";

// Python's str.split() with no separator: splits on runs of whitespace and
// drops empty strings at either end.
export function pySplit(s) {
  const m = s.match(new RegExp(`${PY_NOT_S}+`, "g"));
  return m || [];
}

// " ".join(s.split()) — collapse all whitespace runs to single spaces and
// trim the ends.
export function normSpace(s) {
  return pySplit(s).join(" ");
}

// Python's str.strip() with no args: strip PY_S characters from both ends
// (never a BOM — see PY_S's comment).
export function pyStrip(s) {
  const re = new RegExp(`^${PY_S}+|${PY_S}+$`, "g");
  return s.replace(re, "");
}
// str.rstrip() / str.lstrip() with no args.
export function pyRstrip(s) {
  return s.replace(new RegExp(`${PY_S}+$`), "");
}
export function pyLstrip(s) {
  return s.replace(new RegExp(`^${PY_S}+`), "");
}

// Python's `^`/`$` (re.M) and `.` (no DOTALL) treat ONLY code point 0x0A
// (LF) as a line boundary — confirmed against CPython: CR (0x0D), LINE
// SEPARATOR (0x2028), PARAGRAPH SEPARATOR (0x2029), form feed, vertical
// tab are all ordinary characters to Python's regex engine. JS's
// LineTerminator set (which `^`/`$`/`.` are ALL sensitive to, and which JS
// gives no flag to redefine) is LF, CR, 0x2028, and 0x2029 — so a source
// line/paragraph separator inside text silently splits a JS multiline
// match Python would have kept whole (the corpus's `cm-u2028-in-heading`
// case: a heading whose "space" is really 0x2028). CR is handled by
// translating it to LF (below, matching Python's universal-newlines read
// — the two engines then agree there's no separate character to diverge
// on). 0x2028/0x2029 have no such collapse available (they carry real
// meaning, must survive byte-for-byte in output), so they're swapped for
// two Private-Use-Area sentinel code points for the whole life of the
// string inside a checker, and swapped back with `restoreLineSeparators`
// at every exit point (a checker's returned stdout/stderr, and anything
// written back to a file) — see README.md "CRLF, universal newlines, and
// U+2028/U+2029".
const U2028_SENTINEL = "";
const U2029_SENTINEL = "";
const U2028_CHAR = " ";
const U2029_CHAR = " ";

// Python's universal-newlines text-mode read: open(path, encoding="utf-8")
// (the default, no newline="") translates \r\n AND a bare \r into \n
// before the caller's code ever sees the text. Every port that reads a
// file through `io.readFile` must run the text through this first — see
// README.md "CRLF, universal newlines, and U+2028/U+2029".
export function universalNewlines(s) {
  return s.replace(/\r\n|\r/g, "\n").split(U2028_CHAR).join(U2028_SENTINEL).split(U2029_CHAR).join(U2029_SENTINEL);
}
// Swap the sentinels back to the real 0x2028/0x2029 characters — call this
// on every string a checker hands back out (stdout/stderr, and file
// content about to be written).
export function restoreLineSeparators(s) {
  return s.split(U2028_SENTINEL).join(U2028_CHAR).split(U2029_SENTINEL).join(U2029_CHAR);
}

// Python's str.splitlines(): a MUCH broader boundary set than `^`/`$` — LF,
// CR, CRLF, vertical tab, form feed, 0x1c, 0x1d, 0x1e, NEL (0x85), and
// 0x2028/0x2029 (matched here as their post-`universalNewlines` sentinels,
// since splitlines() runs on text a checker already holds in-memory).
// Only call this where the Python source literally calls `.splitlines()`
// (render_resume.py's `blocks()`, check_materials.py's case-prose
// paragraph split) — every OTHER "split into lines" in these scripts is a
// plain `.split("\n")` or regex `^`/`$`, which is LF-only (see
// universalNewlines's comment) and must NOT use this.
const SPLITLINES_RE = new RegExp(`\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85${U2028_SENTINEL}${U2029_SENTINEL}]`);
export function pySplitlines(s) {
  if (s === "") return [];
  return s.split(SPLITLINES_RE);
}

// Python's str.strip(chars) / lstrip / rstrip: strip any of the given
// characters (not a substring — a *set* of characters) from one or both
// ends. JS has no built-in for this.
function escapeForClass(chars) {
  return chars.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}
export function stripChars(s, chars) {
  const esc = escapeForClass(chars);
  return s.replace(new RegExp(`^[${esc}]+`), "").replace(new RegExp(`[${esc}]+$`), "");
}

// Python's int(str): strips surrounding whitespace (PY_S), allows a single
// leading sign, allows single underscores between digit groups (PEP 515),
// and accepts ANY Unicode decimal-digit character (category Nd) — not
// just ASCII 0-9 (`int("１２")` == 12, fullwidth digits). Returns
// null (Python: raises ValueError) when the string doesn't parse.
//
// Residual gap (documented, not corpus-tested): this normalizes digits via
// NFKC, which covers fullwidth digits (the corpus's case) and most
// compatibility forms, but not every Unicode Nd character Python's int()
// accepts (e.g. Arabic-indic digits are Nd but not NFKC-normalizable to
// ASCII) — those return null here where Python would successfully parse
// them. See README.md "Known, sanctioned divergences".
export function pyInt(s) {
  if (typeof s !== "string") return null;
  const t = pyStrip(s);
  const m = t.match(/^([+-]?)(\p{Nd}(?:_?\p{Nd})*)$/u);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const digits = m[2].replace(/_/g, "").normalize("NFKC");
  if (!/^[0-9]+$/.test(digits)) return null;
  return sign * parseInt(digits, 10);
}

// Code-point-correct length/slice/compare — Python str is a sequence of
// Unicode code points; JS string indexing/length/.slice() are UTF-16 code
// UNITS, which silently split a surrogate pair (an emoji, most CJK
// Extension B+ characters) in half. Array.from(s) (or a for-of loop)
// iterates by code point in JS; these wrap that.
export function cpArray(s) {
  return Array.from(s);
}
export function cpLength(s) {
  return cpArray(s).length;
}
export function cpSlice(s, n) {
  return cpArray(s).slice(0, n).join("");
}

// Python's default string comparison (and `sorted()`/`list.sort()`) orders
// by Unicode CODE POINT. JS's default Array.prototype.sort() on strings
// compares UTF-16 code UNITS, which puts every astral character (code
// point > 0xFFFF, encoded as a surrogate pair whose high surrogate is
// 0xD800-0xDBFF) ahead of common BMP characters in the 0xE000-0xFFFF range
// — a different order than comparing the real code points.
export function codePointCompare(a, b) {
  const ai = cpArray(a);
  const bi = cpArray(b);
  const len = Math.min(ai.length, bi.length);
  for (let i = 0; i < len; i++) {
    const ca = ai[i].codePointAt(0);
    const cb = bi[i].codePointAt(0);
    if (ca !== cb) return ca - cb;
  }
  return ai.length - bi.length;
}
// `sorted(list_of_str)` — a fresh, code-point-sorted copy.
export function pySortStrings(arr) {
  return arr.slice().sort(codePointCompare);
}

// Minimal Python repr() for a list of plain strings — enough for the
// headings/words the ported checkers ever embed via an f-string list
// literal (e.g. `f"...{some_list}...", which calls str(list) -> repr of
// each element).
export function pyStrRepr(s) {
  const hasSingle = s.includes("'");
  const hasDouble = s.includes('"');
  const quote = hasSingle && !hasDouble ? '"' : "'";
  let out = "";
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += "\\" + quote;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return quote + out + quote;
}
export function pyListRepr(arr) {
  return "[" + arr.map(pyStrRepr).join(", ") + "]";
}
