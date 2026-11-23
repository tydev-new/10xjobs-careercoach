# Private onboarding and configuration checklist

This distribution is intentionally unconfigured. Perform onboarding ONLY in a new
private copy, never in a public source tree. Files that are safe synthetic examples
become private once populated. `.gitignore` alone is not a publication boundary.

## Authorities to review together
- `AGENTS.md`: kit-wide rules for every skill. Bootstrap copies this file with
  the rest of the kit.
- `skills/job-search-intake/SKILL.md`: capture what the user gives. They can paste
  a resume, LinkedIn text, files, or chat. `python3 setup/intake.py report` lists
  missing fields and which task each one blocks. `python3 setup/intake.py set`
  writes one field and records where it came from and the date. A claim the user
  states is stored approved. A claim taken from a file stays unconfirmed until
  `python3 setup/intake.py confirm` records their yes and sets it approved. Do not
  approve a claim by editing its status in claims.yaml. Intake does not authorize
  send or submit.
- `workspace/job-search/profile/profile.yaml`: identity and contact, the eight
  intake fields (each value has a source and a date), lane name, description,
  and competitiveness, and the criteria note. This is the only profile file
  those answers live in. Empty intake fields in this public tree. Replace
  fictional identity fields. Do not assume an example is an approved fact.
- `workspace/job-search/profile/claims.yaml`: approved proof, source, evidence,
  numbers, anchors, roles, and wording that is conditional, scoped, or forbidden.
  The user approves a new fact by saying it, or by confirming an extracted one
  through intake. Approval of a claim is not approval to send or submit. Only a
  claim with status approved counts as proof.
- `workspace/job-apps/base-resumes/*/resume-native.md` and `_shared/*`: claim-backed
  base documents, dates/headers, publications and optional sections. Keep all role
  dates/contact/header facts consistent with the approved profile.
- `workspace/job-apps/tools/precheck_terms.yaml`: banned/warn/age terms, case rules,
  fixed company headers/dates/contact fields and selected-work order. These are
  separate deterministic checks: explicitly synchronize with approved facts.
- `workspace/job-search/profile/policy.yaml`: choose age/date, page/word/bullet,
  pay/travel/location, review-round, outreach and Workday rules deliberately.
- `pipeline/sources.yaml`, `pipeline/scoring.yaml`, and
  `workspace/job-search/profile/agent-config.yaml`: boards, enabled adapters,
  and paths. Sweep reads roles, places, and named boards from `profile.yaml`
  when it runs. It does not copy them into `sources.yaml`. Select fresh sources.
  No former company list survives.
  A board type the sweep does not fetch yet is a new file in
  `workspace/job-search/pipeline/adapters/`. The steps are in
  `skills/job-search-source/SKILL.md` under New ATS. That does not require a sweep.py edit.
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
from explicitly disabled settings BEFORE real use. `python3 setup/intake.py report`
lists the intake fields that are still missing and which task each one blocks.
`python3 setup/intake.py set` merges one answered field and records where it came
from and the date. A claim the user states is stored approved. An extracted claim
stays unconfirmed until confirm. It does not authorize send or submit. It is not a
full validator of every policy key. The same `report` command lists empty
policy settings, whether sources are configured, the synthetic-profile flag,
and a don't-publish warning when the profile is not marked synthetic.
`setup/onboarding_status.py` is gone. US-oriented enum and pay parsing
assumptions remain.

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
