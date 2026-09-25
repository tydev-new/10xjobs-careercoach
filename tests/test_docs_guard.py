"""The PII guard and the link check, extended to the public prose and the
code that ships outside the SHIPPED folders (independent tester, onboarding
docs review 2026-09-25).

Why: tests/test_invariants.py scans only SHIPPED (skills, plugins, kit,
.claude-plugin, apps, scripts, design), and check_files.py resolves links
only under skills/. The repo is public, and PROCESS.md step 6 (0d65c6d)
now routes the owner's real-data lessons back as "numbers-only receipts" —
receipts land in docs/, the root *.md files and commit-adjacent prose, the
exact place a home path, an email or a phone number would leak with no
test to stop it. packages/*/src is bundled into the site and supabase/ is
deployed, yet neither is in SHIPPED although SECURITY.md tells readers the
guard covers "shipped folders".

The failure each check prevents:
- PII: a receipt, a pasted log line or a stray config carrying a home
  path, email, phone number or profile URL reaches the public repo.
- Links: a newcomer doc (ARCHITECTURE, TEAM, CONTRIBUTING, SECURITY, the
  docs index) points at a moved file or a renamed contract heading, and
  nobody notices until a reader hits the 404.

Same PII pattern as test_invariants.py (imported, one definition).
"""
import glob
import os
import re
import shutil
import tempfile
import unicodedata

from test_invariants import PII, SKIP_DIRS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Prose: every root *.md, docs/ (recursively), agents/.
PROSE_DIRS = ("docs", "agents")
# Code that ships but is outside SHIPPED: the agent/checker sources bundled
# into the site, and the deployed Edge Functions + migrations. Test dirs
# under packages/ are left out on purpose: the just-bash sandbox's own fake
# home (/home/user/) is a fixture there, not a builder's path.
EXTRA_CODE = ("packages/agent/src", "packages/checkers/src", "packages/checkers/bin", "supabase")

LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE = re.compile(r"^\s*```.*?^\s*```", re.S | re.M)


def prose_files(root=ROOT):
    files = sorted(os.path.join(root, f) for f in os.listdir(root) if f.endswith(".md"))
    for d in PROSE_DIRS:
        files += sorted(glob.glob(os.path.join(root, d, "**", "*.md"), recursive=True))
    return files


def walk(root, top):
    for dirpath, dirs, files in os.walk(os.path.join(root, top)):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f in ("package-lock.json", ".DS_Store"):
                continue
            yield os.path.join(dirpath, f)


def pii_scan(root=ROOT):
    paths = [p for p in prose_files(root)]
    for d in PROSE_DIRS + EXTRA_CODE:
        paths += [p for p in walk(root, d) if not p.endswith(".md")]
    hits, scanned = [], 0
    for p in paths:
        try:
            text = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        hits += [f"{os.path.relpath(p, root)}: {m.group(0)}" for m in PII.finditer(text)]
    return hits, scanned


def github_slug(heading):
    """GitHub's heading id: lowercased; markup and punctuation dropped
    (letters, digits, '-', '_' and spaces kept); spaces become '-'."""
    h = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", heading.strip().lower())
    h = re.sub(r"[`*]", "", h)
    kept = "".join(ch for ch in h if ch in "-_ " or unicodedata.category(ch)[0] in "LN")
    return kept.replace(" ", "-")


