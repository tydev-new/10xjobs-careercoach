"""The one config resolver: $JOBSEARCH_HOME / --config, default ./jobsearch-data; nothing points at a fixed path."""
import os, re, subprocess, sys
from pathlib import Path

from pipeline import home as H
from tests import helpers as T


def test_env_and_default(monkeypatch, tmp_path):
    monkeypatch.setenv("JOBSEARCH_HOME", str(tmp_path / "x"))
    assert H.home() == (tmp_path / "x").resolve()
    assert H.path("jobs_db") == (tmp_path / "x" / "jobs.db").resolve()
    monkeypatch.delenv("JOBSEARCH_HOME")
    monkeypatch.chdir(tmp_path)
    assert H.home() == (tmp_path / "jobsearch-data").resolve()


def test_agent_config_overrides_paths(home):
    cfg = (home / "profile" / "agent-config.yaml").read_text().replace("jobs_db: jobs.db", "jobs_db: data/my.db")
    (home / "profile" / "agent-config.yaml").write_text(cfg)
    assert H.path("jobs_db") == home / "data" / "my.db"
    assert H.path("rubric") == H.PKG_ROOT / "apply" / "rubric" / "apply-rubric.md"


def test_cli_config_flag_and_paths(home, tmp_path):
    r = subprocess.run([sys.executable, str(T.CLI), "--config", str(home), "paths"], capture_output=True, text=True,
                       env={k: v for k, v in os.environ.items() if k != "JOBSEARCH_HOME"}, cwd=str(tmp_path))
    assert r.returncode == 0 and f"home: {home}" in r.stdout
    r = T.cli(home, "tools", check=True)
    assert "build-package" in r.stdout and "submit-gate" in r.stdout


def test_every_tool_has_help(home):
    from jobsearch import TOOLS
    for name in TOOLS:
        if name in ("export-csv", "claims", "config"):
            continue                       # these act immediately rather than parse --help
        r = T.cli(home, name, "--help")
        assert r.returncode == 0, f"{name}: {r.stderr[-400:]}"


# a hardcoded absolute data path (a home folder, a mounted workspace, a container root) instead of the resolver
ABS_PATH = re.compile(r"""["'](?:/(?:home|Users|workspace|root|mnt|data)\b|[A-Z]:\\\\)""")


def test_no_fixed_paths_or_path_hacks_in_code():
    bad = []
    for p in T.ROOT.rglob("*.py"):
        if "tests" in p.parts:
            continue
        t = p.read_text()
        bad += [f"{p.relative_to(T.ROOT)}: {m.group(0)}" for m in ABS_PATH.finditer(t)]
        bad += [f"{p.relative_to(T.ROOT)}: {n}" for n in ("sys.path.insert", "sys.path.append") if n in t]
    assert not bad, bad
