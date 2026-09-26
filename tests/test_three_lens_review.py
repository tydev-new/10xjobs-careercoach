#!/usr/bin/env python3
"""Independent review of 9842d81 — the three-lens panel, the ASCII-arrow
FAIL and the search_jargon rule — tests derived from the spec
(docs/design-apply-three-lens.md §§ 3-5 and the § 7 test plan, owner
rulings § 8), not from the code.

    python3 tests/test_three_lens_review.py  (or via tests/run.py)
"""
import os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "apply", "scripts"))
sys.path.insert(0, os.path.join(ROOT, "skills", "outreach", "scripts"))
sys.path.insert(0, os.path.join(ROOT, "skills", "profile", "scripts"))
import check_materials as cm  # noqa: E402
import check_messages as cmsg  # noqa: E402
import check_files as cf  # noqa: E402

CM_PY = os.path.join(ROOT, "skills", "apply", "scripts", "check_materials.py")
CM_JS = os.path.join(ROOT, "packages", "checkers", "src", "check-materials.mjs")
MSG_PY = os.path.join(ROOT, "skills", "outreach", "scripts", "check_messages.py")
CF_PY = os.path.join(ROOT, "skills", "profile", "scripts", "check_files.py")

# § 4, the message, verbatim.
SPEC_MSG = ('arrow/scaffolding chain "{m}" — write transitions in words '
            '("from 80% to under 1%"); symbol arrows garble in ATS parsers')


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


def flat(s):
    return " ".join(s.split())


def shared(text):
    out = []
    cm._shared(text, out.append)
    return out


def chain_fails(results):
    return [m for lvl, m in results if lvl == "FAIL" and "arrow/scaffolding chain" in m]


# ---- check_materials: the ASCII-arrow FAIL (§ 4) ---------------------------

def test_ascii_arrow_message_is_the_spec_message_word_for_word():
    for form in ("->", "-->", "<-", "<->", "=>", "==>", "<=>"):
        f = chain_fails(shared(f"Growth went 80{form}90 this quarter."))
        assert f == [SPEC_MSG.format(m=form)], (form, f)


def test_only_the_first_ascii_arrow_is_reported():
    f = chain_fails(shared("Went a=>b, then c->d, then e<-f."))
    assert f == [SPEC_MSG.format(m="=>")], f


def test_unicode_and_ascii_arrows_fail_twice_unicode_first():
    res = [m for lvl, m in shared("Cut cost 80%→<1%, then 80->90.") if lvl == "FAIL"]
    arrows = [m for m in res if m.startswith("arrow/scaffolding")]
    assert len(arrows) == 2, res
    assert arrows[0].startswith('arrow/scaffolding glyph "→"'), arrows
    assert arrows[1] == SPEC_MSG.format(m="->"), arrows


def test_comparisons_and_gt_chains_are_not_arrows():
    # § 4: "It does not match <=, >=, <, or > alone." A > B > C is the
    # recruiter lens's job ("symbol chains the checker cannot see").
    for text in ("Kept p99 x <= 5 ms.", "Uptime >= 99.9%.", "x<==5 held.",
                 "Moved work intake > triage > fix.", "a < - b", "List<T> and Map<K,V>.",
                 "Used <br/> once.", "A -- > B"):
        assert not chain_fails(shared(text)), text


def test_each_form_fails_in_a_resume_not_only_a_letter():
    for form in ("->", "<-", "=>", "<=>"):
        r = "# Alex Chen\n\n## Summary\n\n- Moved deploys weekly" + form + "daily.\n"
        assert chain_fails(cm.check_resume(r)), form


def test_exempt_spans_are_replaced_by_a_space_so_neighbours_never_glue():
    # § 4: "replaced with one space before scanning".
    for text in ("Split -`x`> apart.", "Split -<!-- c -->> apart.", "Split =`x`> apart."):
        assert not chain_fails(shared(text)), text


def test_multiline_comment_and_language_fence_are_exempt():
    for text in ("<!-- note\na->b\nstill internal -->\nBody.",
                 "```python\nf = a->b\n```\nBody.",
                 "```\nx => y\n```\nBody."):
        assert not chain_fails(shared(text)), text


def test_text_after_an_exempt_span_is_still_scanned():
    for text in ("<!-- x --> then a->b", "`x` then a->b", "```\nx\n```\nthen a->b",
                 "https://example.com/p then a->b"):
        assert chain_fails(shared(text)), text


def test_claim_rules_section_is_stripped_before_the_ascii_scan():
    r = ("# Alex Chen\n\n## Summary\n\n- Platform leader.\n\n"
         "## Claim rules\n\n- never write a->b transitions\n")
    assert not chain_fails(cm.check_resume(r))


