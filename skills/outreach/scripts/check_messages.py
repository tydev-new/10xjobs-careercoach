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
# row in docs/receipts.md § apply. No JS port: there is no parity item
# for this script.
ASCII_ARROWS = re.compile(r"<=+>|<-+>?|-+>|=+>")
EXEMPT_SPANS = re.compile(r"```.*?```|~~~.*?~~~|<!--.*?-->|``[^\n]*?``|`[^`\n]*`|https?://\S+", re.S)
YEAR_COUNT = re.compile(r"\b\d{2}\+?\s*(?:\+\s*)?years\b", re.I)
CONNECT_CHAR_LIMIT = 300      # eval.md § Channel limits: connection request
THANKYOU_WORD_LIMIT = 120     # eval.md § Channel limits: thank-you note


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


def drafts(text):
    """Blockquote groups. Blank lines do NOT split a draft — a markdown-legal
    multi-paragraph quote is one message (reviewer-caught 2026-08-16: a
    two-paragraph 400-char connect request fragmented into two under-limit
    pieces, defeating the length note). Any other prose line closes the draft.
    """
    out, cur = [], []
    for ln in text.splitlines():
        if ln.startswith(">"):
            cur.append(ln.lstrip("> ").rstrip())
        elif ln.strip() == "":
            continue
        elif cur:
            out.append(" ".join(x for x in cur if x))
            cur = []
    if cur:
        out.append(" ".join(x for x in cur if x))
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

    ds = drafts(text)
    # FAIL scope is the DRAFTS only — the rest of the file legitimately quotes
    # third parties (evidence chains, the recipient's own words as hooks), and
    # presence-in-file is not candidate-says-it (reviewer-caught 2026-08-16:
    # a recipient's quoted post containing a never-say phrase FAILed the file).
    if not ds:
        res.append(("WARN", "no draft blockquotes found in the file"))
    for i, d in enumerate(ds, 1):
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

    fails = [r for r in res if r[0] == "FAIL"]
    print(f"{os.path.basename(a.contacts)}: {'FAIL' if fails else 'pass'} "
          f"({len(fails)} fail, {sum(1 for r in res if r[0]=='WARN')} warn, {len(ds)} drafts)")
    for level, msg in res:
        print(f"  [{level}] {msg}")
    print("✘ fix the FAILs before finalizing" if fails else "✔ message floor clean")
    print("  language tier (never-say, WATCH forms, paraphrases) → independent checker: "
          "profile/references/language-check.md")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
