#!/usr/bin/env python3
"precheck.py: every deterministic package check in one pass.\nCode checks deterministic facts; the reviewer judges meaning. No prior approval is imported.\nFAIL (hard facts only): configured banned terms, date/age policy and approved fixed facts,\nincluding current titles/dates, contact block and any configured selected-work ordering; form completeness (required\nquestions answered, no [USER]/TBD placeholder on a REQUIRED line, cover only when required, standing screening\nanswers), files / PDF parse / configured page limit / em-dash-arrow-emoji typography, 8+ word JD copy, claims vs claims.yaml,\nexplicit gap plans, the package linked to its job record (jobs.package_path), builder runs known and the reviewer\nnot a builder run. WARN (style; the reviewer accepts or fixes each with a one-line reason in combined.json\nprecheck_warns, keyed by the W-xxxxxx id): bullet / sentence word counts, SUMMARY bullet count and lead shape,\nacronym runs, repeats (incl. duplicate sentences), keyword coverage, 6-7 word JD copy, configured terminology warnings,\ncover greeting / length, default-plan gap overclaims, optional-field placeholders.\nRun it after build_package.py --write and before the one combined review. The reviewer reads its report and judges\nonly what code can't (fit, story, tone, claim truthfulness vs the facts).\n\n  python3 precheck.py <pkg> [<pkg> ...] [--json] [--no-write] [--strict]\n\nReuses the existing checkers (no second copy of their rules):\n  format   format_check.check: sections + order, header separators, configured year/graduation policy\n  shape    lint_3lens_package.lint_package: files, PDFs parse, configured page limit, configured SUMMARY bullet count, configured word caps,\n           em-dash / arrows / emoji, leaked internal text (its SECT and year checks are left to format_check)\n  claims   check_claims.check_package: every number vs claims.yaml, banned / conditional / scoped wording, PDF sync\n  terms    tools/precheck_terms.yaml: the user's configured banned terms and scoped wording rules;\n           configured career-length wording and technology restrictions,\n           wording (N years, decades, seasoned, since 200x, Former VP), legacy tech in the headline / SUMMARY\n  repeat   duplicate sentences and repeated phrases, configured metric pairs or metric markers (WARN)\n           sentence more than once (WARN)\n  read     sentences and bullets over configured word thresholds,\n           runs of 3+ acronyms (the 2-6 word SUMMARY lead rule was retired 2026-11-05) (all WARN: the reviewer decides)\n  jd       ats_check: longest run copied from jd.md (8+ FAIL, 6-7 WARN); keyword coverage of package.yaml\n           ats_keywords (WARN under 85%; no list = skipped, the reviewer's keyword list is what finalize records)\n  gaps     gap_check on package.yaml gap_plan (FAIL) or the default plan from the step-6 record (named-tech\n           OVERCLAIM hits are WARN unless --strict)\n  cover    fetch_form.cover_required: required but missing = FAIL; built but not required = WARN (do not upload)\nWrites <pkg>/precheck.json (unless --no-write). Exit 0 = no FAIL, 1 = at least one FAIL. Never submits or contacts anyone."

# Portable path/config adapter; pipeline implementation below is retained.
from pathlib import Path as _JobbiPath
import os as _jobbi_os, sys as _jobbi_sys
_JOBBI_ROOT = _JobbiPath(_jobbi_os.environ.get("JOBBI_ROOT", str(_JobbiPath(__file__).resolve().parents[3])))
_jobbi_sys.path.insert(0, str(_JOBBI_ROOT))
from runtime_config import policy as _jobbi_policy, candidate as _jobbi_candidate
_JOBBI_SEARCH = _JOBBI_ROOT / "workspace" / "job-search"
_JOBBI_APPS = _JOBBI_ROOT / "workspace" / "job-apps"
_JOBBI_POLICY = _jobbi_policy(_JOBBI_ROOT)
_JOBBI_CAND = _jobbi_candidate(_JOBBI_ROOT)

