"""Shared schemas for the sweep (generic; no user data).

1. sources.yaml input schema (JSON Schema). validate_sources() checks the whole file, drops bad board/agency
   entries with a clear error instead of crashing, and returns the cleaned config plus the error list.
2. JobRecord (Pydantic): the one job-record model every source's output must pass before a DB insert.
   Records that fail go to the `rejected` table with the reason.
"""
import datetime as dt
import re
from typing import Literal, Optional

import jsonschema
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

ATS_TYPES = ["ashby", "greenhouse", "lever", "smartrecruiters", "workday", "linkedin", "usajobs", "neogov",
             "calcareers", "getro", "a16z", "hn", "hiring_cafe", "web", "referral", "manual"]
BOARD_ATS = ["ashby", "greenhouse", "lever", "smartrecruiters"]
SLUG = r"^[A-Za-z0-9][A-Za-z0-9._%-]{0,80}$"   # %20 occurs in real Ashby slugs

BOARD_SCHEMA = {
    "type": "object",
    "required": ["company"],
    "properties": {
        "company": {"type": "string", "minLength": 1, "maxLength": 120},
        "ats_type": {"enum": ATS_TYPES},
        "slug": {"type": "string", "pattern": SLUG},
        "url": {"type": "string", "pattern": r"^https?://\S+$"},
        "keywords": {"type": "array", "items": {"type": "string", "minLength": 1}},
        "tag": {"type": "string"},
        "note": {"type": "string"},
        "added": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
        "why": {"type": "string"},
    },
    "anyOf": [{"required": ["slug"]}, {"required": ["url"]}],
    "additionalProperties": False,
}
AGENCY_SCHEMA = {"type": "object", "required": ["slug"], "properties": {
    "slug": {"type": "string", "pattern": SLUG}, "name": {"type": "string"}}, "additionalProperties": True}
GETRO_SCHEMA = {"type": "object", "required": ["firm", "host"], "properties": {
    "firm": {"type": "string", "pattern": SLUG}, "host": {"type": "string", "pattern": r"^[a-z0-9.-]+\.[a-z]{2,}$"}}}
LI_QUERY_SCHEMA = {"type": "object", "required": ["id", "q", "geo_id"], "properties": {
    "id": {"type": "string"}, "q": {"type": "string", "minLength": 2}, "geo_id": {"type": ["string", "integer"]},
    "remote": {"type": "boolean"}}}

TOP_SCHEMA = {
    "type": "object",
    "required": ["version", "window", "lanes", "geo", "sources"],
    "properties": {
        "version": {"type": "integer"},
        "window": {"type": "object", "required": ["default_hours"], "properties": {
            "default_hours": {"type": "number", "exclusiveMinimum": 0}, "overlap_minutes": {"type": "number", "minimum": 0}}},
        "lanes": {"type": "object", "minProperties": 1, "additionalProperties": {"type": "array", "items": {"type": "string"}, "minItems": 1}},
        "exclude_title": {"type": "array", "items": {"type": "string"}},
        "exclude_company": {"type": "array", "items": {"type": "string"}},
        "geo": {"type": "object", "required": ["include", "exclude", "remote_us", "non_us"],
                "properties": {"remote_filter_cards": {"enum": ["verify", "drop"]}, "unknown_location": {"enum": ["keep", "drop"]}}},
        "sources": {"type": "object", "additionalProperties": {"type": "object", "properties": {"enabled": {"type": "boolean"}}}},
        "health": {"type": "object", "properties": {"retries": {"type": "integer", "minimum": 0, "maximum": 5},
                                                    "retry_pause_seconds": {"type": "number", "minimum": 0},
                                                    "history_runs": {"type": "integer", "minimum": 2},
                                                    "empty_streak": {"type": "integer", "minimum": 1}}},
    },
}

def _regex_errors(cfg):
    errs = []
    pats = [("lanes." + k, p) for k, v in (cfg.get("lanes") or {}).items() for p in v]
    pats += [("exclude_title", p) for p in cfg.get("exclude_title") or []] + [("exclude_company", p) for p in cfg.get("exclude_company") or []]
    pats += [("geo." + k, p) for k, v in (cfg.get("geo") or {}).items() if isinstance(v, list) for p in v]
    for where, p in pats:
        try:
            re.compile(p)
        except re.error as e:
            errs.append(f"{where}: bad regex {p!r}: {e}")
    return errs

def check_board(entry, ats_type):
    """-> error string or None. Used for sources.yaml entries and for sources the model proposes."""
    e = dict(entry)
    e.setdefault("ats_type", ats_type)
    try:
        jsonschema.validate(e, BOARD_SCHEMA)
    except jsonschema.ValidationError as ex:
        return f"{ats_type} entry {entry.get('company') or entry.get('slug') or entry}: {ex.message}"
    if e["ats_type"] != ats_type:
        return f"{ats_type} entry {e.get('company')}: ats_type {e['ats_type']} does not match list {ats_type}"
    return None

