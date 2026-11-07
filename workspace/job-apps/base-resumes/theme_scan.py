#!/usr/bin/env python3
"""Scan every jd.md under <apps-workspace>, classify by package prefix, count JD-level theme frequency."""

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

import re, glob, os, json, collections
ROOT=str(_JOBBI_APPS)
TYPE={"tpm":"TPM","fde":"SOL","sol":"SOL","solutions":"SOL","eng":"EM"}
THEMES = {
 "Build and lead TPMs / program managers": r"(lead|build|manage|mentor|coach|develop|hire)[^.\n]{0,40}(tpms|program managers|technical program management team)",
 "Cross-functional program execution / alignment": r"cross[- ]functional|cross[- ]org|across (teams|organizations|functions)|dependenc",
 "Roadmap / strategy into plans and milestones": r"roadmap|milestone|translate .{0,40}(strategy|priorities|goals)|multi[- ]quarter|program strategy|execution plan",
 "Risk, issue, and escalation management": r"\brisks?\b|escalat|blocker|mitigat",
 "Executive / senior stakeholder communication": r"executive|senior leadership|c-level|leadership team|stakeholder|leadership (updates|reviews)",
 "Process, operating rhythm, scalable mechanisms": r"operating (rhythm|model|mechanism|cadence)|process(es)? (improvement|that)|scalable process|best practices|playbook|repeatable|frameworks?",
 "SDLC / Agile / release management": r"\bsdlc\b|agile|scrum|sprint|release (process|planning|management|schedule|criteria)|software development lifecycle|ci/cd|continuous integration",
 "Mentor / build / lead a team": r"mentor|coach|hire|hiring|recruit|build(ing)? (and|a) (lead|team)|grow (a|the) team|develop(ing)? (engineers|managers|the team)|people (management|leader)|performance (management|reviews)",
 "Technical depth (architecture, design reviews)": r"architect|technical design|design review|system design|technical decision",
 "Cloud / infrastructure / distributed systems": r"\bcloud\b|aws|gcp|azure|infrastructure|distributed systems|kubernetes|compute|data ?center",
 "Data-driven metrics, KPIs, reporting": r"metrics|kpis?\b|dashboards?|data[- ]driven|reporting|measur",
 "AI / LLM / agents": r"\bai\b|\bllms?\b|machine learning|\bml\b|\bagent(s|ic)?\b|generative|genai",
 "Customer adoption / value / outcomes": r"adoption|time[- ]to[- ]value|customer (success|outcomes|value|health)|value realization|retention",
 "Discovery, POC/pilot, technical validation": r"discovery|proof[- ]of[- ]concept|\bpocs?\b|pilot|technical validation|evaluation|demo",
 "Production deployment / implementation / integration": r"deploy|implementation|integrat|go[- ]live|rollout|into production|production (environment|workload|integration|deployment)",
 "Executive sponsor / trusted advisor relationship": r"trusted advisor|executive sponsor|relationship|account (plan|strategy)|strategic accounts?",
 "Field feedback into product / roadmap": r"(feedback|insights?|voice of the customer|field evidence).{0,80}(product|roadmap|engineering)|(product|roadmap).{0,40}(feedback|insights)",
 "Partner with Sales / GTM, pre-sales": r"sales|go[- ]to[- ]market|\bgtm\b|account executive|\baes?\b|revenue|pipeline|pre[- ]sales",
 "Reusable assets: reference architectures, playbooks, enablement": r"reference architecture|playbook|runbook|enablement|templates?|reusable|best practices",
 "Hands-on coding / stays technical": r"hands[- ]on|write (production )?code|coding|python|typescript|pull requests|code review",
 "Quality, reliability, incidents, RCA": r"quality|reliab|incident|root cause|\brca\b|on[- ]call|observability|uptime|sla",
 "Predictable delivery, velocity, on-time execution": r"predictab|velocity|on[- ]time|throughput|deliver(ing|y)? (on time|predictabl|high[- ]quality|results)|bring programs to completion|end[- ]to[- ]end (delivery|execution)",
 "Partner with Product Management": r"product manage|product managers?|product partners|partner with product|\bpms?\b",
 "Security / compliance / regulated": r"security|compliance|hipaa|soc ?2|regulat|fda|fedramp|privacy",
 "Budget / capacity / resourcing": r"budget|capacity|resourc|headcount|staffing",
 "Modernization / migration / legacy to cloud": r"moderniz|migrat|legacy|re-?architect",
}
seen=set(); rows=collections.defaultdict(list)
for p in sorted(glob.glob(ROOT+"/**/jd.md", recursive=True)):
    slug=os.path.basename(os.path.dirname(p)); key=slug
    if key in seen: continue
    seen.add(key)
    t=TYPE.get(slug.split("-")[0])
    if not t: continue
    raw=open(p,errors="ignore").read()
    txt="\n".join(l for l in raw.splitlines() if re.match(r"\s*([-*\u2022]|\d+[.)])\s+\S",l))
    if len(txt)<200: txt=raw
    # company = 2nd token of slug
    comp=slug.split("-")[1]
    hits=[th for th,rx in THEMES.items() if re.search(rx,txt,re.I)]
    rows[t].append((slug,comp,hits))
res={}
for t,lst in rows.items():
    c=collections.Counter(); ex=collections.defaultdict(list)
    for slug,comp,hits in lst:
        for h in hits:
            c[h]+=1
            if comp not in ex[h] and len(ex[h])<5: ex[h].append(comp)
    res[t]={"n":len(lst),"themes":[(th,n,ex[th]) for th,n in c.most_common()], "slugs":[s for s,_,_ in lst]}
json.dump(res,open(ROOT+"/base-resumes/theme_scan.json","w"),indent=1)
for t in ("TPM","SOL","EM"):
    print(f"\n=== {t}: {res[t]['n']} JDs")
    for th,n,ex in res[t]["themes"]:
        print(f"{n:3d} {round(100*n/res[t]['n']):3d}%  {th}  [{', '.join(ex)}]")