import argparse, datetime as dt, hashlib, json, os, re, sys
from pathlib import Path
import yaml
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(_JOBBI_APPS / 'lib'))
import ats_check, check_claims, format_check, gap_check, fetch_form
import lint_3lens_package as LINT
import reconcile_reviews as RR
from textscan import md_candidate_text, md_units

VERSION = "precheck-sanitized-v1"
TERMS = yaml.safe_load((HERE / "precheck_terms.yaml").read_text())
COPY_FAIL, COPY_WARN = 8, 6
SENT_MAX, EXP_SOFT, SUM_SOFT = [_JOBBI_POLICY.get(k) or float("inf") for k in ("sentence_words", "experience_soft_words", "summary_soft_words")]
METRIC_PAIRS = _JOBBI_POLICY.get("metric_pairs", [])
ACRONYM_RUN = re.compile(r"\b[A-Z][A-Z0-9]{1,5}s?(?:[ ,/&]+(?:and |or )?[A-Z][A-Z0-9]{1,5}s?){2,}\b")
WORDS = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")

def read(p): return Path(p).read_text(encoding="utf-8", errors="replace") if Path(p).exists() else ""
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest() if Path(p).exists() else None

def candidate_texts(pkg):
    """[(where, [sentences])] for every candidate-facing text."""
    out = [("resume", md_units(md_candidate_text(read(pkg / "resume-native.md"))))]
    if (pkg / "cover.txt").exists(): out.append(("cover", md_units(read(pkg / "cover.txt"))))
    out += [(f.name, md_units(read(f))) for f in sorted(pkg.glob("answers*.md"))]
    return out

def headline_and_summary(md):
    m = re.search(r"(?m)^\*\*Headline[^*]*\*\*\s*(.+)$", md)
    return ([m.group(1)] if m else []) + LINT.bullets(LINT.md_section(md, "SUMMARY"))

def term_checks(pkg, md, texts):
    fails, warns = [], []
    for where, sents in texts:
        for s in sents:
            for b in TERMS.get("banned") or []:
                if re.search(b["rx"], s, re.I): fails.append(f"TERM [{where}] {b['why']}: {s[:120]!r}")
            for b in TERMS.get("case_sensitive") or []:
                if re.search(b["rx"], s): fails.append(f"TERM [{where}] {b['why']}: {s[:120]!r}")
            for rx in TERMS.get("age_signal") or []:
                if (m := re.search(rx, s, re.I)): fails.append(f"AGE [{where}] career-length wording {m.group(0)!r}: {s[:120]!r}")
            for b in TERMS.get("warn") or []:
                if re.search(b["rx"], s, re.I): warns.append(f"TERM [{where}] {b['why']}: {s[:120]!r}")
    for line in headline_and_summary(md):
        for rx in TERMS.get("legacy_top") or []:
            if (m := re.search(rx, line)): fails.append(f"AGE legacy / era-dating tech {m.group(0)!r} in the headline or SUMMARY: {line[:120]!r}")
    return list(dict.fromkeys(fails)), list(dict.fromkeys(warns))

def repeat_checks(md, texts):
    fails, warns = [], []
    seen = {}
    for where, sents in texts:
        for s in sents:
            k = " ".join(WORDS.findall(s.lower()))
            if len(k.split()) < 6: continue
            if k in seen: warns.append(f"REPEAT duplicate sentence in {seen[k]} and {where}: {s[:120]!r}")
            else: seen[k] = where
    for b in LINT.prose_units(md):
        w = WORDS.findall(b.lower()); grams = [tuple(w[i:i + 4]) for i in range(len(w) - 3)]
        dup = next((g for g in grams if grams.count(g) > 1), None)
        if dup: warns.append(f"REPEAT 4-word phrase {' '.join(dup)!r} twice in one bullet: {b[:100]!r}")
    for where, sents in texts:
        blob = " ".join(sents)
        for a, b in METRIC_PAIRS:
            n = sum(1 for s in sents if re.search(a, s) and re.search(b, s))
            if n > 1: warns.append(f"REPEAT metric pair {a} / {b} appears {n} times in {where}")
        for marker in _JOBBI_POLICY.get("repeat_metric_markers", []):
            count = sum(1 for s in sents if marker in s)
            if count > 1: warns.append(f"REPEAT configured metric marker appears {count} times in {where}")
    return fails, warns

