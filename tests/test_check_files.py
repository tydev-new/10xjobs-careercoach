"""Schema checker: the three tiers, and the escape hatch."""
import os, subprocess, sys, tempfile, textwrap
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "skills", "profile", "scripts", "check_files.py")

def run(files):
    ws = tempfile.mkdtemp()
    for name, body in files.items():
        with open(os.path.join(ws, name), "w") as f:
            f.write(body)
    p = subprocess.run([sys.executable, SCRIPT, "--workspace", ws,
                        "--skills", os.path.join(ROOT, "skills")],
                       capture_output=True, text=True)
    return p.returncode, p.stdout

FULL_PROFILE = textwrap.dedent("""\
    # P
    ## Snapshot
    ## Experience
    ## Intake findings
    ### Positioning strengths
    ### Likely interviewer concerns
    ### Career-narrative gaps
    ### Story seeds
    ## Interview history
    ## Constraints
    ## Application defaults
    """)

TIER1 = "| date | round | driver | scored vs FIXED | what changed |"


def test_conforming_profile_passes():
    code, out = run({"profile.md": FULL_PROFILE})
    assert code == 0, out

def test_missing_required_section_fails():
    code, out = run({"profile.md": "# P\n## Snapshot\n"})
    assert code == 1
    assert "missing required section" in out

def test_foreign_section_fails_with_its_owner_named():
    """The cross-contamination class: interview history in criteria.md."""
    code, out = run({"criteria.md": textwrap.dedent("""\
        # C
        ## Targets
        ## Level
        ## Geo
        ## Compensation
        ## Dealbreakers
        ## Target companies
        ## Retired
        ## Interview history
        """)})
    assert code == 1
    assert "belongs to profile.md" in out

def test_unknown_section_only_warns():
    code, out = run({"profile.md": FULL_PROFILE + "## Wildcard\n"})
    assert code == 0, out
    assert "WARN" in out and "Wildcard" in out

def test_escape_hatch_contents_are_not_policed():
    code, out = run({"profile.md": FULL_PROFILE + "## Other notes\n### Anything At All\n"})
    assert code == 0, out
    assert "Anything At All" not in out

def test_singular_plural_folds():
    """'Target' must resolve to criteria's 'Targets', not read as novel."""
    code, out = run({"profile.md": FULL_PROFILE + "## Target\n"})
    assert code == 1
    assert "belongs to criteria.md" in out

def test_absent_file_is_not_an_error():
    """Nothing exists until something creates it."""
    code, out = run({})
    assert code == 0, out


def test_prose_mention_in_another_skill_cannot_clobber_a_schema():
    """search's SKILL once began a line with **`criteria.md` mid-prose and
    silently deleted profile's criteria schema. The owner's sections win."""
    import check_files as cf
    schemas = cf.load_schemas(os.path.join(ROOT, "skills"))
    assert "criteria.md" in schemas and len(schemas["criteria.md"]["sections"]) >= 7


def test_storybank_schema_registered_and_enforced():
    """§13 (2026-08-14): storybank.md becomes a multi-writer file — its
    schema must be owned by the storybank skill and enforced like criteria."""
    import check_files as cf
    schemas = cf.load_schemas(os.path.join(ROOT, "skills"))
    assert "storybank.md" in schemas and schemas["storybank.md"]["owner"] == "storybank"
    ok = "# Storybank\n\n## Coverage\n\n- FDE org design [source: jd-analysis]\n\n## Stories\n\n| ID | Title |\n|---|---|\n"
    rc, out = run({"storybank.md": ok})
    assert rc == 0, out
    missing_coverage = "# Storybank\n\n## Stories\n\n| ID | Title |\n|---|---|\n"
    rc, out = run({"storybank.md": missing_coverage})
    assert rc == 1 and "Coverage" in out, out


