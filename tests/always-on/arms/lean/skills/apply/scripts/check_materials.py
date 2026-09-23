#!/usr/bin/env python3
"""Mechanical pre-delivery check for tailored résumés and cover letters.

The apply skill's constraints were prose in references/patterns.md, which meant
they bound only if the model remembered to read them. This script makes the
checkable subset checkable. Run it BEFORE showing materials to the candidate.

    python3 check_materials.py --workspace . \
        --resume applications/foo-resume.md \
        --letter applications/foo-cover-letter.md

Exit 0 = clean, 1 = at least one FAIL. WARNs never fail the run — they are
judgment calls the agent must actively defend in its reply, not silently pass.

STRUCTURE TIER ONLY since #29 (the READ-split principle, measured by t15 —
docs/eval-t15-checker.md: the subagent 10/10 vs this parser's 5/10). The
language rungs (never-say, struck forms, confirm-tier) and their parsers
(load_hazards, load_never_say, quoted_phrases) are DELETED — the rungs'
incidents now enforced by profile/references/language-check.md, which also
catches the paraphrases exact-match never could. Receipts carried over:
never-say/struck forms earned 2026-08-17 ("three technology eras"); the
hazard parser's own failure (silently loading ZERO forms, 2026-08-17) is
the incident that earned the deletion.

Earned 2026-08-01: a tailored résumé shipped with a Summary AND a parallel
highlights band (the exact structure tailoring.md forbids), a 133-word case
against a 7-11s scan budget, and bullets that did not open with the JD's
phrasing. Every one of those rules was already written down.

Earned 2026-08-16 (the deletion valve, issue #25): rules that had become
checkable were still full prose in tailoring.md — moved here, prose deleted.
New rungs from the first live packet: --base verifies Experience bullets are
the base résumé's own sentences (the verbatim-bullets law as a guarantee,
candidate-caught 08-16: story-blended rewrites "feel taken out of context");
arrow glyphs (candidate-caught 08-16); repeated Summary numbers; banned
filler; grad-year/stale-date age tags; duplicated Summary/Experience
sentences.

Pruned 2026-08-18 (#11 guardrail sweep, the earned-FAIL bar): the
no-opening-section WARN (never fired; its incident class is the
two-opening-sections FAIL) and both checklist-shape WARNs (style
opinion hardened into code) deleted; the two spec-born letter FAILs
(word band, block count — never fired on a real document) demoted to
WARN until an incident promotes them.
"""
import argparse, os, re, sys

# patterns.md: standard section names win — ATS rank, and a custom H2 costs
# ranking position. Non-listed H2s WARN (the candidate may override knowingly).
STANDARD_SECTIONS = {
    "summary", "professional experience", "experience", "selected experience",
    "earlier experience", "other experience", "education", "skills", "key skills & tools",
    "key skills and tools", "patents", "patents & publications", "patents and publications",
    "patents, architectures & education", "selected work and publications",
    "selected work & publications", "selected work, publications & patents",
    "selected work, patents & publications", "publications", "certifications",
    "independent ai projects", "projects",
}

# profile/references/patterns.md § The three readers: recruiter scan is 7-11
# ~2 lines is invisible to the first reader, so the case gets a hard budget.
CASE_MAX_WORDS = 50
LETTER_MIN_WORDS, LETTER_MAX_WORDS = 250, 400  # patterns.md § Cover letter
LETTER_MAX_BLOCKS = 6   # salutation + hook + 2-3 body + why-us + close

# patterns.md assembly table / base-resume claim rules: an aggregate year count converts
# experience into an age tag.
YEAR_COUNT = re.compile(r"\b\d{2}\+?\s*(?:\+\s*)?years\b", re.I)
INFORMAL_SALUTATION = re.compile(r"^\s*(hello|hi|hey|greetings)\b[^,]*[—,-]?\s*$", re.I)

# patterns.md assembly table: arrows garble in ATS parsers and read as audit
# scaffolding that leaked into the document (candidate-caught 2026-08-16).
ARROW_GLYPHS = re.compile(r"[→⇒▸►◄←↔]")
# patterns.md § Shape: banned filler — generic strings, so no second-source issue.
FILLER = re.compile(r"\b(passionate|motivated|fast-paced environments?|outside the box)\b", re.I)
# Numeric tokens that carry claims (percents/multipliers) — years excluded by shape.
CLAIM_NUMBER = re.compile(r"\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?x\b")


def section(text, *names):
    """Return the body of the first H2 whose name contains any of names."""
    for m in re.finditer(r"^##\s+(.+?)\s*$", text, re.M):
        if any(n in m.group(1).lower() for n in names):
            nxt = re.search(r"^##\s+", text[m.end():], re.M)
            return text[m.end(): m.end() + nxt.start()] if nxt else text[m.end():]
    return ""


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()



def blocks(text):
    """Non-empty, non-heading paragraph blocks."""
    body = re.sub(r"^#.*$", "", text, flags=re.M)
    return [b.strip() for b in re.split(r"\n\s*\n", body) if b.strip()]


