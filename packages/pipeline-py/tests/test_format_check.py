"""format_check: standard section order, 'Company, Title' role headers, no undated-rule violations."""
from apply.tools import format_check as FC
from tests import helpers as T


def body_of(home, base="ic-builder"):
    return (home / "base-resumes" / base / "resume-native.md").read_text()


def pkg_with(home, tmp_path, md, cover=None):
    p = tmp_path / "pkg"; p.mkdir()
    (p / "resume-native.md").write_text(md)
    if cover: (p / "cover.txt").write_text(cover)
    return p


def test_example_bases_pass(home, tmp_path):
    for base in ("ic-builder", "eng-manager"):
        p = tmp_path / base; p.mkdir()
        (p / "resume-native.md").write_text(body_of(home, base))
        fails, _ = FC.check(p)
        assert fails == [], (base, fails)


def test_bad_header_separator(home, tmp_path):
    md = body_of(home).replace("**Northwind Systems, Engineering Manager, Platform**", "**Northwind Systems | Engineering Manager**")
    assert any(f.startswith("HEADER") for f in FC.check(pkg_with(home, tmp_path, md))[0])


def test_missing_and_extra_sections(home, tmp_path):
    md = body_of(home).replace("## SKILLS", "## HOBBIES")
    fails = FC.check(pkg_with(home, tmp_path, md))[0]
    assert any("missing section: SKILLS" in f for f in fails) and any("non-standard" in f for f in fails)


def test_year_before_earliest_year(home, tmp_path):
    md = body_of(home)
    p = pkg_with(home, tmp_path, md, cover="Dear Team,\n\nI started building systems in 2009.\n")
    assert any(f.startswith("DATES") and "2009" in f for f in FC.check(p)[0])


def test_cli_json(home):
    import json
    p = T.built_package(home)
    r = T.cli(home, "format-check", p, "--json", check=True)
    out = json.loads(r.stdout)
    assert out["result"] == "PASS" and out["fails"] == []
