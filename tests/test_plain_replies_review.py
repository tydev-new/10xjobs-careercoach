#!/usr/bin/env python3
"""Independent review tests for docs/design-plain-replies.md (build b3b338b).

Derived from the DESIGN, not from the code. Each test names the design
section it holds the build to. Tests marked "RED until fixed" assert what
the design says where the build disagrees; the reviewer's hand-back names
each one with file:line.

Zero spend: judge_voice.sh is driven with a stub `claude` on PATH that
records its prompt and never touches the network.

    python3 tests/test_plain_replies_review.py
"""
import glob, json, os, re, shutil, stat, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
AO = os.path.join(REPO, "tests", "always-on")
sys.path.insert(0, AO)
import scan_voice as sv  # noqa: E402

DESIGN = os.path.join(REPO, "docs", "design-plain-replies.md")


def _read(*p):
    with open(os.path.join(REPO, *p), encoding="utf-8") as f:
        return f.read()


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def _target_block(starts_with):
    """A `>` target-text block from the design, joined and whitespace-normalised."""
    lines = [l.strip() for l in _read("docs", "design-plain-replies.md").splitlines()]
    idx = [i for i, l in enumerate(lines) if l.startswith("> " + starts_with)]
    assert idx, f"design has no target block starting {starts_with!r}"
    out, i = [], idx[0]
    while i < len(lines) and lines[i].startswith(">"):
        out.append(lines[i][1:].strip())
        i += 1
    return _norm(" ".join(out))


def _hits(text, cand=frozenset()):
    return [(h.cls, h.match) for h in sv.scan_text(text, set(cand), "reply")]


def _hard(text, cand=frozenset()):
    return [m for c, m in _hits(text, cand) if c == sv.HARD]


def _review(text, cand=frozenset()):
    return [m for c, m in _hits(text, cand) if c == sv.REVIEW]


# ---------------------------------------------------------------- § 2 target text


def test_tier0_paragraph_is_the_design_target_word_for_word():
    target = _target_block("Write every reply, and every line you put in `plan.md`")
    body = _read("skills", "profile", "templates", "workspace-CLAUDE.md")
    assert target in _norm(body)
    assert len(target.split()) == 91, len(target.split())
    # a second paragraph of § How you talk, not a new section
    how = body.split("## How you talk", 1)[1].split("\n## ", 1)[0]
    assert target in _norm(how)


def test_tier0_marker_is_v8():
    first = _read("skills", "profile", "templates", "workspace-CLAUDE.md").splitlines()[0]
    assert "guardrails v8" in first and "v7" not in first


def test_loop_discipline_decision_line():
    body = _norm(_read("skills", "profile", "templates", "workspace-CLAUDE.md"))
    assert "must stop and present the tradeoff to the candidate as a decision for them to make." in body
    assert "DECISION" not in body


def test_language_check_fallback_line():
    target = _target_block("Re-spawn the checker once.")
    assert target in _norm(_read("skills", "profile", "references", "language-check.md"))


def test_evaluate_summary_card_lines_without_outer_backticks_inside_the_fence():
    lines = _read("skills", "evaluate", "references", "schema.md").splitlines()
    heading = ("## [Company] — [Role]: [Verdict] ([score][, your <target name> target — its name as "
               "criteria.md's Targets section writes it, when criteria.md defines tracks])")
    last = "The full analysis: `jd-analysis/<file>` · the company notes: `company/<file>`. It's on your job list."
    hi, li = lines.index(heading), lines.index(last)
    fence_open = max(i for i, l in enumerate(lines[:hi]) if l.startswith("```"))
    fence_close = min(i for i, l in enumerate(lines) if i > li and l.startswith("```"))
    assert fence_open == hi - 1, "the heading is the fenced block's first line"
    assert fence_close == li + 1, "the closing line is the fenced block's last line"
    # only the reply's card changes; the analysis file's own heading (a
    # record, § 1 "what it does not bind") keeps its "Track X lens".
    assert "Track X" not in "\n".join(lines[fence_open:fence_close + 1])


