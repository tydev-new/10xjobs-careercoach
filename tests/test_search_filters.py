"""Filter regressions for search_ats.

Every case below reproduces a defect that actually shipped in a live sweep.
Named with the date it was earned so the reason survives the fix.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "search", "scripts"))
import search_ats as s  # noqa: E402

CRIT = dict(s.DEFAULT_CRITERIA)


def crit(**over):
    c = dict(s.DEFAULT_CRITERIA)
    c.update(over)
    return c


class TestICGuard(unittest.TestCase):
    """2026-08-04: `founding` is in the default seniority_regex, so IC titles
    passed the band gate. Three of thirteen small-company hits at the comp
    floor were 'Founding Forward Deployed Engineer' — all IC seats."""

    def test_founding_fde_is_ic_not_leadership(self):
        self.assertEqual(
            s.filter_reason("Founding Forward Deployed Engineer", "San Francisco", CRIT),
            "ic-title")

    def test_founding_engineer_forward_deployed_variant(self):
        self.assertEqual(
            s.filter_reason("Founding Engineer, Forward Deployed", "San Francisco", CRIT),
            "ic-title")

    def test_founding_head_of_is_rescued_by_a_real_band_word(self):
        self.assertIsNone(
            s.filter_reason("Founding Head of Forward Deployed Engineering", "San Francisco", CRIT))

    def test_founding_director_is_leadership(self):
        self.assertIsNone(
            s.filter_reason("Founding Director of Solutions Engineering", "Palo Alto", CRIT))

    def test_ordinary_leadership_title_unaffected(self):
        self.assertIsNone(
            s.filter_reason("Head of Forward Deployed Engineering", "San Francisco", CRIT))


class TestCompFloor(unittest.TestCase):
    """2026-08-04: yearly_min/max_compensation were present in the feed and
    entirely unused. 73 of 125 roles disclosed comp; the floor would have
    flagged Shamrock AI ($200-250K) before an evaluation was spent on it."""

    def test_max_below_floor_is_a_miss(self):
        self.assertEqual(
            s.filter_reason("Head of Forward Deployed Engineering", "San Francisco",
                            crit(comp_floor=250_000),
                            meta={"comp_max": 250_000 - 1}),
            "comp-miss")

    def test_straddling_range_is_kept_it_is_a_negotiation(self):
        # Zep AI: $220-270K. Max clears, so the role survives -> anchor high.
        self.assertIsNone(
            s.filter_reason("Head of Forward Deployed Engineering", "San Francisco",
                            crit(comp_floor=250_000),
                            meta={"comp_min": 220_000, "comp_max": 270_000}))

    def test_undisclosed_comp_is_never_a_miss(self):
        # 52 of 125 roles published nothing; dropping them would hide the market.
        for absent in (None, 0):
            self.assertIsNone(
                s.filter_reason("Head of Forward Deployed Engineering", "San Francisco",
                                crit(comp_floor=250_000), meta={"comp_max": absent}),
                f"comp_max={absent!r} must not be treated as below-floor")

    def test_floor_off_by_default(self):
        self.assertIsNone(
            s.filter_reason("Head of Forward Deployed Engineering", "San Francisco", CRIT,
                            meta={"comp_max": 100_000}))


class TestStructuredBand(unittest.TestCase):
    """2026-08-03 (Clera): a 'Head of Engineering' posting carried
    seniority_level 'Entry Level' and 2+ years. The lesson was written into a
    workspace analysis file and never implemented. Where the feed knows the
    management-years, it beats the title."""

    def test_feed_says_ic_despite_a_leadership_title(self):
        self.assertEqual(
            s.filter_reason("Head of Solutions Engineering", "San Francisco",
                            crit(min_mgmt_yoe=3), meta={"min_mgmt_yoe": 0}),
            "band-miss")

    def test_feed_confirms_band(self):
        self.assertIsNone(
            s.filter_reason("Head of Solutions Engineering", "San Francisco",
                            crit(min_mgmt_yoe=3), meta={"min_mgmt_yoe": 5}))

    def test_unknown_mgmt_yoe_falls_back_to_title(self):
        self.assertIsNone(
            s.filter_reason("Head of Solutions Engineering", "San Francisco",
                            crit(min_mgmt_yoe=3), meta={"min_mgmt_yoe": None}))

    def test_no_meta_at_all_is_title_only_behaviour(self):
        # Most ATS vendors supply no structured band data; nothing may break.
        self.assertIsNone(
            s.filter_reason("Head of Solutions Engineering", "San Francisco",
                            crit(min_mgmt_yoe=3)))


class TestCriteriaValidation(unittest.TestCase):
    def test_new_keys_are_typed_ints(self):
        self.assertIs(s.CRITERIA_TYPES["comp_floor"], int)
        self.assertIs(s.CRITERIA_TYPES["min_mgmt_yoe"], int)

    def test_new_keys_default_to_off(self):
        self.assertEqual(s.DEFAULT_CRITERIA["comp_floor"], 0)
        self.assertEqual(s.DEFAULT_CRITERIA["min_mgmt_yoe"], 0)


class TestYCVendor(unittest.TestCase):
    """2026-08-04: Zep AI was a real, evaluated role that NO channel could
    reach — absent from companies.txt, 0 aggregator postings under any name,
    no ATS discoverable by slug probing. It posts only on YC's own board."""

    def test_yc_company_url_parses_to_a_slug(self):
        self.assertEqual(s.parse_ats_url("https://www.ycombinator.com/companies/zep-ai"),
                         ("yc", "zep-ai", None, None))

    def test_yc_url_without_www_parses(self):
        self.assertEqual(s.parse_ats_url("https://ycombinator.com/companies/serval-2"),
                         ("yc", "serval-2", None, None))

    def test_yc_is_a_known_vendor_but_not_slug_probed(self):
        # Probing every company against YC would cost a request each for no
        # yield — most target companies were never in a batch.
        self.assertIn("yc", s.VENDORS)
        self.assertNotIn("yc", s.PROBE_VENDORS)

    def test_extract_carries_salary_equity_and_founders(self):
        posting = {"title": "Head of Forward Deployed Engineering",
                   "location": "San Francisco, CA, US / Remote (US)",
                   "_url": "https://www.ycombinator.com/companies/zep-ai/jobs/x",
                   "salaryRange": "$220K - $270K", "equityRange": "1.20% - 1.75%",
                   "minExperience": "11+ years", "visa": "US citizen/visa only",
                   "_batch": "W24", "_founders": [{"full_name": "Daniel Chalef"}]}
        title, loc, url, meta = s.extract("yc", posting)
        self.assertEqual(title, "Head of Forward Deployed Engineering")
        self.assertIn("$220K - $270K", meta)
        self.assertIn("1.20% - 1.75%", meta)      # equity — almost no ATS publishes this
        self.assertIn("Daniel Chalef", meta)       # founder — the A2 lane's whole point
        self.assertIn("W24", meta)


