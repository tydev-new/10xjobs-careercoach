#!/usr/bin/env python3
"""Rebuild a package resume.pdf from its resume-native.md with the same _native_lib layout the
2026-10-19 builders used (header + headline, SUMMARY, EXPERIENCE, 'Earlier Experience', SELECTED/PUBLICATIONS,
EDUCATION, SKILLS). Added 2026-10-20 for the AGE-1 de-dating fix so held packages are NOT regenerated from the
current bases. Usage: rebuild_resume_from_native.py <pkg_dir> <out_pdf>
2026-10-20c: accepts BOTH earlier-career forms ('**Earlier Experience**' + paragraph, or the undated one-line
'**Earlier career:** ...' that NL renders inline with EARLIER_TITLE=None), and takes EDUCATION lines from the md
(so comma header separators carry into the PDF instead of the lib's em-dash defaults)."""

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

import sys, re
from pathlib import Path
sys.path.insert(0, str(_JOBBI_APPS / 'lib'))  # 2026-10-20 p1: shared lib + claims.yaml shim
import _native_lib as NL
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor

pkg, out_pdf = Path(sys.argv[1]), sys.argv[2]
md = (pkg / "resume-native.md").read_text()
L = md.split("\n")
head = re.search(r"(?m)^\*\*Headline \(rendered under name[^)]*\):\*\* (.+)$", md).group(1).strip()
is_ic = "**Base:** ic-builder" in md

def section(name):
    i = L.index("## " + name); j = i + 1
    while j < len(L) and not L[j].startswith("## "): j += 1
    return L[i + 1:j]

summary = [x[2:] for x in section("SUMMARY") if x.startswith("- ")]
jobs, earlier, cur = [], None, None
exp = section("PROFESSIONAL EXPERIENCE"); k = 0
while k < len(exp):
    x = exp[k]
    if x == "**Earlier Experience**":
        earlier, earlier_title = exp[k + 1], "Earlier Experience"; break
    if x.startswith("**Earlier career:**"):
        earlier, earlier_title = "Earlier career:" + x[len("**Earlier career:**"):], None; break
    if x.startswith("**") and x.endswith("**"):
        cur = [x[2:-2], exp[k + 1][1:-1], []]; jobs.append(cur); k += 2; continue
    if x.startswith("- "): cur[2].append(x[2:])
    elif x.startswith("_") and x.endswith("_"): cur[2].append("@@ " + x[1:-1])
    k += 1
assert earlier is not None, "no Earlier Experience / Earlier career block"
skills = " ".join(section("SKILLS")).strip()
sel_title = [l[3:] for l in L if l.startswith("## ") and l[3:] not in ("SUMMARY", "PROFESSIONAL EXPERIENCE", "EDUCATION", "SKILLS")][0]
sel_paras = [p.strip() for p in "\n".join(section(sel_title)).strip().split("\n\n") if p.strip()]
def md2html(s):
    s = s.replace("&", "&amp;")
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" color="#1a4fa0">\1</a>', s)
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
NL.SELECTED_TITLE = sel_title
NL.SELECTED = "<br/>".join(md2html(p) for p in sel_paras)
NL.EARLIER_TITLE = earlier_title
edu = [x[2:] for x in section("EDUCATION") if x.startswith("- ")]
if edu: NL.EDU_LINES = edu
if is_ic:
    _o = NL.styles
    def _s():
        st = _o(); st["BodyJust"].alignment = 0; return st
    NL.styles = _s
import yaml   # 2026-10-21 p3 item 9: identity lines come from profile/candidate.yaml (same strings as before)
CAND = yaml.safe_load(Path(str(_JOBBI_SEARCH / 'profile/candidate.yaml')).read_text())
def add_header(story, st, auth=None):
    story.append(Paragraph(CAND["name_display"], st["Name"]))
    story.append(Paragraph(head, ParagraphStyle(name="Headline", parent=st["Contact"], fontName="Helvetica-Bold",
                            fontSize=9.5, leading=12, spaceAfter=1, textColor=HexColor("#222222"))))
    story.append(Paragraph("<br/>".join(CAND["resume_contact_lines"]), st["Contact"]))
    story.append(NL.hr())
NL.add_header = add_header
# NL.esc only escapes '&'; md2html already escaped SELECTED. Bullets/earlier go through NL.esc inside build_resume.
NL.build_resume(out_pdf, summary, [], [tuple(j) for j in jobs], earlier, skills=skills)
print(out_pdf, NL.page_count(out_pdf), "pages")
