"""proposal_block.py — the paste block and its two mechanical rungs."""
import os, subprocess, sys, tempfile

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "skills", "apply", "scripts", "proposal_block.py")
BASE = "# Base\n## Experience\n- Set up scheduled job monitoring with alerting on failed overnight loads.\n- Built tested dbt models with peer review.\n"
COV = ("## Coverage\n| requirement | status | evidence | decision |\n|---|---|---|---|\n"
       "| Orchestrate scheduled data workflows | have | monitoring bullet | answered |\n"
       "| Tested dbt models | have | dbt bullet | answered |\n"
       "| A/B testing | gap | none | open |\n")
SEL = ("## Selection\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n"
       "| 1 | A | one | in | base | 5 | lead |\n"
       "| 2 | A | two | out | base | 6 | weakest |\n"
       "| 3 | A | three | out | base | 7 | next |\n"
       "| 4 | A | four | out | base | 8 | furthest |\n")


def run(app_text, base=BASE):
    ws = tempfile.mkdtemp()
    os.makedirs(os.path.join(ws, "applications"))
    open(os.path.join(ws, "base-resume.md"), "w").write(base)
    open(os.path.join(ws, "applications", "x.md"), "w").write(app_text)
    p = subprocess.run([sys.executable, SCRIPT, "--workspace", ws, "--application", "applications/x.md"],
                       capture_output=True, text=True)
    return p.returncode, p.stdout


def test_prints_the_cut_list_short_with_why():
    code, out = run(COV + SEL)
    body = out.split("--- paste")[0]
    assert "Cut — 3 of 4 bullets" in body
    assert "1. A — two — *weakest*" in body            # bullet + what it buys
    assert "| in |" not in body                       # the table stays in the file
    assert "A/B testing" in body and "Gaps" in body   # gaps as questions
    assert "Otherwise this is the version." in body


def test_have_row_missing_their_word_warns_and_near_vocab_does_not():
    code, out = run(COV + SEL)
    assert "Orchestrate" in out and "WARN" in out
    assert '"Tested dbt models"' not in out             # every content word is in the base


def test_out_rows_in_base_order_warns():
    code, out = run(COV + SEL)
    assert "base order" in out


def test_out_row_without_why_fails():
    bad = SEL.replace("| 2 | A | two | out | base | 6 | weakest |", "| 2 | A | two | out | base | — | — |")
    code, out = run(COV + bad)
    assert code == 1 and "nobody can weigh" in out


def test_missing_table_fails():
    code, out = run(COV)
    assert code == 1 and "no selection table" in out