def test_pitch_schema_registered():
    """Positioning rebuild 2026-08-15: pitch.md is cross-session multi-consumer
    state — schema owned by positioning, enforced like storybank.md.
    Updated for #12 (2026-08-17): Version history MIGRATED to
    pitch-history.md (append-only survives rewrites) — it must no longer
    be a pitch.md section."""
    import check_files as cf
    schemas = cf.load_schemas(os.path.join(ROOT, "skills"))
    assert "pitch.md" in schemas and schemas["pitch.md"]["owner"] == "profile"
    required = {s["name"] for s in schemas["pitch.md"]["sections"] if not s["optional"]}
    assert {"Core statement", "Variants", "Messages rubric"} <= required
    all_sections = {s["name"] for s in schemas["pitch.md"]["sections"]}
    assert "Version history" not in all_sections, "history lives in pitch-history.md now"
    assert "Other notes" in all_sections, "the escape hatch must survive block moves (closing-review regression 2026-08-17: a relocated bold block orphaned this bullet)"
    # #11 (2026-08-18) flipped this contract: brief files are now REGISTERED
    # schemas (## FIXED + ## LIVING) — see test_brief_schemas_registered.
    assert "pitch-brief.md" in schemas, "brief schema lost — #11 registered it"


def test_knowledge_schema_registered():
    """learn skill (#23, 2026-08-15): knowledge.md is multi-reader state
    (prep, coach) — schema owned by learn, enforced."""
    import check_files as cf
    schemas = cf.load_schemas(os.path.join(ROOT, "skills"))
    assert "knowledge.md" in schemas and schemas["knowledge.md"]["owner"] == "learn"
    required = {s["name"] for s in schemas["knowledge.md"]["sections"] if not s["optional"]}
    assert {"Map", "Assessment log"} <= required


# ---- #11: brief schemas, the history-table rung, the manifest ---------------
sys.path.insert(0, os.path.join(ROOT, "skills", "profile", "scripts"))
import check_files as cf
SKILLS = os.path.join(ROOT, "skills")

def test_brief_schemas_registered():
    s = cf.load_schemas(SKILLS)
    for f in ("base-resume-brief.md", "pitch-brief.md"):
        assert f in s, f"{f} not registered"
        names = {x["name"] for x in s[f]["sections"]}
        assert {"FIXED", "LIVING"} <= names, names


def test_brief_missing_living_fails():
    s = cf.load_schemas(SKILLS)
    with tempfile.TemporaryDirectory() as ws:
        open(os.path.join(ws, "pitch-brief.md"), "w").write("# Brief\n\n## FIXED\n- x\n")
        res = cf.check_file(os.path.join(ws, "pitch-brief.md"),
                            s["pitch-brief.md"], s, "pitch-brief.md")
        assert any(lvl == "FAIL" and "LIVING" in m for lvl, m in res), res


def test_history_header_enforced():
    with tempfile.TemporaryDirectory() as ws:
        p = os.path.join(ws, "pitch-history.md")
        open(p, "w").write("# H\n\n| date | round | notes |\n|---|---|---|\n| a | b | c |\n")
        res = cf.check_history(p, TIER1)
        assert any(lvl == "FAIL" and "header" in m for lvl, m in res), res
        open(p, "w").write("# H\n\n" + TIER1 +
                           "\n|---|---|---|---|---|\n| a | b | c | d | e |\n")
        assert cf.check_history(p, TIER1) == []
        # a malformed append (one cell short) fails loudly
        open(p, "a").write("| a | b | c | d |\n")
        res = cf.check_history(p, TIER1)
        assert any(lvl == "FAIL" and "cells" in m for lvl, m in res), res


def test_heading_form_schema_declaration_parses():
    r"""FILE_RE's second form, added 2026-08-20: a references/schema.md may
    declare a file as `## \`file.md\` — ...` heading. The first attempt at
    profile's schema.md put prose on the line after the heading, which ended
    the block before its bullets — five schemas silently vanished and only
    the printed count caught it. The freeform marker must sit ON the
    declaring line."""
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "x", "references"))
        open(os.path.join(root, "x", "SKILL.md"), "w").write("# x\n")
        open(os.path.join(root, "x", "references", "schema.md"), "w").write(
            "# Shapes\n\n"
            "## `alpha.md` — a thing *(free-form body)*\n\n"
            "- `## Keep` — required\n\n"
            "Prose after the bullets ends the block harmlessly.\n\n"
            "## `beta.md` — another\n\n"
            "- `## Only` \n")
        s = cf.load_schemas(root)
        assert set(s) == {"alpha.md", "beta.md"}, s
        assert s["alpha.md"]["freeform"] is True
        assert [x["name"] for x in s["beta.md"]["sections"]] == ["Only"]


