#!/usr/bin/env python3
"""Rebuild a package cover.pdf from cover.txt using the native labelled-bullet format.
Opening, proof bullets, closing and approved signature are preserved. Existing
PDF date is retained unless --date is supplied. Does not rerun a batch builder.
Usage: rebuild_cover_from_txt.py <pkg_dir> [out_pdf] [--date "January 1, 2099"]"""

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

import sys, re, subprocess
from pathlib import Path
sys.path.insert(0, str(_JOBBI_APPS / 'lib'))  # 2026-10-20 p1: shared lib + claims.yaml shim
import _native_lib as NL
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from xml.sax.saxutils import escape as esc

args = sys.argv[1:]
date = None
if "--date" in args:
    i = args.index("--date"); date = args[i + 1]; del args[i:i + 2]
pkg = Path(args[0]); out_pdf = args[1] if len(args) > 1 else str(pkg / "cover.pdf")
if date is None:
    old = subprocess.check_output(["pdftotext", str(pkg / "cover.pdf"), "-"], text=True)
    date = next(l.strip() for l in old.splitlines() if l.strip())
    assert re.fullmatch(r"[A-Z][a-z]+ \d{1,2}, 20\d\d", date), f"no date line in existing cover.pdf: {date!r}"
blocks = [b.strip("\n") for b in (pkg / "cover.txt").read_text().strip().split("\n\n")]
assert blocks[0].startswith("Dear ") and blocks[0].endswith(","), "cover.txt must start with 'Dear ... ,'"
assert blocks[-1].startswith(NL._JOBBI_CAND["name"] + "\n"), "cover.txt must end with the approved candidate name + contact"
greet, sign = blocks[0], blocks[-1].split("\n")
body = blocks[1:-1]
bi = [i for i, b in enumerate(body) if b.startswith("- ")]
assert len(bi) == 1, "expected exactly one bullet block"
opening, bul, closing = body[:bi[0]], body[bi[0]].split("\n"), body[bi[0] + 1:]
st = NL.styles()
doc = SimpleDocTemplate(out_pdf, pagesize=letter, leftMargin=1*inch, rightMargin=1*inch, topMargin=0.85*inch, bottomMargin=0.85*inch)
c = [Paragraph(esc(date), st["LetterDate"]), Paragraph(esc(greet), st["LetterBody"])]
c += [Paragraph(esc(p), st["LetterBody"]) for p in opening]
for line in bul:
    assert line.startswith("- "), line
    lab, sep, rest = line[2:].partition(". ")
    if not sep or len(lab.split()) > 8:      # no short label sentence: render the whole bullet plain
        c.append(Paragraph(esc(line[2:]), st["LetterBody"], bulletText="•"))
    else:
        c.append(Paragraph(f"<b>{esc(lab)}.</b> {esc(rest)}", st["LetterBody"], bulletText="•"))
c += [Paragraph(esc(p), st["LetterBody"]) for p in closing]
c += [Spacer(1, 6)] + [Paragraph(esc(x), st["LetterSign"]) for x in sign]
doc.build(c)
print(out_pdf, NL.page_count(out_pdf), "page(s)")
