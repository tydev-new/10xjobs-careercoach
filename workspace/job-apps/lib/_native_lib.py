#!/usr/bin/env python3
"""Shared native-density PDF helpers."""
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

import os, subprocess
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, HRFlowable, Spacer, KeepTogether
from reportlab.lib.colors import HexColor

DATE_LETTER = __import__("datetime").date.today().strftime("%B %d, %Y")
SELECTED = _JOBBI_CAND.get("selected_work_html", "")
SELECTED_MD = _JOBBI_CAND.get("selected_work_md", "")
SELECTED_TITLE = "SELECTED WORK"
# 2026-10-19 (age-signal fix): bases set EARLIER_TITLE = None to render the earlier-career text as one inline
# line that starts with a bold "Earlier career:" label. Default keeps the old "Earlier Experience" heading so
# existing packages render exactly as before if ever rebuilt.
EARLIER_TITLE = "Earlier Experience"
EDU_LINES = _JOBBI_CAND.get("education_lines", [])

def styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle(name="Name", fontName="Helvetica-Bold", fontSize=15, leading=18, alignment=TA_CENTER, spaceAfter=1, textColor=HexColor("#111111")))
    s.add(ParagraphStyle(name="Contact", fontName="Helvetica", fontSize=8.5, leading=11, alignment=TA_CENTER, spaceAfter=4, textColor=HexColor("#333333")))
    s.add(ParagraphStyle(name="Section", fontName="Helvetica-Bold", fontSize=10, leading=12, spaceBefore=7, spaceAfter=2, textColor=HexColor("#111111")))
    s.add(ParagraphStyle(name="BodyJust", fontName="Helvetica", fontSize=9, leading=11.5, alignment=TA_JUSTIFY, spaceAfter=2, textColor=HexColor("#222222")))
    s.add(ParagraphStyle(name="StrengthItem", fontName="Helvetica", fontSize=9, leading=11.4, alignment=TA_LEFT, spaceAfter=1.4, textColor=HexColor("#222222")))
    s.add(ParagraphStyle(name="JobTitle", fontName="Helvetica-Bold", fontSize=9.5, leading=12, spaceBefore=5, spaceAfter=0, textColor=HexColor("#111111")))
    s.add(ParagraphStyle(name="JobMeta", fontName="Helvetica-Oblique", fontSize=8.5, leading=10.5, spaceAfter=1.2, textColor=HexColor("#444444")))
    s.add(ParagraphStyle(name="BulletItem", fontName="Helvetica", fontSize=9, leading=11.4, leftIndent=12, firstLineIndent=-8, spaceAfter=1.4, textColor=HexColor("#222222")))
    s.add(ParagraphStyle(name="EduLine", fontName="Helvetica", fontSize=9, leading=11.5, spaceAfter=1, textColor=HexColor("#222222")))
    s.add(ParagraphStyle(name="LetterBody", fontName="Helvetica", fontSize=10.5, leading=15, alignment=TA_JUSTIFY, spaceAfter=10, textColor=HexColor("#222222")))
    s.add(ParagraphStyle(name="LetterSign", fontName="Helvetica", fontSize=10.5, leading=14, spaceBefore=6, textColor=HexColor("#222222")))
    s.add(ParagraphStyle(name="LetterDate", fontName="Helvetica", fontSize=10, leading=13, spaceAfter=12, textColor=HexColor("#222222")))
    return s

def hr():
    return HRFlowable(width="100%", thickness=0.8, color=HexColor("#222222"), spaceBefore=1, spaceAfter=3)

def esc(text: str) -> str:
    return text.replace("&", "&amp;")

# Candidate-specific annotation removed.
# SUMMARY logistics line, so the header carries contact info only. SKILLS goes at
# the very end (after EDUCATION) because it is for ATS, not human readers.
HEADER_AUTH = False
SKILLS_AT_END = True

def add_header(story, st, auth=None):
    auth = HEADER_AUTH if auth is None else auth
    story.append(Paragraph(_JOBBI_CAND["name_display"], st["Name"]))
    story.append(Paragraph(
        "<br/>".join(_JOBBI_CAND["resume_contact_lines"])
        + (_JOBBI_CAND.get("logistics_line", "") if auth else ""),
        st["Contact"]))
    story.append(hr())

def add_job(story, st, title, meta, bullets):
    "Bullets starting with '@@ ' render as a short sub-heading (themed role groups)."
    block = [Paragraph(esc(title), st["JobTitle"]), Paragraph(esc(meta), st["JobMeta"])]
    sub = ParagraphStyle(name="SubHead", parent=st["JobMeta"], fontName="Helvetica-BoldOblique", fontSize=8.8, leading=11, spaceBefore=1.5, spaceAfter=0.8, textColor=HexColor("#222222"))
    for b in bullets:
        if b.startswith("@@ "):
            block.append(Paragraph(esc(b[3:]), sub))
        else:
            block.append(Paragraph("• " + esc(b), st["BulletItem"]))
    story.append(KeepTogether(block[:3]))
    for extra in block[3:]:
        story.append(extra)

