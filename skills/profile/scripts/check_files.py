#!/usr/bin/env python3
"""Validate a candidate workspace against the file schemas — and the skill
files' own structure.

    python3 check_files.py --workspace ~/job-search [--skills ../..]

Exit 0 = clean, 1 = at least one FAIL. WARNs never fail the run — they are
judgment calls the agent must actively defend in its reply, not silently pass.

Three tiers, matching the agreed split (goals doc, goal 2):

  FAIL  a required section is missing        — one right answer
  FAIL  a section belongs to a DIFFERENT file's schema — also mechanical,
        because every schema is known; this is what catches interview
        history landing in criteria.md, measured 2026-08-13
  WARN  an unrecognised section name         — might be a real finding with
        nowhere to go; `## Other notes` is the sanctioned home for those
  FAIL  a skill file's relative link that does not resolve
  WARN  a skill file's table row whose cell count differs from its header

Design rule, inherited from check_materials.py: the schemas are READ FROM
the skills that own them, never restated here. A checker with its own
private copy of the rules is a second source of truth, which is the bug it
exists to prevent.
"""
import argparse, glob, os, re, sys

# ---- loop history files (base-resume, pitch, storybank): a table, not sections ---
# One right answer: the exact header + a matching cell count per row. The
# human-readable statement lives in the owning SKILL.md § State lines;
# tests/run.py keeps the two copies loudly in sync (the sanctioned
# loud-fail duplicate — PROCESS step 4).
# Loop history headers, per file. The tier-1 loops share a shape; storybank's
# rounds are per-STORY, so its row carries the story id instead of a driver.
HISTORY_HEADERS = {
    "base-resume-history.md": "| date | round | driver | scored vs FIXED | what changed |",
    "pitch-history.md": "| date | round | driver | scored vs FIXED | what changed |",
    "storybank-history.md": "| date | story | round | what changed | scored |",
}

# ---- the manifest: which top-level entries may exist, and who owns each ----
# The one authoritative copy (#11 design gate): schema-registered files are
# allowed automatically; everything else a skill reads or writes is listed
# here with its owner; goal 3's manifest paragraph (goals doc) is the
# design-side statement this implements.
# Stray = WARN, never FAIL — the workspace is the candidate's; code
# surfaces, the human decides. Receipt: a full parallel master-resume sat
# unnoticed beside base-resume.md in the live workspace (found 2026-08-17)
# — exactly the second-source-of-truth start goal 3 predicts.
MANIFEST_FILES = {
    "CLAUDE.md": "profile (written at setup from the template)",
    "jobs.md": "search scripts",
    "companies.md": "search scripts",
    "leads.md": "search scripts (internal lead tier)",
    "criteria.json": "search (generated projection of criteria.md)",
    "jobs.db": "search (on-demand scratch)",
    "jobs.db.bak": "search (migration backup)",
    "autopilot-log.md": "search (scheduled-run log, append-only)",
    "plan-log.md": "coach (append-only annex)",
    "practice-log.md": "interview",
    "question-bank.md": "interview",
    "composite-target.md": "interview",
    "linkedin-audit.md": "profile (regenerated per audit)",
    "base-resume-history.md": "profile (append-only; header checked)",
    "pitch-history.md": "profile (append-only; header checked)",
    "storybank-history.md": "storybank (append-only; header checked)",
}
MANIFEST_DIRS = {
    # the candidate's own drop folder — they are TOLD to put files here at
    # intake, so a file in it is never a stray (it is an input awaiting
    # capture, not a second source of truth)
    "documents": "the candidate (drop folder — read on sight, captured into the owned files)",
    "applications": "apply", "company": "evaluate", "contacts": "outreach",
    "jd-analysis": "evaluate", "jd-inbox": "search + candidate drops",
    "prep": "interview", "practice": "interview", "stories": "storybank",
    "courses": "learn",
    # stated comp numbers heard in interview rounds; debrief writes them,
    # prep's day-of sheet reads them for consistency
    "negotiation": "interview",
}


# Only the loop-owned history files are bound to the header — derived from
# the manifest annotation, not a third list. A CANDIDATE's own *-history.md
# is theirs: the stray WARN mentions it, nothing FAILs it (reviewer-measured
# 2026-08-18: the bare glob hard-failed a candidate-authored
# interview-history.md while the same run called it a stray — the manifest
# docstring's own rule, contradicted one function down).
LOOP_HISTORY = tuple(HISTORY_HEADERS)

