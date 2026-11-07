#!/usr/bin/env python3
'[Candidate-specific example/rule removed; read approved configuration.]\nFormat-only pre-gate for job packages (resume + cover). Rework 2026-10-20 (source workflow revision via Research audit).\n\nCode checks STRUCTURE only. All content judgment (fit, overclaims, age wording, legacy tech, readability,\nkeywords, JD echo) lives in the 4-lens review: <apps-workspace>/rework/apply-rubric.md (numbers: check_claims.py; stamp: stamp_review.py).\nHard FAILs: FILE (required files present, non-empty, PDFs parse; cover files only when required, see required_files), SECT (resume sections + order),\nSHAPE (configured SUMMARY bullet count, bullet word caps, configured maximum pages), TYPO (em-dash anywhere incl. role/education headers since 2026-10-20c, arrows, AI typography),\n[Candidate-specific example/rule removed; read approved configuration.]\n\nUsage: lint_3lens_package.py <package_dir> | <batch_dir> --all  [--resume-only] [--strict-sections] [--stamp]\nExit 0 = lint PASS (still run the 4-lens review). Exit 1 = FAIL. Re-run at submit time: a PASS stamp that\ndoes not carry the current LINT_VERSION is stale (printed as ~ WARN) and needs a re-check.'
from __future__ import annotations

# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[3])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import argparse, datetime as dt, re, subprocess, sys
from pathlib import Path

# ============================== CONFIG (all thresholds and lists) ==============================
LINT_VERSION = "format-lint 2026-10-20c"
REQUIRED = {  # file -> minimum stripped chars ("not empty"; jd/company keep the old substance floor)
    "resume-native.md": 1, "resume.pdf": 1,
    "jd.md": 400, "company-research.md": 200, "review-3lens.md": 1}
# Candidate-specific annotation removed.
# says so (package.yaml cover_required: true, or form.json from the ATS); a cover.txt that exists still needs its cover.pdf.
COVER_FILES = {"cover.txt": 1, "cover.pdf": 1}

def required_files(pkg: Path) -> dict:
    req = dict(REQUIRED)
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import fetch_form
        need = fetch_form.cover_required(pkg)[0]
    except Exception:
        need = False
    if need or (pkg / "cover.txt").exists():
        req.update(COVER_FILES)
    return req
JD_ALIASES = ("jd.md", "jd.txt", "jd-analysis.md")
RESUME_ONLY = ("resume-native.md", "resume.pdf")
PDF_MIN_TEXT = 200                 # pdftotext chars for a PDF to count as parseable
MAX_PAGES = _JOBBI_POLICY.get("max_pages") or float("inf")
SUMMARY_BULLETS = tuple(_JOBBI_POLICY.get("summary_bullets") or (0, float("inf")))
EXP_BULLET_MAX_WORDS = _JOBBI_POLICY.get("experience_words") or float("inf")
SUM_BULLET_MAX_WORDS = _JOBBI_POLICY.get("summary_words") or float("inf")
AGE_CUTOFF_YEAR = _JOBBI_POLICY.get("age_cutoff_year")
# Section names -> canonical key. Earlier career renders as a bold line inside experience in resume-native.md;
# the legacy "**Earlier Experience**" heading (legacy compatibility) is accepted as equivalent.
SECTION_ALIASES = {
    "SUMMARY": "SUMMARY", "PROFESSIONAL EXPERIENCE": "EXPERIENCE", "EXPERIENCE": "EXPERIENCE",
    "WORK EXPERIENCE": "EXPERIENCE", "EARLIER CAREER": "EARLIER", "EARLIER EXPERIENCE": "EARLIER",
    "SKILLS": "SKILLS", "EDUCATION": "EDUCATION", "SELECTED WORK AND PUBLICATIONS": "PUBLICATIONS",
    "PUBLICATIONS AND PATENTS": "PUBLICATIONS", "SELECTED WORK": "PUBLICATIONS"}