def read_checks(md):
    warns = []
    sb = LINT.bullets(LINT.md_section(md, "SUMMARY"))
    eb = LINT.bullets(LINT.md_section(md, "PROFESSIONAL EXPERIENCE|EXPERIENCE|WORK EXPERIENCE"))
    for b in sb + eb:
        for s in re.split(r"(?<=[.;!?])\s+(?=[A-Z(])", b):
            if LINT.nwords(s) > SENT_MAX: warns.append(f"READ sentence is {LINT.nwords(s)} words (> {SENT_MAX}): {s[:100]!r}")
        if (m := ACRONYM_RUN.search(b)): warns.append(f"READ run of 3+ acronyms {m.group(0)!r}: spell one out")
    for i, b in enumerate(sb, 1):
        if LINT.nwords(b) > SUM_SOFT: warns.append(f"READ SUMMARY bullet {i} is {LINT.nwords(b)} words (> {SUM_SOFT} needs a reason)")
        # Candidate-specific annotation removed.
    for b in eb:
        if LINT.nwords(b) > EXP_SOFT: warns.append(f"READ experience bullet is {LINT.nwords(b)} words (> {EXP_SOFT} needs a reason): {b[:80]!r}")
    return warns

def step6(pkg):
    try: job_id, s6 = RR.job_of(pkg)
    except Exception: return None, None
    return job_id, (json.loads(Path(s6).read_text()) if s6 else None)

def keyword_terms(pkg):
    """package.yaml ats_keywords: ["term|alias|alias", ...] or [{term, aliases}]. No guessing from the JD: the reviewer
    lists the top JD keywords in combined.json and finalize records coverage from that list."""
    out = []
    for k in RR.spec_of(pkg).get("ats_keywords") or []:
        if isinstance(k, str):
            parts = [x.strip() for x in k.split("|") if x.strip()]
            if parts: out.append({"term": parts[0], "aliases": parts[1:]})
        elif isinstance(k, dict) and k.get("term"): out.append({"term": k["term"], "aliases": k.get("aliases") or []})
    return out

def gap_checks(pkg, rec, strict):
    import precheck_spec as PS
    if rec is None: return [], ["GAPS no step-6 record for this package: gap check skipped (score the job first)"]
    spec = RR.spec_of(pkg); explicit = spec.get("gap_plan") is not None
    gh = spec["gap_plan"] if explicit else PS.default_plan(rec)
    rv = {"gap_handling": gh, "step6_record": None, "cover": RR.cover_mode(pkg), "final": "REVISE",
          "gaps": rec.get("gaps"), "blockers": rec.get("blockers")}
    fails, _ = gap_check.check(pkg, {**rv, "gap_source": "legacy"})
    fails = [f for f in fails if not f.startswith(("G-RECORD", "G-DECISION"))]
    if not explicit: fails = [f for f in fails if PS.keep_default(f)]
    hard = [f for f in fails if explicit or strict or not f.startswith("OVERCLAIM")]
    return [f"GAPS {f}" for f in hard], [f"GAPS {f}" for f in fails if f not in hard]

# ---- 2026-11-04 review split: style vs hard facts ---------------------------------------------------------------
STYLE_SHAPE = ("SHAPE SUMMARY has", "SHAPE SUMMARY bullet", "SHAPE experience bullet")
def is_style(x): return x.startswith(STYLE_SHAPE)
def warn_id(x): return "W-" + hashlib.sha1(x.encode()).hexdigest()[:6]
UPD = str(_JOBBI_SEARCH / 'pipeline/update_status.py')
JS = Path(str(_JOBBI_SEARCH))
URL_RX = re.compile(r"https?://[^\s)\]>'\"]+")

