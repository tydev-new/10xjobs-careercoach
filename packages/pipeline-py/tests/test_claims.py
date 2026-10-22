"""check_claims: every number, year and risky phrase in candidate-facing text must trace to claims.yaml."""
import pytest, yaml

from apply.lib import claims as CL
from tests import helpers as T


def text(home, s, scope="all"):
    return T.cli(home, "check-claims", "--text", s, "--scope", scope)


@pytest.mark.parametrize("s,scope,ok", [
    ("Built the internal Kubernetes platform that runs 30 production services.", "all", True),
    ("Cut deployment time from 2 hours to 10 minutes.", "all", True),
    ("Built a platform that runs 31 production services.", "all", False),          # number not in any claim
    ("Ran 30 teams across the company.", "all", False),                            # number without its anchor
    ("Lead a platform team of 8 engineers.", "eng", True),
    ("Lead a platform team of 8 engineers.", "ic", False),                        # out of scope
    ("Lead an organization of 8 engineers.", "eng", False),                       # forbid_with
    ("Seasoned engineer with deep platform skills.", "all", False),               # banned
    ("Built a streaming platform for analytics.", "all", False),                  # banned paraphrase
    ("Used Terraform to manage infrastructure.", "all", False),                    # conditional
    ("Used Terraform in a personal project.", "all", True),
    ("Hired engineers for the platform team.", "ic", False),                       # scoped phrase
    ("Hired engineers for the platform team.", "eng", True),
    ("Shipped the platform in 2019.", "all", True),
    ("Shipped the platform in 2018.", "all", False),                               # year not listed
    ("Cut cloud spend by about a third.", "all", False),                           # unconfirmed claim
])
def test_text_cases(home, s, scope, ok):
    r = text(home, s, scope)
    assert (r.returncode == 0) == ok, r.stdout


def mutate(home, fn):
    p = home / "profile" / "claims.yaml"; d = yaml.safe_load(p.read_text()); fn(d)
    p.write_text(yaml.safe_dump(d, sort_keys=False)); CL._load.cache_clear()
    return p


def test_valid_example_loads(home):
    d = CL.load()
    assert d["version"] == "claims-example-1" and CL.earliest_year() == 2012
    assert {c["id"] for c in CL.approved({"ic"})} >= {"nw.platform", "ct.observability"}
    assert "nw.team" not in {c["id"] for c in CL.approved({"ic"})}


def test_bad_scope_rejected(home):
    p = mutate(home, lambda d: d["claims"][0].update(scope=["sales"]))
    with pytest.raises(CL.ClaimsError, match="bad scope"):
        CL.load(p)


def test_role_year_before_earliest_year_rejected(home):
    p = mutate(home, lambda d: d["roles"][1].update(meta="2009 – 2021 · Springfield"))
    with pytest.raises(CL.ClaimsError, match="before 2012"):
        CL.load(p)


def test_earliest_year_optional(home):
    p = mutate(home, lambda d: (d.pop("earliest_year"), d["roles"][1].update(meta="2009 – 2021 · Springfield")))
    assert CL.earliest_year(p) is None


def test_numbers_need_anchors(home):
    p = mutate(home, lambda d: d["claims"][1].pop("anchors"))
    with pytest.raises(CL.ClaimsError, match="anchors"):
        CL.load(p)


def test_reviewer_brief_lists_scope_facts(home):
    r = T.cli(home, "claims", "ic", check=True)
    assert "nw.platform" in r.stdout and "nw.team" not in r.stdout and "Cut cloud spend" in r.stdout
