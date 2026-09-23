#!/usr/bin/env python3
"""Render a résumé markdown file to ATS-safe HTML, and measure it.

    python3 render_resume.py --md <resume.md> [--html out.html] [--pdf out.pdf]
                             [--pages 2]

THE BUILDER OWNS THE MARKUP. The skill emits content (markdown); this script
owns every tag, every CSS class, and all HTML escaping. Prior art: career-ops
splits the same way (a JSON payload + a builder script) and the formatting-bug
class cannot occur there because the model never holds markup.

Earned 2026-08-18, on the founder's own tailored résumé — both bugs shipped to
him in a PDF because the renderer was hand-rolled per run instead of living
here:
  * every wrapped source line became its own <p>, so the summary rendered as a
    column of orphan lines instead of a paragraph;
  * bold that OPENED on one line and CLOSED on the next never converted, so
    "**Deep fluency ...**" printed with literal asterisks.
Both are fixed structurally: blocks are assembled (wrapped lines joined) BEFORE
inline formatting runs, so a span crossing a line break is one string by then.

Measurement is the other half (issue #31): a résumé that does not fit its page
target is a decision for the candidate, not a silent trim. This script reports
words and rendered pages; the skill turns an overflow into a proposed cut list.
Exit 0 always for measurement; --strict makes an over-target render exit 1.
"""
import argparse, html, os, re, shutil, subprocess, sys, tempfile

CHROME = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "google-chrome", "chromium", "chromium-browser")

CSS = """
@page { size: Letter; margin: 0.4in 0.5in; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
       font-size: 10pt; line-height: 1.25; color: #111; margin: 0; }
h1 { font-size: 18pt; letter-spacing: .5px; margin: 0 0 2pt; }
h1 + p { font-size: 9.5pt; margin: 0 0 7pt; }
h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .6px;
     border-bottom: 1px solid #222; padding-bottom: 2pt; margin: 8pt 0 4pt; }
h3 { font-size: 10.5pt; margin: 7pt 0 1pt; }
h3 + p { margin: 0 0 2pt; font-size: 9.3pt; }
p { margin: 0 0 4pt; }
ul { margin: 2pt 0 4pt; padding-left: 14pt; }
li { margin: 0 0 2.5pt; }
h2, h3, li { page-break-inside: avoid; }
h2, h3, h3 + p { page-break-after: avoid; }
"""


def blocks(md_text):
    """Source lines -> [(kind, joined_text)]. Wrapped lines are joined HERE,
    before any inline formatting sees them."""
    out, kind, buf = [], None, []

    def flush():
        nonlocal kind, buf
        if kind and buf:
            out.append((kind, " ".join(" ".join(buf).split())))
        kind, buf = None, []

    for raw in md_text.splitlines():
        s = raw.rstrip()
        if not s.strip():
            flush(); continue
        m = re.match(r"^(#{1,3})\s+(.*)$", s)
        if m:
            flush(); out.append((f"h{len(m.group(1))}", m.group(2).strip())); continue
        if s.startswith("- "):
            flush(); kind, buf = "li", [s[2:]]; continue
        if kind in ("li", "p"):
            # Any non-blank line that is not a heading or a new bullet
            # continues the current block — markdown's rule, and the one that
            # matters: wrapped prose is usually FLUSH LEFT, not indented. An
            # indent-only rule silently split every wrapped paragraph into
            # one-line paragraphs (the bug this file exists to prevent; the
            # first fix attempt handled only the indented bullet case).
            buf.append(s.strip()); continue
        flush(); kind, buf = "p", [s]
    flush()
    return out


def inline(text):
    """Escape first, then convert emphasis. DOTALL is deliberate: a span may
    have crossed a line break in the source (it is one string by now)."""
    t = html.escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t, flags=re.S)
    t = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<em>\1</em>", t, flags=re.S)
    return t.replace("`", "")


def to_html(md_text, title="Resume"):
    body, in_ul = [], False
    for kind, text in blocks(md_text):
        if kind == "li":
            if not in_ul:
                body.append("<ul>"); in_ul = True
            body.append(f"<li>{inline(text)}</li>")
        else:
            if in_ul:
                body.append("</ul>"); in_ul = False
            body.append(f"<{kind}>{inline(text)}</{kind}>")
    if in_ul:
        body.append("</ul>")
    return ("<!doctype html><html><head><meta charset='utf-8'>"
            f"<title>{html.escape(title)}</title><style>{CSS}</style>"
            f"</head><body>{''.join(body)}</body></html>")


def word_count(md_text):
    """Words a reader actually sees — headings, prose, bullets; no markup."""
    return sum(len(re.sub(r"[*`#|]", " ", t).split()) for _, t in blocks(md_text))


def find_chrome():
    for c in CHROME:
        p = c if os.path.isabs(c) and os.path.exists(c) else shutil.which(c)
        if p:
            return p
    return None


def to_pdf(html_path, pdf_path):
    chrome = find_chrome()
    if not chrome:
        return False, "no Chrome/Chromium found — see references/patterns.md § The PDF (the conversion ladder)"
    subprocess.run([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}", html_path],
                   capture_output=True, timeout=120)
    return (os.path.exists(pdf_path), None) if os.path.exists(pdf_path) else (False, "Chrome produced no file")


def pdf_pages(pdf_path):
    """Page count without a dependency: /Type /Page objects minus /Type /Pages."""
    d = open(pdf_path, "rb").read()
    return d.count(b"/Type /Page") - d.count(b"/Type /Pages")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--md", required=True)
    ap.add_argument("--html"); ap.add_argument("--pdf")
    ap.add_argument("--pages", type=int, default=2, help="page target (patterns.md § Shape)")
    ap.add_argument("--strict", action="store_true", help="exit 1 when over target")
    a = ap.parse_args()

    md_text = open(a.md, encoding="utf-8").read()
    words = word_count(md_text)
    html_path = a.html or os.path.join(tempfile.mkdtemp(), "resume.html")
    open(html_path, "w", encoding="utf-8").write(to_html(md_text))
    print(f"words: {words}  ->  {html_path}")

    over = False
    if a.pdf:
        ok, err = to_pdf(html_path, a.pdf)
        if not ok:
            print(f"PDF: NOT RENDERED — {err}")
            return 0
        pages, size = pdf_pages(a.pdf), os.path.getsize(a.pdf)
        over = pages > a.pages
        print(f"pages: {pages} (target {a.pages}){'  ← OVER' if over else ''}  "
              f"| {size/1024:.0f}KB{'  ← over the ~100KB upload limit' if size > 100_000 else ''}")
        if over:
            # the candidate decides what goes; the skill owes them a cut list
            print("  over target — propose a ranked cut list to the candidate; "
                  "never trim silently (references/patterns.md § The page target)")
    return 1 if (over and a.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
