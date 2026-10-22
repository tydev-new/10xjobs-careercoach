#!/usr/bin/env python3
"""One package builder. Every resume and cover is built only from data:
  - the base resume text   <base_resumes>/<base>/resume-native.md   (bullets live here, not in Python)
  - shared blocks          <base_resumes>/_shared/*.md               (e.g. publications.md)
  - approved facts         profile/claims.yaml
  - identity               profile/candidate.yaml (name, contact lines, cover signature)
  - the package spec       <pkg>/package.yaml: header lines, line edits vs the base (each citing claim ids or
                           marked wording_only with a basis), and the cover (date, greeting, opening, bullets, closing).
PDFs are rendered by apply/lib/render.py in reportlab invariant mode, so the same input gives the same bytes.
Paths come from the data folder (pipeline/home.py: $JOBSEARCH_HOME or jobsearch.py --config DIR).

  build_package.py <pkg> --init BASE --company C --title T --url U    write a skeleton package.yaml on BASE
  build_package.py <pkg> --check            build into a temp dir, run the gates, diff against the package (md/txt, PDF text)
  build_package.py <pkg> --write [--run-id ID] [--accept-diff "why"]
                                            write md/txt/PDFs; refuses a content change to an existing package without --accept-diff
  build_package.py --base <name> --check    render a base resume from its md (and diff against its resume.pdf when present)

Gates on --check/--write: claims (check_claims on the rendered text + spec citations: every cited claim id exists, is
approved and in scope), JD copy (no 8+ word run shared with jd.md), format_check. Nothing else.
Every --write (and --check with --record) is a prep run and gets a package_runs row (verdict BUILT, source build_package).
--write also appends the builder run id (--run-id, else $APPLY_RUN_ID, else generated) to package.yaml builder_runs;
finalize_review refuses lens reviews written under any of those ids. Builds of different packages can run in parallel.
Prep only: never submits or contacts anyone.
"""
import argparse, datetime as dt, difflib, json, os, re, shutil, sys, tempfile
from pathlib import Path

import yaml

from pipeline import home as H
from apply.lib import agent_config as AC
from apply.lib import claims as CL
from apply.lib import pkgmeta as PM
from apply.lib import render as R
from apply.lib import reviews as RV
from apply.tools import ats_check, check_claims as CC, format_check

SPEC = "package.yaml"
SEC_RX = re.compile(r"(?ms)^(## (?:PUBLICATIONS AND PATENTS|SELECTED[^\n]*)\n.*?)(?=^## )")


def bases_dir(): return H.path("base_resumes")
def shared_dir(): return bases_dir() / "_shared"


# ---------------- text model ----------------
def split_md(t):
    head, sep, body = t.partition("\n---\n")
    if not sep: raise SystemExit("resume-native.md has no '---' header separator")
    return head, body


def base_body(base, shared):
    _, body = split_md((bases_dir() / base / "resume-native.md").read_text())
    for name in shared:
        blk = (shared_dir() / f"{name}.md").read_text()
        if not blk.endswith("\n"): blk += "\n"
        body, n = SEC_RX.subn(lambda m: blk, body, count=1)
        if n != 1: raise SystemExit(f"shared block {name}: base {base} has no PUBLICATIONS/SELECTED section to replace")
    return body


def find_block(lines, ctx, old):
    pat = list(ctx) + list(old)
    return [i for i in range(len(lines) - len(pat) + 1) if lines[i:i + len(pat)] == pat]


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
    sig = AC.candidate().get("cover_signature") or []
    if not sig: raise SystemExit("candidate.yaml has no cover_signature")
    parts = [c["greeting"], *c["opening"], "\n".join("- " + b["text"] for b in c["bullets"]), *c["closing"], "\n".join(sig)]
    return "\n\n".join(parts) + "\n"


# ---------------- claims gates ----------------
def scope_of(pkg):
    return set(CC.scope_for(Path(pkg))) | {"all"}


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


# ---------------- build / check ----------------
def align_for(base):
    for v in PM.lanes().values():
        if v.get("base") == base and v.get("align"):
            return v["align"]
    return "justify"