def test_storybank_history_uses_its_own_header():
    """Per-file headers, added 2026-08-20: storybank's rounds are per-STORY,
    so its row carries the story id where the tier-1 loops carry a driver.
    A single global header would have forced the wrong shape on it."""
    sb = cf.HISTORY_HEADERS["storybank-history.md"]
    assert sb != cf.HISTORY_HEADERS["base-resume-history.md"]
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "storybank-history.md")
        open(p, "w").write("# H\n\n" + sb + "\n|---|---|---|---|---|\n"
                           "| 2026-08-20 | S001 | 1 | added stakes | 3 |\n")
        assert cf.check_history(p, sb) == [], cf.check_history(p, sb)
        # the tier-1 header must NOT validate it
        assert cf.check_history(p, cf.HISTORY_HEADERS["base-resume-history.md"])


def test_history_header_sync_with_skill_prose():
    # the sanctioned loud-fail duplicate: the checker constant and the owning
    # skill's prose must state the SAME header, or this test is the alarm.
    # storybank states its header in a reference, not the body — so search both.
    for skill, hist in (("profile", "base-resume-history.md"),
                        ("profile", "pitch-history.md"),
                        ("storybank", "storybank-history.md")):
        prose = ""
        for root, _, names in os.walk(os.path.join(SKILLS, skill)):
            for n in names:
                if n.endswith(".md"):
                    prose += open(os.path.join(root, n), encoding="utf-8").read()
        assert cf.HISTORY_HEADERS[hist] in prose, f"{skill} header drifted from checker"


def test_stray_file_and_dir_warn_but_never_fail():
    s = cf.load_schemas(SKILLS)
    with tempfile.TemporaryDirectory() as ws:
        open(os.path.join(ws, "profile.md"), "w").write("# ok\n")
        open(os.path.join(ws, "Old_Master_Resume.md"), "w").write("# stray\n")
        os.mkdir(os.path.join(ws, "random-notes"))
        res = cf.check_strays(ws, s)
        assert any(lvl == "WARN" and "Old_Master_Resume.md" in m for lvl, m in res), res
        assert any(lvl == "WARN" and "random-notes" in m for lvl, m in res), res
        assert not any(lvl == "FAIL" for lvl, m in res), "strays must never FAIL"


def test_manifest_and_schema_files_are_not_strays():
    s = cf.load_schemas(SKILLS)
    with tempfile.TemporaryDirectory() as ws:
        for f in ("profile.md", "jobs.md", "CLAUDE.md", "pitch-history.md"):
            open(os.path.join(ws, f), "w").write("x\n")
        os.mkdir(os.path.join(ws, "applications"))
        # the candidate's drop folder is the manifest's flagship row (the
        # folder-moment change): a file THERE is an input, never a stray
        os.mkdir(os.path.join(ws, "documents"))
        open(os.path.join(ws, "documents", "old-resume.pdf"), "w").write("x")
        assert cf.check_strays(ws, s) == []
        # and the stray message routes drops toward documents/
        open(os.path.join(ws, "Random_Notes.md"), "w").write("x\n")
        res = cf.check_strays(ws, s)
        assert any("documents/" in m for _, m in res), res


def test_candidate_history_file_is_not_policed():
    # reviewer-measured 2026-08-18: the bare glob hard-FAILed a candidate's
    # own interview-history.md while the same run called it a stray. Only
    # the loop-owned files bind to the header; a candidate file WARNs as
    # stray at most, never FAILs.
    rc, out = run({"interview-history.md": "# My interviews\n\nnotes in prose\n"})
    assert rc == 0, out
    assert "header" not in out, out
    assert "stray" in out, out


def test_escaped_pipe_in_history_cell_is_text_not_boundary():
    with tempfile.TemporaryDirectory() as ws:
        p = os.path.join(ws, "pitch-history.md")
        open(p, "w").write("# H\n\n" + TIER1 +
                           "\n|---|---|---|---|---|\n"
                           "| d | 1 | drafts A \\| B compared | ok | none |\n")
        assert cf.check_history(p, TIER1) == [], cf.check_history(p, TIER1)


# ---- the tailoring proposal's declared tables (apply/references/schema.md) --------------

def _app(ws, body):
    os.makedirs(os.path.join(ws, "applications"), exist_ok=True)
    p = os.path.join(ws, "applications", "acme-role.md")
    open(p, "w").write(body)
    return p


