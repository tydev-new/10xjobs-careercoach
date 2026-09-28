#!/usr/bin/env python3
"""Mechanical floor for outreach drafts — the checkable slice of the rubric.

Scans the draft blockquotes in a contacts/<company>.md file (each blockquote
group is one draft; blank lines don't split it). FAILs scope to the DRAFTS —
the rest of the file legitimately quotes third parties. Judgment
(hook choice, voice, ask) stays in the written rubric line; this floor is what
Loop A fixes before showing (design: outreach message self-loop, ≤2 passes).

    python3 check_messages.py --workspace <dir> --contacts contacts/foo.md

Structure tier ONLY since #29 (the READ-split, measured by t15: the
language tier — never-say phrases, WATCH-tier struck forms — moved to the
independent checker, profile/references/language-check.md, which catches
paraphrases this floor's exact-match never could). The rubric-PINNED state
stays here: a PROPOSED rubric yields a WARN (pinning is a state check, not
a language read).

Earned 2026-08-16 (first live plan, Lindy): a drafted connect request opened
"I've spent 20 years" — an aggregate-year age tag banned by the proposed
rubric's own WATCH row — and carried an arrow glyph; nothing mechanical could
catch either. Exit 0 = clean, 1 = at least one FAIL.
"""
import argparse, os, re, sys

ARROW_GLYPHS = re.compile(r"[→⇒▸►◄←↔]")
# Owner ruling 6 (2026-09-25, docs/design-apply-three-lens.md § 4): ASCII
# arrow chains — the same pattern and exemptions as
# apply/scripts/check_materials.py, scoped here to the drafts. A named
# exception to the earned-FAIL bar (goals § 2): no incident behind it,
# row in docs/receipts.md § apply. JS port: J3 (docs/design-js-only.md)
# ports the three small checkers, this one included; until then this
# Python file is the only copy.
ASCII_ARROWS = re.compile(r"<=+>|<-+>?|-+>|=+>")
EXEMPT_SPANS = re.compile(r"```.*?```|~~~.*?~~~|<!--.*?-->|``[^\n]*?``|`[^`\n]*`|https?://\S+", re.S)
YEAR_COUNT = re.compile(r"\b\d{2}\+?\s*(?:\+\s*)?years\b", re.I)
CONNECT_CHAR_LIMIT = 300      # eval.md § Channel limits: connection request
THANKYOU_WORD_LIMIT = 120     # eval.md § Channel limits: thank-you note

# design-honest-ceilings.md § 4.2: marks are normalized before any check —
# filled-glyph variants read the same as the plain marks.
MARK_NORMALIZE = str.maketrans({"✔": "✓", "✅": "✓", "✘": "✗", "❌": "✗"})
RUBRIC_CRITERIA = ("specificity", "brevity", "ask", "value", "voice")
RUBRIC_MARK_RE = {name: re.compile(re.escape(name) + r"\s*(\S)", re.I) for name in RUBRIC_CRITERIA}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()




def rubric_pinned(workspace):
    """pitch.md § Messages rubric present and not marked PROPOSED.

    A state probe, not a language read — the WATCH forms themselves are
    the language checker's (#29)."""
    p = os.path.join(workspace, "pitch.md")
    if not os.path.exists(p):
        return False
    m = re.search(r"##\s*Messages rubric(.*?)(?=\n##\s|\Z)", read(p), re.S | re.I)
    if not m:
        return False
    return "proposed" not in m.group(1)[:400].lower()


def _draft_groups(text):
    """Blockquote groups, each paired with the line index right after its
    last blockquote line — drafts()'s own line-indexed twin, so a caller can
    look at what follows a group without re-scanning. Blank lines do NOT
    split a draft — a markdown-legal multi-paragraph quote is one message
    (reviewer-caught 2026-08-16: a two-paragraph 400-char connect request
    fragmented into two under-limit pieces, defeating the length note). Any
    other prose line closes the draft.
    """
    lines = text.splitlines()
    out, cur, cur_end = [], [], None
    for i, ln in enumerate(lines):
        if ln.startswith(">"):
            cur.append(ln.lstrip("> ").rstrip())
            cur_end = i + 1
        elif ln.strip() == "":
            continue
        elif cur:
            out.append((" ".join(x for x in cur if x), cur_end))
            cur, cur_end = [], None
    if cur:
        out.append((" ".join(x for x in cur if x), cur_end))
    return out, lines


def drafts(text):
    """Blockquote groups, text only — see _draft_groups for the shape this
    scopes down from."""
    return [d for d, _ in _draft_groups(text)[0]]


def draft_rubric_line(lines, end_index):
    """design-honest-ceilings.md § 4.2: a draft's rubric line is the first
    non-blank line after its group, IF that line contains `rubric:`. A draft
    whose next non-blank line has no `rubric:` gets no rubric check — left
    alone on purpose."""
    j = end_index
    while j < len(lines) and lines[j].strip() == "":
        j += 1
    if j >= len(lines):
        return None
    return lines[j] if "rubric:" in lines[j].lower() else None