def check_resume(text, base_text=None, app_text=None):
    res = []
    add = res.append
    headings = re.findall(r"^##\s+(.+?)\s*$", text, re.M)
    lower = [h.lower().strip() for h in headings]

    # patterns.md assembly table row 1, as a guarantee: Experience bullets are
    # the base's own sentences. "Other Experience" is exempt (collapse-to-a-line
    # compression is allowed authorship there); the Summary is synthesis.
    if base_text:
        # whitespace and emphasis markers normalize away — bolding is
        # presentation, not wording
        def norm(s):
            return " ".join(s.replace("**", "").replace("*", "").split())
        norm_base = norm(base_text)
        # § Reworded declares JD-vocabulary rewordings the candidate approved
        # line by line (patterns.md § Rewording, candidate ruling 2026-08-19).
        # Each pair must name a REAL base line — a pair whose `base:` half is
        # not in the base would let anything through, so it is its own FAIL.
        declared = section(text, "reworded") + "\n" + section(app_text or "", "reworded")
        approved = set()
        for m in re.finditer(r"-\s*base:\s*(.+?)\n\s*tailored:\s*(.+?)(?=\n\s*-\s*base:|\n\s*#|\Z)",
                             declared, re.S):
            nb_src, nb_out = norm(m.group(1)), norm(m.group(2))
            if nb_src not in norm_base:
                add(("FAIL", f'§ Reworded declares a base line that is not in the base: '
                             f'"{nb_src[:60]}…" — the exemption cannot be self-issued'))
            else:
                approved.add(nb_out)
        exp = section(text, "selected experience", "professional experience") \
            or section(text, "experience")
        for b in re.findall(r"^-\s+(.*(?:\n(?![-#]).+)*)", exp, re.M):
            nb = norm(b)
            if nb and nb not in norm_base and nb not in approved:
                add(("FAIL", f'Experience bullet not verbatim from base: "{nb[:70]}…" — '
                             "patterns.md: selection is the tailoring. A JD-vocabulary "
                             "rewording is allowed only when the candidate approved it and "
                             "it is declared in § Reworded (base: / tailored: pair)"))

    # patterns.md assembly table: no repeated claim-number inside the Summary.
    summ = section(text, "summary")
    nums = CLAIM_NUMBER.findall(summ)
    dupes = sorted({n.strip() for n in nums if nums.count(n) > 1})
    if dupes:
        add(("WARN", f"claim number repeated inside the Summary: {dupes} — the case "
                     "carries the strongest number once; a repeat carries next-best evidence "
                     "instead (labels make a defended repeat legitimate)"))

    # patterns.md § Shape: dates hygiene — grad years and per-role 1990s dates
    # are age tags a clean pitch section can't undo.
    edu = section(text, "education")
    yr = re.search(r"\b(19|20)\d{2}\b", edu)
    if yr:
        add(("WARN", f'year "{yr.group(0)}" in Education — no graduation dates'))

    # Duplicated sentence between Summary and Experience (the same sentence
    # twice is the antipattern; number-with-how split is the pattern).
    exp_all = " ".join(text.split())
    for sent in re.split(r"[.;]\s+", " ".join(summ.split())):
        if len(sent.split()) >= 8 and exp_all.count(sent) > 1:
            add(("WARN", f'sentence appears in Summary AND Experience: "{sent[:60]}…" — '
                         "Summary carries the number, the role bullet carries the how"))
            break

    # patterns.md: ONE opening qualifications section, never Summary + a
    # parallel highlights band drawing on the same pool of wins.
    opener_like = [h for h in lower if any(
        k in h for k in ("summary", "highlight", "why i fit", "selected experience against",
                         "qualification", "profile"))]
    if len(opener_like) > 1:
        add(("FAIL", f"two opening sections drawing on the same wins: {opener_like} — "
                     "patterns.md allows ONE (case + checklist), never Summary + a highlights band"))

    for h, hl in zip(headings, lower):
        if hl not in STANDARD_SECTIONS:
            add(("WARN", f'non-standard section name "{h}" — ATS parsers rank on '
                         "standard names ('Professional Experience', not 'Where I've "
                         "Made Impact'); put the ambition in a subtitle line instead"))

    # The case: prose between the opening heading and the first checklist bullet.
    m = re.search(r"^##\s+.*$", text, re.M)
    if m and opener_like:
        after = text[m.end():]
        case = after.split("\n- ")[0]
        prose = [ln for ln in case.splitlines()
                 if ln.strip() and not ln.startswith(("#", "-", "*", ">"))]
        # a bolded/italic positioning line is a subtitle, not case prose
        prose = [ln for ln in prose if not re.fullmatch(r"[*_].*[*_]", ln.strip())]
        words = sum(len(ln.split()) for ln in prose)
        if words > CASE_MAX_WORDS:
            add(("FAIL", f"case is {words} words (max {CASE_MAX_WORDS}) — the summary obeys "
                         "the scan budget: a recruiter reads 7-11s in an F-pattern and "
                         "prose past ~2 lines is invisible"))

    _shared(text, add)
    return res


