# JORDAN PARK

Portland, OR | jordan.park.eng@example.com | 503.555.0198
linkedin.com/in/jordanparkeng

## Summary

- Staff-track backend engineer functioning as the team's reliability owner: service architecture, on-call process, and the migration off a monolith.
- **Led the service extraction — architecture, rollout, on-call:** drove the split of a Django monolith into four services, wrote the rollout plan (dark launch, shadow traffic, staged cutover) and the on-call runbook that came out of it.
- **Owns the incident process — postmortems, the review board:** started the blameless postmortem template the org still uses; sits on the review board that decides which incidents need a follow-up ticket versus a policy change.
- **Deep Go, solid Python and Postgres:** rewrote the hot path of the pricing service in Go, cutting p99 latency from 800ms to 120ms; still ships Python for the internal tooling the team depends on.
- **Mentors and hires:** built the take-home exercise the team now uses for backend hiring; mentored two engineers through their first on-call rotation.
- Retail (Fernbank Goods), logistics (Corvid Logistics) and healthcare (Meridian Health) domain experience, plus a short stint building internal LLM tooling (LangChain) for support-ticket triage.

## Professional Experience

### Fernbank Goods — Staff Software Engineer (Backend)
**2021 - Present | Portland, OR**

- Led the extraction of the checkout and inventory services from the core Django monolith, using a dark-launch and shadow-traffic rollout to avoid a big-bang cutover.
- Wrote the on-call runbook and the escalation policy adopted org-wide after the extraction shipped.
- Rewrote the pricing service's hot path in Go, cutting p99 latency from 800ms to 120ms under peak holiday load.
- Started a blameless postmortem template now required for every SEV-1 and SEV-2 incident.
- Sit on the incident review board that decides whether a postmortem needs a follow-up ticket or a policy change.
- Mentored two engineers through their first on-call rotation, including one who is now the rotation's primary.
- Built the take-home coding exercise the backend team still uses for hiring, replacing a whiteboard round candidates consistently disliked.
- Ran the quarterly architecture review that surfaced the monolith's database as the next bottleneck, ahead of the incident that would otherwise have forced the same conversation.
- Wrote the capacity-planning doc the org still uses ahead of every major sale event, cutting the number of last-minute scaling fire drills to zero this year.

### Corvid Logistics — Senior Software Engineer
**2018 - 2021 | Seattle, WA**

- Built the route-optimization service's caching layer, cutting average dispatch latency by half during peak.
- Migrated the team's deploy pipeline from a manual SSH process to a CI/CD pipeline with automatic rollback on failed health checks.
- Investigated and fixed a data-consistency bug between the dispatch service and the billing service that had gone unnoticed for months.
- Introduced structured logging across the dispatch stack, cutting the average incident triage time from 40 minutes to under 10.
- Paired with the data team to design the event schema the billing service still consumes today, avoiding a second migration when billing later moved off the monolith.

### Meridian Health — Software Engineer
**2015 - 2018 | Seattle, WA**

- Built the internal scheduling tool used by every clinic in the network, replacing a shared spreadsheet.
- Wrote the first integration test suite for the scheduling service, catching two regressions before release that manual QA had missed both times.
- Owned the on-call rotation for the scheduling service during its first year in production, including its first two SEV-1 incidents.

## Earlier Experience

- Junior Developer, Alderly Systems (2013 - 2015)

## Education

- BS Computer Science, University of Washington

## Skills

Go, Python, Postgres, Kafka, Docker, Kubernetes, Terraform, gRPC, Redis, GitHub Actions
