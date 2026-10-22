"""Guard: nothing in the shipped tree looks like a real person's contact data or a machine-specific path."""
import re
from pathlib import Path

from tests import helpers as T

TEXT = {".py", ".md", ".yaml", ".yml", ".json", ".txt", ".ini", ".jsonl", ".cfg", ".toml"}
EMAIL = re.compile(r"[\w.+-]+@([\w-]+\.)+[a-z]{2,}", re.I)
PHONE = re.compile(r"(?<!\d)\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)")
MACHINE_PATH = re.compile(r"/(?:home|Users)/[a-z][\w.-]+/|/(?:workspace|mnt)/|C:\\\\Users\\\\", re.I)
OK_EMAIL = re.compile(r"@(?:example\.(?:com|org|net))$", re.I)

# The repo's own guard (tests/test_invariants.py PII), same pattern, so adding this folder to the repo scan passes.
REPO_PII = re.compile(
    r"/Users/[A-Za-z]|/home/[a-z]+/"
    r"|(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?!example\.)[A-Za-z0-9.-]+\.[a-z]{2,}"
    r"|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b"
    r"|linkedin\.com/in/[A-Za-z0-9-]+"
)


def files():
    for p in T.ROOT.rglob("*"):
        if p.is_file() and p.suffix in TEXT and "__pycache__" not in p.parts and p.name != Path(__file__).name:
            yield p


def test_no_real_emails_phones_or_machine_paths():
    bad = []
    for p in files():
        t = p.read_text(errors="replace")
        bad += [f"{p.relative_to(T.ROOT)}: email {m.group(0)}" for m in EMAIL.finditer(t) if not OK_EMAIL.search(m.group(0))]
        bad += [f"{p.relative_to(T.ROOT)}: phone-like {m.group(0)}" for m in PHONE.finditer(t)]
        bad += [f"{p.relative_to(T.ROOT)}: machine path {m.group(0)}" for m in MACHINE_PATH.finditer(t)]
    assert not bad, "\n".join(bad[:40])


def test_repo_pii_pattern_is_clean_here():
    hits = []
    for p in files():
        hits += [f"{p.relative_to(T.ROOT)}: {m.group(0)}" for m in REPO_PII.finditer(p.read_text(errors="replace"))]
    assert not hits, "\n".join(hits[:20])


def test_no_backup_db_or_bytecode_files_shipped():
    junk = [p for p in T.ROOT.rglob("*") if p.is_file() and "__pycache__" not in p.parts and ".pytest_cache" not in p.parts
            and re.search(r"\.bak|\.db$|\.sqlite$|\.pyc$", p.name)]
    assert not junk, junk
