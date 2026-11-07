#!/usr/bin/env python3
"""Create a NEW disposable private kit and invented fixtures using original tools.
Not onboarding, not a review, not permission to apply. Generated PDFs/DBs never belong
in the public distribution. Network is unnecessary; run under a network-denied test env.
"""
from pathlib import Path
import argparse,json,os,subprocess,sys,yaml,shutil
p=argparse.ArgumentParser(description=__doc__);p.add_argument("root",type=Path);a=p.parse_args()
source=Path(__file__).resolve().parents[1];root=a.root.absolute()
if root.exists():raise SystemExit("test root must be NEW")
subprocess.run([sys.executable,str(source/"setup/bootstrap.py"),str(root)],check=True)
os.environ.update(JOBBI_ROOT=str(root),JOBSEARCH_WORKSPACE=str(root/"workspace/job-search"),PYTHONDONTWRITEBYTECODE="1")
for k in ("STAMP_REVIEW_DB","PRECHECK_DB","PRECHECK_NO_LINK"):os.environ.pop(k,None)
apps=root/"workspace/job-apps";search=root/"workspace/job-search";tools=apps/"tools"
policy=yaml.safe_load((search/"profile/policy.yaml").read_text())
policy.update(synthetic=True,max_review_rounds=2,pay_floor=110000,travel_max=11,age_cutoff_year=2095,
 max_pages=4,summary_bullets=[2,5],experience_words=70,summary_words=65,sentence_words=24,
 experience_soft_words=26,summary_soft_words=12,hide_graduation_years=True,
 home_area_regex="example city",excluded_area_regex="excluded example city",restrict_onsite_to_home=True,
 clearance_block_regex="(?i)security clearance",hard_gap_terms=[["ExampleLang","ExampleLang"],["example-training","example-training"]])
(search/"profile/policy.yaml").write_text(yaml.safe_dump(policy))
candidate=yaml.safe_load((search/"profile/candidate.yaml").read_text());candidate["standing_answer_rules"]=[{"question_rx":"(?i)sponsorship","answer_rx":"(?i)^no$"}]
candidate["selected_work_md"]="**Card Atlas.** A fictional exercise in sorting sample cards."
(search/"profile/candidate.yaml").write_text(yaml.safe_dump(candidate))
claims=yaml.safe_load((search/"profile/claims.yaml").read_text())
claims["banned"]=[{"rx":"pretend omniscience|all imaginary colors","why":"explicitly invented fixture rule"}]
claims["scoped_phrases"]=[{"rx":"pretend orchard audit","scopes":["health"],"why":"invented scoped phrase"}]
claims["claims"].append({"id":"example.unapproved","status":"unconfirmed","text":"Imaginary unverified orchard outcome.","scope":["all"],"numbers":[],"anchors":["orchard"],"source":"invented negative fixture"})
next(c for c in claims["claims"] if c["id"]=="example.cards")["forbid_with"]=["impossible certification"]
(search/"profile/claims.yaml").write_text(yaml.safe_dump(claims,sort_keys=False))
terms={"banned":[{"rx":"ExampleLang|all imaginary colors","why":"ExampleLang and all imaginary colors are invented banned tokens"}],"age_signal":["decades"],"warn":[],"case_sensitive":[],"legacy_top":[],"fixed_facts":{"companies":[{"prefix":"Example Workshop","header":"Example Workshop, Project Contributor","dates":"2097 – 2099"}],"selected_work_first_regex":r"\*\*Card Atlas","contact":["alex@example.invalid"]}}
(tools/"precheck_terms.yaml").write_text(yaml.safe_dump(terms))
for name in ("contacts","stories","prep"):(search/name).mkdir(exist_ok=True)
for base in (apps/"base-resumes").glob("*/resume-native.md"):
 text=base.read_text().replace("\n\n**Earlier career:**", "\n- Built fictional intake-label matching for a toy exercise.\n\n**Earlier career:**")
 base.write_text(text)
shared=apps/"base-resumes/_shared/publications.md";shared.write_text("## SELECTED WORK\n"+candidate["selected_work_md"]+"\n")
sys.path[:0]=[str(root),str(search/"pipeline"),str(tools),str(apps/"lib"),str(tools/"tests")]
import jobsdb as J,precheck as PC,reconcile_reviews as RR,package_fixtures as F

