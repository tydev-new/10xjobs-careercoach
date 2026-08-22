"""Two-file company model + settings + the career-ops ports."""
import os, sys, tempfile, textwrap, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "skills", "search", "scripts"))
import search_ats as sa

def ws(criteria=None, companies=None):
    d = tempfile.mkdtemp()
    if criteria is not None:
        open(os.path.join(d, "criteria.md"), "w").write(textwrap.dedent(criteria))
    if companies is not None:
        open(os.path.join(d, "companies.md"), "w").write(textwrap.dedent(companies))
    return d

def test_target_companies_parse_tolerates_human_formatting():
    d = ws("""\
        # Criteria
        ## Targets
        - Head of FDE
        ## Target companies
        - OpenAI  *(applied — no response, 2026-08)*
        - Cursor
        Anthropic — dream company
        - TODO: grow this list to 20-40
        ## Retired
        """)
    names, _ = sa.parse_criteria_md(d)
    assert names == ["OpenAI", "Cursor"]  # prose line is NOT a bullet -> skipped

def test_prose_in_target_section_never_parses_as_a_company():
    """Caught on the first live sweep: an italic note and a TODO continuation
    were probed as employers."""
    d = ws("""        ## Target companies
        *the candidate's own picks — always swept.*
        - OpenAI
        - TODO: this list should be 20-40 names
        Building it is an early search task.
        """)
    names, _ = sa.parse_criteria_md(d)
    assert names == ["OpenAI"]

def test_settings_parse_and_defaults():
    d = ws("""\
        ## Search settings
        - Target yield per sweep: 5
        - Stale after: 45 days
        """)
    _, s = sa.parse_criteria_md(d)
    assert s["target_yield"] == 5 and s["stale_days"] == 45
    assert s["active_cap"] == 25 and s["max_per_company"] == 5  # defaults fill in

def test_bad_setting_is_loud():
    d = ws("## Search settings\n- Stale after: never\n")
    try:
        sa.parse_criteria_md(d)
        assert False, "should have exited"
    except SystemExit as e:
        assert "needs a number" in str(e)

def test_companies_md_roundtrip_and_criteria_regeneration():
    d = ws()
    sa.write_companies_md(d, {
        sa.canon("OpenAI"): {"name": "OpenAI", "source": "criteria", "evidence": "", "status": "new"},
        sa.canon("Zep AI"): {"name": "Zep AI", "source": "discovery-hn 2026-08-14",
                             "evidence": "founder post", "status": "new"},
    })
    rows = sa.load_companies_md(d)
    assert set(rows) == {sa.canon("OpenAI"), sa.canon("Zep AI")}
    # the criteria row is rebuilt each sweep — dropping it from criteria.md must drop it here
    rows = {k: r for k, r in rows.items() if r["source"] != "criteria"}
    assert list(rows) == [sa.canon("Zep AI")]  # discovered persists

def test_append_discovered_idempotent():
    d = ws()
    assert sa.append_discovered(d, "Shamrock AI", "hn", "nov thread") is True
    assert sa.append_discovered(d, "Shamrock AI", "hn", "again") is False
    assert len(sa.load_companies_md(d)) == 1

def test_simhash_flags_near_duplicates_only():
    base = """Forward Deployed Engineering Lead. You will embed with enterprise
    customers to design deploy and operate production integrations. Own
    reference architectures runbooks and automation. Partner with product
    engineering on field feedback. Requirements: 8 years infrastructure
    experience kubernetes terraform python distributed systems. Travel 25
    percent. Compensation range 210000 to 260000 plus equity. Benefits medical
    dental vision 401k. Location San Francisco hybrid. Our interview process
    includes a systems design panel and a customer scenario exercise.
    Responsibilities include leading discovery workshops with customer
    platform teams, translating ambiguous requirements into phased delivery
    plans, establishing deployment playbooks that survive handoff, mentoring
    embedded engineers across three regions, and representing field realities
    in quarterly roadmap planning. Qualifications: demonstrated ownership of
    production incidents, comfort presenting to executive stakeholders,
    experience negotiating scope with procurement and security review teams,
    familiarity with observability tooling and cost management. We value
    written communication, bias to action, and durable documentation."""
    # the real hazard: an agency reposts the SAME body with the employer scrubbed
    agency = base.replace("Forward Deployed Engineering Lead.",
                          "Job ref 4482 for our confidential client:")
    other = ("Completely different marketing coordinator role planning events "
             "and managing social channels with weekly content calendars "
             "reporting to the brand director and owning the newsletter") * 2
    a, b, c = sa.simhash64(base), sa.simhash64(agency), sa.simhash64(other)
    assert sa.sim_pct(a, b) >= 0.92
    assert sa.sim_pct(a, c) < 0.92

