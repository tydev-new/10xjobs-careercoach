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
--candidate takes the CANDIDATE-AUTHORED text: the case's own user
messages (prompt.md, turn*.md) and files the candidate wrote or named,
or, for a saved web conversation, its user messages and seed files.
Repeatable; a directory argument is read recursively, EXCLUDING
script-written records (jobs.md — record_verdict.py/search's own field
set, never the candidate's words; a token that only lives there is not
something the candidate typed). Every snake_case token found in
candidate text is exempt from HARD — a token the candidate typed or
named a file with is not a leak the skills produced, so it is
downgraded to REVIEW. With no --candidate, that exemption set is empty.
A --candidate path that does not exist on disk is an error (exit 2),
never a silent no-op.

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
# A real file name or a plain domain/path token: starts lowercase (a real
# script/file/domain name here is never capitalised — "Node.js" is prose,
# not a pointer), and its "extension" is 2-6 lowercase letters/digits
# starting with a letter (excludes "e.g" — 1 char — and "$0.35"/"3.5" —
# starts with a digit). *.py is handled separately above (HARD, not
# REVIEW) and checked first, so it always wins that overlap.
FILEPATH = re.compile(r"\b[a-z0-9_][\w./-]*\.[a-z][a-z0-9]{1,5}\b")
# A capitalised workspace file name ("CLAUDE.md", "README.md") is still a
# pointer (§ 3: workspace *.md names are REVIEW); only a document extension
# counts, so prose like "Node.js" stays out.
CAP_FILENAME = re.compile(r"\b[A-Z][\w-]*\.(?:md|txt|json|pdf|html|csv)\b")
# A scheme-less URL or bare domain path (design § 3: "outside a URL or
# email" — a scheme-less one is still a path). Requires a dot BEFORE the
# slash, so it never eats "6/7 held" or similar digit/digit phrases.
SCHEMELESS_PATH = re.compile(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)+/[\w./-]+")
JD_WORD = re.compile(r"\bJD\b")
GATE_WORD = re.compile(r"\bgate\b")
TRACK = re.compile(r"\btrack\s+[A-Za-z]\b(?!\w)", re.IGNORECASE)
HELD = re.compile(r"\b\d+/\d+ held\b")
CAPS_LABEL = re.compile(r"\b(?:DECISION|ARTIFACT|STATUS|TO-DO)\b")
COINED = re.compile(
    r"\bmechanical checks?\b|\blanguage checks?\b|\blanguage checker\b"
    r"|\bTo Review\b|\bshown-but-unnamed\b|§"
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

    # 2. a scheme-less URL / bare domain path — REVIEW, consumed whole so a
    #    snake token inside it (linkedin.com/in/jordan_lee) is never HARD.
    #    Checked BEFORE the plain FILEPATH pass so the longer match wins.
    for m in SCHEMELESS_PATH.finditer(text):
        if _inside(m.start(), excluded):
            continue
        hits.append(Hit(REVIEW, source, m.group(0), _context_for(text, m.start(), m.end())))
        consumed.append((m.start(), m.end()))

    # 3. workspace file names / any other dotted-extension token — REVIEW.
    for pat in (CAP_FILENAME, FILEPATH):
      for m in pat.finditer(text):
        if _inside(m.start(), excluded) or _overlaps(m.start(), m.end(), consumed):
            continue
        hits.append(Hit(REVIEW, source, m.group(0), _context_for(text, m.start(), m.end())))
        consumed.append((m.start(), m.end()))

    # 4. "JD" — REVIEW.
    for m in JD_WORD.finditer(text):
        if _inside(m.start(), excluded):
            continue
        hits.append(Hit(REVIEW, source, m.group(0), _context_for(text, m.start(), m.end())))

    # 5. "gate" — REVIEW.
    for m in GATE_WORD.finditer(text):
        if _inside(m.start(), excluded):
            continue
        hits.append(Hit(REVIEW, source, m.group(0), _context_for(text, m.start(), m.end())))

    # 6. the coined-word list, Track [A-Z], N/M held, DECISION/ARTIFACT/
    #    STATUS/TO-DO in capitals — HARD, unconditional.
    for pattern in (COINED, TRACK, HELD, CAPS_LABEL):
        for m in pattern.finditer(text):
            if _inside(m.start(), excluded):
                continue
            hits.append(Hit(HARD, source, m.group(0), _context_for(text, m.start(), m.end())))

    # 7. remaining snake_case tokens — HARD, unless inside a file/path
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


# Script-written records, never the candidate's own words — excluded from
# --candidate so a schema field there can't accidentally exempt a real
# leak (jobs.md is written ONLY by record_verdict.py / search's sweeps).
SCRIPT_WRITTEN_NAMES = {"jobs.md"}


def collect_candidate_tokens(paths):
    """Every snake_case token appearing in the candidate-AUTHORED text —
    the case's user messages, and planted workspace files the candidate
    wrote or named (never a script-written record — SCRIPT_WRITTEN_NAMES).
    A directory is read recursively. A path that doesn't exist is an
    error, not a silent no-op — a typo must not silently empty the
    exemption set."""
    tokens = set()
    for path in paths:
        if not os.path.exists(path):
            raise SystemExit(f"scan_voice.py: --candidate path does not exist: {path}")
        files = []
        if os.path.isdir(path):
            for root, _dirs, names in os.walk(path):
                for name in names:
                    if name in SCRIPT_WRITTEN_NAMES:
                        continue
                    files.append(os.path.join(root, name))
        elif os.path.isfile(path):
            if os.path.basename(path) not in SCRIPT_WRITTEN_NAMES:
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
