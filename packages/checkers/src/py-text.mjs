// Small text helpers that reproduce specific Python string/regex semantics
// the ports rely on, so each port file doesn't have to re-derive them.

// Python's str.split() with no separator: splits on runs of whitespace and
// drops empty strings at either end. JS's String.split(/\s+/) instead keeps
// a leading/trailing "" when the string starts/ends with whitespace, which
// silently shifts every word-count/rejoin in the ported checkers.
export function pySplit(s) {
  const m = s.match(/\S+/g);
  return m || [];
}

// " ".join(s.split()) — collapse all whitespace runs to single spaces and
// trim the ends.
export function normSpace(s) {
  return pySplit(s).join(" ");
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

// Python's int(str): strips surrounding whitespace, allows a leading sign,
// requires the rest to be all digits — returns null (Python: raises
// ValueError) otherwise. Used where the source catches ValueError and
// skips the value.
export function pyInt(s) {
  const t = s.trim();
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : null;
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
