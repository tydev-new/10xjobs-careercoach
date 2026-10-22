"""Shared test helpers: a fictional data folder, fictional packages, step-6 records and lens reviews."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "config.example"
CLI = ROOT / "jobsearch.py"
BATCH = "2026-01-05"
COMPANY, TITLE, URL = "Acme Robotics", "Senior Platform Engineer", "https://jobs.ashbyhq.com/acme-robotics/11111111-2222-3333-4444-555555555555"

JD = """# Acme Robotics: Senior Platform Engineer

Acme Robotics builds warehouse robots. We are hiring a Senior Platform Engineer to own the platform our robot fleet
software runs on.

What you will do:
- Run production services on Kubernetes and keep them healthy.
- Make deploys fast and boring for every product team.
- Lead incident response and improve alerting.

What we need:
- Kubernetes in production
- CI/CD pipelines
- Observability: tracing and dashboards
- Python or Go
- Nice to have: Rust
"""

COVER_BULLETS = [
    {"text": "Platform. Built the internal Kubernetes platform that runs 30 production services.", "claims": ["nw.platform"]},
    {"text": "Delivery. Cut deployment time from 2 hours to 10 minutes with a shared CI/CD pipeline.", "claims": ["nw.deploy"]},
    {"text": "Reliability. Reduced paging incidents by 40% by rebuilding the on-call rotation and alerting.", "claims": ["nw.oncall"]},
]
OBS_EDIT = {"ctx_before": ["- Reliability. Reduced paging incidents by 40% by rebuilding the on-call rotation and alerting."],
            "old": ["- Safe migrations. Migrated 12 services from virtual machines to containers with no customer downtime."],
            "new": ["- Observability. Introduced tracing and dashboards used by every backend team."],
            "claims": ["ct.observability"]}


def make_home(dst):
    dst = Path(dst)
    shutil.copytree(EXAMPLE, dst)
    shutil.copy(dst / "sources.example.yaml", dst / "sources.yaml")
    return dst


def activate(h):
    """point in-process module state at data folder h (paths that modules computed at import)."""
    os.environ["JOBSEARCH_HOME"] = str(h)
    from pipeline import jobsdb as J
    J.configure()
    from apply.lib import claims as CL
    CL._load.cache_clear()


def env_for(h, **extra):
    e = dict(os.environ, JOBSEARCH_HOME=str(h))
    e.pop("STAMP_REVIEW_DB", None); e.pop("APPLY_RUN_ID", None)
    e.update({k: str(v) for k, v in extra.items()})
    return e


def cli(h, *args, check=False, timeout=300, **extra_env):
    r = subprocess.run([sys.executable, str(CLI), "--config", str(h), *map(str, args)], capture_output=True, text=True,
                       env=env_for(h, **extra_env), cwd=str(h), timeout=timeout)
    if check:
        assert r.returncode == 0, f"{args}: exit {r.returncode}\n{r.stdout}\n{r.stderr}"
    return r


def pkg_dir(h, name="ic-acme-robotics", batch=BATCH):
    return Path(h) / "packages" / batch / name


def spec_package(h, name="ic-acme-robotics", base="ic-builder", company=COMPANY, title=TITLE, url=URL, edits=None,
                 bullets=None, jd=JD, scope_line="ic"):
    """init a package with build-package --init, then fill in a claim-cited edit and cover. Returns the folder."""
    p = pkg_dir(h, name)
    cli(h, "build-package", p, "--init", base, "--company", company, "--title", title, "--url", url, check=True)
    spec = yaml.safe_load((p / "package.yaml").read_text())
    spec["resume"]["edits"] = [OBS_EDIT] if edits is None else edits
    spec["cover"].update(date="January 5, 2026",
                         opening=[f"I build the platform layer that lets product teams ship safely, which is the core of this role at {company}."],
                         bullets=COVER_BULLETS if bullets is None else bullets,
                         closing=[f"I would welcome the chance to talk about the platform roadmap at {company}."])
    (p / "package.yaml").write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True, width=200))
    if jd is not None:
        (p / "jd.md").write_text(jd)
    (p / "README.md").write_text(f"# {name}\n\nClaims scope: {scope_line}\n")
    (p / "company-research.md").write_text(f"# {company}\n\nFictional company used in tests.\n")
    return p


def built_package(h, name="ic-acme-robotics", run_id="build-test-1", **kw):
    p = spec_package(h, name, **kw)
    cli(h, "build-package", p, "--write", "--run-id", run_id, check=True)
    return p


def step6(job_id, company=COMPANY, title=TITLE, url=URL, gaps=("Rust",), blockers=()):
    return {"schema": "step6-v1", "job_id": job_id, "company": company, "title": title, "url": url,
            "scored_at": "2026-01-05T08:00:00-08:00", "scored_with": "two-way-v1", "base": "ic-builder",
            "analysis_md": f"jd-analysis/job-{job_id}-acme.md", "want": "pass", "want_reasons": ["remote US", "IC platform lane"],
            "dealbreakers": [], "win": "high",
            "must_haves": [{"need": "Kubernetes in production", "proof": "nw.platform: 30 production services"},
                           {"need": "CI/CD pipelines", "proof": "nw.deploy"},
                           {"need": "observability", "proof": "ct.observability"},
                           {"need": "Rust", "proof": None}],
            "gaps": list(gaps), "blockers": list(blockers), "reason": "Strong platform match; Rust is only a nice-to-have.",
            "remote_check": "remote-us", "call": "Strong"}


def seed_job(h, pkg, status="Packaged", url=URL, gaps=("Rust",), blockers=(), title=TITLE):
    """a jobs row linked to the package, with its step-6 record on disk. Returns the job id."""
    from pipeline import jobsdb as J
    activate(h)
    c = J.connect()
    jid = J.insert_job(c, company=COMPANY, title=title, source="ats:ashby", url=url, lane="IC builder", location="Remote, US")
    rel = f"jd-analysis/job-{jid}-acme.md"
    (Path(h) / "jd-analysis").mkdir(exist_ok=True)
    (Path(h) / rel).write_text("# step 6\n")
    (Path(h) / rel).with_suffix(".json").write_text(json.dumps(step6(jid, title=title, url=url, gaps=gaps, blockers=blockers), indent=1))
    c.execute("UPDATE jobs SET package_path=?, analysis_path=?, want='pass', win='high', fit='Strong', scored_with='two-way-v1' WHERE id=?",
              (str(Path(pkg).resolve()), rel, jid))
    if status != "To Review":
        J.set_status(c, jid, status, by="test")
    c.commit(); c.close()
    return jid


LENSES = ["hiring_manager", "age_signal_claims", "recruiter", "ats"]


def write_lenses(pkg, verdicts=None, run_suffix="rev1", cover=True, gap_handling=None, rubric_version=None, ids=None, **per_lens):
    """write 4 schema-valid lens files for pkg against its current files."""
    from apply.lib import reviews as RV
    pkg = Path(pkg)
    hashes = RV.file_hashes(pkg)
    if not cover:
        hashes.pop("cover.txt", None)
    rv = rubric_version or RV.live_rubric()
    verdicts = verdicts or {}
    (pkg / "reviews").mkdir(exist_ok=True)
    for lens in LENSES:
        v = verdicts.get(lens, "PASS")
        docs = [{"doc": "resume", "verdict": v, "summary": f"{lens} checked the resume against the step-6 record."}]
        if cover:
            docs.append({"doc": "cover", "verdict": "PASS", "summary": f"{lens} checked the cover; nothing to fix."})
        d = {"schema": "lens-review-v1", "lens": lens, "package": pkg.name,
             "reviewer_run_id": (ids or {}).get(lens, f"{lens}-{run_suffix}"), "rubric_version": rv,
             "reviewed_at": "2026-01-05T10:00:00-08:00", "reviewed_files_sha256": hashes,
             "inputs": ["resume-native.md", "cover.txt", "jd.md", "step-6 JSON", "apply-rubric.md", "claims.yaml"], "round": 1,
             "verdict": max([x["verdict"] for x in docs], key={"PASS": 0, "REVISE": 1, "FAIL": 2}.get), "docs": docs,
             "findings": [{"doc": "resume", "severity": "note" if v == "PASS" else "revise",
                           "finding": f"{lens}: reviewed the resume line by line", "evidence": "resume-native.md SUMMARY"}]}
        if lens == "hiring_manager":
            d.update(top_rejection_reason="No Rust experience", answered=True)
        if lens == "ats":
            d["keywords"] = [{"term": "Kubernetes", "aliases": ["k8s"]}, {"term": "CI/CD", "aliases": ["continuous delivery"]},
                             {"term": "observability", "aliases": ["tracing"]}, {"term": "Python", "aliases": []}]
        if lens == "age_signal_claims":
            d["gap_handling"] = gap_handling if gap_handling is not None else [
                {"item": "Rust", "kind": "gap", "handling": "omitted", "terms": ["Rust"], "reason": "no Rust claim; left out of resume and cover"}]
        d.update(per_lens.get(lens, {}))
        (pkg / "reviews" / f"{lens}.json").write_text(json.dumps(d, indent=1))
    return pkg / "reviews"


def finalized_package(h, name="ic-acme-robotics", status="Packaged", **kw):
    """built, linked to a job with a step-6 record, 4 passing lenses, finalized. Returns (pkg, job_id)."""
    p = built_package(h, name, **kw)
    jid = seed_job(h, p, status=status)
    write_lenses(p)
    r = cli(h, "finalize-review", p)
    assert r.returncode == 0, r.stdout + r.stderr
    return p, jid