class TestYCRelativeDates(unittest.TestCase):
    """YC publishes a RELATIVE string ('1 day'), not a date. posted_iso sliced
    it to 10 chars and wrote the literal '1 day' into posted_at, which drives
    the freshness rule for action slots."""

    def setUp(self):
        import datetime
        self.today = datetime.date(2026, 8, 4)

    def test_days(self):
        self.assertEqual(s.yc_relative_to_iso("1 day", self.today), "2026-08-03")

    def test_months_approximate_to_30_days(self):
        self.assertEqual(s.yc_relative_to_iso("3 months", self.today), "2026-05-06")

    def test_hours_are_today(self):
        self.assertEqual(s.yc_relative_to_iso("about 2 hours", self.today), "2026-08-04")

    def test_unparseable_yields_empty_not_garbage(self):
        # A wrong date is worse than no date.
        for junk in ("", None, "recently", "just now"):
            self.assertEqual(s.yc_relative_to_iso(junk, self.today), "")

    def test_posted_iso_never_returns_a_relative_string(self):
        out = s.posted_iso("yc", {"createdAt": "1 day"})
        self.assertNotEqual(out, "1 day")
        self.assertRegex(out, r"^\d{4}-\d{2}-\d{2}$")


class TestRejectionReasonsAreSeeded(unittest.TestCase):
    """2026-08-04: filter_reason gained 'ic-title' but main()'s counter was
    still hardcoded to the original three keys, so a 175-company sweep died
    mid-run on KeyError. Any reason the filter can emit must be declared."""

    def test_every_emitted_reason_is_declared(self):
        # Drive the filter through cases that produce each reason.
        emitted = {
            s.filter_reason("Chef de Partie", "San Francisco", CRIT),
            s.filter_reason("Founding Forward Deployed Engineer", "San Francisco", CRIT),
            s.filter_reason("Head of Accounting", "San Francisco", CRIT),
            s.filter_reason("Head of Forward Deployed Engineering", "Berlin, Germany", CRIT),
            s.filter_reason("Head of Forward Deployed Engineering", "San Francisco",
                            crit(min_mgmt_yoe=3), meta={"min_mgmt_yoe": 0}),
            s.filter_reason("Head of Forward Deployed Engineering", "San Francisco",
                            crit(comp_floor=250_000), meta={"comp_max": 100_000}),
        } - {None}
        undeclared = emitted - set(s.REJECTION_REASONS)
        self.assertEqual(undeclared, set(),
                         f"filter_reason emits {undeclared} but REJECTION_REASONS omits it — "
                         "the sweep's counter will KeyError mid-run")

    def test_declared_reasons_are_unique(self):
        self.assertEqual(len(s.REJECTION_REASONS), len(set(s.REJECTION_REASONS)))


