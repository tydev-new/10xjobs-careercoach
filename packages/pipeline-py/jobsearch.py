#!/usr/bin/env python3
"""jobsearch.py: one entry point for every tool in this package.

  python3 jobsearch.py [--config DIR] <tool> [tool args...]
  python3 jobsearch.py tools            list the tools
  python3 jobsearch.py paths            print where each data file is read from

--config DIR points at the user's data folder (sets $JOBSEARCH_HOME). Default: $JOBSEARCH_HOME, else ./jobsearch-data.
Each tool is also runnable as a module from this folder, e.g. `python3 -m pipeline.find --help`.
"""
import os
import runpy
import sys

TOOLS = {
    # pipeline (search side: reads postings, writes only the jobs DB and notes)
    "sweep": "pipeline.sweep",
    "upsert": "pipeline.upsert",
    "find": "pipeline.find",
    "update-status": "pipeline.update_status",
    "score": "pipeline.score",
    "render": "pipeline.render",
    "export-csv": "pipeline.export_csv",
    "weekly-report": "pipeline.weekly_report",
    "evals": "pipeline.evals.run",
    "build-private-evals": "pipeline.evals.build_private",
    # apply (package side: builds and checks files; never submits or contacts anyone)
    "build-package": "apply.tools.build_package",
    "check-claims": "apply.tools.check_claims",
    "format-check": "apply.tools.format_check",
    "ats-check": "apply.tools.ats_check",
    "review-queue": "apply.tools.review_queue",
    "finalize-review": "apply.tools.finalize_review",
    "submit-gate": "apply.tools.submit_gate",
    "claims": "apply.lib.claims",
    "config": "apply.lib.agent_config",
}


def main(argv):
    if argv[:1] == ["--config"]:
        if len(argv) < 2:
            sys.exit("--config needs a folder")
        os.environ["JOBSEARCH_HOME"] = os.path.abspath(argv[1])
        argv = argv[2:]
    elif argv and argv[0].startswith("--config="):
        os.environ["JOBSEARCH_HOME"] = os.path.abspath(argv[0].split("=", 1)[1])
        argv = argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "tools":
        for k, v in TOOLS.items():
            print(f"{k:22s} {v}")
        return 0
    if argv[0] == "paths":
        from pipeline import home
        print(f"home: {home.home()}")
        for k, v in home.all_paths().items():
            print(f"  {k:16s} {v}")
        return 0
    mod = TOOLS.get(argv[0])
    if not mod:
        sys.exit(f"unknown tool {argv[0]!r}; run `jobsearch.py tools`")
    sys.argv = [f"jobsearch.py {argv[0]}"] + argv[1:]
    runpy.run_module(mod, run_name="__main__", alter_sys=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
