#!/usr/bin/env python3
"""One package builder (phase 3 item 7, 2026-10-21). Every resume and cover is built only from data:
  - the base resume text   base-resumes/<base>/resume-native.md   (bullets live here, not in Python)
  - shared blocks          base-resumes/_shared/*.md               (e.g. publications.md)
  - approved facts         <search-workspace>/profile/claims.yaml
  - identity               <search-workspace>/profile/candidate.yaml (name, contact, signature)
  - the package spec       <pkg>/package.yaml: header lines, line edits vs the base (each citing claim ids or
                           marked wording_only with a basis), and the cover (greeting, opening, bullets, closing, date)
                           ONLY when the form requires one (2026-11-04: fetch_form.py form.json or cover_required: true;
                           default cover: null, no cover built or uploaded).
PDFs are rendered by the existing layout tools (rebuild_resume_from_native.py / rebuild_cover_from_txt.py), with
reportlab invariant mode so the same input gives the same bytes.

  build_package.py --extract <pkg>            write <pkg>/package.yaml from the package's current files (migration)
  build_package.py --init <base> <pkg> --company C --title T --url U [--cover]   skeleton; cover only if required
  build_package.py --check <pkg>|--all        build into a temp dir and diff against the package (md/txt bytes, PDF text)
  build_package.py --write <pkg> [--accept-diff "why"]   write md/txt/PDFs; refuses a content change without --accept-diff
  build_package.py --base <name> --check      render a base resume from its md and diff against its resume.pdf
Every --write (and --check with --record) is a prep run and gets a package_runs row (verdict BUILT, source build_package).
--write also appends the builder run id (--run-id, else $APPLY_RUN_ID, else generated) to package.yaml builder_runs;
finalize_review.py refuses lens reviews written under any of those ids.
Gates on --check/--write (2026-10-21 simplification): claims (check_claims on the rendered text + spec citations),
JD copy (8+ words shared with jd.md), format_check.py. Nothing else. Builds of different packages can run in parallel.
Gates on every build: claim ids exist, are approved and in scope; check_claims.py passes on the built text.
Prep only: never submits or contacts anyone.
"""

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

import argparse, difflib, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path
import yaml
JA = Path(str(_JOBBI_APPS)); TOOLS = JA / "tools"; BASES = JA / "base-resumes"; SHARED = BASES / "_shared"
sys.path.insert(0, str(JA / "lib")); sys.path.insert(0, str(TOOLS))
import claims as CL
import fetch_form
CAND = yaml.safe_load(Path(str(_JOBBI_SEARCH / 'profile/candidate.yaml')).read_text())
SPEC = "package.yaml"
NATIVE_GLOBS = _JOBBI_POLICY.get("native_package_globs", ["daily-*/*/review.json"])

# ---------------- text model ----------------
def split_md(t):
    head, sep, body = t.partition("\n---\n")
    assert sep, "resume-native.md has no '---' header separator"
    return head, body

SEC_RX = re.compile(r"(?ms)^(## (?:PUBLICATIONS AND PATENTS|SELECTED[^\n]*)\n.*?)(?=^## )")

def base_body(base, shared):
    _, body = split_md((BASES / base / "resume-native.md").read_text())
    for name in shared:
        blk = (SHARED / f"{name}.md").read_text()
        body, n = SEC_RX.subn(lambda m: blk, body, count=1)
        assert n == 1, f"shared block {name}: no publications section in base {base}"
    return body

def find_block(lines, ctx, old):
    pat = list(ctx) + list(old); hits = [i for i in range(len(lines) - len(pat) + 1) if lines[i:i + len(pat)] == pat]
    return hits

def apply_edits(body, edits):
    L = body.split("\n")
    for k, e in enumerate(edits):
        ctx, old, new = e.get("ctx_before", []), e.get("old", []), e.get("new", [])
        hits = find_block(L, ctx, old)
        if len(hits) != 1: raise SystemExit(f"edit {k + 1}: anchor matches {len(hits)} places (need exactly 1): {(ctx + old)[:2]}")
        i = hits[0] + len(ctx)
        L[i:i + len(old)] = new
    return "\n".join(L)

def build_md(spec):
    return spec["resume"]["head"] + "\n---\n" + apply_edits(base_body(spec["base"], spec["resume"].get("shared", [])), spec["resume"]["edits"])