def test_coverage_enums_enforced_but_never_block():
    with tempfile.TemporaryDirectory() as ws:
        p = _app(ws, "# A\n\n" + cf.COVERAGE_HEADER + "\n|---|---|---|---|\n"
                 "| Python | have | bullet 3 | answered |\n"
                 "| Payments | sort of | — | maybe |\n")
        res = cf.check_table(p, cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS)
        msgs = " ".join(m for _, m in res)
        assert "sort of" in msgs and "maybe" in msgs, res
        assert all(lvl == "WARN" for lvl, _ in res), "enum drift must not block delivery"


def test_valid_coverage_table_is_silent():
    with tempfile.TemporaryDirectory() as ws:
        p = _app(ws, "# A\n\n" + cf.COVERAGE_HEADER + "\n|---|---|---|---|\n"
                 "| Python | have | bullet 3 | answered |\n"
                 "| Payments | gap | — | skipped |\n"
                 "| RAG | shown-but-unnamed | MemVerge bullet | open |\n")
        assert cf.check_table(p, cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS) == []


def test_selection_table_enums_and_cell_count():
    with tempfile.TemporaryDirectory() as ws:
        p = _app(ws, "# A\n\n" + cf.SELECTION_HEADER + "\n|---|---|---|---|---|---|---|\n"
                 "| 1 | MemVerge | Built the deployment machine | in | base | 42 | keeps org scale |\n"
                 "| 2 | Cheetah | Ad platform | dropped | invented | 22 |\n"
                 "| 3 | Peel | short row |\n")
        msgs = " ".join(m for _, m in cf.check_table(p, cf.SELECTION_HEADER, cf.SELECTION_ENUMS))
        assert "dropped" in msgs and "invented" in msgs, msgs
        assert "cells" in msgs, "a short row must be caught"


def test_absent_table_is_silent():
    """Not every application has a proposal yet — absence is not a finding."""
    with tempfile.TemporaryDirectory() as ws:
        p = _app(ws, "# A\n\nJust prose, no tables.\n")
        assert cf.check_table(p, cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS) == []


def test_a_realistic_multi_table_application_is_silent():
    """The rung walked to EOF and measured the NEXT table's rows against this
    header — four bogus WARNs on the design's own normal file. The original
    fixtures each held ONE table, so the rung was green because it never ran
    (measured 2026-08-18). An application file is multi-section by design."""
    with tempfile.TemporaryDirectory() as ws:
        p = _app(ws,
            "# Acme — Staff Engineer\n\n## Coverage\n\n"
            + cf.COVERAGE_HEADER + "\n|---|---|---|---|\n"
            "| Python | have | bullet 3 | answered |\n"
            "| Payments | gap | — | skipped |\n\n"
            "## Selection\n\n"
            + cf.SELECTION_HEADER + "\n|---|---|---|---|---|---|---|\n"
            "| 1 | MemVerge | Built the deployment machine | in | base | 42 | org scale |\n"
            "| 2 | Cheetah | Ad platform features | out | base | 35 | furthest from posting |\n\n"
            "## Screening answers\n\n| question | answer |\n|---|---|\n"
            "| Why Acme? | see the cover letter |\n\n"
            "## Submission record\n\nNot yet submitted.\n")
        assert cf.check_table(p, cf.COVERAGE_HEADER, cf.COVERAGE_ENUMS) == []
        assert cf.check_table(p, cf.SELECTION_HEADER, cf.SELECTION_ENUMS) == []


# ---- skill prose: the one artifact class that shipped unchecked -----------

def test_broken_relative_link_fails():
    """Earned 2026-08-19: two cross-skill links were one `../` short. One was
    tailoring.md's FIRST instruction, so an agent following it found nothing."""
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "apply", "references"))
        os.makedirs(os.path.join(root, "profile", "references"))
        open(os.path.join(root, "profile", "references", "engine.md"), "w").write("# engine\n")
        # one ../ short — resolves to apply/profile/... which does not exist
        open(os.path.join(root, "apply", "references", "t.md"), "w").write(
            "Read `../profile/references/engine.md` first.\n")
        res = cf.check_skill_prose(root)
        assert any(lvl == "FAIL" and "does not resolve" in m for lvl, m in res), res