# ---- the tailoring proposal's tables (apply/references/schema.md) --------------
# Cross-session multi-consumer state: apply writes; the verifier, a later
# session, the coach's board, prep, and the harness judge read. Enums are the
# point — free text in a status cell is how a map breaks (the knowledge-map
# em-dash incident). WARN, not FAIL: no corruption incident yet, and the
# earned-FAIL bar says an incident promotes it.
COVERAGE_HEADER = "| requirement | status | evidence | decision |"
COVERAGE_ENUMS = {1: {"have", "shown-but-unnamed", "gap"},
                  3: {"open", "answered", "skipped"}}
SELECTION_HEADER = "| # | role | bullet | in/out | source | words | why |"
SELECTION_ENUMS = {3: {"in", "out"}, 4: {"base", "story", "new"}}
# The tailoring loop's round record and the panel's findings (2026-08-21,
# the loop-alignment design): the same five columns as the history files,
# inside the application file; the panel table's outcome cell is
# "fixed" or "discarded — <why>". Header + cell counts checked; the
# scored cell's form (N/M held; unmet: …) is the agent's discipline.
ROUNDS_HEADER = "| date | round | driver | scored | what changed |"
ROUNDS_ENUMS = {}
PANEL_HEADER = "| lens | finding | outcome |"
PANEL_ENUMS = {0: {"ats", "recruiter", "hiring manager"}}


def check_table(path, header, enums):
    """A declared table: exact header, matching cell counts, enum cells valid.
    Silent when the table is absent — not every application has one yet."""
    res = []
    raw = open(path, encoding="utf-8").read().replace("\\|", "")
    all_lines = [l.strip() for l in raw.splitlines()]
    if header not in all_lines:
        # a section titled for this table but carrying a near-miss header
        # is not "absent" — it is the altered-header case check_history
        # FAILs on; here it WARNs (2026-08-21 alignment review, L1)
        title = {COVERAGE_HEADER: "## Coverage", SELECTION_HEADER: "## Selection",
                 ROUNDS_HEADER: "## Rounds", PANEL_HEADER: "## Panel",
                 HISTORY_HEADERS["base-resume-history.md"]: "## Rounds",
                 HISTORY_HEADERS["pitch-history.md"]: "## Rounds",
                 HISTORY_HEADERS["storybank-history.md"]: "## Rounds"}.get(header)
        if title and any(l.startswith(title) for l in all_lines):
            res.append(("WARN", f'{title} present but its header is not exactly "{header}"'))
        return res
    # the table is the CONTIGUOUS run of pipe rows under the header; stop at
    # the first line that is not one. An application file holds several
    # tables and free prose (apply/references/schema.md), so walking to EOF
    # measured the next table's rows against this header — four bogus WARNs
    # on the design's own normal file (measured 2026-08-18; the first tests
    # each used a single-table fixture, so this rung was green because it
    # never ran).
    block = []
    for l in all_lines[all_lines.index(header) + 1:]:
        if not l.startswith("|"):
            break
        block.append(l)
    ncols = header.count("|") - 1
    for l in block:
        if set(l) <= set("|-: "):
            continue                      # separator row
        cells = [c.strip() for c in l.strip("|").split("|")]
        if len(cells) != ncols:
            res.append(("WARN", f'row has {len(cells)} cells, the header has {ncols}: "{l[:60]}"'))
            continue
        for idx, allowed in enums.items():
            v = cells[idx].lower().strip("`*_ ")
            if v and v not in allowed:
                res.append(("WARN", f'"{cells[idx]}" is not one of {sorted(allowed)} '
                                    f'— apply/references/schema.md declares the enum'))
        if header == PANEL_HEADER:
            o = cells[2].strip("`*_ ")
            if o and not (o == "fixed" or o.startswith("discarded —") or o == "—"):
                res.append(("WARN", f'panel outcome "{o}" is neither "fixed" nor "discarded — <why>" '
                                    f'(or "—" on a VOID row) — apply/references/schema.md'))
    return res


