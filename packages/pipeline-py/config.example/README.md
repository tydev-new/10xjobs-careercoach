# config.example: a fictional data folder

Everything here belongs to **Alex Example**, a made-up person at made-up employers (Northwind Systems, Contoso
Cloud, Fabrikam Labs) with an `example.com` email and a `555` phone number. Copy this folder to start your own:

    cp -r config.example jobsearch-data
    cp jobsearch-data/sources.example.yaml jobsearch-data/sources.yaml

then replace every file under `profile/` and `base-resumes/` with your own. Never commit your copy: it holds your
contact details, your claims and your job history. (`jobsearch-data/` is in `.gitignore`.)

| File | What it is |
|---|---|
| `profile/candidate.yaml` | name, contact lines, cover signature, form answers |
| `profile/claims.yaml` | the only source of facts: roles, approved claims with numbers and anchors, banned wording |
| `profile/criteria.md` | what you want: lanes, location, pay floor, dealbreakers (the scorer's WANT side) |
| `profile/agent-config.yaml` | lanes (package prefix -> base resume and claim scopes), review rounds, eval rules |
| `sources.example.yaml` | boards and searches for the sweep (copy to `sources.yaml`) |
| `scoring.yaml` | which base resume each lane is scored against |
| `base-resumes/<base>/resume-native.md` | your base resumes, one per lane; packages are edits against these |
| `base-resumes/_shared/*.md` | blocks shared across packages (e.g. selected work) |
| `base-resumes/routing.py` | optional: pick a base from a job title |