def test_proposal_block_strings_both_runtimes():
    # J2 (docs/design-js-only.md § 2, § 6): one copy, the lib that both the
    # node command and the web dispatch import. Both hosts import it:
    assert 'from "./lib/proposal-block.mjs"' in _read("skills", "apply", "scripts", "proposal_block.mjs")
    assert "apply/scripts/lib/proposal-block.mjs" in _read("packages", "checkers", "src", "dispatch.mjs")
    for rel in (("skills", "apply", "scripts", "lib", "proposal-block.mjs"),):
        src = _read(*rel)
        assert "and the bullet's name or number to bring one back." in src, rel
        assert "Say \\\"keep\\\"" in src or 'Say "keep"' in src, rel
        assert "or \\\"leave it out\\\" to move any of these:" in src or 'or "leave it out" to move any of these:' in src, rel
        assert "keep <bullet>" not in src and '"Summary" / "Skills"' not in src, rel


def test_t6_and_t13_expectations_and_judge():
    t6 = _target_block("- Assign the role to track B and say so in the reply")
    assert t6 in _norm(_read("tests", "always-on", "cases", "t6-track-assignment", "expected.md"))
    t13 = _target_block("as a decision for the candidate to make")
    exp = _read("tests", "always-on", "cases", "t13-ceiling", "expected.md")
    assert _norm(exp).count(t13) == 2 and "DECISION" not in exp
    judge = _read("tests", "always-on", "judge_t13.sh")
    joined = re.sub(r'"\s*\n\s*echo "\s*', " ", judge)
    assert t13 in _norm(joined) and "DECISION" not in judge


def test_conditional_rows_untouched():
    # § 2 "Fixes that land only on a measured miss" — none may ship unmeasured.
    # J2: one copy (skills/apply/scripts/lib/check-materials.mjs, § 2); the
    # Python file and packages/checkers/src/ are gone.
    assert "✔ automatic checks clean" in _read("skills", "apply", "scripts", "lib", "check-materials.mjs")
    assert "A spend gate you opened earlier this chat" in _read("packages", "agent", "src", "coach.ts")
    assert "The only gate is spend" in _read("skills", "profile", "templates", "web-host-note.md")


# ---------------------------------------------------------------- § 3 the scanner


def test_urls_and_emails_are_not_scanned():
    for line in ["See https://jobs.acme.com/senior_data_analyst?ref=li_share for it.",
                 "Posting: [link](https://acme.com/careers/data_team).",
                 "Email jordan_lee@gmail.com when ready.",
                 "Reach them at recruiting+data_team@acme.co.uk."]:
        assert _hits(line) == [], (line, _hits(line))


def test_snake_case_inside_a_schemeless_url_or_path_is_never_hard():
    # RED until fixed. § 3: HARD is a snake_case token "outside a URL or
    # email"; REVIEW includes "a snake_case token inside a file name or
    # path". A scheme-less URL is both a URL and a path.
    for line in ["Your LinkedIn is linkedin.com/in/jordan_lee now.",
                 "Their team page is acme.com/data_team if you want it."]:
        assert _hard(line) == [], (line, _hits(line))


def test_py_files_hard_other_files_review():
    assert _hard("I ran render_resume.py on it.") == ["render_resume.py"]
    assert _hard("Open estimate_cost.py.", {"estimate_cost"}) == ["estimate_cost.py"]
    for line, name in [("I saved it as jordan_resume.pdf.", "jordan_resume.pdf"),
                       ("It's in applications/acme_senior_resume.md.", "applications/acme_senior_resume.md"),
                       ("Open base-resume.md to see it.", "base-resume.md"),
                       ("The printable version is resume.html.", "resume.html")]:
        assert _hard(line) == [] and name in _review(line), (line, _hits(line))


def test_script_and_field_names_hard():
    for tok in ["check_materials", "record_verdict", "estimate_cost", "fit_verdict", "jd_file"]:
        assert _hard(f"I ran {tok} for you.") == [tok]
        assert _hard(f"`{tok}` passed.") == [tok]


def test_gate_is_review_and_only_the_lowercase_word():
    assert _review("the spend gate is open") == ["gate"] and _hard("the spend gate is open") == []
    for line in ["Golden Gate Bridge", "I'll delegate the aggregate and navigate it.",
                 "an investigated lead"]:
        assert _hits(line) == [], (line, _hits(line))


def test_jd_is_review():
    assert _review("the JD says five years") == ["JD"]
    assert _hard("the JD says five years") == []


