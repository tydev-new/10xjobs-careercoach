"""Synthetic regression coverage for privacy-related executable and configuration edits."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import precheck_spec as PS
import precheck as PC

def test_plan_terms_preserves_character_iteration():
    assert "SQL" in PS.plan_terms("SQL experience")
    assert PS.plan_terms("Rust systems programming") == []  # original named-token heuristic
    assert "Kafka" in PS.plan_terms("Kafka service")
    assert isinstance(PS.default_plan({"gaps":["SQL experience"],"blockers":[]}), list)

def test_normal_precheck_gap_path_does_not_crash(tmp_path, monkeypatch):
    # Exercise run's real default-plan call using synthetic JD/Markdown; skip only
    # unrelated render/DB contracts, which are covered by original integration tests.
    md="## SUMMARY\n- Built a fictional intake helper.\n## EXPERIENCE\n- Wrote toy instructions.\n"
    (tmp_path/"resume-native.md").write_text(md)
    (tmp_path/"jd.md").write_text("A fictional exercise requiring SQL experience.")
    rec={"gaps":["SQL experience"],"blockers":[]}
    monkeypatch.setattr(PC,"link_check",lambda p:(1,rec,[]))
    result=PC.run(tmp_path)
    assert isinstance(result,dict) and isinstance(result["fail"],list)

def test_rendered_package_precheck_with_gap(tmp_path, monkeypatch):
    import package_fixtures as F
    p=F.copy_current(F.NOCOVER,tmp_path)
    assert not PC.run(p)["fail"]
    monkeypatch.setattr(PC,"link_check",lambda p:(1,{"gaps":["SQL experience"],"blockers":[]},[]))
    assert not PC.run(p)["fail"]

def test_cover_init_has_current_date_not_null(tmp_path):
    import datetime, yaml
    import package_fixtures as F
    d=tmp_path/"synthetic-cover-init"
    rc,out=F.run(F.TOOLS/"build_package.py",d,"--init","ic-builder","--cover",
                 "--company","Fictional Cards","--title","Toy Curator",
                 "--url","https://jobs.example.invalid/cover-init")
    assert rc == 0,out
    spec=yaml.safe_load((d/"package.yaml").read_text())
    assert spec["cover"]["date"] == datetime.date.today().strftime("%B %d, %Y")
