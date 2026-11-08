# Private onboarding and configuration checklist

This distribution is intentionally unconfigured. Perform onboarding ONLY in a new
private copy, never in a public source tree. Files that are safe synthetic examples
become private once populated. `.gitignore` alone is not a publication boundary.

## Authorities to review together
- `workspace/job-search/profile/candidate.yaml`: identity/contact, selected work,
  resume header/signature, approved form-answer rules, base/employer key mappings.
  Replace fictional fields; do not assume an example is an approved fact.
- `workspace/job-search/profile/claims.yaml`: approved proof, source/evidence,
  numbers/anchors, roles, conditional/scoped/forbidden wording. The user must approve
  new factual claims. Approval of a claim is NOT approval to send or submit.
- `workspace/job-apps/base-resumes/*/resume-native.md` and `_shared/*`: claim-backed
  base documents, dates/headers, publications and optional sections. Keep all role
  dates/contact/header facts consistent with the approved profile.
- `workspace/job-apps/tools/precheck_terms.yaml`: banned/warn/age terms, case rules,
  fixed company headers/dates/contact fields and selected-work order. These are
  separate deterministic checks: explicitly synchronize with approved facts.
- `workspace/job-search/profile/policy.yaml`: choose age/date, page/word/bullet,
  pay/travel/location, review-round, outreach and Workday rules deliberately.
- `workspace/job-search/criteria.md`, `pipeline/sources.yaml`, `pipeline/scoring.yaml`
  and `workspace/job-search/profile/agent-config.yaml`: screening, boards, enabled adapters,
  lane/role routing and paths. Select fresh sources; no former company list survives.
- Skills and operational briefs describe review and browser-only submission policy.
  No earlier go, hold override, standing demographic answer or routine is imported.

## Unconfigured is not the same as deliberately disabled
The current runtime adapter returns empty mappings for missing config. Many null
limits disable a respective check; null `max_review_rounds` means zero free rounds,
so an initial finalization can refuse. Set a conscious free-round policy; the next
round remains wording-only unless genuinely user-approved, and later rounds require
approval. Readiness is not permanently disabled and is never permission to submit.
False/empty geographic flags and lists are unselected examples, not recommendations.
A future maintainer should validate required configuration and distinguish missing
from explicitly disabled settings BEFORE real use. No machine-enforced onboarding
validator is claimed here. `python3 setup/onboarding_status.py` only lists starter
values that are still null, empty, or synthetic. It does not approve claims and
does not authorize send or submit. Runtime config is currently fragmented, not a single
validated schema. US-oriented enum/pay parsing assumptions remain.

## Policy keys consumed directly by retained source
The following names are configuration inputs, not inherited default values. Some
optional keys are absent from the starter YAML; read their consuming tool and set
only after deciding the desired behavior. Nested eval and replacement settings need
separate review. Synthetic test-only replacement rules do not belong in real policy.

- `age_cutoff_year`
- `block_clearance`
- `clearance_block_regex`
- `country_card_regex`
- `cover_warn_words`
- `cover_words`
- `earlier_career_undated`
- `eval_rules`
- `excluded_area_regex`
- `excluded_locations`
- `experience_words`
- `field_region_codes`
- `hard_gap_terms`
- `hide_graduation_years`
- `home_area_regex`
- `home_locations`
- `lead_location_regex`
- `local_onsite_extract_regex`
- `local_remote_extract_regex`
- `max_pages`
- `max_review_rounds`
- `metric_pairs`
- `native_package_globs`
- `outside_region_regex`
- `pay_floor`
- `remote_country_prefix`
- `remote_region_regex`
- `repeat_metric_markers`
- `restrict_onsite_to_home`
- `summary_bullets`
- `summary_words`
- `synthetic_fixture_replacements`
- `timezone`
- `title_exclude_regex`
- `travel_max`
- `verify_search_term`
- `workday_lanes`
- `workday_search_terms`

## Safe distribution boundary
`setup/bootstrap.py` accepts only the pristine paths and bytes in DISTRIBUTION.json,
then initializes the original schema empty. It refuses unexpected files and symlinks.
It is NOT a privacy scrubber, signature/authenticity proof, or onboarding validator.
Do not regenerate its manifest around personal files. Any new distribution needs a
fresh content audit and independently verified archive hash. Never publish an
onboarded copy, generated fixtures, databases, contacts, stories, PDFs or test logs.
