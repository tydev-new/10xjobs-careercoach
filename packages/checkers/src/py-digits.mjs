// Unicode decimal-digit (category Nd) value lookup — what Python's
// `int(str)` uses internally (via `unicodedata.decimal()`) to accept ANY
// script's own digits, not just ASCII 0-9 or NFKC-normalizable ones like
// fullwidth. `String.prototype.normalize("NFKC")` covers fullwidth digits
// but NOT e.g. Arabic-Indic (٣ is Nd, but is not a NFKC-compatibility
// form of an ASCII digit) — the corpus's `r2-rv-unicode-digit-scores`
// case needs `int("٣") == 3` to work.
//
// DIGIT_ZERO_POINTS is every Unicode Nd-category "zero" code point (the
// start of a script's own contiguous 0-9 run) — generated once from
// CPython's own `unicodedata.decimal()` (see this repo's history for the
// generating script) and unlikely to change (new Unicode digit scripts
// are rare and additive). Ascending order, and the 76 ten-code-point runs
// never overlap, so finding "which block (if any) a code point falls in"
// is a binary search.
export const DIGIT_ZERO_POINTS = [
  0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6,
  0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0,
  0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620,
  0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x10d40,
  0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650, 0x116c0, 0x116d0,
  0x116da, 0x11730, 0x118e0, 0x11950, 0x11bf0, 0x11c50, 0x11d50, 0x11da0, 0x11f50, 0x16130,
  0x16a60, 0x16ac0, 0x16b50, 0x16d70, 0x1ccf0, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6,
  0x1e140, 0x1e2f0, 0x1e4f0, 0x1e5f1, 0x1e950, 0x1fbf0,
];

// Returns 0-9 if `ch` (a single code point) is a Unicode decimal digit,
// else null.
export function unicodeDigitValue(ch) {
  const cp = ch.codePointAt(0);
  let lo = 0;
  let hi = DIGIT_ZERO_POINTS.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (DIGIT_ZERO_POINTS[mid] <= cp) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) return null;
  const value = cp - DIGIT_ZERO_POINTS[candidate];
  return value >= 0 && value <= 9 ? value : null;
}