def validate_sources(cfg):
    """-> (clean_cfg, errors). Raises ValueError only when the file's top-level structure is unusable."""
    try:
        jsonschema.validate(cfg, TOP_SCHEMA)
    except jsonschema.ValidationError as ex:
        raise ValueError(f"sources.yaml is invalid at {'/'.join(map(str, ex.absolute_path)) or '(top)'}: {ex.message}")
    errors = _regex_errors(cfg)
    if any(e.startswith("lanes") or e.startswith("geo") for e in errors):
        raise ValueError("sources.yaml has unusable regexes: " + "; ".join(errors))
    srcs = dict(cfg["sources"])
    for ats in BOARD_ATS:
        if ats in srcs:
            good = []
            for b in srcs[ats].get("boards") or []:
                err = check_board(b, ats) if isinstance(b, dict) else f"{ats} entry {b!r}: not a mapping"
                (errors.append(err) if err else good.append(b))
            srcs[ats] = {**srcs[ats], "boards": good}
    gov = srcs.get("gov")
    if gov:
        gov = dict(gov)
        for sub, schema, key in (("neogov", AGENCY_SCHEMA, "agencies"), ("smartrecruiters_gov", None, "boards")):
            if sub in gov:
                good = []
                for a in gov[sub].get(key) or []:
                    if schema:
                        try: jsonschema.validate(a, schema); good.append(a)
                        except jsonschema.ValidationError as ex: errors.append(f"gov.{sub} {a}: {ex.message}")
                    else:
                        err = check_board(a, "smartrecruiters")
                        (errors.append("gov." + err) if err else good.append(a))
                gov[sub] = {**gov[sub], key: good}
        srcs["gov"] = gov
    for name, schema, key in (("getro", GETRO_SCHEMA, "boards"), ("linkedin_guest", LI_QUERY_SCHEMA, "queries")):
        if name in srcs:
            good = []
            for x in srcs[name].get(key) or []:
                try: jsonschema.validate(x, schema); good.append(x)
                except jsonschema.ValidationError as ex: errors.append(f"{name}.{key} {x}: {ex.message}")
            srcs[name] = {**srcs[name], key: good}
    return {**cfg, "sources": srcs}, errors

# ------------------------------------------------------------------ output: one job record
def ats_type_of(source):
    s = (source or "").lower()
    for pre, t in (("ats:", None), ("li:", "linkedin"), ("gov:usajobs", "usajobs"), ("gov:neogov", "neogov"), ("gov:smartrecruiters", "smartrecruiters"),
                   ("gov:calcareers", "calcareers"), ("vc:a16z", "a16z"), ("vc:", "getro"), ("workday", "workday"), ("hn", "hn"),
                   ("hiring.cafe", "hiring_cafe"), ("referral", "referral"), ("peer:", "web"), ("news:", "web"), ("web", "web")):
        if s.startswith(pre):
            return t or s.split(":", 1)[1].split(":")[0]
    return "manual"

class JobRecord(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    company: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=2, max_length=300)
    url: str = Field(pattern=r"^https?://[^\s]+$", max_length=2000)
    source: str = Field(min_length=2, max_length=80, pattern=r"^[a-z][a-z0-9:._\-]*$")
    ats_type: Literal[tuple(ATS_TYPES)]
    found_date: dt.date
    req_id: Optional[str] = Field(default=None, max_length=120)
    location: Optional[str] = Field(default=None, max_length=1000)
    pay: Optional[str] = Field(default=None, max_length=300)
    jd_text: Optional[str] = Field(default=None, max_length=200_000)

    @field_validator("company", "title")
    @classmethod
    def _no_markup(cls, v):
        if re.search(r"<[a-z/][^>]*>", v, re.I):
            raise ValueError("contains HTML markup")
        if "\n" in v:
            raise ValueError("contains a line break")
        return v

def _clip(v, n):
    """long free-text pay/location blurbs are trimmed, not rejected (a long pay note is not a bad record)."""
    v = " ".join(str(v).split()) if v else None
    return (v[: n - 1] + "…") if v and len(v) > n else v

def record_from_posting(p, found_date=None):
    """sweep posting dict -> JobRecord (raises ValidationError)."""
    return JobRecord(company=p.get("company") or "", title=p.get("title") or "", url=p.get("url") or "", source=p.get("source") or "",
                     ats_type=ats_type_of(p.get("source")), found_date=found_date or dt.date.today(), req_id=p.get("req") or None,
                     location=p.get("location") or None, pay=_clip(p.get("pay"), 300), jd_text=p.get("jd_text"))

def explain(e: ValidationError):
    return "; ".join(f"{'.'.join(map(str, x['loc'])) or 'record'}: {x['msg']}" for x in e.errors())
