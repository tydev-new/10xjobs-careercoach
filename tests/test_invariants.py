"""The invariants test (#35) — what must be true across EVERY skill, so the
shape stays the shape after the rollout. Each check is one of the
classes sixteen independent reviews caught by hand on 2026-08-21; here
they fail on every `tests/run.py`, instead of needing a reviewer.

Structure only — what code can see. Conduct stays with the harness.
"""
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
SKILLS = os.path.join(ROOT, "skills")
sys.path.insert(0, os.path.join(SKILLS, "profile", "scripts"))
import check_files as cf  # noqa: E402

ALL = sorted(os.path.basename(d) for d in glob.glob(os.path.join(SKILLS, "*")) if os.path.isdir(d))
STAGES_OF_A_SECTION = ("Runs when", "Exits")


def read(*parts):
    return open(os.path.join(SKILLS, *parts), encoding="utf-8").read()


def loop_sections(skill):
    """Every `### ...` section between '## Loops'/'## Sequences'/'## The loop' and '## State'."""
    t = read(skill, "SKILL.md")
    m = re.search(r"^## (?:Loops and sequences|Sequences|The loop and the sequences|The loop|The loops)\b.*?(?=^## State)", t, re.S | re.M)
    if not m:
        return []
    body = m.group(0)
    parts = re.split(r"^### ", body, flags=re.M)[1:]
    return [(p.split("\n", 1)[0].strip(), p) for p in parts]


def test_every_skill_is_converted():
    # the rollout is complete; a new skill must carry the shape from day one
    from test_skill_shape import CONVERTED
    assert set(ALL) == set(CONVERTED), f"unconverted or unlisted: {set(ALL) ^ set(CONVERTED)}"


def test_every_section_has_runs_when_and_exits():
    for skill in ALL:
        for title, body in loop_sections(skill):
            if title.lower().startswith("the other") or title.lower().startswith("the satellites") or title.lower().startswith("asking the bank"):
                continue  # the rule-4 table, not a section
            for needle in STAGES_OF_A_SECTION:
                assert needle in body, f"{skill} § {title}: missing '{needle}'"


def test_every_loop_has_a_standard_a_budget_and_a_ceiling():
    for skill in ALL:
        for title, body in loop_sections(skill):
            if "(the loop)" not in title.lower() and not title.startswith("Improve"):
                continue
            flat = " ".join(body.split())
            for needle in ("**Standard:**", "**Budget:**"):
                assert needle in flat, f"{skill} § {title}: missing {needle}"
            assert "ceiling" in flat or "two rounds" in flat or "two rows" in flat or "two reps" in flat or "two weekly" in flat, \
                f"{skill} § {title}: no ceiling at the exit"


def test_loop_sections_stay_short():
    # the skeleton (skill-shape rule 3): ~300 words per loop; hard ceiling 600
    for skill in ALL:
        for title, body in loop_sections(skill):
            if "(the loop)" not in title.lower() and not title.startswith("Improve"):
                continue
            n = len(body.split())
            assert n <= 600, f"{skill} § {title}: {n} words — a loop is a skeleton, not a procedure"


def test_one_owner_per_schema_file_and_manifest_agrees():
    schemas = cf.load_schemas(SKILLS)
    for name, s in schemas.items():
        assert s.get("owner") in ALL, f"{name}: owner {s.get('owner')!r} is not a skill"
    for fname, owner in cf.MANIFEST_FILES.items():
        if fname in schemas:
            assert schemas[fname]["owner"] in owner, f"{fname}: schema owner {schemas[fname]['owner']} vs manifest '{owner}'"


def test_cross_skill_links_resolve():
    problems = [f"{l}: {m}" for l, m in cf.check_skill_prose(os.path.abspath(SKILLS)) if l == "FAIL"]
    assert not problems, "\n".join(problems)


def test_session_close_names_its_scripts_and_the_subagent_fact():
    for skill in ALL:
        t = read(skill, "SKILL.md")
        m = re.search(r"\*\*Session close[^*]*\*\*(.*?)(?=^## |\Z)", t, re.S | re.M)
        assert m, f"{skill}: no Session close"
        close = m.group(1)
        assert ".py" in close, f"{skill}: Session close names no script"
        assert "subagent" in close or "checker" in close.lower(), f"{skill}: Session close does not state the subagent fact"


def test_eval_is_verdict_bearing_and_patterns_has_the_proposal_rule():
    for skill in ALL:
        e = read(skill, "references", "eval.md")
        assert "## Who checks what" in e, skill
        assert "## Boundaries" not in e or "consumer" in e, f"{skill}: § Boundaries must be a consumer bar, not the skill's own conduct"
        p = read(skill, "references", "patterns.md")
        assert "never self-adopted" in p, skill


def test_no_reference_restates_a_loop_rule_verbatim():
    # a sentence of 12+ words that appears in SKILL.md's loop sections AND in a
    # reference is a second authority (the class cut in every review)
    for skill in ALL:
        loops = " ".join(body for _, body in loop_sections(skill))
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", " ".join(loops.split())) if len(s.split()) >= 12]
        refs = " ".join(" ".join(read(skill, "references", r).split()) for r in ("eval.md", "schema.md", "patterns.md"))
        dupes = [s for s in sentences if s in refs]
        assert not dupes, f"{skill}: restated in a reference: {dupes[0][:90]!r}"