def build_cover(spec):
    c = spec.get("cover")
    if not c: return None
    parts = [c["greeting"], *c["opening"], "\n".join("- " + b["text"] for b in c["bullets"]), *c["closing"], "\n".join(CAND["cover_signature"])]
    return "\n\n".join(parts) + "\n"

# ---------------- claims gates ----------------
def scope_of(pkg):
    import check_claims as CC
    return set(CC.scope_for(Path(pkg))) | {"all"}

STOP = {"the", "and", "a", "an", "of", "to", "in", "for", "with", "on", "at", "i", "my", "as", "by", "then", "that", "it", "is", "was", "from", "into", "his", "he"}
def infer_claims(line, scope):
    """approved in-scope claims a line restates: an anchor matches, or enough of the claim's distinctive words appear.
    Migration aid only; extract output is meant to be read, and anything it cannot tie to a claim is wording_only."""
    ids = []; lw = set(re.findall(r"[a-z0-9+#.-]+", line.lower()))
    for c in CL.approved(scope):
        if any(re.search(rx, line, re.I) for rx in c.get("anchors") or []): ids.append(c["id"]); continue
        tw = set(re.findall(r"[a-z0-9+#.-]+", c["text"].lower())) - STOP
        strong = {w for w in tw if len(w) >= 5}
        if tw and (len(tw & lw) / len(tw) >= 0.45 or len(strong & lw) >= 3): ids.append(c["id"])
    return ids

def check_spec_claims(spec, scope):
    by = {c["id"]: c for c in CL.load()["claims"]}; errs = []
    items = [("resume edit", e) for e in spec["resume"]["edits"] if e.get("new")] + [("cover bullet", b) for b in (spec.get("cover") or {}).get("bullets", [])]
    for kind, e in items:
        ids = e.get("claims") or []
        if not ids and not (e.get("wording_only") and e.get("basis")):
            errs.append(f"{kind} cites no claim and is not wording_only with a basis: {(e.get('new') or [e.get('text')])[0][:90]!r}")
        for cid in ids:
            c = by.get(cid)
            if not c: errs.append(f"{kind}: unknown claim id {cid}")
            elif c.get("status") != "approved" or not (set(c.get("scope") or []) & scope): errs.append(f"{kind}: claim {cid} not approved for scope {sorted(scope)}")
    return errs

# ---------------- extract (migration) ----------------
def extract(pkg):
    pkg = Path(pkg); md = (pkg / "resume-native.md").read_text()
    head, body = split_md(md)
    base = re.search(r"\*\*Base:\*\* ([a-z-]+)", head).group(1)
    shared = ["publications"] if "## PUBLICATIONS AND PATENTS" in body and "## PUBLICATIONS AND PATENTS" not in (BASES / base / "resume-native.md").read_text() else []
    a = base_body(base, shared).split("\n"); b = body.split("\n"); scope = scope_of(pkg)
    rv = json.loads((pkg / "review.json").read_text()) if (pkg / "review.json").exists() else {}
    notes = " ".join(rv.get("edits", []))
    edits = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal": continue
        old, new = a[i1:i2], b[j1:j2]
        ctx = []
        for n in range(0, 4):
            ctx = a[max(0, i1 - n):i1] if n else []
            if len(find_block(a, ctx, old)) == 1 and (old or ctx): break
        e = {"ctx_before": ctx, "old": old, "new": new}
        ids = sorted({cid for l in new for cid in infer_claims(l, scope)})
        if ids: e["claims"] = ids
        elif new:
            e["wording_only"] = True
            terms = [t for t in re.findall(r"\[([^\]]+)\]", notes)]
            e["basis"] = "no new fact: wording/keyword change on approved claims; see review.json edits" + (f" (cited there: {', '.join(sorted(set(terms)))})" if terms else "")
        edits.append(e)
    spec = {"schema": "package-v1", "base": base, "scope": sorted(scope - {"all"}) or ["all"],
            "resume": {"head": head, "shared": shared, "edits": edits}}
    if (pkg / "cover.txt").exists():
        blocks = (pkg / "cover.txt").read_text().strip("\n").split("\n\n")
        sig = blocks[-1].split("\n"); assert sig == CAND["cover_signature"], f"cover signature differs from candidate.yaml: {sig}"
        bi = [i for i, x in enumerate(blocks) if x.startswith("- ")]; assert len(bi) == 1, "cover: expected one bullet block"
        bl = []
        for line in blocks[bi[0]].split("\n"):
            ids = infer_claims(line, scope); d = {"text": line[2:]}
            if ids: d["claims"] = ids
            else: d.update(wording_only=True, basis="no metric; restates approved claims in the resume")
            bl.append(d)
        date = subprocess.check_output(["pdftotext", str(pkg / "cover.pdf"), "-"], text=True).strip().split("\n")[0].strip() if (pkg / "cover.pdf").exists() else None
        spec["cover"] = {"date": date, "greeting": blocks[0], "opening": blocks[1:bi[0]], "bullets": bl, "closing": blocks[bi[0] + 1:-1]}
    (pkg / SPEC).write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True, width=200))
    return spec