def check_letter(text):
    res = []
    add = res.append
    body = re.sub(r"^#.*$", "", text, flags=re.M)
    body = re.split(r"\n\s*(?:Sincerely|Best regards|Best,|Regards|Warm regards|Thank you,)", body)[0]
    words = len(body.split())
    # WARN, not FAIL — the earned-FAIL bar (#11 sweep): both rungs are
    # spec-born and have never fired on a real document; an incident
    # promotes them, a spec alone does not get to block.
    if not (LETTER_MIN_WORDS <= words <= LETTER_MAX_WORDS):
        add(("WARN", f"letter is {words} words — patterns.md § Cover letter wants "
                     f"{LETTER_MIN_WORDS}-{LETTER_MAX_WORDS}"))
    bl = blocks(body)
    if len(bl) > LETTER_MAX_BLOCKS:
        add(("WARN", f"{len(bl)} blocks — max {LETTER_MAX_BLOCKS} "
                     "(salutation + hook + 2-3 body + why-us + close)"))
    if bl and INFORMAL_SALUTATION.match(bl[0]):
        add(("FAIL", f'salutation "{bl[0].strip()}" is DM register — patterns.md: '
                     '"an application letter, not a relationship DM"; never invent a name, '
                     'use "Dear Hiring Manager"'))
    _shared(text, add)
    return res


def _shared(text, add):
    # § Claim rules is internal ("never ships") AND it is meta-text ABOUT
    # forbidden forms — a rule that names the hazard it bans would fail the
    # scan that enforces it. Strip it before scanning the shippable body.
    # Earned 2026-08-18: the rebuilt base FAILed on its own age-tag rule.
    text = re.split(r"^##\s*Claim rules", text, maxsplit=1, flags=re.M | re.I)[0]
    m = ARROW_GLYPHS.search(text)
    if m:
        add(("FAIL", f'arrow/scaffolding glyph "{m.group(0)}" — write transitions in words '
                     '("from 80% to under 1%"); glyphs garble in ATS parsers'))
    m = FILLER.search(text)
    if m:
        add(("FAIL", f'banned filler "{m.group(0)}" — patterns.md § Shape'))
    # Rule 3 bans the candidate's OWN aggregate year count ("25+ years of experience").
    # It does NOT ban quoting the JD's bar, which the checklist pattern actively
    # requires — a bullet opening "**10+ years in software engineering:** yes — ..."
    # is the pattern working. So strip the bolded JD-requirement openers before scanning.
    # Earned 2026-08-03: a Vercel résumé failed for echoing Vercel's own stated bar.
    prose = re.sub(r"^-\s*\*\*[^*]+\*\*", "- ", text, flags=re.M)
    m = YEAR_COUNT.search(prose)
    if m:
        add(("FAIL", f'aggregate year count "{m.group(0)}" in the candidate\'s own prose — '
                     "patterns.md § The Summary: answer with THEIR number instead. (Quoting "
                     "the JD's bar inside a bolded bullet opener is exempt.)"))
    # Three different 80%-shaped facts exist; two unlabeled on one surface is the hazard.
    if len(re.findall(r"\b80\s*%|\b80%", text)) > 1:
        add(("WARN", "more than one 80%-shaped claim on this surface — base-resume.md "
                     "requires labels (onboarding failures / production defects / test coverage)"))


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--workspace", required=True, help="dir holding voice.md + base-resume.md")
    p.add_argument("--resume")
    p.add_argument("--letter")
    p.add_argument("--base", help="base résumé path; defaults to <workspace>/base-resume.md "
                                  "when present — verifies Experience bullets verbatim")
    a = p.parse_args()

    if not a.resume and not a.letter:
        p.error("pass --resume and/or --letter")

    base_path = a.base or os.path.join(a.workspace, "base-resume.md")
    base_text = read(base_path) if os.path.exists(base_path) else None
    print("structure tier" + (", base résumé loaded for the verbatim check" if base_text else "")
          + " — language tier (never-say, struck forms, confirm-tier, paraphrases)"
            " → independent checker: profile/references/language-check.md (#29)")

    failed = False
    for label, path, fn in (("RESUME", a.resume, check_resume), ("LETTER", a.letter, check_letter)):
        if not path:
            continue
        if not os.path.exists(path):
            print(f"{label}: file not found: {path}")
            failed = True
            continue
        kw = {}
        if fn is check_resume:
            kw["base_text"] = base_text
            app_cand = re.sub(r"-resume\.md$", "-application.md", path)
            if app_cand != path and os.path.exists(app_cand):
                kw["app_text"] = read(app_cand)
        results = fn(read(path), **kw)
        fails = [r for r in results if r[0] == "FAIL"]
        print(f"\n{label} {os.path.basename(path)}: "
              f"{'FAIL' if fails else 'pass'} ({len(fails)} fail, {len(results) - len(fails)} warn)")
        for level, msg in results:
            print(f"  [{level}] {msg}")
        failed = failed or bool(fails)

    print("\n" + ("✘ fix the FAILs before delivering" if failed else "✔ mechanical checks clean"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