def test_track_letter_case_insensitive_only_for_track():
    # § 3: patterns are case-sensitive except `Track [A-Z]`.
    for line in ["more Track A roles", "track B roles", "TRACK B", "Track a roles"]:
        assert _hard(line), line
    for line in ["on track", "a strong fit for this team", "your track record"]:
        assert _hard(line) == [], line


def test_coined_words_hard_in_their_listed_case():
    for line in ["the mechanical check passed", "both pass the mechanical checks",
                 "the language check hasn't run", "It's in To Review.", "6/7 held",
                 "a DECISION for you", "ARTIFACT: the letter", "STATUS: done",
                 "TO-DO: send it", "shown-but-unnamed", "see § 2"]:
        assert _hard(line), line
    for line in ["the decision to migrate", "at this stage", "a to-do list",
                 "6 of the 7 standards held", "the status of your application",
                 "It's waiting for you to review it."]:
        assert _hard(line) == [], (line, _hits(line))


def test_candidate_tokens_downgrade_to_review_and_input_matters():
    line = "Your data_pipeline repo and @acme_eng handle."
    assert set(_hard(line)) == {"data_pipeline", "acme_eng"}
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "nested"))
        with open(os.path.join(d, "nested", "base-resume.md"), "w") as f:
            f.write("Built data_pipeline in Airflow.\n")
        with open(os.path.join(d, "prompt.md"), "w") as f:
            f.write("ping @acme_eng\n")
        toks = sv.collect_candidate_tokens([d])
        assert {"data_pipeline", "acme_eng"} <= toks
        assert _hard(line, toks) == []
        assert set(_review(line, toks)) == {"data_pipeline", "acme_eng"}
        # a candidate token never makes a script NAME.py safe (any *.py is HARD)
        assert _hard("see data_pipeline.py", toks) == ["data_pipeline.py"]
    finally:
        shutil.rmtree(d)


def test_cli_prints_tab_separated_hits_and_always_exits_zero():
    d = tempfile.mkdtemp()
    try:
        reply, plan, cand = (os.path.join(d, n) for n in ("reply.txt", "plan.txt", "cand"))
        os.makedirs(cand)
        with open(reply, "w") as f:
            f.write("Ping @acme_eng. check_materials ran.\n")
        with open(plan, "w") as f:
            f.write("* more Track A roles\n")
        with open(os.path.join(cand, "prompt.md"), "w") as f:
            f.write("my handle @acme_eng\n")
        cmd = [sys.executable, os.path.join(AO, "scan_voice.py"), "--reply", reply, "--plan-added", plan]
        r = subprocess.run(cmd, capture_output=True, text=True)
        rows = [l.split("\t") for l in r.stdout.splitlines()]
        assert r.returncode == 0
        assert ["HARD", "reply", "acme_eng"] == rows[0][:3]
        assert ["HARD", "plan-added", "Track A"] in [x[:3] for x in rows]
        r2 = subprocess.run(cmd + ["--candidate", cand], capture_output=True, text=True)
        rows2 = [l.split("\t")[:3] for l in r2.stdout.splitlines()]
        assert ["REVIEW", "reply", "acme_eng"] in rows2 and ["HARD", "reply", "check_materials"] in rows2
    finally:
        shutil.rmtree(d)


# ---------------------------------------------------------------- § 4 dump_tools --results


def _ev_asst(content, parent=None):
    return {"type": "assistant", "message": {"id": "msg_x", "type": "message", "role": "assistant",
            "content": content}, "parent_tool_use_id": parent, "session_id": "s"}


def _ev_user(content, parent=None):
    return {"type": "user", "message": {"role": "user", "content": content},
            "parent_tool_use_id": parent, "session_id": "s"}