# ---------------- build / check ----------------
def pdf_text(p): return subprocess.check_output(["pdftotext", "-layout", str(p), "-"], text=True)
def pages(p): return int(re.search(r"Pages:\s+(\d+)", subprocess.check_output(["pdfinfo", str(p)], text=True)).group(1))

def render(pkg, spec, md, cover, out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    for f in ("README.md", "jd.md", "company-research.md"):
        if (Path(pkg) / f).exists(): shutil.copy2(Path(pkg) / f, out / f)
    (out / "resume-native.md").write_text(md)
    env = dict(os.environ, RL_invariant="1")
    subprocess.run([sys.executable, str(TOOLS / "rebuild_resume_from_native.py"), str(out), str(out / "resume.pdf")], check=True, capture_output=True, env=env)
    if cover is not None:
        (out / "cover.txt").write_text(cover)
        subprocess.run([sys.executable, str(TOOLS / "rebuild_cover_from_txt.py"), str(out), str(out / "cover.pdf"), "--date", spec["cover"]["date"]], check=True, capture_output=True, env=env)
    return out

def build(pkg):
    pkg = Path(pkg).resolve(); spec = yaml.safe_load((pkg / SPEC).read_text())
    scope = scope_of(pkg); errs = check_spec_claims(spec, scope)
    md, cover = build_md(spec), build_cover(spec)
    return spec, md, cover, errs

def diff_report(pkg, md, cover, tmp):
    pkg = Path(pkg); rep = {}
    def d(a, b, name):
        return "".join(difflib.unified_diff(a.splitlines(True), b.splitlines(True), f"{name} (package)", f"{name} (built)", n=1))
    rd = lambda f: (pkg / f).read_text() if (pkg / f).exists() else ""
    rep["resume-native.md"] = d(rd("resume-native.md"), md, "resume-native.md")
    if cover is not None: rep["cover.txt"] = d(rd("cover.txt"), cover, "cover.txt")
    for f in ("resume.pdf", "cover.pdf"):
        if (Path(tmp) / f).exists() and (pkg / f).exists():
            a, b = pdf_text(pkg / f), pdf_text(Path(tmp) / f)
            rep[f + " (text)"] = d(a, b, f)
            if pages(pkg / f) != pages(Path(tmp) / f): rep[f + " (pages)"] = f"{pages(pkg / f)} -> {pages(Path(tmp) / f)}"
    return {k: v for k, v in rep.items() if v}

def claims_gate(tmpdir):
    r = subprocess.run([sys.executable, str(TOOLS / "check_claims.py"), str(tmpdir)], capture_output=True, text=True)
    return [] if r.returncode == 0 else [l.strip() for l in r.stdout.splitlines() if "FAIL" in l]

def record_run(pkg, verdict="BUILT"):
    if not str(pkg).startswith(str(JA) + "/") and not os.environ.get("STAMP_REVIEW_DB"): return None
    sys.path.insert(0, str(_JOBBI_SEARCH / 'pipeline'))
    import jobsdb as J, pkgmeta as PM
    spec = yaml.safe_load((Path(pkg) / SPEC).read_text())
    with J.locked():
        c = J.connect(os.environ["STAMP_REVIEW_DB"]) if os.environ.get("STAMP_REVIEW_DB") else J.connect()
        row = c.execute("select id from jobs where rtrim(package_path,'/')=?", (str(pkg).rstrip("/"),)).fetchone()
        rid = J.record_package_run(c, package_path=str(pkg), job_id=row[0] if row else None, base=spec["base"], cover_format=PM.cover_format(Path(pkg)),
                                   lint_version=None, claims_version=CL.load()["version"], rubric_version=None, verdict=verdict, round=None,
                                   stamped_at=J.now_iso(), source="build_package")
        c.commit()
    return rid

def builder_run_id(given=None):
    """the id of the run doing this build (routine run id from --run-id or APPLY_RUN_ID); reviewers must use a different id."""
    import datetime as _dt
    return given or os.environ.get("APPLY_RUN_ID") or f"build-{_dt.datetime.now().strftime('%Y%m%dT%H%M%S')}-{os.getpid()}"

def record_builder(pkg, run_id):
    """append run_id to package.yaml builder_runs (text edit at the end, so the rest of the spec is untouched)."""
    p = Path(pkg) / SPEC; txt = p.read_text()
    have = [str(x) for x in (yaml.safe_load(txt).get("builder_runs") or [])]
    if run_id in have: return have
    txt = re.sub(r"(?ms)^builder_runs:\n(?:- .*\n?)*", "", txt).rstrip("\n") + "\n"
    have.append(run_id)
    txt += "builder_runs:\n" + "".join(f"- {json.dumps(x)}\n" for x in have)
    tmp = p.with_suffix(".yaml.tmp"); tmp.write_text(txt); os.replace(tmp, p)
    return have

def kept_gates(tmpdir):
    """2026-10-21 simplification: the only code gates besides claims are the JD copy check and the format check."""
    import ats_check, format_check
    errs = []
    if (Path(tmpdir) / "jd.md").exists():
        a = ats_check.compute(tmpdir, [])
        if a["max_jd_copy_run"] >= 8: errs.append(f"JD-COPY {a['max_jd_copy_run']}-word run copied from jd.md: {a['max_jd_copy_text']!r}")
    errs += format_check.check(tmpdir)[0]
    return errs

def check_one(pkg, keep=None):
    spec, md, cover, errs = build(pkg)
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(keep) if keep else Path(t) / Path(pkg).name
        try:
            render(pkg, spec, md, cover, tmp)
        except (subprocess.CalledProcessError, ValueError) as e:   # backport 2026-10-21: the renderer refuses a resume it
            # cannot lay out (e.g. a missing core section); report a gate FAIL instead of crashing the build
            why = (getattr(e, "stderr", None) or getattr(e, "stdout", None) or str(e))
            why = why.decode() if isinstance(why, bytes) else why
            return errs + [f"RENDER {why.strip().splitlines()[-1] if why.strip() else e}"], {}
        errs += claims_gate(tmp)
        errs += kept_gates(tmp)
        if cover is None and fetch_form.cover_required(Path(pkg))[0]:
            errs.append(f"COVER the form requires a cover letter ({fetch_form.cover_required(Path(pkg))[1]}) but package.yaml has cover: null")
        rep = diff_report(pkg, md, cover, tmp)
    return errs, rep

def native_packages():
    return sorted({str(Path(p).parent) for g in NATIVE_GLOBS for p in JA.glob(g)})

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg", nargs="?"); ap.add_argument("--extract", action="store_true"); ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true"); ap.add_argument("--all", action="store_true"); ap.add_argument("--base")
    ap.add_argument("--init", metavar="BASE", help="write a skeleton package.yaml for a new package on BASE"); ap.add_argument("--company"); ap.add_argument("--title"); ap.add_argument("--url")
    ap.add_argument("--accept-diff"); ap.add_argument("--record", action="store_true"); ap.add_argument("--json", action="store_true")
    ap.add_argument("--cover", action="store_true", help="with --init: add a cover skeleton and cover_required: true even though the form does not require one")
    ap.add_argument("--run-id", help="id of the run doing the build (default: $APPLY_RUN_ID or a generated id); recorded in package.yaml builder_runs")
    a = ap.parse_args()
    if a.base:
        b = BASES / a.base
        with tempfile.TemporaryDirectory() as t:
            env = dict(os.environ, RL_invariant="1")
            subprocess.run([sys.executable, str(TOOLS / "rebuild_resume_from_native.py"), str(b), f"{t}/resume.pdf"], check=True, capture_output=True, env=env)
            same = pdf_text(b / "resume.pdf") == pdf_text(f"{t}/resume.pdf")
            print(f"base {a.base}: resume.pdf text {'IDENTICAL' if same else 'DIFFERS'} ({pages(f'{t}/resume.pdf')} pages)")
            if not same: print("".join(difflib.unified_diff(pdf_text(b / "resume.pdf").splitlines(True), pdf_text(f"{t}/resume.pdf").splitlines(True), "base pdf", "rendered", n=0))[:3000])
            sys.exit(0 if same else 1)
    if a.init:
        p = Path(a.pkg).resolve(); p.mkdir(parents=True, exist_ok=True)
        if (p / SPEC).exists(): sys.exit(f"{p / SPEC} exists")
        bh, _ = split_md((BASES / a.init / "resume-native.md").read_text())
        hl = re.search(r"(?m)^\*\*Headline \(rendered under name[^)]*\):\*\* .+$", bh).group(0)
        pitch = re.search(r"(?m)^\*\*Pitch:\*\* .+$", bh).group(0)
        head = (f"# {CAND['name']} — Resume (native re-tailor for {a.company} {a.title})\n\n**Target:** {a.title} — {a.company}\n**URL:** {a.url}\n"
                f"**Base:** {a.init} (approved base + approved tagline/headline) · tailored SUMMARY bullets: none\n{hl}\n{pitch}\n")
        shared = ["publications"] if "## PUBLICATIONS AND PATENTS" not in (BASES / a.init / "resume-native.md").read_text() else []
        # Candidate-specific annotation removed.
        need, why = fetch_form.cover_required(p)
        want = need or a.cover
        spec = {"schema": "package-v1", "base": a.init, "scope": [], "resume": {"head": head, "shared": shared, "edits": []},
                "cover": {"date": __import__("datetime").date.today().strftime("%B %d, %Y"), "greeting": f"Dear {a.company} Hiring Team,", "opening": ["<one fit sentence>"],
                          "bullets": [{"text": "<Label.> <proof>", "claims": []}], "closing": [f"I'd welcome the chance to discuss <role> at {a.company}."]} if want else None}
        if a.cover and not need: spec["cover_required"] = True
        (p / SPEC).write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True, width=200))
        print(f"wrote skeleton {p / SPEC}: add edits (each citing claim ids)" + (" and the cover" if want else "") + ", then --check and --write")
        print(f"  cover: {'skeleton written' if want else 'none'} ({'--cover' if a.cover and not need else why})"); return
    pkgs = native_packages() if a.all else [str(Path(a.pkg).resolve())]
    out = {}; bad = False
    for p in pkgs:
        if a.extract:
            extract(p); print(f"extracted {Path(p).name}/{SPEC}")
        if a.check or a.write:
            if not (Path(p) / SPEC).exists(): print(f"SKIP {Path(p).name}: no {SPEC}"); continue
            errs, rep = check_one(p)
            out[Path(p).name] = {"gate_errors": errs, "diffs": rep}
            status = "FAIL" if errs else ("SAME" if not rep else "DIFF")
            bad |= bool(errs)
            if not a.json:
                print(f"{status:4s} {Path(p).name}" + (f"  gate: {errs[:3]}" if errs else "") + (f"  diffs: {', '.join(rep)}" if rep else ""))
            if a.write:
                content = {k for k in rep if not k.endswith("(pages)")}
                if errs: print("  not written: gate errors"); continue
                new_pkg = not (Path(p) / "resume-native.md").exists()
                if content and not a.accept_diff and not new_pkg: print("  not written: content differs; list the diff for the user, then rerun with --accept-diff"); bad = True; continue
                spec, md, cover, _ = build(p)
                with tempfile.TemporaryDirectory() as t:
                    tmp = render(p, spec, md, cover, Path(t) / Path(p).name)
                    for f in ("resume-native.md", "cover.txt", "resume.pdf", "cover.pdf"):
                        if (tmp / f).exists():
                            if (Path(p) / f).exists(): shutil.copy2(Path(p) / f, Path(p) / f"{f}.bak-build")
                            shutil.copy2(tmp / f, Path(p) / f)
                rid = builder_run_id(a.run_id); record_builder(p, rid)
                print(f"  written; builder run {rid}; package_runs #{record_run(p)}")
            elif a.record:
                print(f"  package_runs #{record_run(p)}")
    if a.json: print(json.dumps(out, indent=1))
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
