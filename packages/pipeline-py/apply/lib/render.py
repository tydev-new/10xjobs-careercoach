"""PDF rendering for resumes and cover letters (reportlab). Everything personal comes from the inputs:
the resume text from resume-native.md, and the name, contact lines and cover signature from candidate.yaml.

resume-native.md layout (see config.example/base-resumes/*/resume-native.md):
  header (above the first '---'):  **Headline (rendered under name):** <one line>   (required)
  ## SUMMARY                       "- " bullets
  ## PROFESSIONAL EXPERIENCE       **Company, Title** / *dates · place* / "- " bullets (a line "_Sub heading_" starts a group),
                                   then the earlier-career line: **Earlier career:** ...  (or **Earlier Experience** + a paragraph)
  ## <any other section>           optional, e.g. PUBLICATIONS AND PATENTS or SELECTED WORK (paragraphs; [label](url) links)
  ## EDUCATION                     "- Degree, Field, School"
  ## SKILLS                        one paragraph

Rendering is deterministic (reportlab invariant mode): the same input gives the same bytes.
"""
import re
import subprocess
from xml.sax.saxutils import escape

from reportlab import rl_config
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer

rl_config.invariant = 1
CORE = ("SUMMARY", "PROFESSIONAL EXPERIENCE", "EDUCATION", "SKILLS")


def styles(align="justify"):
    s = getSampleStyleSheet()
    body_align = TA_LEFT if align == "left" else TA_JUSTIFY
    add = lambda **k: s.add(ParagraphStyle(**k))
    add(name="Name", fontName="Helvetica-Bold", fontSize=15, leading=18, alignment=TA_CENTER, spaceAfter=1, textColor=HexColor("#111111"))
    add(name="Headline", fontName="Helvetica-Bold", fontSize=9.5, leading=12, alignment=TA_CENTER, spaceAfter=1, textColor=HexColor("#222222"))
    add(name="Contact", fontName="Helvetica", fontSize=8.5, leading=11, alignment=TA_CENTER, spaceAfter=4, textColor=HexColor("#333333"))
    add(name="Section", fontName="Helvetica-Bold", fontSize=10, leading=12, spaceBefore=7, spaceAfter=2, textColor=HexColor("#111111"))
    add(name="BodyJust", fontName="Helvetica", fontSize=9, leading=11.5, alignment=body_align, spaceAfter=2, textColor=HexColor("#222222"))
    add(name="JobTitle", fontName="Helvetica-Bold", fontSize=9.5, leading=12, spaceBefore=5, spaceAfter=0, textColor=HexColor("#111111"))
    add(name="JobMeta", fontName="Helvetica-Oblique", fontSize=8.5, leading=10.5, spaceAfter=1.2, textColor=HexColor("#444444"))
    add(name="SubHead", fontName="Helvetica-BoldOblique", fontSize=8.8, leading=11, spaceBefore=1.5, spaceAfter=0.8, textColor=HexColor("#222222"))
    add(name="BulletItem", fontName="Helvetica", fontSize=9, leading=11.4, leftIndent=12, firstLineIndent=-8, spaceAfter=1.4, textColor=HexColor("#222222"))
    add(name="EduLine", fontName="Helvetica", fontSize=9, leading=11.5, spaceAfter=1, textColor=HexColor("#222222"))
    add(name="LetterBody", fontName="Helvetica", fontSize=10.5, leading=15, alignment=TA_JUSTIFY, spaceAfter=10, textColor=HexColor("#222222"))
    add(name="LetterSign", fontName="Helvetica", fontSize=10.5, leading=14, spaceBefore=6, textColor=HexColor("#222222"))
    add(name="LetterDate", fontName="Helvetica", fontSize=10, leading=13, spaceAfter=12, textColor=HexColor("#222222"))
    return s


def hr():
    return HRFlowable(width="100%", thickness=0.8, color=HexColor("#222222"), spaceBefore=1, spaceAfter=3)