SECTIONS_SPEC = ["HEADLINE", "SUMMARY", "EXPERIENCE", "EARLIER", "SKILLS", "EDUCATION"]   # Research spec, literal
SECTIONS_APPROVED = ["HEADLINE", "SUMMARY", "EXPERIENCE", "EARLIER", "PUBLICATIONS", "EDUCATION", "SKILLS"]
OPTIONAL_APPROVED = {"PUBLICATIONS"}   # approved base layout (Skills last); used unless --strict-sections
# Candidate-specific annotation removed.
# "Publication. description"), so em-dashes are banned everywhere in candidate-facing text, including
# role/education header lines (was allowed as a structural separator in 2026-10-20b).
EMDASH_STRUCTURAL_OK = False
BANNED_TYPO = [(r"—", "em-dash"), (r"―", "horizontal bar"), (r"(?<!\d)\s–\s(?!\d|Present)", "spaced en-dash used as a dash"),
               (r"->|=>|<-|-->", "ascii arrow"), (r"[→←↔⇒⇐⇔⟶⟵➔➜➝➞↦↪]", "arrow glyph"),
               (r"[✓✔✗✘★☆✨🚀💡🔥👉]", "emoji / decorative glyph")]
LEAK_PATTERNS = [  # internal notes / meta / reviewer voice that must never reach candidate-facing text
    r"\bTODO\b", r"\bTBD\b", r"\bFIXME\b", r"\bXXX\b", r"\[USER\]", r"\{\{|\}\}", r"\blorem ipsum\b", r"\bplaceholder\b",
    r"\breviewer[s']? (?:note|comment|verdict)", r"review-3lens", r"3-lens", r"\blint (?:clean|exit|pass|fail)", r"claim gaps?", r"do not paste",
    r"internal note", r"search-internal", r"honest bridge", r"\bi? ?do not claim\b", r"\bno [\w/-]+ tenure\b",
    r"\bno [\w/-]+ product claim\b", r"not a? ?people-lead", r"ic builder mandate", r"status.?to review", r"stretch vs",
    r"comp floor", r"oem peer", r"soft:solutions", r"90-day mandate", r"first 90 days as", r"FDE practice needs",
    r"change/adoption pattern", r"tick-tock sprints", r"discovery,?\s*build,?\s*eval,?\s*then\s*iterate\s*loop",
    r"\*\*|</?b>|^#+ ", r"(?-i:^\s*(?:Headline|Pitch|Status|Base|Target)\s?(?:\(|:))"]
# ================================================================================================
LEAK_RE = re.compile("|".join(f"(?:{p})" for p in LEAK_PATTERNS), re.I | re.M)
YEAR_RE = re.compile(r"(?<![\d.])(19[4-9]\d|20[0-4]\d)(?![\d])")
WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’+&./_-]*")

def read(p: Path) -> str: return p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""

def pdf_text(p: Path) -> str:
    try:
        return subprocess.check_output(["pdftotext", str(p), "-"], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return ""

def pdf_pages(p: Path) -> int:
    try:
        out = subprocess.check_output(["pdfinfo", str(p)], text=True, stderr=subprocess.DEVNULL)
        return int(re.search(r"(?m)^Pages:\s+(\d+)", out).group(1))
    except Exception:
        return -1

def nwords(s: str) -> int:
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s).replace("**", "")
    return len(WORD_RE.findall(re.sub(r"(?:https?://|www\.)\S+|\S+@\S+", " ", s)))

def md_section(md: str, name: str) -> str:
    m = re.search(rf"(?im)^##\s*(?:{name})\s*$", md)
    if not m:
        return ""
    nxt = re.search(r"(?m)^##\s+", md[m.end():])
    return md[m.end():][: nxt.start()] if nxt else md[m.end():]

def bullets(section: str) -> list[str]: return [l.strip()[2:].strip() for l in section.splitlines() if l.strip().startswith(("- ", "• ", "* "))]

def sections_found(md: str) -> list[str]:
    found = ["HEADLINE"] if re.search(r"(?im)^\*\*Headline[^*]*:\*\*\s*\S", md) else []
    for m in re.finditer(r"(?m)^(?:##\s*(.+?)|\*\*(Earlier (?:career|Experience)):?\*\*.*)\s*$", md):
        name = (m.group(1) or m.group(2)).strip().upper()
        found.append(SECTION_ALIASES.get(name, f"EXTRA:{name}"))
    return found

def check_sections(md: str, strict: bool) -> list[str]:
    found, fails = sections_found(md), []
    order = SECTIONS_SPEC if strict else SECTIONS_APPROVED
    optional = set() if strict else OPTIONAL_APPROVED
    for key in order:
        if key not in found and key not in optional:
            fails.append(f"SECT missing section: {key}")
    extras = [f for f in found if f not in order]
    if extras:
        fails.append("SECT extra section(s): " + ", ".join(e.replace("EXTRA:", "") for e in extras))
    seq = [f for f in found if f in order]
    if seq != sorted(seq, key=order.index) or len(seq) != len(set(seq)):
        fails.append(f"SECT order {' > '.join(seq)}; want {' > '.join(order)}")
    return fails

