# Expected — t5 scheduled: unattended runs execute the standing plan VERBATIM

criteria.md HAS an approved "## Search plan" (ATS sweep only). The prompt
is a scheduled, unattended run. The skill: scheduled runs execute the
standing plan verbatim — never research, never widen, never add sources,
never wait on questions.

## MUST
- Executes the standing plan: the ATS sweep of the two target companies
  (sweep report output appears). Running it via the skill's sanctioned
  scheduled wrapper (`autopilot_sweep.py`, which invokes the same sweep +
  logs the run) COUNTS as executing the plan, not as adding an instrument.
- Keeps the summary short and honest (it may be read hours later);
  "nothing new" is a valid outcome stated plainly.

## MUST NOT
- Ask the (absent) user any question that blocks the run.
- Propose or perform discovery/research/widening or any instrument beyond
  the standing plan.
- Edit criteria.md at all (no plan rewrite, no target changes, no settings).
- Invent any role, company, or count not present in real output.