def inline(s):
    """markdown **bold** and [label](url) -> reportlab markup; everything else escaped."""
    s = escape(s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" color="#1a4fa0">\1</a>', s)
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)


# ---------------- resume ----------------
def parse_resume(md):
    head, sep, body = md.partition("\n---\n")
    if not sep:
        raise ValueError("resume-native.md has no '---' header separator")
    m = re.search(r"(?m)^\*\*Headline[^*]*\*\*\s*(.+)$", head)
    if not m:
        raise ValueError("resume-native.md header has no **Headline ...:** line")
    L = body.split("\n")
    order = [l[3:].strip() for l in L if l.startswith("## ")]

    def section(name):
        i = L.index("## " + name); j = i + 1
        while j < len(L) and not L[j].startswith("## "): j += 1
        return L[i + 1:j]

    for need in CORE:
        if need not in order:
            raise ValueError(f"resume-native.md has no ## {need} section")
    jobs, earlier, earlier_title, cur = [], None, None, None
    exp = section("PROFESSIONAL EXPERIENCE"); k = 0
    while k < len(exp):
        x = exp[k].strip()
        if x == "**Earlier Experience**":
            earlier, earlier_title = (exp[k + 1].strip() if k + 1 < len(exp) else ""), "Earlier Experience"; break
        if x.startswith("**Earlier career:**"):
            earlier = "Earlier career:" + x[len("**Earlier career:**"):]; break
        if x.startswith("**") and x.endswith("**"):
            meta = exp[k + 1].strip() if k + 1 < len(exp) else ""
            cur = {"title": x[2:-2], "meta": meta.strip("*_"), "bullets": []}; jobs.append(cur); k += 2; continue
        if cur is not None and x.startswith("- "): cur["bullets"].append(x[2:])
        elif cur is not None and x.startswith("_") and x.endswith("_") and len(x) > 2: cur["bullets"].append("@@ " + x[1:-1])
        k += 1
    extras = []
    for name in order:
        if name not in CORE:
            paras = [p.strip() for p in "\n".join(section(name)).strip().split("\n\n") if p.strip()]
            extras.append((name, paras))
    return {"headline": m.group(1).strip(),
            "base": (re.search(r"\*\*Base:\*\*\s*([\w-]+)", head) or [None, None])[1],
            "summary": [x[2:] for x in section("SUMMARY") if x.startswith("- ")],
            "jobs": jobs, "earlier": earlier, "earlier_title": earlier_title, "extras": extras,
            "education": [x[2:] for x in section("EDUCATION") if x.startswith("- ")],
            "skills": " ".join(x.strip() for x in section("SKILLS")).strip(),
            "order": order}


def render_resume(md, out_pdf, candidate, align="justify"):
    """resume-native.md text -> PDF. candidate: dict with name_display (or name) and resume_contact_lines."""
    r = parse_resume(md)
    st = styles(align)
    doc = SimpleDocTemplate(str(out_pdf), pagesize=letter, leftMargin=0.55 * inch, rightMargin=0.55 * inch,
                            topMargin=0.42 * inch, bottomMargin=0.4 * inch)
    s = [Paragraph(escape(candidate.get("name_display") or candidate["name"]), st["Name"]),
         Paragraph(inline(r["headline"]), st["Headline"]),
         Paragraph("<br/>".join(escape(x) for x in candidate.get("resume_contact_lines") or []), st["Contact"]), hr()]

    def heading(t):
        s.append(Paragraph(escape(t), st["Section"])); s.append(hr())

    heading("SUMMARY")
    s += [Paragraph("• " + inline(b), st["BulletItem"]) for b in r["summary"]]
    heading("PROFESSIONAL EXPERIENCE")
    for j in r["jobs"]:
        block = [Paragraph(inline(j["title"]), st["JobTitle"]), Paragraph(escape(j["meta"]), st["JobMeta"])]
        for b in j["bullets"]:
            block.append(Paragraph(inline(b[3:]), st["SubHead"]) if b.startswith("@@ ") else Paragraph("• " + inline(b), st["BulletItem"]))
        s.append(KeepTogether(block[:3])); s += block[3:]
    if r["earlier"]:
        if r["earlier_title"]:
            s += [Paragraph(escape(r["earlier_title"]), st["JobTitle"]), Paragraph(inline(r["earlier"]), st["BodyJust"])]
        else:
            lab, _, rest = r["earlier"].partition(":")
            s += [Spacer(1, 4), Paragraph(f"<b>{escape(lab)}:</b>{inline(rest)}" if rest else inline(r["earlier"]), st["BodyJust"])]
    for name, paras in r["extras"]:
        heading(name)
        s.append(Paragraph("<br/>".join(inline(p) for p in paras), st["BodyJust"]))
    heading("EDUCATION")
    s += [Paragraph(inline(e), st["EduLine"]) for e in r["education"]]
    if r["skills"]:
        heading("SKILLS")
        s.append(Paragraph(inline(r["skills"]), st["BodyJust"]))
    doc.build(s)
    return out_pdf


