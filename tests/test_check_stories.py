"""check_stories.py — the storybank mechanical tier (IDs, files, Status)."""
import os, subprocess, sys, tempfile, textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "skills", "storybank", "scripts", "check_stories.py")

INDEX_HEAD = """\
# Storybank

## Coverage

| Competency | Source | Covered by |
|---|---|---|
| X | [inferred] | S001 |

## Stories

| ID | Title | Strength | Status | Notes |
|---|---|---|---|---|
"""


def run(index_rows, story_files=()):
    ws = tempfile.mkdtemp()
    with open(os.path.join(ws, "storybank.md"), "w") as f:
        f.write(INDEX_HEAD + index_rows)
    os.makedirs(os.path.join(ws, "stories"), exist_ok=True)
    for name in story_files:
        open(os.path.join(ws, "stories", name), "w").write("# story\n")
    p = subprocess.run([sys.executable, SCRIPT, "--workspace", ws],
                       capture_output=True, text=True)
    return p.returncode, p.stdout


def test_clean_bank_passes():
    rc, out = run("| S001 | A | 4 | confirmed | |\n"
                  "| S002 | B | 2 | draft [source: old-resume.pdf] | |\n",
                  ["S001-a.md", "S002-b.md"])
    assert rc == 0, out


def test_duplicate_id_fails():
    rc, out = run("| S001 | A | 4 | confirmed | |\n| S001 | B | 3 | confirmed | |\n",
                  ["S001-a.md"])
    assert rc == 1 and "duplicate" in out


def test_bad_status_fails():
    rc, out = run("| S001 | A | 4 | pending | |\n", ["S001-a.md"])
    assert rc == 1 and "invalid Status" in out


def test_row_without_file_and_orphan_file_fail():
    rc, out = run("| S001 | A | 4 | confirmed | |\n", ["S002-b.md"])
    assert rc == 1 and "no stories/" in out and "no index row" in out


def test_id_gap_warns_but_passes():
    rc, out = run("| S001 | A | 4 | confirmed | |\n| S003 | C | 3 | confirmed | |\n",
                  ["S001-a.md", "S003-c.md"])
    assert rc == 0 and "WARN" in out and "S002" in out


def test_empty_bank_passes():
    rc, out = run("")
    assert rc == 0, out
