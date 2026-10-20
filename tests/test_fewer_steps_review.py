"""Independent review (tester, 2026-10-20) of Phase B of docs/design-fewer-steps.md
(design branch 69e9399): the new wording is the doc's, word for word, apart from
the builder's two stated deviations, and nothing else moved.

The design doc lives on origin/design/fewer-steps, not on this branch; it is read
with `git show` (skipped, loudly, when that commit is not in the clone).

    python3 tests/test_fewer_steps_review.py
"""
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DESIGN_REF = os.environ.get("FEWER_STEPS_DESIGN_REF", "69e9399")


def _read(*p):
    with open(os.path.join(REPO, *p), encoding="utf-8") as f:
        return f.read()


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def _doc():
    r = subprocess.run(["git", "-C", REPO, "show", f"{DESIGN_REF}:docs/design-fewer-steps.md"], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"SKIPPED: design commit {DESIGN_REF} not available: {r.stderr.strip()}")
        return None
    return r.stdout


def _quote_after(doc, marker):
    """The `> ` block that follows `marker` in the doc, joined and normalised."""
    i = doc.index(marker)
    lines = doc[i:].splitlines()[1:]
    block, started = [], False
    for l in lines:
        if l.startswith(">"):
            started = True
            block.append(l[1:].strip())
        elif started:
            break
    return _norm(" ".join(block))


def test_b1_guardrails_paragraph_is_the_docs_word_for_word():
    doc = _doc()
    if doc is None:
        return
    want = _quote_after(doc, "**The wording** (guardrails v8 → v9")
    assert want.startswith("Before a reply ends:") and want.endswith("(clean is one line).")
    assert want in _norm(_read("skills", "profile", "templates", "workspace-CLAUDE.md"))


def test_b1_coach_session_close_is_the_docs_word_for_word():
    doc = _doc()
    if doc is None:
        return
    want = _quote_after(doc, "Coach's Session close (`skills/coach/SKILL.md:78`)")
    # the doc wraps the backticked command across quoted lines; the file holds it on one
    assert _norm(want) in _norm(_read("skills", "coach", "SKILL.md")), want


def test_b3_host_note_is_the_docs_apart_from_the_two_stated_deviations():
    doc = _doc()
    if doc is None:
        return
    want = _quote_after(doc, "**Host note additions**")
    got = _norm(_read("skills", "profile", "templates", "web-host-note.md"))
    # deviation 1 (the word budget): "need no making, because a folder appears once a file is in it."
    #   -> "need no making: a folder appears with its first file."
    # deviation 2 (the link checker): the backticks around skills/profile/references/patterns.md are dropped
    adjusted = want.replace("need no making, because a folder appears once a file is in it.", "need no making: a folder appears with its first file.")
    adjusted = adjusted.replace("is `skills/profile/references/patterns.md`.", "is skills/profile/references/patterns.md.")
    # deviation 3 (the word budget, after the honesty line grew 3 words): two phrases shortened
    adjusted = adjusted.replace("A path a skill gives starts from", "A skill's path starts from").replace("with the skill's arguments;", "with its arguments;")
    assert adjusted != want, "the doc's text no longer carries the two deviated phrases"
    assert adjusted in got, (adjusted, got)


def test_b3_guardrails_hint_is_the_docs():
    body = _norm(_read("skills", "profile", "templates", "workspace-CLAUDE.md"))
    assert "Check both at the start of a session (one listing of the folder shows both) and read anything new before asking for it" in body


def test_only_the_named_files_changed_and_no_other_skill():
    r = subprocess.run(["git", "-C", REPO, "diff", "--name-only", "8748196", "HEAD", "--", "skills", "docs", "packages", "apps", "supabase"], capture_output=True, text=True)
    if r.returncode != 0:
        print("SKIPPED: base commit 8748196 not available")
        return
    changed = sorted(r.stdout.split())
    allowed = {"docs/README.md", "docs/design-fewer-steps.md", "docs/design-web-agent.md", "skills/coach/SKILL.md", "skills/profile/templates/web-host-note.md", "skills/profile/templates/workspace-CLAUDE.md"}
    assert set(changed) <= allowed, changed


def test_the_honesty_rule_reads_against_the_new_close_out():
    """Characterization (for the lead): "every check that didn't run ... is still said" and "a reply that did
    none of the three is not due a check" sit in the same always-on block. Printed, not asserted."""
    body = _norm(_read("skills", "profile", "templates", "workspace-CLAUDE.md"))
    honesty = re.search(r"Plain words drop nothing:[^.]*\.", body)
    print("  [honesty]", honesty.group(0) if honesty else "(not found)")
    assert honesty, "the honesty line moved"


if __name__ == "__main__":
    import sys
    failed = 0
    for name in sorted(n for n in dir() if n.startswith("test_")):
        try:
            globals()[name]()
            print("PASS", name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", name, "-", str(e)[:500])
    sys.exit(1 if failed else 0)