def _capture(path, cm_out):
    """A stream-json capture in Claude Code's message schema: results out of
    order, two parallel calls answered in one user event, an error result,
    list-shaped content, a sidechain Bash inside a Task, and an unanswered call."""
    ev = [
        {"type": "system", "subtype": "init", "session_id": "s"},
        _ev_asst([{"type": "text", "text": "Checking."}]),
        _ev_asst([{"type": "tool_use", "id": "toolu_A", "name": "Bash", "input": {"command": "python3 check_materials.py"}}]),
        _ev_asst([{"type": "tool_use", "id": "toolu_B", "name": "Bash", "input": {"command": "cat plan.md"}},
                  {"type": "tool_use", "id": "toolu_C", "name": "Bash", "input": {"command": "false_cmd"}}]),
        _ev_user([{"tool_use_id": "toolu_C", "type": "tool_result", "content": "Exit code 127", "is_error": True},
                  {"tool_use_id": "toolu_B", "type": "tool_result", "content": "PLAN BODY", "is_error": False}]),
        _ev_user([{"tool_use_id": "toolu_A", "type": "tool_result", "content": cm_out, "is_error": False}]),
        _ev_asst([{"type": "tool_use", "id": "toolu_T", "name": "Task", "input": {"description": "wording check", "prompt": "check", "subagent_type": "general-purpose"}}]),
        _ev_asst([{"type": "tool_use", "id": "toolu_S", "name": "Bash", "input": {"command": "wc -w l.md"}}], parent="toolu_T"),
        _ev_user([{"tool_use_id": "toolu_S", "type": "tool_result", "content": [{"type": "text", "text": "127 l.md"}]}], parent="toolu_T"),
        _ev_user([{"tool_use_id": "toolu_T", "type": "tool_result", "content": [{"type": "text", "text": "{\"rows\":[]}"}]}]),
        _ev_asst([{"type": "tool_use", "id": "toolu_Z", "name": "Bash", "input": {"command": "sleep 999"}}]),
        {"type": "result", "subtype": "success", "result": "done", "session_id": "s"},
    ]
    with open(path, "w") as f:
        for e in ev:
            f.write(json.dumps(e) + "\n")


def test_dump_tools_copies_byte_identical():
    assert _read("tests", "always-on", "dump_tools.py") == _read("kit", "harness", "dump_tools.py")


def test_dump_tools_results_pairs_each_bash_call_with_its_own_result():
    d = tempfile.mkdtemp()
    try:
        cm = _read("tests", "always-on", "cases", "t21-plain-report", "_materials_check.before.txt")
        cap = os.path.join(d, "x.turn1.stream.json")
        _capture(cap, cm)
        run = lambda *a: subprocess.run([sys.executable, os.path.join(AO, "dump_tools.py"), *a],
                                        capture_output=True, text=True).stdout.splitlines()
        with_r = run("--results", cap)[1:]
        calls = run(cap)[1:]
        assert not any("RESULT:" in l for l in calls), "calls-only output must not change"
        assert [l for l in with_r if "RESULT:" not in l] == calls
        pairs = {}
        for i, l in enumerate(with_r):
            if l.startswith("  RESULT: "):
                pairs[with_r[i - 1]] = l
        assert "[WARN] letter is 127 words" in pairs["TOOL Bash: 'python3 check_materials.py'"]
        assert pairs["TOOL Bash: 'cat plan.md'"] == "  RESULT: 'PLAN BODY'"
        assert pairs["TOOL Bash: 'false_cmd'"] == "  RESULT: 'Exit code 127'"
        assert pairs["TOOL Bash: 'wc -w l.md'"] == "  RESULT: '127 l.md'"
        assert "TOOL Bash: 'sleep 999'" not in pairs
    finally:
        shutil.rmtree(d)


# ---------------------------------------------------------------- § 4 judge_voice.sh


def _stub_claude(bindir, promptdir):
    os.makedirs(bindir, exist_ok=True)
    p = os.path.join(bindir, "claude")
    with open(p, "w") as f:
        f.write("#!/bin/bash\n"
                "# test stub: records the prompt, never calls a model\n"
                'n=$(ls "$STUB_DIR" | wc -l | tr -d " ")\n'
                'printf "%s" "$2" > "$STUB_DIR/prompt-$n.txt"\n'
                'echo \'{"leaks":[],"facts":[],"verdict":"pass"}\'\n')
    os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)