def norm_url(u): return re.sub(r"[?#].*$", "", u.strip().rstrip("/.,;")).lower().replace("http://", "https://")

def package_urls(pkg):
    spec = RR.spec_of(pkg); head = (spec.get("resume") or {}).get("head", "")
    txt = head + "\n" + "\n".join(read(pkg / f)[:3000] for f in ("README.md", "jd.md", "resume-native.md"))
    try: txt += "\n" + str(json.loads(read(pkg / "form.json") or "{}").get("url") or "")
    except Exception: pass
    return list(dict.fromkeys(norm_url(u) for u in URL_RX.findall(txt) if not any(link and link in u for link in _JOBBI_CAND.get("profile_urls", []))))

def find_job(pkg):
    """(row dict or None, how). Order: package_path, package.yaml job_id, any package URL (resume **URL:** line incl. the
    LinkedIn URL in parentheses, README, jd.md, form.json) vs jobs.url / url_canon, then jd-analysis/*.md URL lines."""
    import sqlite3
    if os.environ.get("PRECHECK_DB"): db = Path(os.environ["PRECHECK_DB"])
    else: db = RR.DB
    if not db.exists(): return None, "no jobs.db"
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True); c.row_factory = sqlite3.Row
    q = "select id, status, url, package_path, analysis_path from jobs where "
    r = c.execute(q + "rtrim(package_path,'/')=?", (str(pkg),)).fetchone()
    if r: return dict(r), "package_path"
    jid = RR.spec_of(pkg).get("job_id")
    if jid and (r := c.execute(q + "id=?", (int(jid),)).fetchone()): return dict(r), "package.yaml job_id"
    urls = package_urls(pkg)
    for u in urls:
        r = c.execute(q + "lower(rtrim(url,'/'))=? or lower(rtrim(url_canon,'/'))=?", (u, u)).fetchone()
        if r: return dict(r), f"url {u}"
    ja = JS / "jd-analysis"
    if urls and ja.exists():
        for f in ja.glob("job-*.md"):
            head = f.read_text(errors="replace")[:2500]
            if any(norm_url(x) in urls for x in URL_RX.findall(head)):
                m = re.match(r"job-(\d+)-", f.name)
                if m and (r := c.execute(q + "id=?", (int(m.group(1)),)).fetchone()): return dict(r), f"jd-analysis {f.name}"
    return None, "no match on package_path, job_id, URLs or jd-analysis"

def link_check(pkg):
    """(job_id, step-6 record, fails). The package must be the job's package_path; the fix command is printed."""
    if os.environ.get("PRECHECK_NO_LINK"):           # test fixtures copied to tmp only
        jid, rec = step6(pkg); return jid, rec, []
    row, how = find_job(pkg)
    if not row: return None, None, [f"LINK no job record found for this package ({how}): add job_id to package.yaml or score the job first"]
    rec = None
    if row["analysis_path"]:
        s6 = (JS / Path(row["analysis_path"]).with_suffix(".json"))
        if s6.exists(): rec = json.loads(s6.read_text())
    fails = []
    pp = (row["package_path"] or "").rstrip("/")
    if pp != str(pkg):
        what = "is not linked to job" if not pp else f"is not job {row['id']}'s package_path ({pp})"
        fails.append(f"LINK package {what} {row['id']} (found by {how}; gap check needs the link). Fix: python3 {UPD} --id {row['id']} "
                     f"--status '{row['status'] or 'To Review'}' --package {pkg}")
    return row["id"], rec, fails

