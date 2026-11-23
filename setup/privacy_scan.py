#!/usr/bin/env python3
"""Heuristic publication scan for this kit.

A passing scan is not proof of anonymization, legal clearance, or production readiness.
It rejects obvious secrets, private machine paths, non-example contact data, generated
state, and a public profile that is no longer the bundled synthetic example.
"""
from pathlib import Path
import argparse, re, sys, tempfile, textwrap
import yaml

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}(?!\d)")
# Patterns are assembled so this file does not contain the strings it rejects.
_WIN_USERS = "\\" + "Users" + "\\"
HOME = re.compile("(?:/Users" + "/|/home/" + "[A-Za-z0-9._-]+/" + "|" + re.escape(_WIN_USERS) + "|[A-Za-z]:" + re.escape(_WIN_USERS) + ")")
DRIVE = re.compile(r"https?://(?:drive|docs)\.google\.com/", re.I)
PROFILE_URL = re.compile(r"https?://(?:www\.)?linkedin\.com/in/", re.I)
SECRET = re.compile(
    r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----"
    r"|ghp_[A-Za-z0-9]{20,}"
    r"|github_pat_[A-Za-z0-9_]{20,}"
    r"|AKIA[0-9A-Z]{16}"
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"
)
ALLOWED_EMAIL_DOMAINS = {"example.invalid", "example.com", "example.org"}
STATE_SUFFIXES = {".pdf", ".docx", ".db", ".sqlite", ".sqlite3", ".pyc"}
SKIP_DIRS = {".git", ".venv", "__pycache__", ".pytest_cache"}

def problems_in_text(rel, text):
    out = []
    for rx, label in ((HOME, "private-path"), (DRIVE, "cloud-file-url"), (PROFILE_URL, "profile-url"), (SECRET, "secret")):
        m = rx.search(text)
        if m:
            out.append(f"{rel}: {label}: {m.group(0)[:80]}")
    for m in EMAIL.finditer(text):
        domain = m.group(0).rsplit("@", 1)[-1].lower()
        if domain not in ALLOWED_EMAIL_DOMAINS:
            out.append(f"{rel}: email: {m.group(0)}")
    m = PHONE.search(text)
    if m:
        out.append(f"{rel}: phone: {m.group(0)}")
    return out