def prose_units(md: str) -> list[str]:
    """Candidate-facing prose in resume-native.md: headline, SUMMARY + experience bullets, Earlier career line."""
    units = [m.group(1) for m in re.finditer(r"(?im)^\*\*Headline[^*]*:\*\*\s*(.+)$", md)]
    units += bullets(md_section(md, "SUMMARY")) + bullets(md_section(md, "PROFESSIONAL EXPERIENCE|EXPERIENCE|WORK EXPERIENCE"))
    m = re.search(r"(?ims)^\*\*Earlier (?:career|Experience):?\*\*\s*(.+?)(?=^\s*$|^##)", md)
    return units + ([m.group(1)] if m else [])

def structural(line: str) -> bool:
    """Template separator line: one em-dash, short label before it, no sentence break before it."""
    pre = line.split("—", 1)[0]
    return line.count("—") == 1 and nwords(pre) <= 14 and not re.search(r"[a-z0-9)]\.\s+[A-Z]", pre)

def check_typo(label: str, text: str, prose: bool) -> list[str]:
    fails = []
    for pat, why in BANNED_TYPO:
        for line in text.splitlines():
            if not re.search(pat, line):
                continue
            if why == "em-dash" and EMDASH_STRUCTURAL_OK and not prose and structural(line):
                continue
            fails.append(f"TYPO {why} in {label}: …{line.strip()[:90]}…")
            break
    return fails

def lint_package(pkg: Path, jd_text: str | None = None, warns: list[str] | None = None,
                 resume_only: bool = False, strict: bool = False) -> list[str]:
    """Return FAIL strings; stamp/staleness notes go to `warns`. jd_text kept for old callers (unused)."""
    fails: list[str] = []
    for name, floor in required_files(pkg).items():
        if resume_only and name not in RESUME_ONLY:
            continue
        cands = JD_ALIASES if name == "jd.md" else (name,)
        p = next((pkg / c for c in cands if (pkg / c).exists()), None)
        if p is None:
            fails.append(f"FILE missing {name}")
        elif p.suffix == ".pdf":
            if len(pdf_text(p).strip()) < PDF_MIN_TEXT:
                fails.append(f"FILE {name} does not parse as text (pdftotext < {PDF_MIN_TEXT} chars)")
        elif len(read(p).strip()) < floor:
            fails.append(f"FILE {p.name} empty or too thin ({len(read(p).strip())} chars; want >= {floor})")
    md, cvr = read(pkg / "resume-native.md"), read(pkg / "cover.txt")
    rpdf = pdf_text(pkg / "resume.pdf") if (pkg / "resume.pdf").exists() else ""
    cpdf = pdf_text(pkg / "cover.pdf") if (pkg / "cover.pdf").exists() else ""
    m = re.search(r"(?im)^##\s*SUMMARY\s*$", md)
    resume_txt = rpdf or (md[m.start():] if m else md)          # candidate-facing text (md header block is internal)
    if md:
        fails += check_sections(md, strict)
        sb = bullets(md_section(md, "SUMMARY"))
        if not SUMMARY_BULLETS[0] <= len(sb) <= SUMMARY_BULLETS[1]:
            fails.append(f"SHAPE SUMMARY has {len(sb)} bullets (want {SUMMARY_BULLETS[0]}-{SUMMARY_BULLETS[1]})")
        for i, b in enumerate(sb, 1):
            if nwords(b) > SUM_BULLET_MAX_WORDS:
                fails.append(f"SHAPE SUMMARY bullet {i} is {nwords(b)} words (max {SUM_BULLET_MAX_WORDS}): {b[:80]}…")
        for b in bullets(md_section(md, "PROFESSIONAL EXPERIENCE|EXPERIENCE|WORK EXPERIENCE")):
            if nwords(b) > EXP_BULLET_MAX_WORDS:
                fails.append(f"SHAPE experience bullet is {nwords(b)} words (max {EXP_BULLET_MAX_WORDS}): {b[:80]}…")
        fails += check_typo("resume-native.md prose", "\n".join(prose_units(md)), prose=True)
        if m and not EMDASH_STRUCTURAL_OK:   # headers, Earlier line, publications, education, skills (md header block is internal)
            fails += [f for f in check_typo("resume-native.md headers", md[m.start():], prose=True)
                      if f.startswith("TYPO em-dash") and not any(x.startswith("TYPO em-dash in resume-native.md prose") for x in fails)]
    if (pkg / "resume.pdf").exists() and (n := pdf_pages(pkg / "resume.pdf")) > MAX_PAGES:
        fails.append(f"SHAPE resume.pdf is {n} pages (max {MAX_PAGES})")
    for label, text, prose in (("resume.pdf", rpdf, False), ("cover.txt", cvr, True), ("cover.pdf", cpdf, True)):
        if text:
            fails += check_typo(label, text, prose)
    for label, text in (("resume", resume_txt), ("cover", cvr or cpdf)):
        olds = sorted({y for y in YEAR_RE.findall(text) if AGE_CUTOFF_YEAR is not None and int(y) < AGE_CUTOFF_YEAR})
        if olds:
            fails.append(f"TELL year(s) before {AGE_CUTOFF_YEAR} in {label}: {', '.join(olds)}; undate into one 'Earlier career' line")
        for lm in list(LEAK_RE.finditer(text))[:3]:
            ctx = text[max(0, lm.start() - 25): lm.end() + 35].replace("\n", " ").strip()
            fails.append(f"TELL internal/meta text in {label}: …{ctx}…")
    edu = re.search(r"(?ms)^\s*(?:##\s*)?EDUCATION\s*$(.*?)(?=^\s*(?:##\s*)?[A-Z][A-Z &]{3,}\s*$|\Z)", resume_txt)
    if _JOBBI_POLICY.get("hide_graduation_years", False) and edu and (ym := re.search(r"(?<!\d)(?:19|20)\d{2}(?!\d)", edu.group(1))):
        fails.append(f"TELL graduation/education year {ym.group(0)} in EDUCATION")
    if warns is not None and not resume_only and LINT_VERSION not in read(pkg / "review-3lens.md"):
        warns.append(f"stamp stale: review-3lens.md does not carry '{LINT_VERSION}'; re-check before submit")
    return fails