class TestThemeHitStillHolds(unittest.TestCase):
    """2026-08-03 regression: norm_title collapses 'engineering'->'eng', so
    substring matching let every IC 'Software Engineer' match the theme
    'software engineering'. Word boundaries fixed it; keep it fixed."""

    def test_ic_software_engineer_does_not_match_software_engineering(self):
        self.assertFalse(s.theme_hit("software engineering",
                                     s.norm_title("Principal Software Engineer")))

    def test_vp_software_engineering_does_match(self):
        self.assertTrue(s.theme_hit("software engineering",
                                    s.norm_title("VP Software Engineering")))


if __name__ == "__main__":
    unittest.main()


class TestTitleGeoRescue(unittest.TestCase):
    """2026-08-04: an ATS location field names ONE primary city, but a
    multi-location role often carries the others in its title. Amigo's
    'Head of Applied AI [NYC or SF]' — $300-500K, the highest-paying
    FDE-leadership role found in the whole search — was dropped because its
    Ashby location field says only 'New York City'."""

    def test_sf_in_title_rescues_a_non_bay_location_field(self):
        self.assertIsNone(
            s.filter_reason("Head of Applied AI [NYC or SF]", "New York City", CRIT))

    def test_same_role_without_the_title_hint_still_misses(self):
        # Mesh's 'Head of Forward Deployed Engineering' @ 'New York, NY' has no
        # geo hint anywhere — correctly still a miss.
        self.assertEqual(
            s.filter_reason("Head of Forward Deployed Engineering", "New York, NY", CRIT),
            "geo-miss")

    def test_exclusion_is_never_overridden_by_the_title(self):
        # A "London or SF" role fails on London — geo_exclude has the last word.
        self.assertEqual(
            s.filter_reason("Head of Solutions Engineering - SF", "London, United Kingdom", CRIT),
            "geo-miss")

    def test_bay_area_alias(self):
        self.assertIsNone(
            s.filter_reason("Director of Field Engineering (Bay Area)", "Austin, TX", CRIT))

    def test_sf_must_be_word_bounded_not_a_substring(self):
        # "sf" inside an ordinary word must not count as San Francisco.
        self.assertFalse(s.title_names_included_geo("Head of Transfer Engineering", CRIT))

    def test_alias_only_applies_when_its_target_is_included(self):
        narrow = crit(geo_include=["new york"])
        self.assertFalse(s.title_names_included_geo("Head of Eng [SF]", narrow))
