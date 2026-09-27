#!/usr/bin/env python3
"""jobs.md — the pipeline as a readable markdown record (the one record).

Script-owned: regenerated in full on every save, organized by stage so the
file reads as the board. Humans read it anywhere; changes go through the
owning scripts (search_ats.py appends, update_job.py moves, record_verdict.py
judges) so the loud-fail duplicate key survives the storage change.

Design (settled at #14's gate): one labeled block per role — a 20-field row
is unreadable as a table row. SQLite is gone as persistent storage; in-run
set logic uses plain dicts. The escape hatch stays: at a few hundred roles,
parsing markdown to answer questions gets silly and the pipeline moves back
to a real table — reverse on evidence.
"""
import os, re, sys
from datetime import datetime, timezone

STAGES = ["To Review", "Interested", "Applied", "Interviewing", "Offer"]
DISMISSED = "Dismissed"
NOTES = "Search notes"

# block field label -> row key (order here = write order)
FIELDS = [
    ("URL", "url"), ("Location", "location"), ("Posted", "posted_at"),
    ("Seen", "seen_at"), ("Updated", "updated_at"),
    ("Verdict", "fit_verdict"), ("Score", "fit_score"), ("Reason", "fit_reason"),
    ("Dealbreakers", "dealbreakers"), ("Track", "track"), ("Flags", "flags"),
    ("Sim", "jd_sim"), ("JD", "jd_file"), ("Analysis", "analysis_file"),
    ("Company file", "company_file"),
    ("Evaluated", "evaluated_at"), ("Was", "was_stage"), ("Dismissed", "dismiss_note"),
]
LABEL_TO_KEY = {l: k for l, k in FIELDS}

# B2: sanitising (design-web-search.md § 4.3/§ 4.4) — every row value save()
# writes (a field's value, and the company/title in a row's heading; NEVER
# the `## Search notes` block, which save() copies as it is) has every run
# of THIS exact class collapsed to one space, then is trimmed. This is
# deliberately NOT Python's `\s` (broader: it also counts 0x1c-0x1f, 0x1680,
# 0x2000-0x200a, 0x202f, 0x205f, 0x3000) and NOT re.escape('\s') — a
# different, narrower, written-out class so both languages agree on the
# same posting (the design's own reasoning for why `\s` would make Python
# and JavaScript disagree). Prevents a posting title carrying a newline and
# `## Offer` or `- URL:` from becoming a stage heading or a field of
# another row (a job posting is the plan's named prompt-injection risk).
_SANITISE_WS = " \t\n\r\f\v\x85\xa0  "
_SANITISE_WS_RE = re.compile("[" + re.escape(_SANITISE_WS) + "]+")


def _clean(value):
    """Collapse every run of the sanitising whitespace class to one space
    and trim both ends. `None` (an absent field) stays `None`."""
    if value is None:
        return None
    cleaned = _SANITISE_WS_RE.sub(" ", str(value))
    return cleaned.strip(_SANITISE_WS)


def _clean_company(value):
    """Like `_clean`, plus: a company containing ` — ` (space, em dash,
    space), or ENDING in ` —` (space, em dash, nothing after — the
    heading's own separator supplies the space and the title that would
    otherwise follow), has that em dash written as `-` — a row's
    heading splits company from title on the FIRST ` — `, so a company
    that legitimately carries an em dash must never be misread as the
    company/title separator. Titles keep theirs; the split above takes
    the first one. (S1 review, finding 8: a company ending in ` —` with
    no rewrite would make the heading read `### Acme — — Role`, two
    ` — ` runs, so the FIRST one — the company's own trailing dash, not
    the real separator — is what load() would split on.)"""
    cleaned = _clean(value)
    if cleaned is None:
        return None
    cleaned = cleaned.replace(" — ", " - ")
    if cleaned.endswith(" —"):
        cleaned = cleaned[:-1] + "-"
    return cleaned


