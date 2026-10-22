#!/usr/bin/env python3
"""format_check.py: the section-format code gate (length, style and shape are judged by the recruiter lens, not here).

  jobsearch.py format-check <pkg> [<pkg> ...] [--json] [--strict-dots]
  jobsearch.py format-check --text-dir <dir>       same checks on a rendered temp dir (build_package uses this)

FAIL (exit 1) on:
  SECT    resume-native.md must have the standard sections, in order:
          SUMMARY > PROFESSIONAL EXPERIENCE (with the "Earlier career" line) > [PUBLICATIONS AND PATENTS] > EDUCATION > SKILLS
  HEADER  header lines use commas as separators: role headers "**Company, Title**", education "Degree, Field, School".
          No '·', em-dash, ' | ' or ' - ' separators in them.
  DATES   when claims.yaml sets earliest_year: no year before it in candidate-facing resume or cover text (older work goes in
          the undated Earlier career line). Always: no graduation years in EDUCATION.
DOT (WARN by default, FAIL with --strict-dots): '·' in the role date/location lines ("2021 – 2025 · Springfield") and in the
          rendered contact lines (candidate.yaml).
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

FORMAT_VERSION = "format-check 2026-10-21"


def age_cutoff_year():
    """claims.yaml earliest_year (None = no age-signal date rule)."""
    try:
        from apply.lib import claims as CL
        return CL.earliest_year()
    except Exception:
        return None
ORDER = ["SUMMARY", "EXPERIENCE", "EARLIER", "PUBLICATIONS", "EDUCATION", "SKILLS"]
OPTIONAL = {"PUBLICATIONS"}
ALIASES = {"SUMMARY": "SUMMARY", "PROFESSIONAL EXPERIENCE": "EXPERIENCE", "EXPERIENCE": "EXPERIENCE", "WORK EXPERIENCE": "EXPERIENCE",
           "EARLIER CAREER": "EARLIER", "EARLIER EXPERIENCE": "EARLIER", "PUBLICATIONS AND PATENTS": "PUBLICATIONS",
           "SELECTED WORK AND PUBLICATIONS": "PUBLICATIONS", "SELECTED WORK": "PUBLICATIONS", "EDUCATION": "EDUCATION", "SKILLS": "SKILLS"}
BAD_SEP = re.compile(r"·|—|―|\s\|\s|\s-\s|\s–\s(?!\d|Present)")
YEAR_RE = re.compile(r"(?<![\d.])(19[4-9]\d|20[0-4]\d)(?![\d])")

def body(md):
    head, sep, rest = md.partition("\n---\n")
    return rest if sep else md

def sections(b):
    found = []
    for line in b.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line) or re.match(r"^\*\*(Earlier (?:career|Experience))[:*]", line, re.I)
        if m:
            k = ALIASES.get(m.group(1).strip().upper().rstrip(":"), f"EXTRA:{m.group(1).strip()}")
            if not found or found[-1] != k: found.append(k)
    return found

def section_text(b, name):
    m = re.search(rf"(?ms)^##\s+{name}\s*$(.*?)(?=^##\s|\Z)", b)
    return m.group(1) if m else ""

def pdf_text(p):
    try: return subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True, timeout=60).stdout
    except Exception: return ""

def check(pkg, strict_dots=False):
    pkg = Path(pkg); fails, warns = [], []
    mdp = pkg / "resume-native.md"
    if not mdp.exists(): return [f"SECT no resume-native.md in {pkg}"], warns
    b = body(mdp.read_text())
    # SECT
    s = sections(b)
    extras = [x[6:] for x in s if x.startswith("EXTRA:")]
    if extras: fails.append(f"SECT non-standard section(s): {', '.join(extras)}")
    for k in ORDER:
        if k not in s and k not in OPTIONAL: fails.append(f"SECT missing section: {k}")
    seq = [x for x in s if x in ORDER]
    if seq != sorted(seq, key=ORDER.index): fails.append(f"SECT order {' > '.join(seq)}; want {' > '.join(k for k in ORDER if k in seq)}")
    # HEADER
    exp = section_text(b, "(?:PROFESSIONAL |WORK )?EXPERIENCE")
    for line in exp.splitlines():
        t = line.strip()
        m = re.match(r"^\*\*([^*]+)\*\*$", t)
        if m and not re.match(r"(?i)earlier", m.group(1)):
            h = m.group(1)
            if BAD_SEP.search(h): fails.append(f"HEADER role header uses a non-comma separator: {h!r}")
            elif ", " not in h: fails.append(f"HEADER role header is not 'Company, Title': {h!r}")
        if re.match(r"^\*[^*].*\*$", t) and "·" in t:
            (fails if strict_dots else warns).append(f"DOT date/location line uses '·': {t.strip('*')!r}")
    for line in section_text(b, "EDUCATION").splitlines():
        t = line.strip()
        if t.startswith(("- ", "* ", "• ")):
            e = t[2:]
            if BAD_SEP.search(e): fails.append(f"HEADER education line uses a non-comma separator: {e!r}")
            elif ", " not in e: fails.append(f"HEADER education line is not 'Degree, Field, School': {e!r}")
            if re.search(r"(?<!\d)(?:19|20)\d{2}(?!\d)", e): fails.append(f"DATES graduation year in EDUCATION: {e!r}")
    rp = pkg / "resume.pdf"
    if rp.exists():
        top = pdf_text(rp).split("SUMMARY", 1)[0]
        for line in top.splitlines()[1:]:
            if "·" in line: (fails if strict_dots else warns).append(f"DOT contact line uses '·': {line.strip()!r}")
    # DATES
    texts = [("resume", b)]
    if (pkg / "cover.txt").exists(): texts.append(("cover", (pkg / "cover.txt").read_text()))
    cutoff = age_cutoff_year()
    for label, t in texts if cutoff else []:
        t = re.sub(r"https?://\S+|\]\([^)]*\)", " ", t)          # URLs and link targets are not dates
        t = re.sub(r"\b(?:US|U\.S\.)\s+(?:Patent\s+)?\d[\dA-Z]+\b|\bUS\s?\d+[A-Z]\d?\b", " ", t)   # patent numbers
        olds = sorted({y for y in YEAR_RE.findall(t) if int(y) < cutoff})
        if olds: fails.append(f"DATES year(s) before {cutoff} in {label}: {', '.join(olds)} (undate into the Earlier career line)")
    return fails, warns

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg", nargs="*"); ap.add_argument("--text-dir"); ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict-dots", action="store_true")
    a = ap.parse_args()
    pkgs = a.pkg + ([a.text_dir] if a.text_dir else [])
    if not pkgs: ap.error("give a package")
    res = []
    for p in pkgs:
        f, w = check(p, a.strict_dots); res.append({"package": Path(p).name, "result": "FAIL" if f else "PASS", "fails": f, "warns": w})
    if a.json: print(json.dumps(res if len(res) > 1 else res[0], indent=1))
    else:
        for r in res:
            print(f"{r['result']}  {r['package']}  [{FORMAT_VERSION}]")
            for x in r["fails"]: print(f"  FAIL {x}")
            for x in r["warns"]: print(f"  WARN {x}")
    sys.exit(1 if any(r["fails"] for r in res) else 0)

if __name__ == "__main__":
    main()
