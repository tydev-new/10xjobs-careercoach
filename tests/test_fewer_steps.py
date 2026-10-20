#!/usr/bin/env python3
"""Phase B of docs/design-fewer-steps.md: the wording that cuts steps.

Pins the new text, word for word where the design gives it, and the two
lines the design says must NOT change (the first two clauses of the
close-out, and "How you talk"'s honesty rule).

    python3 tests/test_fewer_steps.py
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def _read(*p):
    with open(os.path.join(REPO, *p), encoding="utf-8") as f:
        return f.read()


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


TEMPLATE = ("skills", "profile", "templates", "workspace-CLAUDE.md")


def test_b1_guardrails_close_out_runs_only_when_due():
    body = _norm(_read(*TEMPLATE))
    assert _norm("""Before a reply ends: name the stage the search is in; every question
        you asked the candidate is a row in `plan.md` § Waiting on you, this
        turn; "what's my plan?" writes the plan, even beside another ask. Then,
        if this reply wrote or changed a file, asks the candidate anything, or
        says their plan changed, run the checks once, together in one command:
        the coach skill's close-out check (the `check_closeout` script in its
        scripts folder) with `--workspace . --stage <stage> --asked "<each
        question>"`, plus the checks named in your skill's Session close. Read
        both outputs; a FAIL in either is fixed before sending. A reply that did
        none of the three is not due a check. Another skill serving the ask does
        not end the coaching turn. Report check results as outcomes, never
        narration (clean is one line).""") in body
    assert "run the coach skill's close-out check" not in body  # the v8 "every reply" sentence is gone


def test_b1_marker_is_v9():
    assert _read(*TEMPLATE).splitlines()[0].startswith("<!-- 10xjobs guardrails v9 ")


def test_b1_honesty_rule_is_untouched():
    # the design routes any change here to the lead; it must not move quietly
    body = _norm(_read(*TEMPLATE))
    assert ("Plain words drop nothing: every count, every check that didn't run, "
            "and everything you can't do is still said.") in body


def test_b1_coach_session_close_is_one_command_with_semicolon():
    body = _norm(_read("skills", "coach", "SKILL.md"))
    assert _norm("""- **Session close:** when the workspace `CLAUDE.md`'s close-out says a
        check is due, run `node scripts/check_closeout.mjs --workspace . --stage
        <stage> --asked "<each question>" ; node ../profile/scripts/check_files.mjs
        --workspace .` as one command and fix any FAIL before sending. No
        checker-subagent is spawned (coach's voice). Report outcomes, never
        narration (clean is one line).""") in body
    assert "&&" not in body.split("**Session close:**", 1)[1].split("\n", 1)[0]


def test_b3_guardrails_hint_one_listing_shows_both():
    assert "Check both at the start of a session (one listing of the folder shows both)" in _norm(_read(*TEMPLATE))


def test_b2_b3_host_note_says_where_things_are():
    note = _norm(_read("skills", "profile", "templates", "web-host-note.md"))
    for needle in (
        "The workspace is set up: `CLAUDE.md` is in place, and `documents/` and `jd-inbox/` need no making",
        "Skip profile's Setup.",
        "One `list_files` call with no folder shows the whole workspace.",
        "Skills live under `skills/<skill>/` and are read-only.",
        "A path a skill gives starts from its own folder: `references/patterns.md` in profile is skills/profile/references/patterns.md.",
        "Run a script as `node <name>.mjs` with the skill's arguments; the file name is enough.",
        "Never list or search `skills/` with `bash`. The skill names every file you need.",
    ):
        assert needle in note, needle
    assert "`CLAUDE.md` is already in place." not in note


def test_design_web_agent_does_not_say_check_closeout_reads_updated_at():
    doc = _norm(_read("docs", "design-web-agent.md"))
    assert "which `check_closeout` reads" not in doc
    assert "`check_closeout` does not read it" in doc


if __name__ == "__main__":
    n = 0
    for k, v in sorted(globals().items()):
        if k.startswith("test_"):
            v()
            n += 1
    print(f"{n} passed")
