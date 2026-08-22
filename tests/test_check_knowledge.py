"""check_knowledge.py — Map scope/status grammar."""
import os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "skills", "learn", "scripts", "check_knowledge.py")
HEAD = "# K\n\n## Map\n\n| Topic | Scope | Source | Status |\n|---|---|---|---|\n"


def run(rows):
    ws = tempfile.mkdtemp()
    open(os.path.join(ws, "knowledge.md"), "w").write(HEAD + rows)
    p = subprocess.run([sys.executable, SCRIPT, "--workspace", ws],
                       capture_output=True, text=True)
    return p.returncode, p.stdout


def test_clean_map_passes():
    rc, out = run("| X | track-A | [inferred] | gap |\n"
                  "| Y | role: mesh-head-of-fde | Mesh JD | studying |\n")
    assert rc == 0, out


def test_em_dash_scope_fails():
    rc, out = run("| X | role: mesh—head-of-fde | Mesh JD | gap |\n")
    assert rc == 1 and "bad scope" in out


def test_prose_status_fails():
    rc, out = run("| X | track-A | [inferred] | gap (long shot, skip) |\n")
    assert rc == 1 and "bad status" in out