def _judge_voice_on(names, stream_suffix):
    d = tempfile.mkdtemp()
    res, bindir, prompts = (os.path.join(d, n) for n in ("res", "bin", "prompts"))
    os.makedirs(res)
    os.makedirs(prompts)
    _stub_claude(bindir, prompts)
    cm = _read("tests", "always-on", "cases", "t21-plain-report", "_materials_check.before.txt")
    for n in names:
        _capture(os.path.join(res, n + stream_suffix(n)), cm)
        with open(os.path.join(res, n + ".md"), "w") as f:
            f.write("Both pass the automatic checks.\n")
        os.makedirs(os.path.join(res, n + "-ws"))
    env = dict(os.environ, PATH=bindir + ":" + os.environ["PATH"], STUB_DIR=prompts, PAR="1",
               JUDGE_MODEL="claude-opus-4-1-20250805", JUDGE_SKILLS_DIR=os.path.join(REPO, "skills"))
    r = subprocess.run(["bash", os.path.join(AO, "judge_voice.sh"), res], capture_output=True, text=True, env=env)
    verdicts = sorted(os.path.basename(p)[: -len(".voice-verdict.json")]
                      for p in glob.glob(os.path.join(res, "*.voice-verdict.json")))
    texts = [open(p).read() for p in sorted(glob.glob(os.path.join(prompts, "*.txt")))]
    shutil.rmtree(d)
    return r, verdicts, texts


def _runner_suffix(name):
    # run_t6.sh writes "$out.stream.json"; the others "$out.turn1.stream.json".
    return ".stream.json" if name.startswith("t6-") else ".turn1.stream.json"


def test_judge_voice_feeds_the_scripts_own_output_for_t21():
    r, verdicts, texts = _judge_voice_on(["t21-plain-report-t1"], _runner_suffix)
    assert r.returncode == 0, r.stderr
    assert verdicts == ["t21-plain-report-t1"]
    assert "[WARN] letter is 127 words" in texts[0]
    assert "Plain words drop nothing" in texts[0], "the judge sees the target text"


def test_judge_voice_grades_every_case_in_the_design_s_table():
    # RED until fixed. § 4: judge_voice.sh "grades any results dir", over
    # t4-intake, t6-track-assignment, t6-duplicate-row, t8-stage-sensing,
    # t8-honesty-thresholds, t10-over-budget, t10-verbatim-panel,
    # t13-ceiling, t21-plain-report. Results named the way each runner
    # names them (run_t4.sh:29 "$cond-t$trial"; run_t6.sh:53 and
    # run_t8.sh:46 "$case_name-$cond-t$trial"; the rest "$case_name-t$trial").
    names = ["full-t1", "t6-track-assignment-full-t1", "t6-duplicate-row-full-t1",
             "t8-stage-sensing-full-t1", "t8-honesty-thresholds-full-t1",
             "t10-over-budget-t1", "t10-verbatim-panel-t1", "t13-ceiling-t1", "t21-plain-report-t1"]
    r, verdicts, texts = _judge_voice_on(names, _runner_suffix)
    assert "SKIP" not in r.stdout, r.stdout
    assert len(verdicts) == len(names), verdicts
    # and every graded case saw the scripts' own output, t6's included
    assert all("[WARN] letter is 127 words" in t for t in texts)


# ---------------------------------------------------------------- § 4 t21-plain-report


def test_t21_planted_files_trip_exactly_the_letter_band_warn():
    case = os.path.join(AO, "cases", "t21-plain-report")
    d = tempfile.mkdtemp()
    try:
        for f in ("plan.md", "criteria.md", "jobs.md", "base-resume.md"):
            shutil.copy(os.path.join(case, f), d)
        shutil.copytree(os.path.join(case, "applications"), os.path.join(d, "applications"))
        R = glob.glob(os.path.join(d, "applications", "*-resume.md"))[0]
        L = glob.glob(os.path.join(d, "applications", "*cover-letter*.md"))[0]
        r = subprocess.run(["node", os.path.join(REPO, "skills", "apply", "scripts", "check_materials.mjs"),
                            "--workspace", d, "--resume", R, "--letter", L], capture_output=True, text=True)
        out = r.stdout + r.stderr
        flagged = [l for l in out.splitlines() if "[WARN]" in l or "[FAIL]" in l]
        assert flagged == ["  [WARN] letter is 127 words — patterns.md § Cover letter wants 250-400"], flagged
        assert "RESUME acme-senior-data-analyst-resume.md: pass (0 fail, 0 warn)" in out
        assert out == open(os.path.join(case, "_materials_check.before.txt")).read(), "the captured proof is the real output"
    finally:
        shutil.rmtree(d)


