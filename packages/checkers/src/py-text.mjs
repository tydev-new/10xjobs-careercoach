// Small text helpers that reproduce specific Python string/regex semantics
// the ports rely on, so each port file doesn't have to re-derive them.
import { unicodeDigitValue } from "./py-digits.mjs";
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

// Two Private-Use-Area sentinel code points that stand in for a real
// U+2028/U+2029 for the whole life of a string inside a checker — see
// this file's "universalNewlines"/"restoreLineSeparators" comment further
// down for why. Defined here (ahead of PY_S) because PY_S, matching
// Python's OWN `\s` (which includes U+2028/U+2029), must ALSO match
// whatever currently stands in for them: a NATIVE JS `\s` (or an earlier
// draft of PY_S that forgot this) stops matching a "whitespace" that's
// actually a sentinel, which is exactly the corpus's
// `r2-rv-nel-and-u2028-in-fields` case — a field value like
// "Location:  x" where the second "space" is really a U+2029; Python's
// `\s*` (operating on the real character) consumes it as part of the
// label/value separator, so a checker whose OWN `\s*`-equivalent doesn't
// ALSO consume the sentinel leaves it glued to the front of the captured
// value instead.
const U2028_SENTINEL = "";
const U2029_SENTINEL = "";
const U2028_CHAR = " ";
const U2029_CHAR = " ";

// Python's `\s` / str.isspace() (Unicode, default for str) vs JS's `\s`.
// PY_S_CHARS is the EXACT 29-code-point set (verified by iterating every
// BMP code point 0x0-0xFFFF through CPython's `str.isspace()`, and
// confirming `str.split()`/`str.strip()` agree with it): tab, LF, vertical
// tab, form feed, CR, 0x1C-0x1F (the "information separator" controls —
// Python counts these; JS's `\s` does not), space, NEL (0x85 — JS's `\s`
// does not count this either), NBSP, 0x1680, the 0x2000-0x200A run, LINE
// SEPARATOR and PARAGRAPH SEPARATOR (here as their sentinels — see
// above; real ones never survive past `universalNewlines`), 0x202F,
// 0x205F, 0x3000. The one JS `\s` member Python's `\s`/`.isspace()` does
// NOT count is U+FEFF (BOM / zero-width no-break space; confirmed:
// `"﻿".isspace()` is False in CPython) — so PY_S is deliberately NOT
// "JS's `\s` plus a few extras": a BOM Python leaves glued to the
// following character has to stay glued here too — this is the corpus's
// `cm-bom-letter` case (a BOM'd salutation must NOT be seen as "Hello"
// with leading whitespace stripped).
const PY_S_CHARS = `\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\u00a0\\u1680\\u2000-\\u200a${U2028_SENTINEL}${U2029_SENTINEL}\\u202f\\u205f\\u3000`;
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
// two Private-Use-Area sentinel code points (defined at the top of this
// file, alongside PY_S) for the whole life of the string inside a
// checker, and swapped back with `restoreLineSeparators` at every exit
// point (a checker's returned stdout/stderr, and anything written back to
// a file) — see README.md "CRLF, universal newlines, and U+2028/U+2029".

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
// paragraph split, check_closeout.py's `waiting_rows()`, check_files.py's
// / proposal_block.py's `raw.splitlines()`) — every OTHER "split into
// lines" in these scripts is a plain `.split("\n")` or regex `^`/`$`,
// which is LF-only (see universalNewlines's comment) and must NOT use
// this. This is the ONE shared helper every port uses for a Python
// `.splitlines()` call — see check-closeout.mjs's `waitingRows` (fix
// round 3, item 2) for why a bespoke `.split(/\r?\n/)` in a port is a bug
// even when the port never intended to diverge: it silently drops the
// \v/\f/\x1c-\x1e/NEL/U+2028/U+2029 boundaries Python's splitlines()
// recognizes (the corpus's `r3-cc-nel-rows` case).
const SPLITLINES_RE = new RegExp(`\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85${U2028_SENTINEL}${U2029_SENTINEL}]`);
export function pySplitlines(s) {
  if (s === "") return [];
  const parts = s.split(SPLITLINES_RE);
  // Python's splitlines() never emits a trailing empty line for a string
  // that ends exactly on a line boundary ("a\n".splitlines() == ["a"],
  // not ["a", ""]) — unlike a plain regex split, which always emits one
  // final (possibly empty) fragment after the last match. Since a
  // trailing empty fragment can ONLY occur when the last match ends at
  // the string's own end, popping it once (never more) exactly reproduces
  // Python's rule, including runs of blank lines ("a\n\n".splitlines()
  // == ["a", ""], i.e. drop only the LAST empty fragment).
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
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
// just ASCII 0-9 (`int("１２")` == 12, fullwidth digits; `int("٣")` == 3,
// Arabic-Indic — the corpus's `r2-rv-unicode-digit-scores` case). Returns
// null (Python: raises ValueError) when the string doesn't parse. Each
// digit's VALUE comes from `py-digits.mjs`'s `unicodeDigitValue()` (a
// lookup generated from CPython's own `unicodedata.decimal()`), not
// `String.normalize("NFKC")` — NFKC covers fullwidth digits but not every
// script's own native digits (Arabic-Indic, for one, doesn't
// NFKC-decompose to ASCII).
export function pyInt(s) {
  if (typeof s !== "string") return null;
  const t = pyStrip(s);
  const m = t.match(/^([+-]?)(\p{Nd}(?:_?\p{Nd})*)$/u);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const digitChars = cpArray(m[2]).filter((c) => c !== "_");
  let value = 0;
  for (const ch of digitChars) {
    const d = unicodeDigitValue(ch);
    if (d === null) return null; // \p{Nd} matched but not in our block table — treat as unparseable rather than silently wrong
    value = value * 10 + d;
  }
  return sign * value;
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