def test_cli_exits_1_and_prints_the_message_on_an_ascii_arrow():
    with tempfile.TemporaryDirectory() as ws:
        p = os.path.join(ws, "resume.md")
        open(p, "w", encoding="utf-8").write(
            "# Alex Chen\n\n## Summary\n\n- Moved deploys weekly->daily.\n")
        r = subprocess.run([sys.executable, CM_PY, "--workspace", ws, "--resume", p],
                           capture_output=True, text=True)
        assert r.returncode == 1, r.stdout
        assert "[FAIL] " + SPEC_MSG.format(m="->") in r.stdout, r.stdout


def test_opener_fail_names_one_summary_not_case_plus_checklist():
    # § 4: "(case + checklist)" becomes "ONE Summary" in both files.
    r = "# A\n\n## Summary\n\n- x.\n\n## Highlights\n\n- y.\n"
    f = [m for lvl, m in cm.check_resume(r) if lvl == "FAIL" and "two opening sections" in m]
    assert f and "allows ONE Summary, never Summary + a highlights band" in f[0], f
    for path in (CM_PY, CM_JS):
        assert "case + checklist" not in open(path, encoding="utf-8").read(), path


# ---- the Summary shape (ruling 1) passes the mechanical floor ----------------

def test_a_seven_bullet_mandate_first_summary_passes_every_fail_rung():
    r = ("# Alex Chen\n\n*Platform engineering leader — reliability at scale*\n\n## Summary\n\n"
         "- Platform engineering leader who keeps a payments platform available through 10x growth.\n"
         "- **8+ years in SRE:** yes — Northwind Labs on-call lead since 2021.\n"
         "- Cut incident response time from 4 hours to 40 minutes across 12 services.\n"
         "- Built the on-call rotation from zero to a 6-person bench.\n"
         "- Moved deploys from weekly to daily with zero customer-facing rollbacks.\n"
         "- Reduced cloud spend 30% by retiring two legacy clusters.\n"
         "- Ran the incident review program for 40 engineers.\n\n"
         "## Experience\n\n### Northwind Labs — Platform Lead\n\n- Led the reliability program.\n")
    f = [m for lvl, m in cm.check_resume(r) if lvl == "FAIL"]
    assert f == [], f


# ---- source-text parity of the pattern (§ 4, § 7 item 6) --------------------

def _py_regex(path, name):
    m = re.search(name + r'\s*=\s*re\.compile\(r"(.+?)"(?:, re\.S)?\)', open(path, encoding="utf-8").read())
    assert m, (path, name)
    return m.group(1)


def test_ascii_arrows_has_the_same_source_text_in_all_three_checkers():
    spec = "<=+>|<-+>?|-+>|=+>"
    assert _py_regex(CM_PY, "ASCII_ARROWS") == spec
    assert _py_regex(MSG_PY, "ASCII_ARROWS") == spec
    js = re.search(r"const ASCII_ARROWS = /(.+?)/;", open(CM_JS, encoding="utf-8").read())
    assert js and js.group(1) == spec, js and js.group(1)


def test_exempt_spans_are_the_same_alternation_in_both_python_checkers():
    a = _py_regex(CM_PY, "ARROW_EXEMPT_SPANS")
    b = _py_regex(MSG_PY, "EXEMPT_SPANS")
    assert a == b == r"```.*?```|<!--.*?-->|`[^`\n]*`|https?://\S+", (a, b)


# ---- check_messages: the same pattern, scoped to drafts (§ 4) -------------

def _run_messages(contacts_body):
    with tempfile.TemporaryDirectory() as ws:
        p = os.path.join(ws, "acme.md")
        open(p, "w", encoding="utf-8").write(contacts_body)
        r = subprocess.run([sys.executable, MSG_PY, "--workspace", ws, "--contacts", p],
                           capture_output=True, text=True)
        return r.returncode, r.stdout


def test_messages_cli_fails_an_ascii_arrow_in_a_draft_with_the_spec_message():
    code, out = _run_messages("# Acme\n\n> Grew signal 80%->90% this quarter across teams.\n")
    assert code == 1, out
    assert '[FAIL] draft 1: arrow chain "->" — write it in words' in out, out


def test_messages_arrow_outside_a_draft_is_not_a_fail():
    # FAIL scope is the drafts only — notes around them may quote anything.
    code, out = _run_messages("# Acme\n\nNotes: pipeline a->b.\n\n> Hi Sam, one question about the role.\n")
    assert code == 0, out
    assert "arrow chain" not in out, out


def test_messages_exempt_spans_pass_in_a_draft():
    for draft in ("> See https://example.com/a->b for the writeup.\n",
                  "> The flag `a->b` stays internal.\n"):
        code, out = _run_messages("# Acme\n\n" + draft)
        assert "arrow chain" not in out, (draft, out)


def test_messages_unicode_and_ascii_arrows_both_fail():
    code, out = _run_messages("# Acme\n\n> Cut cost 80%→<1%, then 80->90 all year.\n")
    assert code == 1
    assert 'arrow glyph "→"' in out and 'arrow chain "->"' in out, out
    assert out.index('arrow glyph') < out.index('arrow chain'), out