def test_t21_case_matches_the_design():
    case = os.path.join(AO, "cases", "t21-plain-report")
    assert _read("tests", "always-on", "cases", "t21-plain-report", "prompt.md").strip() == \
        "Is the Acme application ready to send? What's left for me?"
    assert "- Track: A" in _read("tests", "always-on", "cases", "t21-plain-report", "jobs.md")
    plan = _read("tests", "always-on", "cases", "t21-plain-report", "plan.md")
    for old in ("mechanical checks are clean; the language check has not run",
                "I have no submit tool yet", "more Track A roles"):
        assert old in plan, old
    app = _read("tests", "always-on", "cases", "t21-plain-report", "applications",
                "acme-senior-data-analyst-application.md")
    assert "language" not in app.lower(), "no record that the wording check ran"
    runner = _read("tests", "always-on", "run_t21.sh")
    for skill in ("profile", "apply", "evaluate", "coach"):
        assert f'"$RUNNER_SKILLS_DIR/{skill}"' in runner, skill
    assert "_materials_check.txt" in runner
    assert "t21-plain-report" in _read("tests", "always-on", "README.md")
    for sh in ("run_t21.sh", "judge_voice.sh"):
        assert subprocess.run(["bash", "-n", os.path.join(AO, sh)]).returncode == 0, sh


# ---------------------------------------------------------------- § 5 fixtures


