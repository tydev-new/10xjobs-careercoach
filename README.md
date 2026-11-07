# Portable job-search kit

Skills and tools for sourcing roles, scoring them, and preparing application packages. This public tree ships with synthetic examples only. It does not include a real candidate profile, an approval to apply, or permission to send email.

This branch replaces the previous working tree. Git history is preserved and was not rewritten or scrubbed. Anything committed before this replacement remains reachable from older commits.

## What you can run

Nine skills: source, evaluate, apply, evidence summary, coach, outreach, hiring-manager idea email, storybank, and interview.

Retained tooling includes the sourcing adapters and SQLite ledger, scoring, base-resume routing, package build, deterministic precheck, combined independent review, finalization, and the submission-readiness gate. Scope and intentional omissions are in [CAPABILITIES.md](CAPABILITIES.md). The command list is [workspace/job-apps/rework/PIPELINE.md](workspace/job-apps/rework/PIPELINE.md).

## Install and onboarding

Python 3.10+ and Poppler (`pdfinfo`, `pdftotext`). Follow [INSTALL.md](INSTALL.md), then complete onboarding only in a private copy. The checklist is [CONFIGURATION.md](CONFIGURATION.md).

```sh
python3 setup/bootstrap.py /absolute/path/to/new-private-kit
export JOBBI_ROOT=/absolute/path/to/new-private-kit
python3 "$JOBBI_ROOT/workspace/job-apps/lib/agent_config.py"
python3 "$JOBBI_ROOT/setup/onboarding_status.py"
```

`JOBBI_ROOT` is the root of that private copy. Configured paths use `${JOBBI_ROOT}`. Do not point it at this public checkout after you add real profile data.

## Approvals

Replace the synthetic `candidate.yaml`, `claims.yaml`, and base resumes with facts the current user has approved. Choose policy, criteria, sources, and standing answers explicitly. Nothing in this tree is an inherited authorization, standing demographic answer, target list, or schedule.

`tools/submit_gate.py` reports readiness only. It is not permission to submit. Submission stays browser-only and needs the current user's explicit go naming the roles. Upload only the files the gate prints. Use approved standing answers. Do not invent facts or credentials.

Outreach and hiring-manager notes are drafts. Sending requires the current user to approve the person, the channel, and the exact text. This tree does not submit applications, send mail, create external drafts, or install a routine.

## Examples

Bundled identity, claims, and base resumes are labelled synthetic: Alex Example, Example Workshop, and the years 2097–2099. They are not renamed career facts. Eval postings and the ten HTTP fixtures are fictional parser fixtures, not captured vacancies and not a target list.

## Tests

From a machine with the install dependencies:

```sh
bash setup/run_offline_tests.sh
```

What that run covers, and what it does not, is in [TESTING.md](TESTING.md). On this public tree, `workspace/job-apps/tools/run_all_checks.sh` is still expected to fail: the private sourcing case set is not included, and `examples --check` has no accepted baseline. That failure is the gate working. Do not remove it, and do not commit a baseline to turn the aggregate green.

## License

[LICENSE](LICENSE) is this repository's MIT license, Copyright (c) 2026 10xjobs.co, kept verbatim. [NOTICE.md](NOTICE.md) is the provenance note. Dependencies are not vendored and keep their own licenses. This tree does not name a new copyright holder.

## Publication boundary

Do not commit an onboarded copy, a database, a PDF, contacts, stories, or test logs. `.gitignore` is not a privacy guarantee. `setup/bootstrap.py` copies only the hashed paths in `DISTRIBUTION.json` and refuses extra files and symlinks. It is not a scrubber. `python3 setup/privacy_scan.py --public` is a heuristic tripwire, not proof that the tree is anonymous or ready for production use.