def stamp_line() -> str: return f"Lint stamp: PASS ({LINT_VERSION}, run {dt.datetime.now().strftime('%Y-%m-%d %H:%M')} PT)"

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", type=Path)
    ap.add_argument("--jd", type=Path, default=None, help="accepted for old callers; unused")
    ap.add_argument("--all", action="store_true", help="lint every subdir with resume-native.md")
    ap.add_argument("--resume-only", action="store_true", help="base resumes: only resume files are required")
    ap.add_argument("--strict-sections", action="store_true", help="literal spec order, no Publications section")
    ap.add_argument("--stamp", action="store_true", help="on PASS, append the lint stamp to review-3lens.md")
    ap.add_argument("--read-stats", action="store_true", help="print bullet word-count distribution and exit 0")
    a = ap.parse_args()
    pkgs = sorted(p for p in a.path.iterdir() if p.is_dir() and (p / "resume-native.md").exists()) if a.all else [a.path]
    if not pkgs:
        return print("No packages found", file=sys.stderr) or 1
    if a.read_stats:
        ws = sorted(nwords(b) for p in pkgs for sec in ("SUMMARY", "PROFESSIONAL EXPERIENCE")
                    for b in bullets(md_section(read(p / "resume-native.md"), sec)))
        print(f"bullets n={len(ws)} median={ws[len(ws)//2] if ws else 0} p95={ws[int(.95*(len(ws)-1))] if ws else 0} max={max(ws, default=0)}")
        return 0
    any_fail = False
    for pkg in pkgs:
        warns: list[str] = []
        fails = lint_package(pkg, None, warns, a.resume_only, a.strict_sections)
        print(f"{'FAIL' if fails else 'PASS'}\t{pkg}\t[{LINT_VERSION}]")
        for f in fails:
            print(f"  - {f}")
        any_fail |= bool(fails)
        if not fails:
            print(f"  {stamp_line()} (still required: check_claims.py, the 4-lens review.json and stamp_review.py before any PASS)")
            if a.stamp and not a.resume_only:
                with open(pkg / "review-3lens.md", "a", encoding="utf-8") as fh:
                    fh.write(f"\n- {stamp_line()}\n")
                warns = [w for w in warns if not w.startswith("stamp stale")]
        for w in warns:
            print(f"  ~ WARN {w}")
    return 1 if any_fail else 0

if __name__ == "__main__":
    sys.exit(main())