def _fixture(name):
    with open(os.path.join(REPO, "apps", "web", "fixtures", name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def _assistant_texts(fx):
    return [p["text"] for m in fx["messages"] if m["role"] == "assistant"
            for p in m.get("parts", []) if p.get("type") == "text"]


def test_design_given_fixture_copy_is_word_for_word():
    cf = _assistant_texts(_fixture("checker-failure"))
    assert ("The automatic checks caught a bullet I'd reworded from your base résumé without saying so. "
            "I'm fixing it myself, so there's nothing to look at yet.") in cf
    assert ("Clean now: the automatic checks pass with nothing failed and nothing flagged, and the bullet is "
            "back to your base résumé's own wording. Ready when you are.") in cf
    gm = _assistant_texts(_fixture("gate-moment"))
    assert "That wasn't a yes, so the request above is still waiting and nothing has started." in gm
    assert ("5 roles come to $0.35–$0.48. That's under the amount that needs your yes, so I can start those "
            "without asking. The request for all 6 is still open above if you want them all: say yes to it, "
            "or tell me to go ahead with 5.") in gm
    assert "Starting on the 6 roles now, as your yes approved. Say so if you'd rather I stopped at 5." in gm
    ol = " ".join(_assistant_texts(_fixture("over-limit-error")))
    assert "under the amount that needs your yes, so I'm starting now" in ol
    assert "an Investable Stretch, and it's on your job list now" in ol


def test_no_old_phrase_remains_in_assistant_text():
    old = ["recorded in jobs.md", "queued in plan.md", "gate above", "no gate", "spend threshold",
           "recorded as Investable Stretch", "render_resume", "check_materials", "mechanical check",
           "language check", "Track A", "keep <bullet>"]
    for name in ("mvp-journey", "checker-failure", "gate-moment", "over-limit-error"):
        text = " ".join(_assistant_texts(_fixture(name)))
        for phrase in old:
            assert phrase not in text, (name, phrase)


def test_mvp_journey_plan_lines_identical_in_all_three_places():
    fx = _fixture("mvp-journey")

    def todo(md):
        m = re.search(r"To do\n(.*?)(?:\n\n|\Z)", md, re.S)
        return [re.sub(r"^- ", "", l) for l in m.group(1).split("\n") if l.strip()]

    files = todo(fx["files"]["plan.md"])
    msg = fx["messages"][9]["parts"]
    write = todo(next(p for p in msg if p["type"] == "tool-write_file")["input"]["content"])
    card = [i["text"] for i in next(p for p in msg if p["type"] == "data-card")["data"]["props"]["items"]]
    assert files == write == card and len(files) == 3
    assert "I can't submit applications for you yet" in files[1]
    assert "`applications/acme-staff-pm-cover-letter.md`" in files[0], "the backticked path stays (parsePlanTodo ref)"


def test_mvp_journey_proposal_block_output_is_the_real_script_output():
    fx = _fixture("mvp-journey")
    d = tempfile.mkdtemp()
    try:
        for k, v in fx["files"].items():
            p = os.path.join(d, k)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(v)
        parts = [p for m in fx["messages"] for p in m.get("parts", [])
                 if p.get("type") == "tool-bash" and "proposal_block" in p["input"]["command"]]
        assert len(parts) == 1
        cmd = parts[0]["input"]["command"].split()
        assert cmd[:2] == ["node", "apply/scripts/proposal_block.mjs"]
        r = subprocess.run(["node", os.path.join(REPO, "skills", "apply", "scripts", "proposal_block.mjs"), *cmd[2:]],
                           capture_output=True, text=True, cwd=d)
        assert r.stdout.rstrip("\n") == parts[0]["output"]["stdout"].rstrip("\n")
        assert r.returncode == parts[0]["output"]["exitCode"]
    finally:
        shutil.rmtree(d)


def test_before_txt_is_the_five_design_quotes_verbatim_and_tagged():
    # § 3 as amended (lead, 2026-09-26): the five § 1 quotes, verbatim,
    # each tagged with its expected class.
    design = _read("docs", "design-plain-replies.md")
    sec1 = design.split("## 1.", 1)[1].split("A candidate has to decode", 1)[0]
    quotes = [_norm(q) for q in re.findall(r'"([^"]+)"', sec1)]
    tagged = [l.split("\t", 1) for l in _read("tests", "fixtures", "voice", "before.txt").splitlines() if l.strip()]
    assert [_norm(t) for _, t in tagged] == quotes, (quotes, tagged)
    for cls, text in tagged:
        got = {c for c, _ in _hits(text)}
        assert cls in got and (cls == "HARD" or "HARD" not in got), (cls, text, _hits(text))


def test_mvp_journey_text_takes_the_designer_target_copy():
    # § 5: "The assistant text takes the designer's T.target copy" (branch
    # worktree-agent-a7b2db3c5da9cc5ae, direction-c-home.html, `T.target`
    # m2/m4/m6/m10), typographic apostrophes normalised.
    texts = [t.replace("’", "'") for t in _assistant_texts(_fixture("mvp-journey"))]
    for want in [
        "Got it — I've read your résumé and saved your experience as your base résumé. Before I tailor anything, "
        "I need three things: the roles you're aiming for, how much time you can give this each day, and when "
        "you'd like an offer by. Got a few minutes now?",
        "Saved. Goal: an offer by Nov 30, with 45 minutes a day. Paste a job posting whenever you've got one, "
        "or I can start finding roles for you.",
        "It's a Strong Fit, and it's on your job list now. Want me to tailor a résumé and cover letter for this one?",
        "That's your plan: send the letter, submit once you have, and tell me if you want more roles found.",
    ]:
        assert want in texts, want


def test_dump_tools_results_pairs_the_subagent_result_too():
    # M5 fix: the wording check runs as a subagent; its own result must
    # reach the voice judge (UNVERIFIED against a live capture).
    d = tempfile.mkdtemp()
    try:
        cap = os.path.join(d, "x.turn1.stream.json")
        _capture(cap, "x")
        out = subprocess.run([sys.executable, os.path.join(AO, "dump_tools.py"), "--results", cap],
                             capture_output=True, text=True).stdout.splitlines()
        i = next(k for k, l in enumerate(out) if l.startswith("TOOL Task(subagent)"))
        assert out[i + 1].startswith("  PROMPT: ") and out[i + 2] == "  RESULT: '{\"rows\":[]}'", out[i:i + 3]
    finally:
        shutil.rmtree(d)


def test_judge_voice_exits_nonzero_when_any_reply_is_unresolved():
    r, verdicts, _ = _judge_voice_on(["t21-plain-report-t1", "mystery-case-t1"], _runner_suffix)
    assert r.returncode != 0 and "mystery-case-t1" in r.stderr, (r.returncode, r.stderr)
    assert verdicts == ["t21-plain-report-t1"]
    r, verdicts, texts = _judge_voice_on(["bare-t1", "guardrails-t1", "full-t1"], _runner_suffix)
    assert r.returncode == 0 and len(verdicts) == 3
    assert all("Expected — t4" in t for t in texts), "run_t4.sh's condition-only names resolve to t4-intake"


def test_verdict_card_track_suffix_removed():
    assert "(Track " not in _read("apps", "web", "src", "components", "Cards.tsx")


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", name)
            except Exception as e:  # noqa: BLE001
                failed += 1
                print("FAIL", name, "-", repr(e)[:300])
    sys.exit(1 if failed else 0)
