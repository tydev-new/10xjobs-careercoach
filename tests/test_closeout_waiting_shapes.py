"""Tester-owned: every plan.md board shape the coach schema allows, run
through check_closeout's Waiting-on-you extraction — Python AND the JS
port, byte for byte.

Derived from the spec, not the code:
- skills/coach/references/schema.md § plan.md — `## Board` (Waiting on
  you · To do · Doing · Done, "as content exists"), then the optional
  `## Standing floor`, `## Queue`, `## Other notes`; an optional H1 title.
  Waiting on you is "one line per open question or gated decision, with a
  pointer to the file" — a row is a bullet line.
- check_closeout.py's contract (its docstring, coach SKILL.md § Session
  close, workspace-CLAUDE.md "Every reply closes"): an --asked question
  with no Waiting-on-you row sharing a keyword FAILs; asked + empty
  Waiting on you FAILs; an empty Board WARNs.
- docs/design-web-agent.md § 6.2: a Board section ends "at the next board
  heading or `##`" (parsePlanTodo's rule — the sibling parser of the
  same file).

Bug under test (2026-09-26): the old block-end lookahead `##\\b` never
matched "## Heading" (no word boundary between `#` and a space), so rows
under a following `## Standing floor` / `## Queue` leaked into Waiting on
you and could satisfy --asked falsely.

Each case writes plan.md as raw bytes to a fresh temp workspace (never a
real one), runs both engines, and checks (1) the rows Python extracts,
(2) the verdict, (3) JS stdout + exit identical to Python.
"""
import importlib.util, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, "skills", "coach", "scripts", "check_closeout.py")
JS = os.path.join(ROOT, "packages", "checkers", "bin", "check_closeout.mjs")
NODE = shutil.which("node")

_spec = importlib.util.spec_from_file_location("_tester_check_closeout", PY)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
waiting_rows = _mod.waiting_rows

HEAD = "# Plan — Test Candidate\nGoal: an offer by 2026-12-01\nBudget: 60 min/day\n\n## Board\n"
ROW = "- the comp floor — criteria.md § Compensation\n"
ROW_TEXT = "the comp floor — criteria.md § Compensation"
LEAK = "- timer: follow up Acme recruiter 10-02\n"   # a row that is NOT Waiting on you
ASK_ROW = "your comp floor"                          # shares "comp", "floor" with ROW only
ASK_LEAK = "follow up with the Acme recruiter"       # shares words with LEAK only
CLEAN = "close-out clean"
NO_ROW = "no Waiting-on-you row shares a word"
EMPTY = "Waiting on you is empty"

# What follows Waiting on you. Each tail's rows must NOT count as Waiting
# on you: board labels end the block; so does every heading (schema
# sections are `##`; an H1 or H3 after the Board is still a heading).
TAILS = {
    "to-do":          "To do\n" + LEAK,
    "doing":          "Doing\n" + LEAK,
    "done":           "Done\n" + LEAK,
    "standing-floor": "\n## Standing floor\n" + LEAK,
    "queue":          "\n## Queue\n" + LEAK,
    "other-notes":    "\n## Other notes\n" + LEAK,
    "h1-title":       "\n# Next plan\n" + LEAK,
    "h3":             "\n### Aside\n" + LEAK,
    "floor-then-queue": "\n## Standing floor\n- 1 practice rep a day\n\n## Queue\n" + LEAK,
}


def _run(cmd, ws, asked):
    args = ["--workspace", ws, "--stage", "applying"]
    for q in asked:
        args += ["--asked", q]
    r = subprocess.run(cmd + args, capture_output=True, text=True, encoding="utf-8")
    return r.returncode, r.stdout.replace(ws, "<WS>"), r.stderr.replace(ws, "<WS>")


def both(plan, *asked):
    """Write `plan` (str or bytes) to a fresh workspace; run Python and JS.
    Returns (py_rows, code, stdout). Asserts the JS port is byte-identical."""
    ws = tempfile.mkdtemp(prefix="tester-closeout-")
    try:
        data = plan if isinstance(plan, bytes) else plan.encode("utf-8")
        with open(os.path.join(ws, "plan.md"), "wb") as f:
            f.write(data)
        with open(os.path.join(ws, "plan.md"), encoding="utf-8") as f:
            rows = waiting_rows(f.read())      # the text exactly as the script reads it
        py = _run([sys.executable, PY], ws, asked)
        if NODE:
            js = _run([NODE, JS], ws, asked)
            assert js == py, f"JS != Python\n  plan={plan!r}\n  py={py!r}\n  js={js!r}"
        else:
            print("SKIPPED JS half of test_closeout_waiting_shapes: no `node` on PATH")
        return rows, py[0], py[1]
    finally:
        shutil.rmtree(ws, ignore_errors=True)


# ---------------------------------------------------------------- the ends

def test_every_block_end_excludes_the_following_rows():
    for name, tail in TAILS.items():
        plan = HEAD + "Waiting on you\n" + ROW + tail
        rows, code, out = both(plan, ASK_ROW)
        assert rows == [ROW_TEXT], f"{name}: rows={rows!r}"
        assert code == 0 and CLEAN in out, f"{name}: {code} {out!r}"