# ---- language-check.md rule 6 (§ 4, § 7 item 7) ------------------------------

def test_language_check_has_six_rules_and_search_jargon_in_the_enum():
    text = read("skills", "profile", "references", "language-check.md")
    rules = re.findall(r"^(\d+)\. \*\*`(\w+)`\*\*", text, re.M)
    assert [n for n, _ in rules] == ["1", "2", "3", "4", "5", "6"], rules
    assert rules[5][1] == "search_jargon", rules
    enum = re.search(r'"rule": "([^"]+)"', text).group(1).split("|")
    assert set(enum) == {r for _, r in rules}, enum


def test_search_jargon_rule_is_bounded_exempted_and_fix_before_delivery():
    text = flat(read("skills", "profile", "references", "language-check.md"))
    body = text.split("6. **`search_jargon`**", 1)[1].split("## What is not a violation", 1)[0]
    assert "The echo exemption applies: the posting's own word, quoted, is not jargon." in body
    assert "*Severity: fix-before-delivery.*" in body
    for example in ('"investable stretch"', '"Track B"', '"shown-but-unnamed"', '"6/7 held"',
                    '"ATS-Ready"', '"recruiter Revise"'):
        assert example in body, example
    assert ("One rule, `search_jargon`, takes its list from this file, not from a "
            "candidate file, so it is always checkable.") in text


# ---- schema: the new scored cell and the waiver form (§ 1, § 7 item 4) ------

def test_application_with_lens_verdicts_waiver_and_void_row_is_silent():
    app = ("# Acme — Staff Engineer\n\n## Rounds\n\n" + cf.ROUNDS_HEADER + "\n|---|---|---|---|---|\n"
           "| 2026-09-25 | 1 | self | 5/7 held; unmet: page target, Skills line; panel not run | first draft |\n"
           "| 2026-09-25 | 2 | panel | 6/7 held; unmet: page target; ats Pass · recruiter Revise · "
           "hiring manager Pass | cut two Earlier roles |\n\n"
           "## Panel\n\n" + cf.PANEL_HEADER + "\n|---|---|---|\n"
           "| ats | Kubernetes missing from prose | fixed |\n"
           "| recruiter | title stack confusing in the header | discarded — candidate waived in chat 2026-09-25 |\n"
           "| hiring manager | VOID — returned prose twice | — |\n")
    with tempfile.TemporaryDirectory() as ws:
        os.makedirs(os.path.join(ws, "applications"))
        p = os.path.join(ws, "applications", "acme-staff.md")
        open(p, "w", encoding="utf-8").write(app)
        assert cf.check_table(p, cf.ROUNDS_HEADER, cf.ROUNDS_ENUMS) == []
        assert cf.check_table(p, cf.PANEL_HEADER, cf.PANEL_ENUMS) == []
        r = subprocess.run([sys.executable, CF_PY, "--workspace", ws,
                            "--skills", os.path.join(ROOT, "skills")],
                           capture_output=True, text=True)
        assert "applications/acme-staff.md" not in r.stdout, r.stdout


# ---- prose: what § 7 items 3 and 5 grep for ----------------------------------

def test_fail_if_lives_only_in_apply_eval():
    hits = []
    for dp, _, fs in os.walk(os.path.join(ROOT, "skills")):
        for f in fs:
            if f.endswith(".md") and "fail if" in open(os.path.join(dp, f), encoding="utf-8").read().lower():
                hits.append(os.path.relpath(os.path.join(dp, f), ROOT))
    assert hits == [os.path.join("skills", "apply", "references", "eval.md")], hits


def test_retired_summary_wording_is_gone_from_apply():
    for f in ("SKILL.md", "references/patterns.md", "references/eval.md", "references/schema.md"):
        text = flat(read("skills", "apply", f))
        for gone in ("3-line", "Three or four lines", "≤50 words", "4–6 bullets", "case + checklist"):
            assert gone not in text, (f, gone)


def test_submit_gate_has_no_latex_or_glyph_arrows():
    text = read("skills", "apply", "SKILL.md")
    assert "rightarrow" not in text and "→" not in text


def test_t10_verbatim_panel_carries_ruling_3_word_for_word():
    text = flat(read("tests", "always-on", "cases", "t10-verbatim-panel", "expected.md"))
    assert ("At most ONE incorporation round: panel findings applied once, checker re-run, "
            "the lenses short of Pass re-checked once, done.") in text
    assert ("A persona review beyond that one re-check (owner 2026-09-25: the author must not "
            "grade its own fixes, so the failing lenses re-check once; nothing further).") in text
    assert "A second wave of persona reviews" not in text


if __name__ == "__main__":
    failed = 0
    for name in sorted(n for n in list(globals()) if n.startswith("test_")):
        try:
            globals()[name]()
            print("PASS", name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL", name, repr(e)[:300])
    sys.exit(1 if failed else 0)
