"""Every test runs against a throwaway copy of config.example/ (the fictional persona). Nothing reads or writes a
real data folder: before any package module is imported, $JOBSEARCH_HOME points at a temp dir."""
import os
import tempfile
from pathlib import Path

import pytest

_SESSION_HOME = Path(tempfile.mkdtemp(prefix="jobsearch-test-session-"))
os.environ["JOBSEARCH_HOME"] = str(_SESSION_HOME)
for _k in ("STAMP_REVIEW_DB", "APPLY_RUN_ID", "JOB_SEARCH_EVAL_PRIVATE", "JOB_SEARCH_EVAL_RESULTS", "SWEEP_RECORD", "USAJOBS_API_KEY"):
    os.environ.pop(_k, None)

from tests import helpers as T  # noqa: E402


@pytest.fixture
def home(tmp_path, monkeypatch):
    """a fresh data folder copied from config.example/, active for in-process calls and for T.cli()."""
    h = T.make_home(tmp_path / "home")
    monkeypatch.setenv("JOBSEARCH_HOME", str(h))
    T.activate(h)
    yield h
    T.activate(_SESSION_HOME)