def test_correct_relative_link_is_silent():
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "apply", "references"))
        os.makedirs(os.path.join(root, "profile", "references"))
        open(os.path.join(root, "profile", "references", "engine.md"), "w").write("# engine\n")
        open(os.path.join(root, "apply", "references", "t.md"), "w").write(
            "Read `../../profile/references/engine.md` first.\n")
        assert cf.check_skill_prose(root) == []


def test_cross_skill_link_without_dotdot_fails():
    """The widening, 2026-08-19: the first pattern only matched links STARTING
    with ./ or ../, so six links written as `apply/scripts/x.py` from inside
    profile shipped invisible to the rung built for exactly that bug."""
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "apply", "scripts"))
        os.makedirs(os.path.join(root, "profile", "references"))
        open(os.path.join(root, "apply", "scripts", "check.py"), "w").write("#\n")
        open(os.path.join(root, "profile", "references", "v.md"), "w").write(
            "Run `apply/scripts/check.py` before delivery.\n")
        res = cf.check_skill_prose(root)
        assert any(lvl == "FAIL" and "does not resolve" in m for lvl, m in res), res


def test_skill_root_relative_link_is_silent():
    """`references/x.md` written in a SKILL.md is the repo's own convention."""
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "apply", "references"))
        open(os.path.join(root, "apply", "references", "x.md"), "w").write("# x\n")
        open(os.path.join(root, "apply", "SKILL.md"), "w").write(
            "Depth lives in `references/x.md`.\n")
        assert cf.check_skill_prose(root) == []


def test_schema_placeholder_is_not_a_link():
    """`jd-analysis/<company_key>.md` names a shape, not a file."""
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "evaluate"))
        open(os.path.join(root, "evaluate", "SKILL.md"), "w").write(
            "Writes `jd-analysis/<company_key>-<title_key>.md`.\n")
        assert cf.check_skill_prose(root) == []


def test_link_escaping_the_skill_tree_fails():
    """It resolves in the repo and is dead in every ~/.claude/skills copy."""
    with tempfile.TemporaryDirectory() as outer:
        root = os.path.join(outer, "skills")
        os.makedirs(os.path.join(root, "apply", "references"))
        os.makedirs(os.path.join(outer, "docs"))
        open(os.path.join(outer, "docs", "receipts.md"), "w").write("# r\n")
        open(os.path.join(root, "apply", "references", "t.md"), "w").write(
            "Incidents live in `../../../docs/receipts.md`.\n")
        res = cf.check_skill_prose(root)
        assert any(lvl == "FAIL" and "escapes" in m for lvl, m in res), res


def test_orphan_table_cell_warns():
    """The Receipt-column deletion left a stray `| upstream |` on one row."""
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "apply"))
        open(os.path.join(root, "apply", "SKILL.md"), "w").write(
            "| Do | Never |\n|---|---|\n| a | b |\n| c | d | upstream |\n")
        res = cf.check_skill_prose(root)
        assert any(lvl == "WARN" and "cells" in m for lvl, m in res), res
        assert not any(lvl == "FAIL" for lvl, _ in res), "a stray cell is not a blocker"


def test_section_pointers_are_deliberately_not_checked():
    """A prototype flagged 12 files, most of them pointers into ANOTHER file.
    A noisy rung trains people to ignore it."""
    with tempfile.TemporaryDirectory() as root:
        os.makedirs(os.path.join(root, "apply"))
        open(os.path.join(root, "apply", "SKILL.md"), "w").write(
            "See `base-resume.md § Claim rules` and § Nowhere At All.\n")
        assert cf.check_skill_prose(root) == []


def test_inlined_rounds_table_enforced():
    """Rounds inlined inside base-resume.md, pitch.md, or storybank.md are validated."""
    with tempfile.TemporaryDirectory() as ws:
        p = os.path.join(ws, "base-resume.md")
        open(p, "w").write("# Base\n## Experience\n- Staff Eng\n## Claim rules\n- x\n## Rounds\n" + TIER1 + "\n|---|---|---|---|---|\n| 2026-08-24 | 1 | improve | 5/5 held | trimmed intro |\n")
        rc, out = run({"base-resume.md": open(p).read()})
        assert rc == 0, out
        
        bad = open(p).read() + "| 2026-08-24 | 2 | improve | short row |\n"
        rc, out = run({"base-resume.md": bad})
        assert "WARN" in out and "cells" in out