# ---------------- cover ----------------
def parse_cover(txt, candidate):
    """cover.txt: 'Dear ...,' / opening paragraph(s) / one block of '- <Label.> <body>' bullets / closing paragraph(s) /
    signature (the cover_signature lines from candidate.yaml)."""
    blocks = [b.strip("\n") for b in txt.strip().split("\n\n")]
    sig = list(candidate.get("cover_signature") or [])
    if not (blocks[0].startswith("Dear ") and blocks[0].endswith(",")):
        raise ValueError("cover.txt must start with 'Dear ... ,'")
    if not sig or blocks[-1].split("\n") != sig:
        raise ValueError("cover.txt must end with the cover_signature lines from candidate.yaml")
    body = blocks[1:-1]
    bi = [i for i, b in enumerate(body) if b.startswith("- ")]
    if len(bi) != 1:
        raise ValueError("cover.txt: expected exactly one bullet block")
    return {"greeting": blocks[0], "opening": body[:bi[0]], "bullets": body[bi[0]].split("\n"),
            "closing": body[bi[0] + 1:], "signature": sig}


def render_cover(txt, out_pdf, date, candidate):
    if not date:
        raise ValueError("cover date is required (package.yaml cover.date)")
    c = parse_cover(txt, candidate)
    st = styles()
    doc = SimpleDocTemplate(str(out_pdf), pagesize=letter, leftMargin=1 * inch, rightMargin=1 * inch,
                            topMargin=0.85 * inch, bottomMargin=0.85 * inch)
    s = [Paragraph(escape(date), st["LetterDate"]), Paragraph(escape(c["greeting"]), st["LetterBody"])]
    s += [Paragraph(escape(p), st["LetterBody"]) for p in c["opening"]]
    for line in c["bullets"]:
        if not line.startswith("- "):
            raise ValueError(f"cover bullet must start with '- ': {line!r}")
        lab, sep, rest = line[2:].partition(". ")
        if not sep or len(lab.split()) > 8:
            s.append(Paragraph(escape(line[2:]), st["LetterBody"], bulletText="•"))
        else:
            s.append(Paragraph(f"<b>{escape(lab)}.</b> {escape(rest)}", st["LetterBody"], bulletText="•"))
    s += [Paragraph(escape(p), st["LetterBody"]) for p in c["closing"]]
    s += [Spacer(1, 6)] + [Paragraph(escape(x), st["LetterSign"]) for x in c["signature"]]
    doc.build(s)
    return out_pdf


# ---------------- PDF helpers (poppler-utils) ----------------
def pdf_text(p, layout=True):
    return subprocess.check_output(["pdftotext"] + (["-layout"] if layout else []) + [str(p), "-"], text=True)


def page_count(p):
    out = subprocess.check_output(["pdfinfo", str(p)], text=True)
    m = re.search(r"Pages:\s+(\d+)", out)
    return int(m.group(1)) if m else -1
