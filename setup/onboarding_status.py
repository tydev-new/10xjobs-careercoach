#!/usr/bin/env python3
"""Report which starter settings are still empty or synthetic.

This is not an onboarding validator. A null value is unselected, not a
recommendation and not proof that a check was deliberately disabled.
Null max_review_rounds leaves finalization with zero free rounds until a
private copy sets one. Nothing printed here is permission to apply or send.
"""
from pathlib import Path
import argparse, sys
import yaml

ROOT_KEYS = (
    "age_cutoff_year", "max_pages", "experience_words", "summary_words", "summary_bullets",
    "max_review_rounds", "pay_floor", "travel_max", "timezone", "home_locations",
    "excluded_locations", "workday_search_terms", "workday_lanes", "cover_words",
    "outreach_words", "outreach_batch_size", "outreach_followup_days", "outreach_max_followups",
)

def load(path):
    return yaml.safe_load(path.read_text()) or {}

def blank(value):
    return value is None or value == [] or value == {} or value == ""

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=None)
    a = ap.parse_args()
    root = (a.root or Path(__file__).resolve().parents[1]).resolve()
    search = root / "workspace/job-search"
    cand = load(search / "profile/candidate.yaml")
    claims = load(search / "profile/claims.yaml")
    policy = load(search / "profile/policy.yaml")
    sources = load(search / "pipeline/sources.yaml")
    synthetic = cand.get("synthetic") is True and claims.get("synthetic") is True and policy.get("synthetic") is True
    print(f"SYNTHETIC_PROFILE: {'yes' if synthetic else 'no'}")
    print("SUBMIT_AUTHORIZED: no")
    print("SEND_AUTHORIZED: no")
    if not synthetic:
        print("PRIVATE_OR_UNMARKED_PROFILE: do not publish this tree")
    empty = [k for k in ROOT_KEYS if blank(policy.get(k))]
    set_keys = [k for k in ROOT_KEYS if k not in empty and k in policy]
    print("UNCONFIGURED: " + (", ".join(empty) if empty else "(none of the listed keys)"))
    print("SET: " + (", ".join(set_keys) if set_keys else "(none of the listed keys)"))
    print("SOURCES_CONFIGURED: " + ("no" if not sources.get("sources") else "yes"))
    print("STANDING_ANSWERS: " + ("none" if not cand.get("standing_answer_rules") else "present"))
    print("NOTE: unconfigured is not the same as deliberately disabled. Readiness is not permission to submit. Drafts are not sends.")
    return 0 if synthetic or a.root else 0

if __name__ == "__main__":
    sys.exit(main())
