#!/usr/bin/env python3
"""Scan reply text for engineering-jargon leaks reaching the candidate.

docs/design-plain-replies.md § 3: "Can code catch a leak?" — at runtime,
no (a script over the model's own reply is no guard, and the web app's
code should not rewrite the model's prose). At TEST time, yes: this is
that one scanner, run against the harness transcripts (as judge input),
the web fixtures (a unit test), and a saved live-run conversation. It
never runs at request time and is never a gate.

Reads ONLY reply text (assistant `text` parts — typically already
extracted by extract_text.py) and the lines ADDED to plan.md this turn —
never tool calls or their output, which keep their own words (design § 1,
"what it does not bind").

    scan_voice.py --reply <file> [--plan-added <file>] [--candidate <path> ...]

--reply is the reply text to scan. --plan-added is the diff-added lines
of plan.md (also scanned as reply-grade text — design § 1, moment 2).
--candidate takes the candidate's own text: a planted workspace's files
and the case's user messages (prompt.md, turn*.md), or, for a saved web
conversation, its user messages and seed files. Repeatable; a directory
argument is read recursively. Every snake_case token found in candidate
text is exempt from HARD — a token the candidate typed or named a file
with is not a leak the skills produced, so it is downgraded to REVIEW.
With no --candidate, that exemption set is empty.

Prints one line per hit to stdout, tab-separated:
    <CLASS>\t<source>\t<match>\t<context>
CLASS is HARD or REVIEW. Exit code is always 0 (a scanner, not a gate).
"""
import argparse, os, re, sys

# ---- patterns (design § 3). Case-sensitive except TRACK.
URL = re.compile(r"https?://\S+")
EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
SNAKE = re.compile(r"\b[a-z]+_[a-z_]+\b")
PY_FILE = re.compile(r"\b[\w./-]*[a-z_]+\.py\b")
# Any dotted-extension token — catches workspace file names (*.md, *.html)
# AND non-.py files a candidate might name (jordan_resume.pdf). *.py is
# handled separately above (HARD, not REVIEW) and checked first.
FILEPATH = re.compile(r"\b[\w][\w./-]*\.[A-Za-z0-9]{1,6}\b")
JD_WORD = re.compile(r"\bJD\b")
GATE_WORD = re.compile(r"\bgate\b")
TRACK = re.compile(r"\btrack\s+[A-Za-z]\b(?!\w)", re.IGNORECASE)
HELD = re.compile(r"\b\d+/\d+ held\b")
CAPS_LABEL = re.compile(r"\b(?:DECISION|ARTIFACT|STATUS|TO-DO)\b")
COINED = re.compile(
    r"\bmechanical checks?\b|\blanguage check\b|\bTo Review\b|\bshown-but-unnamed\b|§"
)

HARD = "HARD"
REVIEW = "REVIEW"


class Hit:
    __slots__ = ("cls", "source", "match", "context")

    def __init__(self, cls, source, match, context):
        self.cls = cls
        self.source = source
        self.match = match
        self.context = context

    def line(self):
        ctx = " ".join(self.context.split())
        if len(ctx) > 160:
            ctx = ctx[:157] + "..."
        return f"{self.cls}\t{self.source}\t{self.match}\t{ctx}"


def _excluded_spans(text):
    """URL and email spans — a snake_case token inside one is not scanned
    at all (design § 3: "outside a URL or email")."""
    spans = [(m.start(), m.end()) for m in URL.finditer(text)]
    spans += [(m.start(), m.end()) for m in EMAIL.finditer(text)]
    return spans


def _inside(pos, spans):
    return any(s <= pos < e for s, e in spans)


def _overlaps(start, end, spans):
    return any(start < e and s < end for s, e in spans)


def _context_for(text, start, end):
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    if line_end == -1:
        line_end = len(text)
    return text[line_start:line_end]


def scan_text(text, candidate_tokens, source):
    """Return a list of Hit for one block of reply-grade text."""
    hits = []
    excluded = _excluded_spans(text)
    consumed = []  # spans already reported, so a snake token inside a
                    # reported *.py / file-path match isn't double-counted

    # 1. any *.py — HARD, unconditional.
    for m in PY_FILE.finditer(text):
        if _inside(m.start(), excluded):
            continue
        hits.append(Hit(HARD, source, m.group(0), _context_for(text, m.start(), m.end())))
        consumed.append((m.start(), m.end()))

    # 2. workspace file names / any other dotted-extension token — REVIEW.
    for m in FILEPATH.finditer(text):
        if _inside(m.start(), excluded) or _overlaps(m.start(), m.end(), consumed):
            continue
        hits.append(Hit(REVIEW, source, m.group(0), _context_for(text, m.start(), m.end())))
        consumed.append((m.start(), m.end()))

    # 3. "JD" — REVIEW.
    for m in JD_WORD.finditer(text):
        if _inside(m.start(), excluded):
            continue
        hits.append(Hit(REVIEW, source, m.group(0), _context_for(text, m.start(), m.end())))

    # 4. "gate" — REVIEW.
    for m in GATE_WORD.finditer(text):
        if _inside(m.start(), excluded):
            continue
        hits.append(Hit(REVIEW, source, m.group(0), _context_for(text, m.start(), m.end())))

    # 5. the coined-word list, Track [A-Z], N/M held, DECISION/ARTIFACT/
    #    STATUS/TO-DO in capitals — HARD, unconditional.
    for pattern in (COINED, TRACK, HELD, CAPS_LABEL):
        for m in pattern.finditer(text):
            if _inside(m.start(), excluded):
                continue
            hits.append(Hit(HARD, source, m.group(0), _context_for(text, m.start(), m.end())))

    # 6. remaining snake_case tokens — HARD, unless inside a file/path
    #    already consumed above, or in the candidate's own vocabulary.
    for m in SNAKE.finditer(text):
        if _inside(m.start(), excluded) or _overlaps(m.start(), m.end(), consumed):
            continue
        token = m.group(0)
        cls = REVIEW if token.lower() in candidate_tokens else HARD
        hits.append(Hit(cls, source, token, _context_for(text, m.start(), m.end())))

    return hits


def _read_text(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def collect_candidate_tokens(paths):
    """Every snake_case token appearing in the candidate's own text —
    planted workspace files, the case's user messages, or a saved web
    conversation's user messages and seed files. A directory is read
    recursively."""
    tokens = set()
    for path in paths:
        files = []
        if os.path.isdir(path):
            for root, _dirs, names in os.walk(path):
                for name in names:
                    files.append(os.path.join(root, name))
        elif os.path.isfile(path):
            files.append(path)
        for fp in files:
            try:
                text = _read_text(fp)
            except (OSError, UnicodeDecodeError):
                continue
            for m in SNAKE.finditer(text):
                tokens.add(m.group(0).lower())
    return tokens


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reply", required=True)
    ap.add_argument("--plan-added")
    ap.add_argument("--candidate", action="append", default=[])
    args = ap.parse_args(argv)

    candidate_tokens = collect_candidate_tokens(args.candidate)

    hits = []
    hits += scan_text(_read_text(args.reply), candidate_tokens, "reply")
    if args.plan_added:
        hits += scan_text(_read_text(args.plan_added), candidate_tokens, "plan-added")

    for h in hits:
        print(h.line())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
