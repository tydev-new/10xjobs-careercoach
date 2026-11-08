#!/usr/bin/env python3
"""Bootstrap must reject a contaminated source and initialize an empty schema from this tree."""
from pathlib import Path
import shutil, subprocess, sys, tempfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        bad = td / "contaminated"
        shutil.copytree(ROOT, bad, ignore=shutil.ignore_patterns(".git", ".venv", "__pycache__", ".pytest_cache"))
        (bad / ".env").write_text("SECRET=not-a-real-secret\n")
        refused = subprocess.run([sys.executable, str(bad / "setup/bootstrap.py"), str(td / "should-not-exist")], text=True, capture_output=True)
        if refused.returncode == 0 or (td / "should-not-exist").exists():
            raise SystemExit("contaminated bootstrap was accepted:\n" + refused.stdout + refused.stderr)
        clean = subprocess.run([sys.executable, str(ROOT / "setup/bootstrap.py"), str(td / "clean")], text=True, capture_output=True)
        if clean.returncode != 0 or "OK original schema: zero data/state rows" not in clean.stdout:
            raise SystemExit("empty bootstrap failed:\n" + clean.stdout + clean.stderr)
    print("bootstrap boundary: PASS (contaminated copy refused; empty schema initialized)")

if __name__ == "__main__":
    main()