def render(pkg, spec, md, cover, out):
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    for f in ("README.md", "jd.md", "company-research.md"):
        if (Path(pkg) / f).exists(): shutil.copy2(Path(pkg) / f, out / f)
    (out / "resume-native.md").write_text(md)
    cand = AC.candidate()
    R.render_resume(md, out / "resume.pdf", cand, align=align_for(spec["base"]))
    if cover is not None:
        (out / "cover.txt").write_text(cover)
        R.render_cover(cover, out / "cover.pdf", spec["cover"].get("date"), cand)
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
            a, b = R.pdf_text(pkg / f), R.pdf_text(Path(tmp) / f)
            rep[f + " (text)"] = d(a, b, f)
            pa, pb = R.page_count(pkg / f), R.page_count(Path(tmp) / f)
            if pa != pb: rep[f + " (pages)"] = f"{pa} -> {pb}"
    return {k: v for k, v in rep.items() if v}


def claims_gate(tmpdir, scope_pkg=None):
    """check_claims on the rendered files; the scope comes from the real package (README line or folder prefix)."""
    scope = ",".join(sorted(CC.scope_for(Path(scope_pkg or tmpdir))))
    r = CC.check_package(tmpdir, scope)
    return [f"CLAIMS {f['check']} [{f['where']}] {f['token']!r}: {f['sentence'][:140]} ({f['why']})" for f in r["fails"]]


def kept_gates(tmpdir):
    """the only code gates besides claims: the JD copy check and the format check."""
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
        except ValueError as e:     # the renderer refuses a resume it cannot lay out (e.g. a missing core section)
            return errs + [f"RENDER {e}"], {}
        errs += claims_gate(tmp, pkg)
        errs += kept_gates(tmp)
        rep = diff_report(pkg, md, cover, tmp)
    return errs, rep


def record_run(pkg, verdict="BUILT"):
    spec = yaml.safe_load((Path(pkg) / SPEC).read_text())
    return RV.record_run(pkg, verdict=verdict, source="build_package", base=spec["base"], claims_version=CL.load()["version"])


def builder_run_id(given=None):
    """the id of the run doing this build (--run-id or $APPLY_RUN_ID); reviewers must use a different id."""
    return given or os.environ.get("APPLY_RUN_ID") or f"build-{dt.datetime.now().strftime('%Y%m%dT%H%M%S')}-{os.getpid()}"


def record_builder(pkg, run_id):
    """append run_id to package.yaml builder_runs (text edit at the end, so the rest of the spec is untouched)."""
    p = Path(pkg) / SPEC; txt = p.read_text()
    have = [str(x) for x in (yaml.safe_load(txt).get("builder_runs") or [])]
    if run_id in have: return have
    txt = re.sub(r"(?ms)^builder_runs:\n(?:- .*\n?)*", "", txt).rstrip("\n") + "\n"
    have.append(run_id)
    txt += "builder_runs:\n" + "".join(f"- {json.dumps(x)}\n" for x in have)
    tmp = p.with_suffix(f".yaml.tmp{os.getpid()}"); tmp.write_text(txt); os.replace(tmp, p)
    return have


def init(pkg, base, company, title, url):
    p = Path(pkg).resolve(); p.mkdir(parents=True, exist_ok=True)
    if (p / SPEC).exists(): raise SystemExit(f"{p / SPEC} exists")
    bpath = bases_dir() / base / "resume-native.md"
    if not bpath.exists(): raise SystemExit(f"no base resume {bpath}")
    bh, bbody = split_md(bpath.read_text())
    hl = re.search(r"(?m)^\*\*Headline[^*]*\*\*\s*.+$", bh)
    if not hl: raise SystemExit(f"base {base} header has no **Headline ...:** line")
    pitch = re.search(r"(?m)^\*\*Pitch:\*\*\s*.+$", bh)
    name = AC.candidate().get("name") or "Candidate"
    head = (f"# {name}, Resume (tailored for {company} {title})\n\n**Target:** {title}, {company}\n**URL:** {url}\n"
            f"**Base:** {base}\n{hl.group(0)}\n" + (f"{pitch.group(0)}\n" if pitch else ""))
    has_pub = bool(SEC_RX.search(bbody))
    shared = ["publications"] if (shared_dir() / "publications.md").exists() and has_pub else []
    spec = {"schema": "package-v1", "base": base, "scope": [], "resume": {"head": head, "shared": shared, "edits": []},
            "cover": {"date": dt.date.today().strftime("%B %-d, %Y"), "greeting": f"Dear {company} Hiring Team,", "opening": ["<one fit sentence>"],
                      "bullets": [{"text": "<Label.> <proof>", "claims": []}], "closing": [f"I'd welcome the chance to discuss the {title} role at {company}."]}}
    (p / SPEC).write_text(yaml.safe_dump(spec, sort_keys=False, allow_unicode=True, width=200))
    return p / SPEC