def check_history(path, header):
    """FAIL on a missing/altered header or a row whose cell count drifts —
    a malformed append silently corrupts the loop's audit trail."""
    res = []
    raw = open(path, encoding="utf-8").read().replace("\\|", "")  # escaped pipes are cell text
    lines = [l.strip() for l in raw.splitlines() if l.strip().startswith("|")]
    if header not in lines:
        res.append(("FAIL", f'history header missing or altered — must be exactly "{header}"'))
        return res
    ncols = header.count("|") - 1
    for i, l in enumerate(lines):
        if set(l) <= set("|-: "):
            continue  # the separator row
        cols = l.count("|") - 1
        if cols != ncols:
            res.append(("FAIL", f"history row {i} has {cols} cells, the header has {ncols}"))
    return res


def check_skill_prose(skills_root):
    """The skill files' own structure — the one artifact class that shipped
    unchecked while schemas, tables, materials and language all had a rung.

    Two checks only, both unambiguous:
      FAIL  a relative link or path that does not resolve
      WARN  a table row whose cell count differs from its header

    Deliberately NOT checked: "§ Some Section" pointers. A prototype flagged
    12 files and most were pointers into ANOTHER file ("base-resume.md
    § Claim rules"), indistinguishable from a local reference without
    parsing intent. A noisy rung trains people to ignore it — the
    earned-FAIL bar's warning, applied to a rung before it shipped.

    Earned 2026-08-19: two cross-skill links were one `../` short. One was
    tailoring.md's FIRST instruction ("read resume-engine.md first"), so an
    agent following it found nothing and assembled without the base-résumé
    resolution ladder.

    Widened 2026-08-19, same day, by the independent review of the CMF and
    negotiate deletions: the first pattern only matched links STARTING with
    `./` or `../`, so six more of the identical class were invisible to it —
    `apply/scripts/check_materials.py` written from inside profile, where the
    repo's own convention is `../../apply/...`. A rung that misses the bug it
    was built for is worse than no rung: it reports green. Any backticked
    path with a `/` and an .md/.py/.html suffix must now resolve, from either
    the file's directory or its skill root. Schema placeholders (`<slug>`)
    are exempt — they name a shape, not a file.
    """
    res = []
    for path in sorted(glob.glob(os.path.join(skills_root, "**", "*.md"), recursive=True)):
        rel_name = os.path.relpath(path, skills_root)
        text = open(path, encoding="utf-8").read()
        here = os.path.dirname(path)
        skill_root = os.path.join(skills_root, rel_name.split(os.sep)[0])
        seen = set()
        for m in re.finditer(
            r"\]\((\.\.?/[^)#\s]+)\)|`([\w./-]*/[\w./-]+\.(?:md|py|html))(?: §[^`]*)?`", text
        ):
            target = m.group(1) or m.group(2)
            if "<" in target or target in seen:
                continue
            seen.add(target)
            # a ./ or ../ link means what it says: it resolves from the
            # file's OWN directory, never from the skill root. Allowing the
            # root as a fallback would mask the original bug — an `../` one
            # short from inside references/ would quietly resolve.
            bases = (here,) if target.startswith(".") else (here, skill_root)
            hit = next(
                (
                    os.path.normpath(os.path.join(base, target))
                    for base in bases
                    if os.path.exists(os.path.normpath(os.path.join(base, target)))
                ),
                None,
            )
            if hit is None:
                res.append(("FAIL", f"{rel_name}: link does not resolve — {target}"))
            elif os.path.relpath(hit, skills_root).startswith(".."):
                # resolves in the repo, not in ~/.claude/skills — a skill must
                # be self-contained or its pointer is dead for every user
                res.append(
                    ("FAIL", f"{rel_name}: link escapes the skill tree — {target}")
                )
        lines = text.split("\n")
        i = 0
        while i < len(lines) - 1:
            head, sep = lines[i], lines[i + 1].strip()
            if head.startswith("|") and sep.startswith("|") and set(sep) <= set("|-: "):
                ncols = head.count("|")
                j = i + 2
                while j < len(lines) and lines[j].startswith("|"):
                    if lines[j].count("|") != ncols:
                        res.append(("WARN", f"{rel_name}: table row {j+1} has "
                                            f"{lines[j].count('|') - 1} cells, header has {ncols - 1}"))
                    j += 1
                i = j
            else:
                i += 1
    return res


