#!/usr/bin/env python3
"""Print the candidate's DECISIONS as the short block the reply carries
beside the delivered document — and check the two things prose kept
failing (t10, ~20 trials across 2026-08):

  1. the cut list never reached the reply (pointed at, retyped loosely, or
     a 26-row table the model would not paste) → this script prints a
     SHORT list from the file's rows: each cut with what it buys, each
     shown-but-unnamed word with its placement, each gap as a question —
     the full seven-column tables stay in the file as the record;
  2. a requirement true in the base but missing the JD's own word was filed
     `have` instead of `shown-but-unnamed` → for every `have` row, the
     requirement's content words are looked up in the base résumé; absent
     words are named as a WARN.

Structure tier (the READ-split): what a script can see. Whether a cut is
the weakest for THIS posting stays the agent's judgment — the script only
notices when the `out` rows are in base order (their # strictly rising)
and says so.

    python3 proposal_block.py --workspace . --application applications/<key>.md
      [--base base-resume.md]

Exit 0 = clean or WARNs only; 1 = at least one FAIL (an `out` row with no
`why` or no `words` — a cut nobody can weigh).
"""
import argparse
import os
import re
import sys

COVERAGE_HEADER = "| requirement | status | evidence | decision |"
SELECTION_HEADER = "| # | role | bullet | in/out | source | words | why |"

STOP = set("""a an the and or of to in on for with at by from as is are be this that
these those their its our your we they it into over under up down out off
own data scale work working team teams across within""".split())


def table(lines, header):
    """The contiguous pipe rows under the exact header (check_files' rule)."""
    if header not in lines:
        return None
    rows = []
    for l in lines[lines.index(header) + 1:]:
        if not l.startswith("|"):
            break
        if set(l) <= set("|-: "):
            continue
        rows.append([c.strip() for c in l.strip("|").split("|")])
    return rows


def stem(w):
    w = w.lower()
    for suf in ("ations", "ation", "ings", "ing", "ies", "ers", "er", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def content_words(text):
    return [w for w in re.findall(r"[A-Za-z][A-Za-z\-/]+", text)
            if w.lower() not in STOP and len(w) > 2]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--application", required=True, help="applications/<key>.md (relative to workspace or absolute)")
    ap.add_argument("--base", help="base résumé path; defaults to <workspace>/base-resume.md")
    a = ap.parse_args()
    apath = a.application if os.path.isabs(a.application) else os.path.join(a.workspace, a.application)
    bpath = a.base or os.path.join(a.workspace, "base-resume.md")
    raw = open(apath, encoding="utf-8").read().replace("\\|", "")
    lines = [l.strip() for l in raw.splitlines()]
    base_text = open(bpath, encoding="utf-8").read() if os.path.exists(bpath) else ""
    base_stems = {stem(w) for w in content_words(base_text)}

    findings, out = [], []
    cov = table(lines, COVERAGE_HEADER)
    sel = table(lines, SELECTION_HEADER)
    if cov is None:
        findings.append(("FAIL", "no coverage table under the declared header — write it to the file first"))
    if sel is None:
        findings.append(("FAIL", "no selection table under the declared header — write it to the file first"))

    # The block is the candidate's DECISIONS, short, beside the delivered
    # document (founder 2026-08-21: deliver first, disclose beside, silence
    # is a yes). The full seven-column tables stay in the file as the
    # record; ~20 trials showed a 26-row table never reaches a reply.
    if sel is not None:
        outs = [r for r in sel if len(r) == 7 and r[3].lower().strip("`*_ ") == "out"]
        ins = [r for r in sel if len(r) == 7 and r[3].lower().strip("`*_ ") == "in"]
        if outs:
            out.append(f"**Cut — {len(outs)} of {len(outs) + len(ins)} bullets, weakest first.** Say \"keep <bullet>\" and it comes back.")
            for i, r in enumerate(outs, 1):
                bullet = r[2] if len(r[2]) <= 70 else r[2][:67].rstrip() + "…"
                out.append(f"{i}. {r[1]} — {bullet} — *{r[6]}*")
            if r[6].strip(" —-") == "":
                pass
        for r in outs:
            if r[6].strip(" —-") == "" or r[5].strip(" —-") == "":
                findings.append(("FAIL", f'out row #{r[0]} ({r[1]}) has no `why` or no `words` — a cut nobody can weigh'))
        nums = []
        for r in outs:
            try:
                nums.append(int(r[0]))
            except ValueError:
                pass
        if len(nums) >= 3 and all(x < y for x, y in zip(nums, nums[1:])):
            findings.append(("WARN", "the `out` rows are in base order (# strictly rising) — rank them weakest-first for THIS posting, "
                                     "in the file, then re-run"))

    if cov is not None:
        sbu = [r for r in cov if len(r) == 4 and r[1].lower().strip("`*_ ") == "shown-but-unnamed"]
        gaps = [r for r in cov if len(r) == 4 and r[1].lower().strip("`*_ ") == "gap"]
        if sbu:
            out.append("")
            out.append("**Their words, placed** — say \"Summary\" / \"Skills\" / \"leave it out\" to move any of these:")
            for r in sbu:
                out.append(f"- **{r[0]}** — true of you ({r[2][:60]}{'…' if len(r[2]) > 60 else ''}); placed where the document shows it")
        if gaps:
            out.append("")
            out.append("**Gaps — evidence you might have?** (\"no\" is a fine answer)")
            for r in gaps:
                out.append(f"- {r[0]} — {r[2][:80]}{'…' if len(r[2]) > 80 else ''}")
        for r in cov:
            if len(r) != 4:
                continue
            req, status = r[0], r[1].lower().strip("`*_ ")
            if status == "have" and base_text:
                missing = [w for w in content_words(req) if stem(w) not in base_stems]
                if missing:
                    findings.append(("WARN", f'`have` row "{req[:50]}": their word(s) {missing} do not appear in the base — '
                                             f'true in the base but missing THEIR word is `shown-but-unnamed`, and then it is a placement the candidate can move'))
    out.append("")
    out.append("Otherwise this is the version.")

    print("\n".join(out))
    print()
    print("--- paste everything above this line into the reply, beside the delivered document ---")
    for level, msg in findings:
        print(f"{level}  {msg}")
    if not findings:
        print("clean: proposal block printed; no FAIL, no WARN")
    sys.exit(1 if any(l == "FAIL" for l, _ in findings) else 0)


if __name__ == "__main__":
    main()
