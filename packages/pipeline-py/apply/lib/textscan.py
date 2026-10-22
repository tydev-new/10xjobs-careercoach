#!/usr/bin/env python3
"""Shared text extraction for check_claims.py: candidate-facing text -> sentences -> metric tokens."""
import re, subprocess
from pathlib import Path

WORDNUM = {"two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
           "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "fifteen": "15", "twenty": "20"}
MAGNITUDE = ("dozens", "hundreds", "thousands", "millions", "billions")
# contact info, URLs and e-mail are not claims
STRIP = [re.compile(p) for p in (
    r"\[([^\]\n]*)\]\([^)\s]*\)",            # markdown link -> its label (first, before bare URLs)
    r"https?://[^\s)]+", r"\b[\w.+-]+@[\w-]+\.[\w.]+\b", r"\b\d{3}[.\-\s]\d{3}[.\-\s]\d{4}\b",
    r"\b(?:linkedin|github)\.com/[^\s)]+")]

def pdf_text(path):
    try:
        return subprocess.run(["pdftotext", str(path), "-"], capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return ""

def clean(text):
    for rx in STRIP:
        text = rx.sub(lambda m: m.group(1) if m.groups() else " ", text)
    text = text.replace("\u00ad", "").replace("\ufb01", "fi").replace("\ufb02", "fl")
    return text

def units(text):
    """Split into bullets/lines, then sentences. Returns a list of strings."""
    text = clean(text)
    text = re.sub(r"-\n(?=[a-z])", "", text)                 # de-hyphenate wraps
    blocks = re.split(r"\n\s*\n|\n\s*[•\-\*]\s+|\n(?=[A-Z][A-Z &]{3,}\n)|•", text)
    out = []
    for b in blocks:
        b = " ".join(b.split())
        if not b:
            continue
        for s in re.split(r"(?<=[.;!?])\s+(?=[A-Z(\"'])", b):
            s = s.strip()
            if s:
                out.append(s)
    return out

NUM_RX = re.compile(
    r"(?<![\w.])(\d{6,}[A-Z]\d|\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|\+|x\b|×|[MKB]\+?(?![a-z])))*)", re.I)
DATE_RX = re.compile(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b")
YEAR_RX = re.compile(r"^(19|20)\d\d$")

def tokens(sentence, ignore_terms=()):
    s = DATE_RX.sub(" ", sentence)
    for t in sorted(ignore_terms, key=len, reverse=True):
        s = re.sub(re.escape(t), " ", s, flags=re.I)
    toks = []
    for m in NUM_RX.finditer(s):
        t = m.group(1).replace(",", "").replace(" ", "").replace("×", "x")
        toks.append(t.upper() if re.search(r"[A-Z]\d$", t, re.I) else t.lower())
    low = s.lower()
    for w, d in WORDNUM.items():
        if re.search(rf"\b{w}\b(?=[\s-](?:person|people|u\.s\.|patents?|versions?|teams?|engineers?|months?|weeks?|years?|regions?|managers?|hires?))", low):
            toks.append(d)
    for w in MAGNITUDE:
        if re.search(rf"\b{w}\b", low):
            toks.append(w)
    return toks

def norm_num(t):
    """Canonical form used for comparison: lowercase, no $ commas or spaces; 'about'/'~' are handled by callers."""
    return str(t).lower().replace(",", "").replace(" ", "").replace("×", "x").replace("~", "")


def md_candidate_text(md):
    """Candidate-facing part of resume-native.md: the rendered headline plus everything from ## SUMMARY on."""
    head = ""
    m = re.search(r"(?m)^\*\*Headline[^*]*\*\*\s*(.+)$", md)
    if m:
        head = m.group(1).strip() + "\n"
    body = md.split("## SUMMARY", 1)[1] if "## SUMMARY" in md else md
    return head + body

def md_units(md):
    """One unit per sentence; markdown bullets, headers and emphasis stripped."""
    out = []
    for line in clean(md).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line == "---":
            continue
        line = re.sub(r"^[-*•]\s+", "", line)
        line = re.sub(r"[*_`]+", "", line).strip()
        for s in re.split(r"(?<=[.;!?])\s+(?=[A-Z(\"'])", line):
            if s.strip():
                out.append(s.strip())
    return out