def run(*args):
 r=subprocess.run([sys.executable,*map(str,args)],text=True,capture_output=True)
 if r.returncode:raise RuntimeError(str(args)+"\n"+r.stdout+"\n"+r.stderr)
 return r

summary=["Built a synthetic intake demonstration for Example Workshop, keeping the fictional labels readable and explaining the toy steps to imaginary peers.","Sorted 17 sample cards by fictional tag.","Used Python for a fictional card-sorting exercise."]

def fixture(rel,cover):
 pkg=apps/"tests/synthetic-fixtures"/rel;pkg.parent.mkdir(parents=True,exist_ok=True)
 init=[tools/"build_package.py",pkg,"--init",("tpm" if cover else "ic-builder"),"--company","Synthetic Workshop","--title","Card Curator "+rel,"--url","https://jobs.example.invalid/"+rel]
 if cover:init.append("--cover")
 run(*init)
 (pkg/"jd.md").write_text("https://jobs.example.invalid/"+rel+"\nSYNTHETIC posting only.\n"+("A fictional organization invites a contributor to communicate clearly with imaginary teammates, organize illustrative materials and explain the reasoning behind toy decisions. This invented vacancy has no actual employer, applicant or real eligibility condition. "*4))
 (pkg/"company-research.md").write_text("SYNTHETIC research only. https://company.example.invalid/fictional\n"+("This entirely invented organization is a testing construct, not a real opportunity or target. "*4))
 (pkg/"README.md").write_text("SYNTHETIC CONTRACT FIXTURE ONLY; NOT REAL REVIEW OR CONSENT\nClaims scope: all\n")
 (pkg/"form.json").write_text(json.dumps({"cover_required":cover,"questions":[]}))
 spec=yaml.safe_load((pkg/"package.yaml").read_text());spec["scope"]=["all"]
 spec["resume"]["edits"]=[{"ctx_before":["## SUMMARY"],"old":["- Built a synthetic intake demonstration for Example Workshop."],"new":["- "+s for s in summary],"claims":["example.delivery","example.cards","example.stack"]}]
 if cover:spec["cover"]={**spec["cover"],"greeting":"Dear Synthetic Workshop Hiring Team,","opening":["I am interested in this fictional card-curator exercise."],"bullets":[{"text":"Cards. Sorted 17 sample cards by fictional tag.","claims":["example.cards"]}],"closing":["This is a synthetic letter fixture only."]}
 if cover and rel.startswith("scenario-3/"):
  spec["cover"]["bullets"] += [{"text":"Intake. Built fictional intake-label matching for a toy exercise.","claims":["example.intake"]},{"text":"Stack. Used Python for a fictional card-sorting exercise.","claims":["example.stack"]}]
 (pkg/"package.yaml").write_text(yaml.safe_dump(spec,sort_keys=False))
 with J.locked():
  c=J.connect();jid=J.insert_job(c,company="Synthetic Workshop",title="Card Curator "+rel,source="test",req_id="fixture-"+rel,url="https://jobs.example.invalid/"+rel);J.set_status(c,jid,"To Review",by="synthetic fixture",package=str(pkg));c.commit();c.close()
 run(search/"pipeline/score.py","--id",jid,"--want","pass","--win","high","--must","synthetic intake :: fictional exercise","--gap","Rust systems programming","--remote","unverified","--reason","Synthetic test fixture, not a candidacy judgment.")
 run(tools/"build_package.py",pkg,"--write","--run-id","synthetic-builder-"+rel.replace("/","-"))
 pre=PC.run(pkg)
 if pre["fail"]:raise RuntimeError(str(pre["fail"]))
 review={"schema":"combined-review-v1","package":pkg.name,"reviewer_run_id":"synthetic-review-"+rel.replace("/","-"),"rubric_version":RR.live_rubric(),"reviewed_at":"2099-01-01T00:00:00Z","reviewed_files_sha256":RR.file_hashes(pkg),"precheck":"Synthetic contract fixture only","round":1,"verdict":"PASS","docs":[{"doc":"resume","verdict":"PASS","summary":"Synthetic contract, not real approval."}]+([{"doc":"cover","verdict":"PASS","summary":"Synthetic contract only."}] if cover else []),"angles":{k:{"verdict":"PASS","summary":"Invented contract fixture, not a genuine review.","findings":[]} for k in RR.LENSES},"top_rejection_reason":"No real candidacy asserted.","answered":True,"keywords":[{"term":s,"aliases":[]} for s in ["synthetic","intake","demonstration","Example","Workshop","Contributor","sample","cards"]],"gap_handling":[{"item":"Rust systems programming","kind":"gap","terms":["Rust"],"handling":"omitted","reason":"No approved Rust evidence in this invented exercise."}],"best_candidate":[{"ask":"Fictional requirement "+s,"proof_claim_ids":["example.delivery"],"on_resume":"yes","evidence":"Synthetic exercise","suggested_line":None} for s in ["alpha","beta","gamma"]],"rejection_reasons":[{"reason":"No actual candidacy is asserted.","outcome":"not_a_risk","reason_not_risk":"Only a synthetic contract fixture."}],"precheck_warns":[{"id":PC.warn_id(w),"action":"accepted","reason":"Explicit synthetic fixture condition."} for w in pre["warn"]],"residual_gaps":[]}
 (pkg/"reviews").mkdir();(pkg/"reviews/combined.json").write_text(json.dumps(review))
 run(tools/"finalize_review.py",pkg)
 F.lensify(pkg);(pkg/"reviews/combined.json").unlink()
 run(tools/"finalize_review.py",pkg)
 # Legacy baseline is genuinely reconciled and stamped by the original tools.
 run(tools/"reconcile_reviews.py",pkg)
 run(tools/"stamp_review.py",pkg)
 print("SYNTHETIC fixture:",rel,flush=True)