def test_question_matching_only_a_following_section_fails():
    # The bug's false pass: the asked question shares words only with a
    # row OUTSIDE Waiting on you. Must FAIL for every block end.
    for name, tail in TAILS.items():
        plan = HEAD + "Waiting on you\n" + ROW + tail
        rows, code, out = both(plan, ASK_LEAK)
        assert code == 1 and NO_ROW in out and "follow up" in out, f"{name}: {code} {out!r}"
        assert out.count("FAIL") == 1, f"{name}: only the leaked question fails: {out!r}"


def test_waiting_at_end_of_file():
    for plan in (HEAD + "Waiting on you\n" + ROW,
                 HEAD + "Waiting on you\n" + ROW.rstrip("\n"),
                 HEAD + "Waiting on you\n" + ROW + "\n\n"):
        rows, code, out = both(plan, ASK_ROW)
        assert rows == [ROW_TEXT], repr(plan)
        assert code == 0 and CLEAN in out


def test_full_schema_shape_waiting_last_in_board():
    # Board order is "as content exists"; Waiting on you last in the Board,
    # then every optional section.
    plan = (HEAD + "To do\n- review the Corvid letter (10 min)\nDoing\n- drafting Northpine letter\n"
            "Done\n- sent Acme application\nWaiting on you\n" + ROW +
            "- warm-path pick: which of the three mutuals to Flo — contacts/flo.md\n\n"
            "## Standing floor\n- 1 practice rep a day\n\n## Queue\n" + LEAK +
            "\n## Other notes\n- recruiter prefers mornings\n")
    rows, code, out = both(plan, ASK_ROW, "which mutual to ask Flo")
    assert rows == [ROW_TEXT, "warm-path pick: which of the three mutuals to Flo — contacts/flo.md"]
    assert code == 0 and CLEAN in out
    rows, code, out = both(plan, ASK_LEAK)
    assert code == 1 and NO_ROW in out
    rows, code, out = both(plan, "the Corvid letter review")   # a To do row is not a Waiting row
    assert code == 1 and NO_ROW in out


# ------------------------------------------------- empty Waiting on you

def test_empty_waiting_then_section_is_empty_both_ways():
    for name in ("standing-floor", "queue", "h3", "to-do"):
        plan = HEAD + "Waiting on you\n" + TAILS[name]
        rows, code, out = both(plan, ASK_LEAK)
        assert rows == [], f"{name}: {rows!r}"
        assert code == 1 and NO_ROW in out and EMPTY in out, f"{name}: {out!r}"


def test_empty_board_warns_when_only_queue_has_rows():
    # No To do, no Waiting rows — the Queue's rows are not the Board.
    plan = HEAD + "Waiting on you\n\n## Queue\n" + LEAK
    rows, code, out = both(plan)
    assert rows == [] and code == 0
    assert "WARN" in out and "no To do and no Waiting-on-you rows" in out, out


# ---------------------------------------------------- row shapes inside

def test_bullet_styles_and_continuations_stop_at_queue():
    plan = (HEAD + "Waiting on you\n"
            "- the comp floor\n  pointer: criteria.md § Compensation\n"
            "* which mutual to ask — contacts/flo.md\n"
            "• relocation answer — profile.md\n"
            "\n## Queue\n" + LEAK)
    rows, code, out = both(plan, "compensation pointer", "mutual", "relocation")
    assert rows == ["the comp floor pointer: criteria.md § Compensation",
                    "which mutual to ask — contacts/flo.md",
                    "relocation answer — profile.md"], rows
    assert code == 0 and CLEAN in out
    rows, code, out = both(plan, ASK_LEAK)
    assert code == 1 and NO_ROW in out


def test_row_text_starting_with_hash_is_still_a_row():
    # A row is a bullet line; its TEXT may start with `#` (an issue number,
    # a hashtag). That is not a heading and must not end the block. An
    # indented continuation starting with `#` is not a heading either.
    plan = (HEAD + "Waiting on you\n- #42 which referral to use — contacts/flo.md\n"
            "  #referral pointer\n" + ROW + "\n## Queue\n" + LEAK)
    rows, code, out = both(plan, "which referral", ASK_ROW)
    assert rows == ["#42 which referral to use — contacts/flo.md #referral pointer", ROW_TEXT], rows
    assert code == 0 and CLEAN in out


def test_crlf_lone_cr_and_bom():
    base = HEAD + "Waiting on you\n" + ROW + "\n## Standing floor\n- 1 rep\n\n## Queue\n" + LEAK
    for label, data in (("crlf", base.replace("\n", "\r\n").encode("utf-8")),
                        ("lone-cr", base.replace("\n", "\r").encode("utf-8")),
                        ("bom", b"\xef\xbb\xbf" + base.encode("utf-8")),
                        ("bom+crlf", b"\xef\xbb\xbf" + base.replace("\n", "\r\n").encode("utf-8"))):
        rows, code, out = both(data, ASK_ROW)
        assert rows == [ROW_TEXT], f"{label}: {rows!r}"
        assert code == 0 and CLEAN in out, f"{label}: {out!r}"
        rows, code, out = both(data, ASK_LEAK)
        assert code == 1 and NO_ROW in out, f"{label}: {out!r}"


def test_mixed_asked_one_real_one_leaked():
    plan = HEAD + "Waiting on you\n" + ROW + "\n## Queue\n" + LEAK
    rows, code, out = both(plan, ASK_ROW, ASK_LEAK)
    assert code == 1
    fails = [l for l in out.splitlines() if l.startswith("FAIL")]
    assert len(fails) == 1 and "follow up" in fails[0], out