def test_simhash_empty_body_never_flags():
    assert sa.simhash64("too short") == 0
    assert sa.sim_pct(0, 12345) == 0.0

def test_liveness_patterns():
    n = sa.normalize_for_match
    dead = n("Cette offre n’est plus disponible. This job has expired")
    assert any(p.search(dead) for p in sa.HARD_EXPIRED)
    filled = n("The job you are trying to apply for has been filled.")
    assert any(p.search(filled) for p in sa.HARD_EXPIRED)
    live = n("Once the application form has been filled out, click submit to apply")
    assert not any(p.search(live) for p in sa.HARD_EXPIRED)

def test_trust_flags():
    assert sa.trust_flags("https://bit.ly/3xyz") == ["shortener-domain"]
    assert sa.trust_flags("https://boards.greenhouse.io/acme/jobs/1") == []


def test_lead_validation_ladder():
    """Rungs 2, 3, 4: raw-feed promotion with employer URL; swept-and-absent
    dies immediately; unknown company joins the universe."""
    d = ws()
    sa.append_lead(d, "Mesh", "Head of FDE", "$282-355K", "hiring.cafe, 2026-08-14", "https://agg/1")
    sa.append_lead(d, "Anthropic", "Head of FDE", "", "builtin, 2026-08-14", "https://agg/2")
    sa.append_lead(d, "NewCo", "Head of FDE", "", "hn, 2026-08-14", "")
    jrows, by_key, companies = [], {}, {}
    feed = {(sa.canon("Mesh"), sa.canon("Head of FDE")):
            ("Head of FDE", "https://boards.greenhouse.io/mesh/1", "NYC")}
    swept = {sa.canon("Mesh"), sa.canon("Anthropic")}
    promoted, dead, expired, added = sa.validate_leads(
        d, by_key, 30, feed_index=feed, swept=swept, companies=companies,
        jrows=jrows, now="2026-08-14T00:00:00+00:00")
    assert (promoted, dead, expired, added) == (1, 1, 0, 1)
    assert jrows[0]["url"].startswith("https://boards.greenhouse.io")  # employer URL, never the aggregator's
    leads = sa.load_leads(d)
    assert "promoted" in leads[(sa.canon("Mesh"), sa.canon("Head of FDE"))]["status"]
    assert "not on the employer's board" in leads[(sa.canon("Anthropic"), sa.canon("Head of FDE"))]["status"]
    assert sa.canon("NewCo") in companies


def test_lane_b_title_themes_match_ats_surface_forms():
    # Lane-B revision 2026-08-14: theme-miss=283/641 because the default
    # themes were lane-A-tuned. These phrases must survive ATS punctuation.
    themes = ["head of engineering", "vp engineering", "vp of engineering",
              "vp platform", "director of engineering"]
    hits = ["Head of Engineering", "VP, Engineering", "VP of Engineering",
            "Head of Engineering, Platform", "VP Engineering - Remote",
            "Director of Engineering (Payments)"]
    for title in hits:
        t = sa.norm_title(title)
        assert any(sa.theme_hit(k, t) for k in themes), title
    # the 2026-07-18 calibration must survive: leadership-band titles that
    # are NOT lane-B seats stay theme-misses
    misses = ["Principal Software Engineer", "Engineering Manager, GRC",
              "VP Marketing", "Director of Finance", "Founding Engineer"]
    for title in misses:
        t = sa.norm_title(title)
        assert not any(sa.theme_hit(k, t) for k in themes), title