for rel in ["scenario-1","scenario-5","scenario-7","fixture-nocover-a","scenario-3/fixture-nocover-a","scenario-3/fixture-nocover-b","scenario-3/fixture-nocover-c"]:fixture(rel,False)
for rel in ["scenario-2","scenario-4","scenario-6","fixture-cover-a","fixture-stamp-cover","scenario-3/fixture-cover-a","scenario-3/fixture-cover-b"]:fixture(rel,True)
# Exercise date-based queue discovery using invented private daily copies.
daily=apps/"daily-2099-01-01";daily.mkdir()
for name in ("fixture-nocover-a","fixture-cover-a"):
 shutil.copytree(apps/"tests/synthetic-fixtures"/name,daily/name)
# Tiny invented eval corpus exercises the original harness, not historical calibration quality.
for case_set in (apps/"evals/cases", apps/"evals/calibration/cases"):
 for name,bad in (("synthetic-cards-pass",False),("synthetic-cards-metric-fail",True)):
  case=case_set/name;case.mkdir(parents=True)
  shutil.copytree(apps/"tests/synthetic-fixtures/fixture-nocover-a",case/"pkg")
  if bad:
   resume=case/"pkg/resume-native.md"
   resume.write_text(resume.read_text().replace("17 sample cards","53 sample cards"))
  expected={"verdict":"FAIL" if bad else "PASS","source_package":"fixture-nocover-a","checks":["CLAIMS"] if bad else [],"lens_should_fail":"age_signal_claims","code_detectable":True,"synthetic":True}
  if "calibration" in str(case_set):expected["axes"]={"writing":"FAIL" if bad else "PASS","fit":"PASS"}
  (case/"expected.json").write_text(json.dumps(expected))
  (case/"step6.json").write_text(json.dumps({"schema":"step6-v1","job_id":1,"gaps":["Rust systems programming"],"blockers":[]}))
run(apps/"evals/run.py","--save-baseline","--check")
run(apps/"evals/run.py","--set","calibration","--save-baseline","--check")
good=apps/"evals/synthetic-outputs";good.mkdir()
for case in (apps/"evals/cases").iterdir():
 rv=json.loads((case/"pkg/review.json").read_text())
 if "fail" in case.name:
  rv["final"]="FAIL"
  for lens in rv["lenses"]:
   if lens["lens"]=="age_signal_claims":lens["verdict"]="Fail"
 (good/(case.name+".t1.json")).write_text(json.dumps(rv))
run(apps/"evals/run.py","--backend","file","--outputs",good,"--save-baseline","--check")
print("Generated invented runtime-only fixtures. No personal snapshot, baseline, contact or permission imported.")