def fact_checks(pkg, md):
    F = []
    FX = TERMS.get("fixed_facts") or {}
    heads = re.findall(r"(?m)^\*\*([^*\n]+)\*\*\s*\n\*([^*\n]+)\*", md)
    seen = set()
    for co in FX.get("companies") or []:
        hit = [(h, d) for h, d in heads if h.startswith(co["prefix"])]
        if not hit:
            if co.get("required"): F.append(f"FACT {co['prefix']} header missing (want '**{co['header']}**')")
            continue
        seen.add(co["prefix"])
        for h, d in hit:
            if h.strip() != co["header"]: F.append(f"FACT header {h.strip()!r} must be {co['header']!r}")
            dates = d.split("·")[0].strip()
            if dates != co["dates"]: F.append(f"FACT {co['prefix']} dates {dates!r} must be {co['dates']!r}")
    sw = LINT.md_section(md, "SELECTED WORK[^\n]*")
    if sw.strip() and FX.get("selected_work_first_regex"):
        first = next((l for l in sw.splitlines() if l.strip()), "")
        if not re.match(FX["selected_work_first_regex"], first): F.append(f"FACT configured selected-work entry must be first; first is {first.strip()[:60]!r}")
    pdf = pkg / "resume.pdf"
    if pdf.exists():
        import subprocess
        t = subprocess.run(["pdftotext", str(pdf), "-"], capture_output=True, text=True).stdout
        for need in FX.get("contact") or []:
            if need not in t: F.append(f"FACT contact block in resume.pdf is missing {need!r}")
    return F

PLACEHOLDER = re.compile(r"\[USER\]|\bTBD\b|\bTODO\b|\bXXX\b|<[^>]{2,30}>|\[placeholder\]", re.I)
STOP = set("a an the you your yours are is do did does have has ever this that to of in for or and any with at on be will now future".split())
STANDING_Q = re.compile(r"(?i)^\s*(first|last|legal|preferred( first)?|full)?\s*name\b|^\s*e-?mail|^\s*phone|resume|^\s*cv\b|^\s*location|latitude|longitude|linkedin|"
                        r"authori[sz]ed to work|sponsor|18\+|\bgender|\brac(e|ial)|ethnic|disabilit|veteran|hispanic|privacy notice|certify that")
def toks(s): return {w for w in WORDS.findall(s.lower()) if w not in STOP and len(w) > 2}