def check_strays(workspace, schemas):
    """WARN on any top-level entry no schema and no manifest row accounts for."""
    res = []
    allowed = set(schemas) | set(MANIFEST_FILES)
    for name in sorted(os.listdir(workspace)):
        if name.startswith("."):
            continue
        if os.path.isdir(os.path.join(workspace, name)):
            if name not in MANIFEST_DIRS:
                res.append(("WARN", f'stray directory "{name}/" — no skill owns it'))
        elif name not in allowed:
            res.append(("WARN", f'stray file "{name}" — no skill reads or writes it. '
                                "A second source of truth starts exactly here: if the "
                                "candidate dropped it, move it to documents/ and capture "
                                "it; if it holds real facts, it needs an owner; if it is "
                                "scratch, move it out"))
    return res

# A schema block in a SKILL.md looks like:
#   **`profile.md` — who they are.** Any prose.
#   - `## Snapshot` — notes
#   - `## Intake findings` — with all four:
#     - `### Positioning strengths`
#   - `## Other notes` — optional
# Two declaration forms: the inline `**\`file.md\`**` block (SKILL.md § State),
# and a `## \`file.md\` — ...` heading (a references/schema.md organised per
# file). Added 2026-08-20 when profile's schema.md gained per-file headings
# and the old pattern silently dropped all five of its schemas — the printed
# schema count is what caught it.
FILE_RE = re.compile(r"^(?:\*\*|##\s+)`([\w\-.]+\.md)`")
# Some files carry the candidate's own structure (a résumé body). Their
# header line says "free-form body"; only the named sections are required
# and unknown headings there are not flagged.
FREEFORM = "free-form body"
SECTION_RE = re.compile(r"^(\s*)-\s+`(#{2,3})\s+([^`]+)`(.*)$")


def load_schemas(skills_root):
    """Parse every skill's schema blocks into {filename: schema}.

    Read from BOTH `SKILL.md` and `references/schema.md`, because a skill
    may declare its file shapes in either. Extended 2026-08-20: profile's
    § State held 516 words of schema in the always-loaded tier; moving it
    to a reference cuts that from every session that fires the skill,
    and a schema is consulted when writing a record, not continuously.
    A filename declared in both places is a duplicate the caller reports.
    """
    schemas = {}
    paths = sorted(glob.glob(os.path.join(skills_root, "*", "SKILL.md")))
    paths += sorted(glob.glob(os.path.join(skills_root, "*", "references", "schema.md")))
    for path in paths:
        current = None
        for line in open(path, encoding="utf-8"):
            m = FILE_RE.match(line)
            if m:
                skill_dir = os.path.dirname(path)
                if os.path.basename(skill_dir) == "references":
                    skill_dir = os.path.dirname(skill_dir)  # references/schema.md -> the skill
                current = {"sections": [], "freeform": FREEFORM in line.lower(),
                           "owner": os.path.basename(skill_dir)}
                # A bare bold mention of a file in ANOTHER skill's prose must
                # never clobber the owner's real schema: only a block that
                # gathers sections may claim the name (caught 2026-08-14 —
                # search's "criteria.md is INPUT only" sentence silently
                # deleted profile's criteria schema).
                if m.group(1) not in schemas or not schemas[m.group(1)]["sections"]:
                    schemas[m.group(1)] = current
                continue
            if current is None:
                continue
            sec = SECTION_RE.match(line)
            if sec:
                _, hashes, name, rest = sec.groups()
                current["sections"].append({
                    "name": name.strip(),
                    "level": len(hashes),
                    "optional": "optional" in rest.lower(),
                })
            elif line.strip() and not line.startswith((" ", "\t", "*", "-")):
                current = None  # prose resumed; the block ended
    return {k: v for k, v in schemas.items() if v["sections"]}


def headings(text):
    """Headings present, each tagged with the `##` section it sits under.

    Anything under `## Other notes` carries under_escape=True: that section
    is the sanctioned home for novel material, so policing its internals
    would defeat the point of having an escape hatch."""
    out = []
    current_top = None
    for m in re.finditer(r"^(#{2,3})\s+(.+?)\s*$", text, re.M):
        level, name = len(m.group(1)), m.group(2).strip()
        if level == 2:
            current_top = name
        out.append({"name": name, "level": level,
                    "under_escape": norm(current_top or "") == norm("Other notes")
                                    and not (level == 2 and norm(name) == norm("Other notes"))})
    return out