def rubric_marks(line):
    """[(criterion, mark)] for the five rubric criteria found on a rubric
    line, after normalizing filled-glyph variants. A mark is the first
    non-space character after the criterion name; anything elsewhere on the
    line ("~280/300 chars", a "?" in a note) is not a mark."""
    norm = line.translate(MARK_NORMALIZE)
    found = []
    for name in RUBRIC_CRITERIA:
        m = RUBRIC_MARK_RE[name].search(norm)
        if m:
            found.append((name, m.group(1)))
    return found


def rubric_line_checks(i, line):
    """FAIL/WARN rows for one draft's rubric line (design-honest-ceilings.md
    § 4.2): a mark other than ✓/✗ is a FAIL (the hedge-mark bug,
    t13-p1A 2026-09-26); a ✗ with no UNMET, or an UNMET with no ✗,
    is a WARN — no incident has shown either mismatch yet."""
    out = []
    marks = rubric_marks(line)
    for name, mark in marks:
        if mark not in ("✓", "✗"):
            out.append(("FAIL", f'draft {i}: rubric mark "{mark}" — each criterion is '
                                 '✓ or ✗; anything short of fully met is ✗, '
                                 'and the line says UNMET'))
    has_x = any(mark == "✗" for _, mark in marks)
    has_unmet = "unmet" in line.lower()
    if has_x and not has_unmet:
        out.append(("WARN", f"draft {i}: rubric has ✗ but no UNMET — say the bar wasn't "
                             "met, and what didn't fit"))
    if has_unmet and not has_x:
        out.append(("WARN", f"draft {i}: rubric says UNMET but marks nothing ✗ — mark the "
                             "criterion that failed"))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workspace", required=True, help="dir holding voice.md + pitch.md")
    ap.add_argument("--contacts", required=True, help="contacts/<company>.md to check")
    a = ap.parse_args()

    text = read(a.contacts)
    res = []

    if not rubric_pinned(a.workspace):
        res.append(("WARN", "pitch.md Messages rubric is PROPOSED/absent — drafts need the "
                            "candidate's pin before finalizing (WATCH forms enforced anyway)"))

    groups, lines = _draft_groups(text)
    ds = [d for d, _ in groups]
    # FAIL scope is the DRAFTS only — the rest of the file legitimately quotes
    # third parties (evidence chains, the recipient's own words as hooks), and
    # presence-in-file is not candidate-says-it (reviewer-caught 2026-08-16:
    # a recipient's quoted post containing a never-say phrase FAILed the file).
    if not ds:
        res.append(("WARN", "no draft blockquotes found in the file"))
    for i, (d, end_idx) in enumerate(groups, 1):
        m = ARROW_GLYPHS.search(d)
        if m:
            res.append(("FAIL", f'draft {i}: arrow glyph "{m.group(0)}" — write it in words'))
        m = ASCII_ARROWS.search(EXEMPT_SPANS.sub(" ", d))
        if m:
            res.append(("FAIL", f'draft {i}: arrow chain "{m.group(0)}" — write it in words '
                                '("from 80% to under 1%"); a reader sees an arrow as notes, '
                                'not a sentence'))
        # Quoting the JD's own bar is not the candidate's age tag (the sibling
        # checker's earned 2026-08-03 exemption, quote-span analogue here).
        unquoted = re.sub(r'["\u201c][^"\u201d]*["\u201d]', "", d)
        m = YEAR_COUNT.search(unquoted)
        if m:
            res.append(("FAIL", f'draft {i}: aggregate year count "{m.group(0)}" — the age tag; '
                                "answer with outcomes, not tenure (a double-quoted JD bar is exempt)"))
        chars, words = len(d), len(d.split())
        note = f"draft {i}: {chars} chars / {words} words"
        if chars > CONNECT_CHAR_LIMIT:
            note += f" (over the {CONNECT_CHAR_LIMIT}-char connect limit IF this is a connect request)"
        if words > THANKYOU_WORD_LIMIT:
            note += f" (over the {THANKYOU_WORD_LIMIT}-word thank-you limit IF this is a thank-you)"
        res.append(("INFO", note))

        rline = draft_rubric_line(lines, end_idx)
        if rline is not None:
            res.extend(rubric_line_checks(i, rline))

    fails = [r for r in res if r[0] == "FAIL"]
    warns = [r for r in res if r[0] == "WARN"]
    print(f"{os.path.basename(a.contacts)}: {'FAIL' if fails else 'pass'} "
          f"({len(fails)} fail, {len(warns)} warn, {len(ds)} drafts)")
    for level, msg in res:
        print(f"  [{level}] {msg}")
    # design-honest-ceilings.md § 6A: never print "clean" beside a
    # standing WARN. WARN rows only — not the INFO length notes.
    if fails:
        print("✘ fix the FAILs before finalizing")
    elif warns:
        n = len(warns)
        print(f"no failures, {'1 warning' if n == 1 else f'{n} warnings'} above — fix each one "
              "or tell the candidate")
    else:
        print("✔ message floor clean")
    print("  language tier (never-say, WATCH forms, paraphrases) → independent checker: "
          "profile/references/language-check.md")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
