"""ats_check accepts every keyword shape the skills produce, including the step-6 two-way-v1 record."""
import json

import pytest

from apply.tools import ats_check as A
from tests import helpers as T


def test_normalize_shapes():
    assert A.normalize_keywords(["Kubernetes|k8s", "CI/CD"]) == [{"term": "Kubernetes", "aliases": ["k8s"]}, {"term": "CI/CD", "aliases": []}]
    assert A.normalize_keywords({"keywords": [{"term": "Go", "aliases": ["golang"]}]}) == [{"term": "Go", "aliases": ["golang"]}]
    s6 = T.step6(1)
    assert [k["term"] for k in A.normalize_keywords(s6)] == [m["need"] for m in s6["must_haves"]]
    with pytest.raises(ValueError):
        A.normalize_keywords({"something": 1})
    with pytest.raises(ValueError):
        A.normalize_keywords([42])


def test_cli_accepts_step6_json(home, tmp_path):
    p = T.built_package(home)
    f = tmp_path / "step6.json"; f.write_text(json.dumps(T.step6(1)))
    r = T.cli(home, "ats-check", p, "--json-keywords", f, check=True)   # was a TypeError before the adapter
    out = json.loads(r.stdout)
    assert {k["term"] for k in out["keywords"]} >= {"Kubernetes in production", "Rust"}
    assert 0 <= out["coverage"] <= 1


def test_cli_bad_json_is_clear(home, tmp_path):
    p = T.built_package(home)
    f = tmp_path / "bad.json"; f.write_text(json.dumps({"x": 1}))
    r = T.cli(home, "ats-check", p, "--json-keywords", f)
    assert r.returncode != 0 and "ats_check:" in r.stderr


def test_jd_copy_run(home):
    p = T.built_package(home)
    out = A.compute(p, ["Kubernetes|k8s"])
    assert out["max_jd_copy_run"] < 8 and out["keywords"][0]["hit"]
