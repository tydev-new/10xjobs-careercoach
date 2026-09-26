#!/usr/bin/env python3
"""Regression tests for apply/scripts/check_materials.py.

Every fixture below reproduces a REAL defect that shipped to a candidate on
2026-08-01 and had to be caught by the candidate rather than the system. A
checker that only passes clean documents proves nothing — these prove it
catches the specific failures that motivated it.

    python3 tests/test_check_materials.py
"""
import os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "apply", "scripts"))
import check_materials as cm  # noqa: E402

VOICE = '''# Voice

## Never-say list

- "passionate", "excited to", "thrilled"
- "pushed to their limit"
'''

BASE = '''# Base résumé

## Claim rules

- ⚠ never "solo" for 10xJobs — the team is him + one intern + AI agents.
- ⚠ never "in production with thousands of concurrent users" — 60+ beta users only.
- ⚠ never an aggregate year count ("25+ years") on any surface.
'''

# The real defect: Summary AND a parallel highlights band, plus a 133-word case.
RESUME_TWO_SECTIONS = '''# Alex Chen

## Summary

''' + ("word " * 133) + '''

## Selected experience against this role

**Sell — technical discovery through executive close**

- Ran a solutions-led transformation.
'''

RESUME_CLEAN = '''# Alex Chen

## Summary

**Forward-Deployed & Solutions Engineering Leader**
*Turning deployment friction into product strategy.*

Built the function twice, from zero, by treating deployment friction as product
intelligence rather than support noise. Still shipping production code today.

- **8+ years leading technical teams:** yes — shipping today.
- **Lead and scale a team:** built the function from zero.
- **Own discovery through close:** cut cycles 4 months to 3 weeks.
- **Executive sponsor:** redirected the account from near-cancellation.
- **Reusable playbooks:** 12-week engagements became 4-week.
- **Escalate product gaps:** built the field-metrics dashboard.

## Experience

Platform Lead — Northwind Labs.
'''

# The real defect: "Hello —" salutation and seven blocks.
LETTER_INFORMAL = '''# Cover letter

Hello —

''' + "\n\n".join(("filler " * 45).strip() for _ in range(6)) + '''

Alex Chen
'''

LETTER_CLEAN = '''# Cover letter

Dear Hiring Manager,

''' + "\n\n".join(("filler " * 60).strip() for _ in range(5)) + '''

Alex Chen
'''

LETTER_HAZARD = '''# Cover letter

Dear Hiring Manager,

''' + "\n\n".join(("filler " * 60).strip() for _ in range(4)) + '''

I built it solo, and I am excited to bring 25+ years of experience.

Alex Chen
'''


def run(text, kind, ws):
    # #29: language tier (never-say, struck forms, confirm) moved to the
    # checker-subagent; the code floor takes the text alone now.
    fn = cm.check_resume if kind == "resume" else cm.check_letter
    return fn(text)


def fails(results):
    return [m for lvl, m in results if lvl == "FAIL"]


def main():
    with tempfile.TemporaryDirectory() as ws:
        open(os.path.join(ws, "voice.md"), "w").write(VOICE)
        open(os.path.join(ws, "base-resume.md"), "w").write(BASE)

        cases = []

        # 1. the two-section redundancy the candidate had to point out
        f = fails(run(RESUME_TWO_SECTIONS, "resume", ws))
        cases.append(("two opening sections caught", any("two opening sections" in m for m in f)))
        # 2. the 133-word case against a 7-11s scan budget
        cases.append(("over-long case caught", any("Summary opens with" in m for m in f)))
        # 3. a correct résumé passes
        cases.append(("clean résumé passes", not fails(run(RESUME_CLEAN, "resume", ws))))
        # 4. informal salutation
        f = fails(run(LETTER_INFORMAL, "letter", ws))
        cases.append(("DM-register salutation caught", any("DM register" in m for m in f)))
        # 5. too many blocks — WARN since the #11 demote (earned-FAIL bar:
        # spec-born, never fired); must flag, must NOT block
        w = [m for lvl, m in run(LETTER_INFORMAL, "letter", ws) if lvl == "WARN"]
        cases.append(("block count flags as WARN", any("blocks" in m for m in w)))
        cases.append(("block count does not FAIL", not any("blocks" in m for m in f)))
        # 6. clean letter passes
        cases.append(("clean letter passes", not fails(run(LETTER_CLEAN, "letter", ws))))
        # 7-8 (claim-rule hazard, never-say) MIGRATED to the language
        # checker (#29) — the code floor must NOT catch them anymore:
        f = fails(run(LETTER_HAZARD, "letter", ws))
        cases.append(("hazard/never-say no longer code rungs",
                      not any("never-say" in m or "struck form" in m for m in f)))
        cases.append(("aggregate year count caught", any("year count" in m for m in f)))
        # 10-11. rule 1 vs rule 3: quoting the JD's bar in a bolded opener is REQUIRED
        # by rule 1 and must not trip rule 3; the candidate's own total still must.
        quoting = RESUME_CLEAN.replace(
            "- **8+ years leading technical teams:** yes — shipping today.",
            "- **10+ years in software engineering, with 5+ years leading delivery teams:** yes — shipping today.")
        cases.append(("JD's bar quoted in a bolded opener is exempt",
                      not any("year count" in m for m in fails(run(quoting, "resume", ws)))))
        own = RESUME_CLEAN.replace("Built the function twice",
                                   "With 25+ years of experience, built the function twice")
        cases.append(("candidate's own aggregate total still caught",
                      any("year count" in m for m in fails(run(own, "resume", ws)))))

        width = max(len(n) for n, _ in cases)
        bad = 0
        for name, ok in cases:
            print(f"  {'PASS' if ok else 'FAIL'}  {name.ljust(width)}")
            bad += not ok
        print(f"\n{len(cases) - bad}/{len(cases)} passed")
        return 1 if bad else 0