def build_resume(path, summary, strengths, jobs, earlier, skills=None):
    st = styles()
    doc = SimpleDocTemplate(path, pagesize=letter,
        leftMargin=0.55 * inch, rightMargin=0.55 * inch,
        topMargin=0.42 * inch, bottomMargin=0.4 * inch)
    story = []
    add_header(story, st)
    story.append(Paragraph("SUMMARY", st["Section"]))
    story.append(hr())
    if isinstance(summary, (list, tuple)):
        for b in summary:
            story.append(Paragraph("• " + esc(b), st["BulletItem"]))
    else:
        story.append(Paragraph(esc(summary), st["BodyJust"]))
    if skills and not SKILLS_AT_END:
        story.append(Paragraph("SKILLS", st["Section"]))
        story.append(hr())
        story.append(Paragraph(esc(skills), st["BodyJust"]))
    if strengths:
        story.append(Paragraph("CORE STRENGTHS", st["Section"]))
        story.append(hr())
        for lead, detail in strengths:
            story.append(Paragraph(f"<b>{esc(lead)}</b> — {esc(detail)}", st["StrengthItem"]))
    story.append(Paragraph("PROFESSIONAL EXPERIENCE", st["Section"]))
    story.append(hr())
    for title, meta, bullets in jobs:
        add_job(story, st, title, meta, bullets)
    if EARLIER_TITLE:
        story.append(Paragraph(EARLIER_TITLE, st["JobTitle"]))
        story.append(Paragraph(esc(earlier), st["BodyJust"]))
    else:
        lab, _, rest = earlier.partition(":")
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<b>{esc(lab)}:</b>{esc(rest)}" if rest else esc(earlier), st["BodyJust"]))
    story.append(Paragraph(SELECTED_TITLE, st["Section"]))
    story.append(hr())
    story.append(Paragraph(SELECTED, st["BodyJust"]))
    story.append(Paragraph("EDUCATION", st["Section"]))
    story.append(hr())
    for line in EDU_LINES:
        story.append(Paragraph(esc(line), st["EduLine"]))
    if skills and SKILLS_AT_END:
        story.append(Paragraph("SKILLS", st["Section"]))
        story.append(hr())
        story.append(Paragraph(esc(skills), st["BodyJust"]))
    doc.build(story)

def build_cover(path, txt_path, company, role, body_paras):
    st = styles()
    doc = SimpleDocTemplate(path, pagesize=letter,
        leftMargin=1 * inch, rightMargin=1 * inch,
        topMargin=0.85 * inch, bottomMargin=0.85 * inch)
    c = []
    c.append(Paragraph(_JOBBI_CAND["name_display"], st["Name"]))
    c.append(Paragraph(
        " · ".join(_JOBBI_CAND["resume_contact_lines"]),
        st["Contact"]))
    c.append(Spacer(1, 8))
    c.append(Paragraph(DATE_LETTER, st["LetterDate"]))
    c.append(Paragraph(f"Hiring Team<br/>{esc(company)}<br/>Re: {esc(role)}", st["LetterBody"]))
    c.append(Paragraph("Dear Hiring Team,", st["LetterBody"]))
    for p in body_paras:
        c.append(Paragraph(esc(p), st["LetterBody"]))
    c.append(Paragraph("Thank you for your consideration.", st["LetterBody"]))
    c.append(Paragraph("Sincerely,", st["LetterSign"]))
    c.append(Spacer(1, 14))
    c.append(Paragraph(_JOBBI_CAND["name"], st["LetterSign"]))
    doc.build(c)
    with open(txt_path, "w") as f:
        f.write(f"{DATE_LETTER}\n\nHiring Team\n{company}\nRe: {role}\n\nDear Hiring Team,\n\n")
        for p in body_paras:
            f.write(p + "\n\n")
        f.write("Thank you for your consideration.\n\nSincerely,\n" + "\n".join(_JOBBI_CAND["cover_signature"]) + "\n")

def write_native_md(path, role):
    lines = [
        f"# {_JOBBI_CAND['name']} — Resume (native re-tailor for {role['company']} {role['title']})",
        "",
        f"**Target:** {role['title']} — {role['company']}",
        f"**URL:** {role['url']}",
        f"**Pitch:** {role['pitch']}",
        "", "---", "",
        "## SUMMARY",
    ]
    summ = role["summary"]
    if isinstance(summ, (list, tuple)):
        for b in summ:
            lines.append(f"- {b}")
    else:
        lines.append(summ)
    strengths = role.get("strengths")
    if strengths:
        lines += ["",
            "## CORE STRENGTHS",
        ]
        for lead, detail in strengths:
            lines.append(f"- **{lead}** — {detail}")
    lines += ["", "## PROFESSIONAL EXPERIENCE", ""]
    for title, meta, bullets in role["jobs"]:
        lines.append(f"**{title}**")
        lines.append(f"*{meta}*")
        for b in bullets:
            lines.append(f"_{b[3:]}_" if b.startswith("@@ ") else f"- {b}")
        lines.append("")
    if EARLIER_TITLE:
        lines += [f"**{EARLIER_TITLE}**", role["earlier"]]
    else:
        lab, _, rest = role["earlier"].partition(":")
        lines += [f"**{lab}:**{rest}" if rest else role["earlier"]]
    lines += ["", "## " + SELECTED_TITLE, SELECTED_MD, "", "## EDUCATION"]
    for line in EDU_LINES:
        lines.append(f"- {line}")
    lines.append("")
    PathWrite = open
    with open(path, "w") as f:
        f.write("\n".join(lines))

def page_count(pdf_path):
    out = subprocess.check_output(["pdfinfo", pdf_path], text=True)
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":")[1].strip())
    return -1