def form_checks(pkg, md):
    """Form completeness from README. Answer lines: '- **REQUIRED <label>:** <answer>' (preferred) or
    '- **<label> (required...):** <answer>'. FAIL: a required answer empty or carrying a placeholder ([USER], TBD, TODO,
    <...>), items left under '## Open questions for the user', form.json required questions but no required answer lines
    at all, or a standing screening answer broken. WARN: a required form.json question that could not be matched to
    an answer line by wording (fuzzy match; the reviewer confirms), placeholders on optional fields."""
    F, W = [], []
    try: form = json.loads(read(pkg / "form.json") or "null")
    except Exception: form = None
    readme = read(pkg / "README.md")
    lines = [(m.group(1).strip(), m.group(2).strip()) for m in re.finditer(r"(?m)^\s*-\s*\*\*REQUIRED\s+([^*]+?):?\*\*:?\s*(.*)$", readme)]
    lines += [(m.group(1).strip(), m.group(2).strip()) for m in re.finditer(r"(?m)^\s*-\s*\*\*([^*]+?\(required[^)]*\)[^*]*?):?\*\*:?\s*(.*)$", readme, re.I)]
    for lab, ans in lines:
        if not ans or PLACEHOLDER.search(ans): F.append(f"FORM required answer unanswered or placeholder: {lab[:90]!r}: {ans[:80]!r}")
    for m in re.finditer(r"(?m)^\s*-\s*\*\*Optional\s+([^*]+?)\*\*:?\s*(.*)$", readme):
        if PLACEHOLDER.search(m.group(2)): W.append(f"FORM optional field still has a placeholder: {m.group(1)!r}: {m.group(2)[:60]!r}")
    oq = re.search(r"(?ims)^##\s*Open questions for the user\s*$(.*?)(?=^##\s|\Z)", readme)
    if oq:
        items = [l for l in oq.group(1).splitlines() if re.match(r"\s*[-*]\s+\S", l) and not re.search(r"(?i)4-lens:|resolved|approved|^\s*[-*]\s+none\b", l)]
        if items: F.append(f"FORM {len(items)} item(s) still under 'Open questions for the user' (record their answer in README first): {items[0].strip()[:90]!r}")
    if form and form.get("questions"):
        req = [q for q in form["questions"] if q.get("required") and q.get("type") != "File"]
        if req and not lines:
            F.append(f"FORM form.json has {len(req)} required question(s) and README has no required answer lines ('- **REQUIRED <label>:** <answer>')")
        else:
            for q in req:
                if STANDING_Q.search(q["label"]): continue     # contact / system / standing-rule fields
                qt = toks(q["label"])
                best = max((len(qt & toks(l)) / max(1, min(len(qt), len(toks(l)))) for l, _ in lines), default=0)
                if best < 0.4: W.append(f"FORM required question not matched to a README answer line (confirm it is answered): {q['label'][:80]!r}")
    def on_resume(label):
        m = re.search(r"(?:at|for)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)", label)
        return bool(m) and bool(re.search(rf"(?m)^\*\*{re.escape(m.group(1))}", md))
    for lab, ans in lines:
        if PLACEHOLDER.search(ans): continue
        l, a = lab.lower(), ans.lower()
        if re.search(r"(ever|previously|before).{0,20}work(ed)? (at|for|here)|worked (at|for|here)", l) and not a.startswith("no") and not on_resume(lab):
            F.append(f"FORM {lab[:80]!r}: prior employment answer needs approved evidence")
        for standing in _JOBBI_CAND.get("standing_answer_rules", []):
            if re.search(standing["question_rx"], lab, re.I) and not re.search(standing["answer_rx"], ans, re.I):
                F.append(f"FORM {lab[:80]!r}: differs from the user's approved standing answer")
    return F, W

def run_checks(pkg):
    F = []
    built = RR.builder_runs(pkg)
    if not built: F.append("RUN package.yaml has no builder_runs: rebuild with build_package.py --write --run-id <run>")
    c = pkg / "reviews" / "combined.json"
    if c.exists():
        try: rid = json.loads(c.read_text()).get("reviewer_run_id")
        except Exception: rid = None
        if rid and rid in built: F.append(f"RUN reviews/combined.json reviewer_run_id {rid!r} is a builder run: re-review from a separate run")
    return F