def canon(s):
    s = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())
    s = re.sub(r"\b(inc|llc|corp|labs|technologies|company|the)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def key(row):
    return (canon(row["company"]), canon(row["title"]))


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def path(workspace):
    return os.path.join(workspace, "jobs.md")


def load(workspace):
    """Parse jobs.md -> list of row dicts. Absent file -> empty pipeline.
    Unknown ## sections (e.g. Search notes) are NOT stages — their content
    never parses as roles. Parsing STOPS at the `## Search notes` heading
    (S1 review, finding 1): everything after it is notes, matching
    load_notes(); a posting quoted inside that block can legitimately carry
    a line that reads like a real stage heading (`## Offer` is both a
    stage name and ordinary English) or a fake `### Company — Title` /
    `- URL:` row — those must never parse as a row, the same threat model
    § 4.3's B1 sanitising already covers for a title arriving through a
    field."""
    p = path(workspace)
    rows, cur_stage, row = [], None, None
    raw_lines = None  # accumulates the CURRENT row's exact original lines
    if not os.path.exists(p):
        return rows

    def finalize_raw():
        # LEAD ruling (S1 review, third pass): cache each row's exact
        # original text (`row["_raw"]`) so save() can echo an UNTOUCHED
        # row byte for byte, even a legacy/hand-edited heading that
        # would fail B2's cleaning (e.g. `### Acme Staff Engineer`, no
        # ` — ` separator at all) — an old row must never block, or even
        # reformat, a write it isn't part of.
        nonlocal raw_lines
        if row is not None and raw_lines is not None:
            while raw_lines and raw_lines[-1] == "":
                raw_lines.pop()
            row["_raw"] = "\n".join(raw_lines)
        raw_lines = None

    for line in open(p, encoding="utf-8"):
        line = line.rstrip("\n")
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m and not line.startswith("###"):
            finalize_raw()
            name = m.group(1).strip()
            if name == NOTES:
                break
            cur_stage = name if name in STAGES or name == DISMISSED else None
            continue
        m = re.match(r"^###\s+(.+?)\s*$", line)
        if m and cur_stage:
            finalize_raw()
            head = m.group(1)
            company, _, title = head.partition(" — ")
            row = {"company": company.strip(), "title": title.strip(),
                   "stage": cur_stage if cur_stage != DISMISSED else None,
                   "dismissed": cur_stage == DISMISSED}
            rows.append(row)
            raw_lines = [line]
            continue
        if row is not None and raw_lines is not None:
            raw_lines.append(line)
        m = re.match(r"^-\s+([^:]+):\s*(.*)$", line)
        if m and row is not None:
            k = LABEL_TO_KEY.get(m.group(1).strip())
            if k:
                row[k] = m.group(2).strip() or None
    finalize_raw()
    for r in rows:
        if r["dismissed"]:
            r["stage"] = r.get("was_stage") or "To Review"
        r.setdefault("fit_score", None)
        if r.get("fit_score"):
            try:
                r["fit_score"] = int(r["fit_score"])
            except ValueError:
                r["fit_score"] = None
    return rows


def load_notes(workspace):
    """The free-text ## Search notes section (script-preserved, agent-written:
    market signals, lane findings — search OUTPUT, so it lives here and never
    in criteria.md, which is input)."""
    p = path(workspace)
    if not os.path.exists(p):
        return ""
    m = re.search(r"^## Search notes\s*$\n(.*)\Z", open(p, encoding="utf-8").read(),
                  re.M | re.S)
    return m.group(1).strip() if m else ""


def append_note(workspace, text):
    notes = load_notes(workspace)
    stamp = datetime.now(timezone.utc).date().isoformat()
    block = f"### {stamp}\n\n{text.strip()}"
    save(workspace, load(workspace), notes=(notes + "\n\n" + block).strip() if notes else block)


def save(workspace, rows, notes=None, write_key=None):
    """Regenerate jobs.md in full: stage sections in board order, dismissed
    last with reasons. A duplicate canonical key is a HARD error — the
    UNIQUE constraint, ported.

    `write_key` (LEAD ruling, S1 review, third pass): the canonical
    `key(row)` of the ONE row this call is creating or updating — the
    writers (record_verdict.py, update_job.py) always pass it. Every
    OTHER row is written back exactly as it was read (`_block()`'s echo
    path below), so a pre-existing row's legacy or hand-edited heading
    never blocks, or reformats, a write it isn't part of. `write_key=None`
    (the default — a bare library call, no single row identified) cleans
    and validates every row, unchanged from before this ruling."""
    seen = {}
    for r in rows:
        k = key(r)
        if k in seen:
            raise SystemExit(f"jobs.md: duplicate role {r['company']} — {r['title']} "
                             f"(canonical collision with {seen[k]['company']} — {seen[k]['title']})")
        seen[k] = r
    out = ["# Pipeline", "",
           "*The record. Script-written (search sweeps, update_job.py moves,",
           "record_verdict.py judges) — read it anywhere; change it via chat so",
           "the duplicate-key check can protect it. Dismissed roles keep their",
           "history at the bottom; nothing is ever deleted.*", ""]
    active = [r for r in rows if not r.get("dismissed")]
    out.append(f"**Active: {len(active)}** · dismissed: {len(rows) - len(active)} · updated {now_iso()[:10]}")
    out.append("")
    for stage in STAGES:
        block = [r for r in active if r.get("stage") == stage]
        if not block:
            continue
        out.append(f"## {stage}")
        out.append("")
        for r in sorted(block, key=lambda x: (-(x.get("fit_score") or 0), x["company"].lower(), x["title"].lower())):
            out.extend(_block(r, write_key=write_key))
    gone = [r for r in rows if r.get("dismissed")]
    if gone:
        out.append(f"## {DISMISSED}")
        out.append("")
        for r in sorted(gone, key=lambda x: (x["company"].lower(), x["title"].lower())):
            r["was_stage"] = r.get("stage") or "To Review"
            out.extend(_block(r, dismissed=True, write_key=write_key))
    if notes is None:
        notes = load_notes(workspace)   # a plain save never destroys the notes
    if notes:
        out += ["## Search notes", "", notes, ""]
    with open(path(workspace), "w", encoding="utf-8") as f:
        f.write("\n".join(out).rstrip() + "\n")


def _block(r, dismissed=False, write_key=None):
    # LEAD ruling (S1 review, third pass): a row that ISN'T the one this
    # call is writing, and still carries its `_raw` cache from load(),
    # is echoed byte for byte — never cleaned, never validated, so its
    # own legacy/hand-edited shape can't block or reformat someone
    # else's write. `write_key=None` (no single row identified) always
    # takes the clean-and-validate path below, unchanged from before.
    raw = r.get("_raw")
    is_target = write_key is not None and key(r) == write_key
    if write_key is not None and not is_target and raw is not None:
        return raw.split("\n") + [""]
    company, title = _clean_company(r["company"]), _clean(r["title"])
    # LEAD spec amendment (S1 review, finding 6; design-web-search.md § 4.3):
    # a company or title that is empty after cleaning, IN THE ROW THIS
    # CALL WRITES, is refused — the writer exits 2 and jobs.md is
    # unchanged (this check runs before any line of `out` is written to
    # disk, so a raise here never touches the file). Never
    # SystemExit(str) (the duplicate-key error's own form, always exit
    # 1) — this is a distinct failure with its own exit code.
    if not company or not title:
        print("error: empty company or title after cleaning; nothing written", file=sys.stderr)
        raise SystemExit(2)
    lines = [f"### {company} — {title}"]
    for label, k in FIELDS:
        if k == "was_stage" and not dismissed:
            continue
        if k == "dismiss_note":
            v = r.get("dismiss_note") or (r.get("dismiss_reason") if dismissed else None)
        else:
            v = r.get(k)
        v = _clean(v)
        if v not in (None, ""):
            lines.append(f"- {label}: {v}")
    lines.append("")
    return lines


def find(rows, company, title_frag):
    """Match on canonical company + title substring; exact-title wins over
    substring collisions (ported from update_job.py). Returns matches."""
    ck, tf = canon(company), canon(title_frag)
    hits = [r for r in rows if canon(r["company"]) == ck and tf in canon(r["title"])]
    if len(hits) > 1:
        exact = [r for r in hits if canon(r["title"]) == tf]
        if len(exact) == 1:
            return exact
    return hits