def anchors_of(path):
    ids, seen, in_fence = set(), {}, False
    for line in open(path, encoding="utf-8"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        m = None if in_fence else re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", line)
        if m:
            s = github_slug(m.group(2))
            n = seen.get(s, 0)
            ids.add(s if n == 0 else f"{s}-{n}")
            seen[s] = n + 1
    return ids


def broken_links(root=ROOT):
    bad, checked, anchored = [], 0, 0
    for f in prose_files(root):
        text = FENCE.sub("", open(f, encoding="utf-8").read())
        for m in LINK.finditer(text):
            target = m.group(1)
            if re.match(r"^[a-zA-Z][a-zA-Z+.-]*:", target) or target.startswith("//"):
                continue
            checked += 1
            path, _, frag = target.partition("#")
            full = os.path.normpath(os.path.join(os.path.dirname(f), path)) if path else f
            where = os.path.relpath(f, root)
            if not os.path.exists(full):
                bad.append(f"{where}: no such file: {target}")
            elif frag and full.endswith(".md"):
                anchored += 1
                if frag not in anchors_of(full):
                    bad.append(f"{where}: no such heading: {target}")
    return bad, checked, anchored


# --- the guards ---------------------------------------------------------

def test_no_pii_in_docs_root_md_agents_and_shipped_code_outside_shipped():
    hits, scanned = pii_scan()
    assert scanned > 100, f"scanned only {scanned} files: the walk is broken"
    assert not hits, "PII-shaped text outside the SHIPPED scan:\n" + "\n".join(hits[:20])


def test_relative_links_and_anchors_in_prose_resolve():
    bad, checked, anchored = broken_links()
    # Non-vacuous: the onboarding docs alone carry dozens of relative links
    # and several contract-heading anchors.
    assert checked > 60 and anchored >= 8, (checked, anchored)
    assert not bad, "broken relative links:\n" + "\n".join(bad[:30])


# --- the guards catch what they claim to (planted in a temp tree) ------

def _tree():
    root = tempfile.mkdtemp(prefix="docs-guard-")
    os.makedirs(os.path.join(root, "docs"))
    os.makedirs(os.path.join(root, "agents"))
    os.makedirs(os.path.join(root, "supabase", "functions"))
    os.makedirs(os.path.join(root, "packages", "agent", "src"))
    with open(os.path.join(root, "docs", "C.md"), "w") as fh:
        fh.write("# C\n\n## 8. Model proxy, balance, and the production project\n\n## 6.2 Where every card comes from\n")
    return root


def _write(root, rel, text):
    with open(os.path.join(root, rel), "w") as fh:
        fh.write(text)


def test_pii_scan_catches_planted_hits_in_each_new_area():
    root = _tree()
    try:
        _write(root, "README.md", "ok\n")
        assert pii_scan(root)[0] == []
        for rel, text in (
            ("SECURITY.md", "Built on /Users/someone/code\n"),
            ("docs/receipt.md", "owner said: jane.doe@gmail.com\n"),
            ("agents/x.md", "call (415) 555-0100\n"),
            ("supabase/functions/a.ts", "// linkedin.com/in/janedoe\n"),
            ("packages/agent/src/b.ts", 'const p = "/home/alice/job-search";\n'),
        ):
            _write(root, rel, text)
            hits, _ = pii_scan(root)
            assert any(h.startswith(rel + ":") for h in hits), (rel, hits)
            os.remove(os.path.join(root, rel))
    finally:
        shutil.rmtree(root)


def test_link_check_catches_a_missing_file_and_a_renamed_heading():
    root = _tree()
    try:
        good = ("[a](docs/C.md) [b](docs/C.md#8-model-proxy-balance-and-the-production-project) "
                "[c](docs/C.md#62-where-every-card-comes-from) [web](https://example.com) [s](#top)\n# top\n")
        _write(root, "README.md", good)
        bad, checked, anchored = broken_links(root)
        assert bad == [] and checked == 4 and anchored == 3, (bad, checked, anchored)
        _write(root, "README.md", good + "[m](docs/Missing.md)\n")
        assert any("no such file" in b for b in broken_links(root)[0])
        _write(root, "README.md", good + "[h](docs/C.md#8-model-proxy-and-balance)\n")
        assert any("no such heading" in b for b in broken_links(root)[0])
        _write(root, "docs/D.md", "[up](../agents/none.md)\n")
        assert any(b.startswith("docs/D.md:") for b in broken_links(root)[0])
    finally:
        shutil.rmtree(root)