def iter_files(root):
    for p in root.rglob("*"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.is_symlink():
            yield p, "symlink"
        elif p.is_file():
            yield p, None

def scan(root):
    root = Path(root).resolve()
    found = []
    for p, kind in iter_files(root):
        rel = p.relative_to(root).as_posix()
        if kind == "symlink":
            found.append(f"{rel}: symlink")
            continue
        if p.name == ".env" or p.name.startswith(".env.") or p.suffix.lower() in STATE_SUFFIXES:
            found.append(f"{rel}: generated-or-secret-file")
            continue
        data = p.read_bytes()
        if b"\0" in data:
            found.append(f"{rel}: binary")
            continue
        found.extend(problems_in_text(rel, data.decode("utf-8", "replace")))
    found.extend(empty_state(root))
    return found

def load_yaml(path):
    if not path.is_file():
        return None
    return yaml.safe_load(path.read_text()) or {}

def empty_state(root):
    out = []
    profile = load_yaml(root / "workspace/job-search/profile/profile.yaml")
    if profile is None:
        return ["missing workspace/job-search/profile/profile.yaml"]
    ident = profile.get("identity") or {}
    if profile.get("synthetic") is not True or ident.get("synthetic") is not True:
        out.append("profile.yaml: synthetic flag is not true")
    if ident.get("name") != "Alex Example" or ident.get("email") != "alex@example.invalid":
        out.append("profile.yaml: public identity is not the bundled Alex Example placeholder")
    if ident.get("phone") not in (None, ""):
        out.append("profile.yaml: phone is set")
    if ident.get("standing_answer_rules"):
        out.append("profile.yaml: standing answers are set")
    if profile.get("submit_authorized") not in (False, None):
        out.append("profile.yaml: submit is authorized")
    if profile.get("send_authorized") not in (False, None):
        out.append("profile.yaml: send is authorized")
    if profile.get("fields"):
        out.append("profile.yaml: fields are populated")
    claims = load_yaml(root / "workspace/job-search/profile/claims.yaml")
    if not claims or claims.get("synthetic") is not True or claims.get("owner") != "Alex Example":
        out.append("claims.yaml: not the bundled synthetic example")
    policy = load_yaml(root / "workspace/job-search/profile/policy.yaml")
    if not policy or policy.get("synthetic") is not True:
        out.append("policy.yaml: synthetic flag is not true")
    for key in ("excluded_locations", "workday_search_terms", "workday_lanes"):
        if policy and policy.get(key) not in ([], None):
            out.append(f"policy.yaml: {key} is not empty")
    sources = load_yaml(root / "workspace/job-search/pipeline/sources.yaml")
    if not sources or sources.get("sources") not in ({}, None):
        out.append("sources.yaml: sources are configured")
    for key in ("exclude_title", "exclude_company", "protected_sources"):
        if sources and sources.get(key) not in ([], None):
            out.append(f"sources.yaml: {key} is not empty")
    cfg = load_yaml(root / "workspace/job-search/profile/agent-config.yaml")
    proof = ((cfg or {}).get("outreach") or {}).get("proof_defaults")
    if proof:
        out.append("agent-config.yaml: outreach proof defaults are set")
    tenants = root / "workspace/job-search/workday-tenants.md"
    if tenants.is_file():
        for line in tenants.read_text().splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if line.startswith("|") and cells and cells[0] not in ("Company", "") and not set(cells[0]) <= set("-:"):
                if cells[0] not in ("Company",):
                    # separator rows are --- ; data rows have a company cell
                    if not re.fullmatch(r":?-{3,}:?", cells[0]):
                        out.append("workday-tenants.md: a tenant row is configured")
                        break
    return out

def self_test():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        profile = root / "workspace/job-search/profile"
        pipe = root / "workspace/job-search/pipeline"
        profile.mkdir(parents=True)
        pipe.mkdir(parents=True)
        (profile / "profile.yaml").write_text(textwrap.dedent("""\
            synthetic: true
            submit_authorized: false
            send_authorized: false
            identity:
              synthetic: true
              name: Alex Example
              email: alex@example.invalid
              phone: null
              standing_answer_rules: []
            fields: {}
            """))
        (profile / "claims.yaml").write_text("synthetic: true\nowner: Alex Example\nclaims: []\n")
        (profile / "policy.yaml").write_text("synthetic: true\nexcluded_locations: []\nworkday_search_terms: []\nworkday_lanes: []\n")
        (profile / "agent-config.yaml").write_text("outreach:\n  proof_defaults: []\n")
        (pipe / "sources.yaml").write_text("sources: {}\nexclude_title: []\nexclude_company: []\nprotected_sources: []\n")
        (root / "workspace/job-search/workday-tenants.md").write_text("| Company | Host |\n|---|---|\n")
        clean = scan(root)
        (profile / "profile.yaml").write_text(textwrap.dedent("""\
            synthetic: true
            submit_authorized: false
            send_authorized: false
            identity:
              synthetic: true
              name: Alex Example
              email: alex@example.invalid
              phone: null
              standing_answer_rules: []
            fields:
              pay_floor:
                value: 1
            """))
        populated = scan(root)
        bad_email = "hidden.person@" + "private.test"
        bad_path = "/Users" + "/someone/notes"
        (root / "note.md").write_text(f"Reach me at {bad_email} or {bad_path}\n")
        dirty = scan(root)
        (root / "note.md").unlink()
        (profile / "profile.yaml").write_text("synthetic: true\nidentity:\n  synthetic: true\n  name: Hidden Person\n  email: " + bad_email + "\n  phone: null\n  standing_answer_rules: []\nfields: {}\n")
        swapped = scan(root)
    bad = []
    if clean:
        bad.append("clean fixture failed: " + "; ".join(clean))
    if not any("email" in x for x in dirty) or not any("private-path" in x for x in dirty):
        bad.append("dirty fixture did not report email and path: " + "; ".join(dirty))
    if not any("profile.yaml" in x for x in swapped):
        bad.append("swapped identity was accepted: " + "; ".join(swapped))
    if not any("profile.yaml: fields are populated" in x for x in populated):
        bad.append("populated profile was accepted: " + "; ".join(populated))
    if bad:
        raise SystemExit("privacy scan self-test failed: " + " | ".join(bad))
    print("privacy scan self-test: PASS")

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument("--public", action="store_true", help="scan the kit root")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        self_test()
    if a.public or not a.self_test:
        found = scan(a.root)
        if found:
            print("\n".join(found))
            raise SystemExit(f"privacy scan: FAIL ({len(found)})")
        print("privacy scan: PASS (heuristic only; not proof of anonymization)")

if __name__ == "__main__":
    main()