def check_base(name):
    b = bases_dir() / name
    with tempfile.TemporaryDirectory() as t:
        out = Path(t) / "resume.pdf"
        R.render_resume((b / "resume-native.md").read_text(), out, AC.candidate(), align=align_for(name))
        if not (b / "resume.pdf").exists():
            print(f"base {name}: rendered OK ({R.page_count(out)} pages); no resume.pdf to compare"); return 0
        same = R.pdf_text(b / "resume.pdf") == R.pdf_text(out)
        print(f"base {name}: resume.pdf text {'IDENTICAL' if same else 'DIFFERS'} ({R.page_count(out)} pages)")
        if not same: print("".join(difflib.unified_diff(R.pdf_text(b / "resume.pdf").splitlines(True), R.pdf_text(out).splitlines(True), "base pdf", "rendered", n=0))[:3000])
        return 0 if same else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pkg", nargs="?"); ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true"); ap.add_argument("--base")
    ap.add_argument("--init", metavar="BASE", help="write a skeleton package.yaml for a new package on BASE")
    ap.add_argument("--company"); ap.add_argument("--title"); ap.add_argument("--url")
    ap.add_argument("--accept-diff"); ap.add_argument("--record", action="store_true"); ap.add_argument("--json", action="store_true")
    ap.add_argument("--run-id", help="id of the run doing the build (default: $APPLY_RUN_ID or a generated id); recorded in package.yaml builder_runs")
    a = ap.parse_args()
    if a.base:
        sys.exit(check_base(a.base))
    if not a.pkg: ap.error("give a package folder")
    if a.init:
        if not (a.company and a.title): ap.error("--init needs --company and --title")
        f = init(a.pkg, a.init, a.company, a.title, a.url or "")
        print(f"wrote skeleton {f}: add edits (each citing claim ids) and the cover, then --check and --write"); return
    p = str(Path(a.pkg).resolve()); out = {}; bad = False
    if not (a.check or a.write): ap.error("give --check, --write or --init")
    if not (Path(p) / SPEC).exists(): sys.exit(f"{Path(p).name}: no {SPEC} (start with --init)")
    errs, rep = check_one(p)
    out[Path(p).name] = {"gate_errors": errs, "diffs": rep}
    status = "FAIL" if errs else ("SAME" if not rep else "DIFF")
    bad |= bool(errs)
    if not a.json:
        print(f"{status:4s} {Path(p).name}" + (f"  gate: {errs[:3]}" if errs else "") + (f"  diffs: {', '.join(rep)}" if rep else ""))
    if a.write:
        content = {k for k in rep if not k.endswith("(pages)")}
        new_pkg = not (Path(p) / "resume-native.md").exists()
        if errs:
            print("  not written: gate errors")
        elif content and not a.accept_diff and not new_pkg:
            print("  not written: content differs; show the diff to the candidate, then rerun with --accept-diff \"why\""); bad = True
        else:
            spec, md, cover, _ = build(p)
            with tempfile.TemporaryDirectory() as t:
                tmp = render(p, spec, md, cover, Path(t) / Path(p).name)
                for f in ("resume-native.md", "cover.txt", "resume.pdf", "cover.pdf"):
                    if (tmp / f).exists(): shutil.copy2(tmp / f, Path(p) / f)
            rid = builder_run_id(a.run_id); record_builder(p, rid)
            print(f"  written; builder run {rid}; package_runs #{record_run(p)}")
    elif a.record:
        print(f"  package_runs #{record_run(p)}")
    if a.json: print(json.dumps(out, indent=1))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