def run(pkg, strict=False):
    pkg = Path(pkg).resolve(); F, W, info = [], [], {}
    md = read(pkg / "resume-native.md")
    if not md: return {"package": pkg.name, "result": "FAIL", "fail": ["FILE no resume-native.md"], "warn": [], "info": {}}
    f, w = format_check.check(pkg); F += [f"FORMAT {x}" for x in f]
    W += [f"FORMAT {x}" for x in w if not x.startswith("DOT ")]       # '·' in date/contact lines is the approved base style
    lw = []
    for x in LINT.lint_package(pkg, None, lw):
        if x.startswith(("SECT", "TELL year", "TELL graduation")) or x == "FILE missing review-3lens.md": continue
        (W if is_style(x) else F).append(f"SHAPE {x}")
    cc = check_claims.check_package(pkg)
    F += [f"CLAIMS {x['check']} [{x['where']}] {x['token']!r}: {x['sentence'][:110]!r} ({x['why']})" for x in cc["fails"]]
    texts = candidate_texts(pkg)
    f, w = term_checks(pkg, md, texts); F += f; W += w
    f, w = repeat_checks(md, texts); F += f; W += w
    W += read_checks(md)
    job_id, rec, f = link_check(pkg); F += f
    F += fact_checks(pkg, md)
    f, w = form_checks(pkg, md); F += f; W += w
    F += run_checks(pkg)
    if (pkg / "jd.md").exists():
        kws = keyword_terms(pkg); a = ats_check.compute(pkg, kws)
        n, s = a["max_jd_copy_run"], a["max_jd_copy_text"]
        if n >= COPY_FAIL: F.append(f"JD-COPY {n}-word run copied from jd.md (limit {COPY_FAIL - 1}): {s!r}")
        elif n >= COPY_WARN: W.append(f"JD-COPY {n}-word run copied from jd.md (6-7 = REVISE): {s!r}")
        info["jd_copy_max_run"] = n
        if kws:
            info["keywords"] = {k["term"]: r["hit"] for k, r in zip(kws, a["keywords"])}; info["keyword_coverage"] = a["coverage"]
            if a["coverage"] < 0.85: W.append(f"ATS coverage {a['coverage']:.0%} of the named terms; missing: {', '.join(k for k, h in info['keywords'].items() if not h)} (never add a gap term)")
        else: info["keywords"] = "none in package.yaml ats_keywords: the reviewer lists them"
    else: W.append("JD no jd.md in the package: copy and keyword checks skipped")
    f, w = gap_checks(pkg, rec, strict); F += f; W += w
    req, why = fetch_form.cover_required(pkg); has = (pkg / "cover.txt").exists() or (pkg / "cover.pdf").exists()
    info["cover_required"] = req; info["cover_rule"] = why
    if req and not has: F.append(f"COVER the form requires a cover letter ({why}) and the package has none: add a cover to package.yaml and rebuild")
    if req and has and not (pkg / "cover.pdf").exists(): F.append("COVER cover.txt exists but cover.pdf is missing: rebuild")
    if has and not req: W.append(f"COVER cover files exist but no cover is required ({why}): do not upload one")
    if has and req:
        c = read(pkg / "cover.txt")
        if not re.match(r"Dear .+ Hiring Team,", c.strip()): W.append("COVER greeting is not 'Dear <Company> Hiring Team,'")
        if _JOBBI_POLICY.get("cover_warn_words") is not None and (n := LINT.nwords(c)) > _JOBBI_POLICY["cover_warn_words"]: W.append(f"COVER is {n} words (configured target: {_JOBBI_POLICY.get('cover_words')})")
    info.update({"job_id": job_id, "step6": bool(rec), "claims_version": cc["claims_version"], "format_version": format_check.FORMAT_VERSION,
                 "files_sha256": {k: sha(pkg / k) for k in ("resume-native.md", "cover.txt") if (pkg / k).exists()}})
    F, W = list(dict.fromkeys(F)), list(dict.fromkeys(W))
    info["warn_ids"] = {warn_id(x): x for x in W}
    return {"schema": "precheck-v1", "version": VERSION, "package": pkg.name, "at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "result": "FAIL" if F else ("WARN" if W else "PASS"), "fail": F, "warn": W, "info": info}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg", nargs="+"); ap.add_argument("--json", action="store_true"); ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--strict", action="store_true", help="default-plan gap OVERCLAIM hits FAIL too")
    a = ap.parse_args(); res = []
    for p in a.pkg:
        r = run(p, a.strict); res.append(r)
        if not a.no_write and (Path(p) / "resume-native.md").exists(): (Path(p) / "precheck.json").write_text(json.dumps(r, indent=1) + "\n")
    if a.json: print(json.dumps(res if len(res) > 1 else res[0], indent=1))
    else:
        for r in res:
            i = r["info"]
            print(f"{r['result']:4s} {r['package']}  [{VERSION}]  fails {len(r['fail'])}, warns {len(r['warn'])}; jd copy {i.get('jd_copy_max_run', '-')}; "
                  f"keywords {i.get('keyword_coverage', '-')}; cover_required {i.get('cover_required')}")
            for x in r["fail"]: print(f"  FAIL {x}")
            for x in r["warn"]: print(f"  WARN {warn_id(x)} {x}")
    sys.exit(1 if any(r["fail"] for r in res) else 0)

if __name__ == "__main__":
    main()
