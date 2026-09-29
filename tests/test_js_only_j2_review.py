#!/usr/bin/env python3
"""Independent review of JS-only J2 (docs/design-js-only.md § 6 J2, § 3.6).

Two groups, derived from the spec, not the code:

1. § 3.6's *Proved by*: "expected-output cases for a missing `.mjs` path, a
   missing `node scripts/x.mjs` command, and both resolving". Run on a copy
   of skills/ with each form planted in a SKILL.md, through the shipped
   command (`node skills/profile/scripts/check_files.mjs`, no --skills: the
   copy must find its own tree).

2. The assertions of deleted Python tests that nothing in the J1 record or
   any surviving test carries (the coder's "every case is in the J1 record"
   claim, checked test by test): the language-check contract of
   test_check_materials.py::test_language_parsers_deleted_and_contract_exists
   (#29, 2026-08-17: the hazard parser silently loaded ZERO forms), and the
   prose of test_search_s1_tester.py::
   test_s1_host_note_and_evaluate_prose_pass_the_analysis_file (renamed
   .py -> .mjs by § 6 J2's prose rule, no other word).

    python3 tests/test_js_only_j2_review.py   (or via tests/run.py)
"""
import os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = os.path.join(ROOT, "skills")


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def _read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


def _check_files_on_copy(planted):
    """Plant `planted` at the end of learn/SKILL.md in a copy of skills/ and
    run the copy's own check_files.mjs (no --skills) on an empty workspace."""
    d = tempfile.mkdtemp(prefix="j2-linkrung-")
    try:
        sk = os.path.join(d, "skills")
        shutil.copytree(SKILLS, sk, ignore=shutil.ignore_patterns("__pycache__"))
        with open(os.path.join(sk, "learn", "SKILL.md"), "a", encoding="utf-8") as f:
            f.write("\n" + planted + "\n")
        ws = os.path.join(d, "ws")
        os.makedirs(ws)
        r = subprocess.run(["node", os.path.join(sk, "profile", "scripts", "check_files.mjs"), "--workspace", ws],
                           capture_output=True, text=True, cwd=d)
        return r.returncode, r.stdout
    finally:
        shutil.rmtree(d)


# ---- § 3.6: the link rung learns .mjs and node commands ------------------------

def test_control_the_unplanted_copy_has_no_link_fail():
    code, out = _check_files_on_copy("")
    assert "link does not resolve" not in out and code == 0, out


def test_missing_mjs_path_fails():
    code, out = _check_files_on_copy("See `scripts/nope_path.mjs` for the check.")
    assert code == 1 and "FAIL  learn/SKILL.md: link does not resolve — scripts/nope_path.mjs" in out, out


def test_missing_node_command_fails():
    # a command, not a bare path: the second alternation of § 3.6's pattern
    code, out = _check_files_on_copy("Run `node scripts/nope_cmd.mjs --workspace .` at close.")
    assert code == 1 and "FAIL  learn/SKILL.md: link does not resolve — scripts/nope_cmd.mjs" in out, out


def test_missing_cross_skill_node_command_fails():
    code, out = _check_files_on_copy("Run `node ../apply/scripts/nope_x.mjs --workspace .`.")
    assert code == 1 and "link does not resolve — ../apply/scripts/nope_x.mjs" in out, out


def test_both_forms_resolving_are_silent():
    code, out = _check_files_on_copy(
        "See `../profile/scripts/check_files.mjs`; run `node ../profile/scripts/check_files.mjs --workspace .`;"
        " and `node ../apply/scripts/check_materials.mjs --workspace . --resume r.md`.")
    assert "link does not resolve" not in out and code == 0, out


def test_every_node_command_in_the_real_skill_prose_resolves():
    # § 6 J2 Exit: "every `node` command in skill prose resolves (§ 3.6)"
    cmds = []
    for dp, _, fs in os.walk(SKILLS):
        for f in fs:
            if f.endswith(".md"):
                p = os.path.join(dp, f)
                for m in re.finditer(r"`node ([\w./-]*/[\w./-]+\.mjs)\b[^`]*`", open(p, encoding="utf-8").read()):
                    cmds.append((p, m.group(1)))
    assert len(cmds) >= 7, cmds
    missing = []
    for p, target in cmds:
        rel = os.path.relpath(p, SKILLS)
        here = os.path.dirname(p)
        skill_root = os.path.join(SKILLS, rel.split(os.sep)[0])
        bases = [here] if target.startswith(".") else [here, skill_root]
        if not any(os.path.isfile(os.path.normpath(os.path.join(b, target))) for b in bases):
            missing.append(f"{rel}: {target}")
    assert not missing, missing


# ---- deleted tests with no case in the record and no surviving test -------------

def test_language_check_contract_carries_every_rule_and_both_severities():
    # from test_check_materials.py::test_language_parsers_deleted_and_contract_exists
    text = _read("skills", "profile", "references", "language-check.md")
    for rule in ("struck_form", "never_say", "confirm_qualifier", "watch_form", "search_jargon"):
        assert rule in text, f"contract missing {rule}"
    assert "fix-before-delivery" in text and "defend-or-qualify" in text
    assert "not checkable" in text, "missing-source convention absent"
    # the parsers the #29 migration deleted never came back in the JS
    lib = _read("skills", "apply", "scripts", "lib", "check-materials.mjs")
    for fn in ("loadHazards", "load_hazards", "loadNeverSay", "load_never_say", "quotedPhrases", "quoted_phrases"):
        assert fn not in lib.replace("(load_hazards, load_never_say, quoted_phrases)", ""), fn


def test_s1_host_note_and_evaluate_prose_pass_the_analysis_file():
    # from test_search_s1_tester.py, with § 6 J2's rename (.py -> .mjs) only
    note = _norm(_read("skills", "profile", "templates", "web-host-note.md"))
    assert _norm("Pass `--analysis-file` to `record_verdict.mjs` when you write an analysis, "
                 "and `--jd-file` when a posting file exists.") in note
    assert "Pass `--jd-file` to `record_verdict.mjs` when a job description file exists." not in note
    patterns = _norm(_read("skills", "evaluate", "references", "patterns.md"))
    assert "`--analysis-file jd-analysis/<file>.md` (the analysis you just wrote)" in patterns
    schema = _norm(_read("skills", "evaluate", "references", "schema.md"))
    assert _norm("Filename = a slug of the company and the title (lowercase; every run of other characters "
                 "becomes `-`), written once; the row's `Analysis` field records the exact path, so no reader "
                 "rebuilds the name.") in schema
    search = _norm(_read("skills", "search", "references", "schema.md"))
    assert _norm("`JD` is the raw posting in `jd-inbox/`; `Analysis` is evaluate's decode in `jd-analysis/`, "
                 "written by `record_verdict.mjs --analysis-file` (the latest wins).") in search


if __name__ == "__main__":
    failed = 0
    for name in sorted(n for n in list(globals()) if n.startswith("test_")):
        try:
            globals()[name]()
            print("PASS", name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", name, repr(e)[:400])
    sys.exit(1 if failed else 0)
