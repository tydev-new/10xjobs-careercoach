#!/usr/bin/env python3
"""The fixture scan test — docs/design-plain-replies.md § 3 and § 5.

"The bar for the sweep: no old phrase remains in any assistant `text`
part or plan To do line ... tool outputs keep the scripts' real words."

Runs scan_voice.py's own scanner (never a second copy of its patterns)
over every apps/web/fixtures/*.json: each assistant `text` part, each
`plan` data-card's `props.items[].text`, and the `## To do` lines of any
seeded `files["plan.md"]`. Tool call inputs/outputs (tool-bash,
tool-write_file bodies for anything other than plan.md's To do lines,
checker/verdict/document card props) are NOT scanned — design § 1: "the
expanded 'ran ...' rows ... The UI owns those", and the scripts' own
output keeps its own words.

    python3 tests/test_fixture_voice.py
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
sys.path.insert(0, os.path.join(REPO, "tests", "always-on"))
import scan_voice as sv  # noqa: E402

FIXTURES_DIR = os.path.join(REPO, "apps", "web", "fixtures")

TODO_SECTION = re.compile(r"To do\n(.*?)(?:\n\n|\Z)", re.DOTALL)


def _todo_lines(plan_md_text):
    m = TODO_SECTION.search(plan_md_text)
    if not m:
        return []
    return [line for line in m.group(1).split("\n") if line.strip()]


def _reply_grade_texts(fixture):
    """(source_label, text) pairs this fixture's plain-voice bar covers."""
    out = []
    plan_md = (fixture.get("files") or {}).get("plan.md")
    if plan_md:
        for line in _todo_lines(plan_md):
            out.append(("files['plan.md'] To do", line))
    for mi, msg in enumerate(fixture.get("messages") or []):
        if msg.get("role") != "assistant":
            continue
        for part in msg.get("parts") or []:
            ptype = part.get("type")
            if ptype == "text" and part.get("text"):
                out.append((f"message {mi} text", part["text"]))
            elif ptype == "data-card":
                data = part.get("data") or {}
                if data.get("card") == "plan":
                    for item in (data.get("props") or {}).get("items") or []:
                        if item.get("text"):
                            out.append((f"message {mi} plan card item", item["text"]))
    return out


def _fixture_paths():
    return sorted(glob.glob(os.path.join(FIXTURES_DIR, "*.json")))


def test_no_hard_hit_in_any_web_fixture():
    paths = _fixture_paths()
    assert paths, f"no fixtures found under {FIXTURES_DIR}"
    failures = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            fixture = json.load(f)
        for source, text in _reply_grade_texts(fixture):
            hits = sv.scan_text(text, set(), source)
            hard = [h for h in hits if h.cls == sv.HARD]
            if hard:
                failures.append((os.path.basename(path), source, [(h.match, h.context) for h in hard]))
    assert not failures, "HARD hits in web fixtures:\n" + "\n".join(
        f"  {fn} :: {src} :: {hits}" for fn, src, hits in failures
    )


def test_every_fixture_has_at_least_one_reply_grade_text():
    # A fixture-scan test that silently scans zero strings proves nothing
    # (the environment-could-express-the-failure rule, CLAUDE.md/PROCESS
    # step 7). empty-first-run.json legitimately has no assistant turns
    # yet, so it is exempt.
    for path in _fixture_paths():
        with open(path, encoding="utf-8") as f:
            fixture = json.load(f)
        texts = _reply_grade_texts(fixture)
        if os.path.basename(path) == "empty-first-run.json":
            continue
        assert texts, f"{os.path.basename(path)} produced nothing to scan"
