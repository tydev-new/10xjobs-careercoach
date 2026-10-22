import json

from tests import helpers as T


def test_queue_shows_lens_status_and_next(home):
    p = T.built_package(home)
    T.seed_job(home, p)
    rows = json.loads(T.cli(home, "review-queue", "--batch", T.BATCH, "--json", check=True).stdout)
    assert [r["name"] for r in rows] == [p.name] and rows[0]["next"] == "lens reviews"
    assert set(rows[0]["lenses"].values()) == {"missing"}
    T.write_lenses(p)
    rows = json.loads(T.cli(home, "review-queue", "--date", T.BATCH, "--json", check=True).stdout)
    assert rows[0]["next"] == "finalize"
    T.cli(home, "finalize-review", p, check=True)
    assert json.loads(T.cli(home, "review-queue", "--batch", T.BATCH, "--json", check=True).stdout) == []
    rows = json.loads(T.cli(home, "review-queue", "--batch", T.BATCH, "--json", "--all", check=True).stdout)
    assert rows[0]["review"] == "finalized" and rows[0]["stamp"].startswith("PASS")


def test_hashes_and_inputs(home):
    p = T.built_package(home)
    T.seed_job(home, p)
    h = json.loads(T.cli(home, "review-queue", "--hashes", p, check=True).stdout)
    assert set(h["reviewed_files_sha256"]) == {"resume-native.md", "cover.txt"} and h["builder_runs"] == ["build-test-1"]
    i = json.loads(T.cli(home, "review-queue", "--inputs", p, check=True).stdout)
    assert any(f.endswith(".json") and "jd-analysis" in f for f in i["files"]), "the step-6 JSON is an input"
    assert any(f.endswith("reviewer-brief.md") for f in i["files"]) and any(f.endswith("claims.yaml") for f in i["files"])
    assert all("jobsearch.py" in c for c in i["tool_outputs"])


def test_builder_run_flagged(home):
    p = T.built_package(home)
    T.write_lenses(p, ids={l: ("build-test-1" if l == "ats" else f"r-{l}") for l in T.LENSES})
    rows = json.loads(T.cli(home, "review-queue", "--batch", T.BATCH, "--json", check=True).stdout)
    assert "BUILDER-RUN" in rows[0]["lenses"]["ats"] and rows[0]["next"] == "lens reviews"