def norm(s):
    """Compare on words only — an appended date or count is not a new section.

    Trailing plurals are folded so "Target" and "Targets" are one section,
    not a silent miss (caught on the first real workspace)."""
    s = re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()
    parts = s.split()
    if parts and len(parts[-1]) > 3 and parts[-1].endswith("s"):
        parts[-1] = parts[-1][:-1]
    return " ".join(parts)


def check_file(path, schema, all_schemas, fname):
    res = []
    text = open(path, encoding="utf-8").read()
    present = headings(text)
    present_norm = {norm(h["name"]) for h in present}

    for want in schema["sections"]:
        if want["optional"]:
            continue
        w = norm(want["name"])
        # A required heading may carry a suffix ("Targets — two, 50/50").
        if not any(p == w or p.startswith(w) for p in present_norm):
            res.append(("FAIL", f'missing required section "{"#" * want["level"]} {want["name"]}"'))

    known = {norm(s["name"]) for s in schema["sections"]} | {norm("Other notes")}
    # Sections owned by some OTHER file — the cross-contamination class.
    foreign = {}
    for other, osch in all_schemas.items():
        if other == fname:
            continue
        for s in osch["sections"]:
            foreign.setdefault(norm(s["name"]), other)

    for h in present:
        if h.get("under_escape"):
            continue
        n = norm(h["name"])
        if any(n == k or n.startswith(k) for k in known):
            continue
        if schema.get("freeform"):
            continue  # the candidate's own headings are theirs
        owner = next((f for k, f in foreign.items() if n == k or n.startswith(k)), None)
        if owner:
            res.append(("FAIL", f'section "{h["name"]}" belongs to {owner} — '
                                f"content in the wrong file breaks its consumers"))
        else:
            res.append(("WARN", f'unrecognised section "{h["name"]}" — '
                                f"put novel material under `## Other notes`"))
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--skills", default=os.path.join(os.path.dirname(__file__), "..", ".."),
                    help="the skills/ directory the schemas are read from")
    args = ap.parse_args()

    schemas = load_schemas(os.path.abspath(args.skills))
    if not schemas:
        print("FAIL  no schemas found — is --skills pointing at the skills directory?")
        return 1
    failed = 0
    checked = 0
    ws = os.path.expanduser(args.workspace)
    for fname, schema in sorted(schemas.items()):
        path = os.path.join(ws, fname)
        if not os.path.exists(path):
            continue  # nothing exists until something creates it
        checked += 1
        for level, msg in check_file(path, schema, schemas, fname):
            print(f"{level}  {fname}: {msg}")
            failed += level == "FAIL"
    for hpath in sorted(glob.glob(os.path.join(ws, "*-history.md"))):
        if os.path.basename(hpath) not in LOOP_HISTORY:
            continue  # a candidate's own history file is theirs — stray WARN at most
        checked += 1
        for level, msg in check_history(hpath, HISTORY_HEADERS[os.path.basename(hpath)]):
            print(f"{level}  {os.path.basename(hpath)}: {msg}")
            failed += level == "FAIL"
    for f, hdr in (("base-resume.md", HISTORY_HEADERS["base-resume-history.md"]),
                   ("pitch.md", HISTORY_HEADERS["pitch-history.md"]),
                   ("storybank.md", HISTORY_HEADERS["storybank-history.md"])):
        p = os.path.join(ws, f)
        if os.path.exists(p):
            for level, msg in check_table(p, hdr, {}):
                print(f"{level}  {f}: {msg}")
                failed += level == "FAIL"
    for apath in sorted(glob.glob(os.path.join(ws, "applications", "*.md"))):
        checked += 1
        for header, enums in ((COVERAGE_HEADER, COVERAGE_ENUMS),
                              (ROUNDS_HEADER, ROUNDS_ENUMS),
                              (PANEL_HEADER, PANEL_ENUMS),
                              (SELECTION_HEADER, SELECTION_ENUMS)):
            for level, msg in check_table(apath, header, enums):
                print(f"{level}  applications/{os.path.basename(apath)}: {msg}")
                failed += level == "FAIL"
    for level, msg in check_skill_prose(os.path.abspath(args.skills)):
        print(f"{level}  {msg}")
        failed += level == "FAIL"
    for level, msg in check_strays(ws, schemas):
        print(f"{level}  {msg}")
        failed += level == "FAIL"
    print(f"\n{checked} file(s) checked against {len(schemas)} schema(s); "
          f"{failed} failure(s).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