def test_mechanical_cases():
    # instrument fix 2026-08-18: main() sat behind the __main__ guard, so
    # run.py NEVER executed these cases — the suite's green was partial
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())



def test_language_parsers_deleted_and_contract_exists():
    """#29: the deletion valve receipt. The parsers that earned their
    deletion (load_hazards silently loaded ZERO forms, 2026-08-17) must
    be gone, and the enforcement's new owner must exist and carry all
    four rules with their severities."""
    for fn in ("load_hazards", "load_never_say", "quoted_phrases"):
        assert not hasattr(cm, fn), f"{fn} still present — the migration is half-done"
    contract = os.path.join(os.path.dirname(cm.__file__), "..", "..",
                            "profile", "references", "language-check.md")
    text = open(contract, encoding="utf-8").read()
    for rule in ("struck_form", "never_say", "confirm_qualifier", "watch_form", "search_jargon"):
        assert rule in text, f"contract missing {rule}"
    assert "fix-before-delivery" in text and "defend-or-qualify" in text
    assert "not checkable" in text, "missing-source convention absent"


BASE_RW = """# Alex Chen

## Professional Experience

### Meridian Health — Senior Data Analyst
**2022 - Present**

- Wrote and maintained SQL pipelines in Postgres over claims data, feeding the finance team.
- Collaborated with team on the quarterly forecast.

## Claim rules
- ⚠ never "solo" — team of two.
"""


def _rw(resume_body):
    return "# Alex Chen\n\n## Summary\n\nSenior analyst.\n\n## Selected Experience\n\n### Meridian Health\n**2022**\n\n" + resume_body


def test_declared_rewording_is_exempt():
    """Candidate ruling 2026-08-19: a JD-vocabulary rewording is allowed when
    approved and declared; the guarantee becomes 'nothing reworded OFF THE
    RECORD', not 'nothing reworded'."""
    body = ("- Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n\n"
            "## Reworded\n\n"
            "- base: Wrote and maintained SQL pipelines in Postgres over claims data, feeding the finance team.\n"
            "  tailored: Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n")
    f = fails(cm.check_resume(_rw(body), base_text=BASE_RW))
    assert not any("not verbatim" in m for m in f), f


def test_undeclared_rewording_still_fails():
    body = "- Built and owned data pipelines in Postgres over claims data, feeding the finance team.\n"
    f = fails(cm.check_resume(_rw(body), base_text=BASE_RW))
    assert any("not verbatim" in m for m in f), "an undeclared rewording must still FAIL"


def test_reworded_block_cannot_self_issue_its_exemption():
    """The `base:` half must name a REAL base line — otherwise the block is a
    licence to write anything."""
    body = ("- Led a 60-person organization across three continents.\n\n"
            "## Reworded\n\n"
            "- base: Led a 60-person organization across three continents.\n"
            "  tailored: Led a 60-person organization across three continents.\n")
    f = fails(cm.check_resume(_rw(body), base_text=BASE_RW))
    assert any("not in the base" in m for m in f), f


# Owner ruling 6 (2026-09-25, docs/design-apply-three-lens.md § 4): ASCII
# arrow chains are the same failure class as the Unicode glyphs above.
def _letter(body):
    return ("# Cover letter\n\nDear Hiring Manager,\n\n" + body + "\n\nAlex Chen\n")


def test_ascii_arrow_chain_fails_each_form():
    for form in ("->", "-->", "<-", "<->", "=>", "==>", "<=>"):
        text = _letter(f"Growth went 80{form}90 this quarter, every week, without exception at all.")
        f = fails(cm.check_letter(text))
        assert any("arrow chain" in m for m in f), (form, f)


def test_ascii_arrow_exempt_spans_pass():
    exempt = [
        _letter("```\na->b\n```\n\nExplained the diagram above to the whole panel, calmly and clearly."),
        _letter("<!-- a->b -->\n\nReviewed the whole draft twice before sending, carefully and calmly."),
        _letter("The old macro was `a->b` in the legacy build script, never shipped externally."),
        _letter("See https://example.com/a->b for the writeup, thanks for reading it all today."),
    ]
    for text in exempt:
        f = fails(cm.check_letter(text))
        assert not any("arrow chain" in m for m in f), (text, f)


def test_ascii_le_ge_do_not_fail():
    text = _letter("Latency stayed <=5ms and throughput >=99% the whole quarter without incident.")
    f = fails(cm.check_letter(text))
    assert not any("arrow" in m for m in f), f


def test_bullets_only_summary_passes_case_budget():
    resume = (
        "# Alex Chen\n\n## Summary\n\n"
        "- Platform engineering leader delivering reliability at scale.\n"
        "- Cut incident response time from 4 hours to 40 minutes.\n"
        "- Built the on-call rotation from zero to a 6-person bench.\n\n"
        "## Experience\n\nPlatform Lead — Northwind Labs.\n"
    )
    f = fails(cm.check_resume(resume))
    assert not any("Summary opens with" in m for m in f), f
