"""Shape conformance — drift is loud, not sanctioned (founder, 2026-08-20).

Every CONVERTED skill carries the shape's files and required sections.
A skill missing one FAILS here the moment it drifts, instead of
accumulating a quiet exception. Checked: SKILL.md + the three references
and their required sections. scripts/ is NOT checked — the spec
sanctions shared-script hosting (positioning uses profile's checker),
so its presence is per-skill. Extend CONVERTED as skills adopt the
shape (docs/skill-shape.md).
"""
import os

SKILLS = os.path.join(os.path.dirname(__file__), "..", "skills")
CONVERTED = ["storybank", "profile", "search", "evaluate", "apply", "outreach", "interview", "learn", "coach"]


def _read(*parts):
    p = os.path.join(SKILLS, *parts)
    assert os.path.exists(p), f"missing file: {'/'.join(parts)}"
    return open(p, encoding="utf-8").read()


def test_converted_skills_have_the_five_files():
    for skill in CONVERTED:
        _read(skill, "SKILL.md")
        for ref in ("eval.md", "schema.md", "patterns.md"):
            _read(skill, "references", ref)


def test_eval_carries_who_checks_what():
    for skill in CONVERTED:
        assert "## Who checks what" in _read(skill, "references", "eval.md"), skill


def test_skill_md_carries_the_shape_sections():
    for skill in CONVERTED:
        t = _read(skill, "SKILL.md")
        for needle in ("Runs when", "ands back", "Session close", "## Guardrails"):
            assert needle in t, f"{skill}: missing {needle!r}"


def test_close_states_its_subagent_fact():
    # inline statement required — a pointer is not a statement (spec)
    for skill in CONVERTED:
        t = _read(skill, "SKILL.md")
        assert ("checker-subagent" in t or "language check" in t.lower()
                or "language checker" in t.lower()), skill


def test_loop_skills_score_as_a_count():
    # the loop-alignment design (founder 2026-08-21): the three persisting
    # loops score N/M held, read the rows before scoring, and the ceiling
    # is two equal rows — the SKILL states it, the schema declares the form
    for skill in ("profile", "apply"):
        body = _read(skill, "SKILL.md")
        assert "N/M held" in body, skill
        assert "same count" in body, skill
        flat = " ".join(body.split())          # whitespace-flexible (overclaim #14)
        assert ("rows first" in flat or "earlier" in flat and "rows" in flat
                or "-history.md` first" in flat), skill
        schema = _read(skill, "references", "schema.md")
        assert "N/M held" in schema and "one item" in schema, skill


def test_loop_skills_carry_the_evidence_law_verbatim():
    # the standard-does-not-bend law, one sentence, identical at every
    # tier-1 loop exit (founder 2026-08-20: improvement-loop.md dissolves;
    # the law is door-guard-pattern duplication, guarded here)
    LAW = "a claim-name without its number is not the claim"
    for skill in ("profile", "apply", "outreach"):
        assert LAW in _read(skill, "SKILL.md"), skill


def test_patterns_carries_the_proposal_rule():
    for skill in CONVERTED:
        assert "never self-adopted" in _read(skill, "references", "patterns.md"), skill
