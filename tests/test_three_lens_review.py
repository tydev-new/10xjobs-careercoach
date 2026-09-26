#!/usr/bin/env python3
"""Independent review of 9842d81 and its round 2 (a0abefe) — the three-lens
panel, the ASCII-arrow FAIL and the search_jargon rule — tests derived from
the spec (docs/design-apply-three-lens.md as amended in 86089d7: §§ 1-5,
the § 7 test plan, owner rulings 1-7 in § 8), not from the code.

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

# § 4 (round 2), the message, verbatim — the same text in all three checkers.
SPEC_MSG = ('arrow chain "{m}" — write it in words ("from 80% to under 1%"); '
            'a reader sees an arrow as notes, not a sentence')
# § 4 (round 2): the Python exempt alternation, same source text in both
# Python checkers; the double-backtick branch before the single-backtick one.
SPEC_EXEMPT = r"```.*?```|~~~.*?~~~|<!--.*?-->|``[^\n]*?``|`[^`\n]*`|https?://\S+"


def read(*p):
    return open(os.path.join(ROOT, *p), encoding="utf-8").read()


def flat(s):
    return " ".join(s.split())


def shared(text):
    out = []
    cm._shared(text, out.append)
    return out


def chain_fails(results):
    return [m for lvl, m in results if lvl == "FAIL" and m.startswith('arrow chain "')]


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
    arrows = [m for m in res if m.startswith(("arrow/scaffolding glyph", 'arrow chain "'))]
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
    assert a == b == SPEC_EXEMPT, (a, b)


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
    # § 4 (round 2): "draft <i>: " followed by the same message as check_materials.
    assert "[FAIL] draft 1: " + SPEC_MSG.format(m="->") + "\n" in out, out


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


# ==== round 2 (a0abefe), derived from the amended design (86089d7) ===========

# ---- § 4: the new exempt spans, and what they must NOT swallow --------------

def test_tilde_fence_and_double_backtick_span_are_exempt():
    for text in ("~~~\na->b\n~~~\nBody.",
                 "~~~text\nx => y\n~~~\nBody.",
                 "Documented ``a->b`` in the wiki.",
                 "Documented `` a`->b `` in the wiki.",   # a backtick inside a double span
                 "Documented ``a->b``, ``c=>d`` twice."):
        assert not chain_fails(shared(text)), text


def test_text_after_a_double_backtick_span_or_tilde_fence_is_still_scanned():
    for text in ("Documented ``a->b`` here, then wrote c=>d.",
                 "~~~\nx\n~~~\nthen a->b",
                 "``x`` then `y` then a->b"):
        assert chain_fails(shared(text)), text


def test_a_double_backtick_span_never_crosses_a_line():
    # "(one line)": an unclosed pair on one line must not swallow the next.
    assert chain_fails(shared("Opened `` here, a->b\nand closed `` there."))


def test_unclosed_fences_and_comments_exempt_nothing():
    for text in ("~~~\na->b", "```\na->b", "<!-- note a->b"):
        assert chain_fails(shared(text)), text


def test_accepted_limits_are_pinned_as_the_design_table_states():
    # § 4 "Known limits": accepted false FAILs stay FAILs, the accepted miss stays a miss.
    for text in ("Held at <-5 C in the field.", "    a->b", "See example.com/a->b today."):
        assert chain_fails(shared(text)), text
    assert not chain_fails(shared("See https://x.com/p->next today."))


def test_url_exemption_is_scheme_bound_and_case_sensitive():
    assert not chain_fails(shared("See http://x.com/a->b today."))
    assert chain_fails(shared("See HTTPS://x.com/a->b today."))


def test_js_url_branch_uses_py_not_s_and_no_bare_js_s():
    # § 4 / § 7 item 6: never a bare JS \\S in the URL branch.
    js = open(CM_JS, encoding="utf-8").read()
    line = next(l for l in js.splitlines() if l.startswith("const ARROW_EXEMPT_SPANS"))
    assert line == ('const ARROW_EXEMPT_SPANS = new RegExp("```[\\\\s\\\\S]*?```|~~~[\\\\s\\\\S]*?~~~|'
                    '<!--[\\\\s\\\\S]*?-->|``[^\\\\n]*?``|`[^`\\\\n]*`|https?://" + PY_NOT_S + "+", "g");'), line
    assert re.search(r'import \{[^}]*\bPY_NOT_S\b[^}]*\} from "\./py-text\.mjs"', js), \
        "PY_NOT_S must be imported from py-text.mjs"


def test_arrow_message_is_word_for_word_in_all_three_checkers():
    tail = '— write it in words ("from 80% to under 1%"); a reader sees an arrow as notes, not a sentence'
    # Python's two checkers are asserted at runtime (SPEC_MSG above); the JS
    # port's template literal carries the text on one line.
    assert ('add("FAIL", `arrow chain "${m[0]}" ' + tail + '`);') in open(CM_JS, encoding="utf-8").read()
    # "garble" survives only in the Unicode glyph message (and its receipt comment)
    for path in (CM_PY, MSG_PY, CM_JS):
        for ln in open(path, encoding="utf-8").read().splitlines():
            if "garble" in ln:
                assert "glyph" in ln or "arrows garble in ATS parsers and read as audit" in ln, (path, ln)


def test_arrow_chain_has_no_ats_claim_in_any_message():
    for form in ("->", "<=>"):
        for m in chain_fails(shared("a" + form + "b")):
            assert "ATS" not in m and "garble" not in m, m


def test_messages_new_spans_exempt_inside_a_draft():
    for draft in ("> Notes ``a->b`` stay internal.\n",
                  "> ~~~\n> a->b\n> ~~~\n> Thanks for the time.\n"):
        code, out = _run_messages("# Acme\n\n" + draft)
        assert "arrow chain" not in out, (draft, out)


def test_messages_unicode_glyph_message_is_unchanged():
    # § 4: "The Unicode glyph FAIL keeps its message unchanged in all three files."
    code, out = _run_messages("# Acme\n\n> Cut cost 80%→1% this year.\n")
    assert '[FAIL] draft 1: arrow glyph "→" — write it in words\n' in out, out


# ---- § 4: "the rest of the case goes too" ----------------------------------

def test_summary_prose_fail_carries_the_round_2_message():
    words = " ".join(["word"] * 51)
    r = "# Alex Chen\n\n## Summary\n\n" + words + "\n\n- Cut costs 30%.\n"
    f = [m for lvl, m in cm.check_resume(r) if lvl == "FAIL"]
    want = ("Summary opens with 51 words of prose (max 50) — the Summary is bullets "
            "(apply's patterns.md § The Summary); a recruiter reads 7-11s in an F-pattern "
            "and prose past ~2 lines is invisible")
    assert want in f, f
    # exactly 50 words is the budget, not over it
    r50 = "# Alex Chen\n\n## Summary\n\n" + " ".join(["word"] * 50) + "\n\n- Cut costs 30%.\n"
    assert not any(m.startswith("Summary opens with") for m in fails_of(cm.check_resume(r50)))


def fails_of(results):
    return [m for lvl, m in results if lvl == "FAIL"]


def test_repeated_number_warn_says_the_summary_not_the_case():
    r = "# A\n\n## Summary\n\n- Cut costs 30%.\n- Grew revenue 30%.\n"
    w = [m for lvl, m in cm.check_resume(r) if lvl == "WARN" and "repeated" in m]
    assert w and "the Summary carries each number once" in w[0] and "the case" not in w[0], w


def test_case_constant_is_renamed_in_both_files():
    assert hasattr(cm, "SUMMARY_PROSE_MAX_WORDS") and cm.SUMMARY_PROSE_MAX_WORDS == 50
    assert not hasattr(cm, "CASE_MAX_WORDS")
    js = open(CM_JS, encoding="utf-8").read()
    assert "const SUMMARY_PROSE_MAX_WORDS = 50;" in js and "CASE_MAX_WORDS" not in js


# ---- § 4: rule 6, bounded (static — the t15c measurement is unapproved spend) --

def _rule6():
    text = flat(read("skills", "profile", "references", "language-check.md"))
    return text.split("6. **`search_jargon`**", 1)[1].split("## What is not a violation", 1)[0]


def test_rule6_scope_names_the_sent_documents_and_excludes_story_files():
    body = _rule6()
    assert ("must not appear in a document that goes to an employer or a contact: the tailored "
            "résumé, the cover letter, application answers, and outreach drafts.") in body
    assert "A story file is the candidate's own record and is never sent, so this rule has no row for it." in body
    assert "in any wording" not in body, "round 1's unbounded phrase is back"


def test_rule6_describes_every_plain_english_probe_as_passing():
    body = _rule6()
    s = body.split("Ordinary English is never this rule's flag", 1)[1]
    for phrase in ('"a strong fit for this team"', '"at this stage"', '"on track"',
                   '"leads a team of 12"', '"my lane"', '"the decision to migrate"',
                   '"scored 96/100 in the customer survey"'):
        assert phrase in s.split("all pass.")[0], phrase
    assert "When a word could be either, it is English — pass it." in s
    assert "The echo exemption applies: the posting's own word, quoted, is not jargon." in s
    assert "*Severity: fix-before-delivery.*" in s


def test_rule6_lists_labels_in_their_label_shape():
    body = _rule6()
    for label in ('"Strong Fit"', '"Investable Stretch"', '"Long-Shot Stretch"', '"Weak Fit"',
                  '"Strong Fit — 82/100"', '"fit 82/100"', '"Track B"', '"To Review"',
                  '"6/7 held"', '"recruiter Revise"', '"ATS-Ready"', '"DECISION" in capitals'):
        assert label in body, label
    coined = body.split("terms Ten coined", 1)[1].split("Ordinary English", 1)[0]
    assert "in any capitalization" in coined
    for term in ('"investable stretch"', '"long-shot stretch"', '"shown-but-unnamed"',
                 '"band call"', '"spine role"', '"mandate sentence"'):
        assert term in coined, term


def test_rule6_names_only_labels_that_exist_elsewhere_in_skills():
    # § 7 item 7: no source-tier, no scout, no lane label, no Track A.
    body = _rule6()
    for gone in ("source-tier", "scout", "Track A", "Lane A", '"long shot"'):
        assert gone not in body, gone
    others = []
    for dp, _, fs in os.walk(os.path.join(ROOT, "skills")):
        for f in fs:
            if f != "language-check.md" and f.endswith((".md", ".py")):
                others.append(open(os.path.join(dp, f), encoding="utf-8").read().lower())
    blob = "\n".join(others)
    for label in ("strong fit", "investable stretch", "long-shot stretch", "weak fit", "track b",
                  "to review", "6/7 held", "recruiter revise", "ats-ready", "decision",
                  "shown-but-unnamed", "band call", "spine role", "mandate sentence"):
        assert label in blob, f"rule 6 names {label!r}, which no other skill file defines"


def test_consumers_of_rule6_are_wired():
    oe = flat(read("skills", "outreach", "references", "eval.md"))
    assert "aggregate year counts, arrow glyphs and ASCII arrow chains (code, comments, and URLs exempt), draft scoping" in oe
    assert "and `search_jargon` — Ten's own labels in a draft." in oe
    ae = flat(read("skills", "apply", "references", "eval.md"))
    assert "confirm-tier hazards," in ae and "— and `search_jargon`" in ae
    ap = flat(read("skills", "apply", "references", "patterns.md"))
    assert ("**No search jargon**: a document sent to an employer or a contact never carries Ten's own "
            "labels (a verdict tier, a track name, a round count); the language checker's "
            "`search_jargon` rule holds the list.") in ap


# ---- §§ 1-2: builder notes out, destination and exit match the lenses -------

def test_builder_notes_are_not_in_skill_files():
    for f in ("eval.md", "schema.md"):
        t = flat(read("skills", "apply", "references", f))
        for note in ("points here", "The existing form stands", "leave the lens lists",
                     "already accepts", "unchanged."):
            assert note not in t, (f, note)


def test_panel_paragraph_is_the_target_text():
    t = flat(read("skills", "apply", "references", "eval.md"))
    assert ("Each lens returns a verdict with a one-line why, then its `lens · finding` rows. "
            "**Fail**: a Fail-if holds. **Revise**: none holds, but a finding must be fixed first. "
            "**Pass**: neither. Every finding ends `fixed` or `discarded — why`; an empty table is "
            "VOID. In `## Panel` the lenses are named `ats`, `recruiter`, and `hiring manager`.") in t


def test_judged_destination_names_the_lens_verdicts_and_the_recheck():
    t = flat(read("skills", "apply", "references", "eval.md"))
    assert ("`N/M held; unmet: …` and the three lens verdicts in `## Rounds`, the earlier rows read "
            "first; the exit said M/M with every lens at Pass, budget, or the ceiling.") in t
    assert ("**The panel was three subagents, one per lens**, each fed the SOURCE documents (raw JD, "
            "decode, company brief), never the author's summary; one incorporation round; the checker "
            "re-ran; the lenses short of Pass re-checked once (t10-verbatim-panel).") in t


def test_apply_skill_goal_row_budget_and_round_match_section_2():
    t = read("skills", "apply", "SKILL.md")
    assert ("| Deterministic checks pass, and all three panel lenses Pass or are waived in chat, "
            "before the package is called ready |") in t
    assert ("- **Budget:** Two self-passes; one review incorporation round, which re-checks only "
            "the lenses short of Pass, once. Said up front.") in t
    assert "Run the checks and the three-lens panel (`references/eval.md § The panel — three lenses`)." in t
    assert "multi-persona" not in t.lower()


# ---- § 3 / § 3a: the Summary has ONE home; ruling 7 points there -------------

def test_summary_rule_has_one_home_in_apply_patterns():
    t = read("skills", "apply", "references", "patterns.md")
    assert t.count("4–7") == 1 and t.count("Bullet 1 is the mandate sentence") == 1
    home = t.split("### The Summary", 1)[1].split("\n### ", 1)[0]
    assert "4–7" in home and "Bullet 1 is the mandate sentence" in home
    ft = flat(t)
    assert ("3. **`## Summary` — the single opening section; its shape is § The Summary.** Never a "
            "second list (\"Core Expertise\", \"Highlights\") that re-says it.") in ft


def test_ruling_7_base_resume_summary_lives_in_apply_home():
    home = flat(read("skills", "apply", "references", "patterns.md").split("### The Summary", 1)[1]
                .split("\n### ", 1)[0])
    assert ("**The base résumé's Summary has the same shape.** With no posting, bullet 1's mandate is "
            "the target in `criteria.md § Targets`, and the proofs lead with what that target's "
            "postings screen for hardest. Tailoring then reorders and swaps the base's bullets "
            "instead of rewriting a paragraph.") in home
    assert "This form answers one posting, so the base résumé never takes it." in home


def test_ruling_7_profile_points_to_apply_and_states_no_shape_of_its_own():
    sk = flat(read("skills", "profile", "SKILL.md"))
    assert ("Read the base resolution ladder (`references/schema.md`), the audit "
            "(`references/eval.md`), reader craft (`references/patterns.md`), and the Summary's "
            "shape (`../apply/references/patterns.md § The Summary`).") in sk
    pp = flat(read("skills", "profile", "references", "patterns.md"))
    assert ("(`../../apply/references/patterns.md § The Summary` turns those 7–11 seconds into the "
            "Summary's shape, for the base résumé too; `check_materials.py` FAILs more than 50 "
            "words of Summary prose.)") in pp
    pe = flat(read("skills", "profile", "references", "eval.md"))
    assert "the Summary's shape (`../../apply/references/patterns.md § The Summary`)" in pe
    for dp, _, fs in os.walk(os.path.join(ROOT, "skills", "profile")):
        for f in fs:
            if f.endswith(".md"):
                txt = open(os.path.join(dp, f), encoding="utf-8").read()
                assert "4–7" not in txt and "case budget" not in txt, f
    # the three pointers resolve to a real heading
    assert "### The Summary" in read("skills", "apply", "references", "patterns.md")


def test_receipts_record_ruling_6_as_a_named_exception():
    r = flat(read("docs", "receipts.md"))
    row = next(l for l in read("docs", "receipts.md").splitlines() if l.startswith("| ASCII arrow chains"))
    assert "None — a named exception to the earned-FAIL bar" in row and "ruling 6" in row, row
    assert "| Summary prose ≤50 words before its bullets (once called the case) |" in r


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
