"""Tester-owned: docs/design-web-agent.md § 9.7 (amended 2026-09-24) — the
evaluate "record each role as soon as decided" hint. Written from the spec:
the hint is § 9.7's blockquote word for word, it sits in
skills/evaluate/references/patterns.md § Full evaluation — getting there, at
the END of step 7 ("Record it"), and it is a hint, not a step — nothing in
SKILL.md.  Run: python3 tests/run.py
"""
import os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DOC = open(os.path.join(ROOT, "docs/design-web-agent.md"), encoding="utf-8").read()
PATTERNS = open(os.path.join(ROOT, "skills/evaluate/references/patterns.md"), encoding="utf-8").read()
SKILL = open(os.path.join(ROOT, "skills/evaluate/SKILL.md"), encoding="utf-8").read()


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def _spec_hint():
    sec = DOC[DOC.index("### 9.7 Prevention in the skill (evaluate)"):DOC.index("### 9.8 Test plan")]
    quote = [l.strip()[1:].strip() for l in sec.splitlines() if l.strip().startswith(">")]
    assert quote, "§ 9.7 has no blockquote"
    return _norm(" ".join(quote))


def _section(md, title):
    start = md.index(title)
    nxt = md.find("\n## ", start + len(title))
    return md[start:nxt if nxt >= 0 else None]


def test_hint_is_verbatim_section_9_7():
    hint = _spec_hint()
    assert hint.startswith("In a run over several roles, record each one"), hint
    assert hint in _norm(PATTERNS), "patterns.md does not carry § 9.7's hint word for word"
    assert _norm(PATTERNS).count(hint) == 1, "the hint appears more than once"


def test_hint_sits_at_the_end_of_step_7_of_full_evaluation():
    sec = _section(PATTERNS, "## Full evaluation — getting there")
    step7 = sec.index("7. **Record it:**")
    step8 = sec.index("8. **")
    body = _norm(sec[step7:step8])
    hint = _spec_hint()
    assert hint in body, "the hint is not inside step 7 of § Full evaluation — getting there"
    assert body.endswith(hint), "the hint is not at the END of step 7"


def test_hint_is_not_a_step_and_not_in_skill_md():
    assert "record each one as soon as its verdict" not in SKILL
    assert "Never hold verdicts back" not in SKILL
    sec = _section(PATTERNS, "## Full evaluation — getting there")
    steps = re.findall(r"^(\d+)\. \*\*", sec, re.M)
    assert steps == [str(i) for i in range(1, 9)], f"the numbered steps changed: {steps}"
