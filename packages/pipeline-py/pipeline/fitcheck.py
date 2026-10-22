"""Structured fit output (step 6 of the search skill) and its code check.
Every fit result is validated here before it is saved (score.py) or graded (evals/run.py)."""
import os, re
from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

DEALBREAKERS = ["geo", "pay", "clearance", "sponsorship", "seniority", "stage", "off-lane", "contract", "company-in-play", "other"]
CALLS = ["Strong", "Solid", "Stretch", "Weak", "Skip"]

def combined_fit(want, win, blockers=0):
    """two-way rule: Strong only when want=pass AND win=high with no blockers."""
    if want == "fail": return "Skip"
    if want != "pass" or not win: return None
    if win == "high" and not blockers: return "Strong"
    if win in ("high", "medium"): return "Solid"
    return "Weak" if blockers else "Stretch"

class MustHave(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    need: str = Field(min_length=3, max_length=300)
    proof: Optional[str] = Field(default=None, max_length=400)   # None/empty = gap

class FitResult(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    want: Literal["pass", "fail"]
    want_reasons: List[str] = Field(min_length=1)
    dealbreakers: List[Literal[tuple(DEALBREAKERS)]] = Field(default_factory=list)
    win: Optional[Literal["high", "medium", "low"]] = None
    must_haves: List[MustHave] = Field(default_factory=list)
    gaps: List[str] = Field(default_factory=list)
    blockers: List[str] = Field(default_factory=list)
    reason: str = Field(min_length=10, max_length=800)
    remote_check: Optional[Literal["local", "remote-us", "out-of-area", "unverified"]] = None  # verified from JD / ATS location
    call: Optional[Literal[tuple(CALLS)]] = None

    @model_validator(mode="after")
    def _consistent(self):
        if self.want == "fail" and not self.dealbreakers:
            raise ValueError("want=fail needs at least one dealbreaker code")
        if self.want == "pass" and self.dealbreakers:
            raise ValueError("want=pass cannot list dealbreakers")
        if self.want == "pass" and not self.win:
            raise ValueError("want=pass needs win (high/medium/low)")
        if self.want == "pass" and not self.must_haves:
            raise ValueError("want=pass needs the JD must-haves with proof or gaps")
        if self.remote_check == "out-of-area" and (self.want != "fail" or "geo" not in self.dealbreakers):
            raise ValueError("remote_check=out-of-area (on-site/hybrid outside the area) must be want=fail with dealbreaker geo")
        derived = combined_fit(self.want, self.win, len(self.blockers))
        if self.call and self.call != derived:
            raise ValueError(f"call {self.call} does not follow the two-way rule (expected {derived})")
        self.call = derived
        return self

PROMPT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scoring-prompt.md")

def render_prompt(criteria, resume, posting, path=PROMPT_PATH):
    """fill the one shared step-6 scoring prompt (scoring-prompt.md); used by score.py (live) and evals/run.py (eval gate)."""
    t = open(path).read()
    return (t.replace("{criteria}", criteria or "").replace("{resume}", resume or "").replace("{company}", posting.get("company") or "")
             .replace("{title}", posting.get("title") or "").replace("{location}", posting.get("location") or "n/a")
             .replace("{pay}", posting.get("pay") or "not posted").replace("{jd_text}", posting.get("jd_text") or ""))

_STOP = set("""a an and or the of in on for to with at by from as is are be not no none any all only own
experience experienced years year yrs yr plus required preferred nice must strong solid deep hands proven work working
knowledge skills skill ability using use used production level senior lead team teams resume role job""".split())

def _keys(t):
    """distinctive words of a requirement: lowercased, split on non-alphanumerics, stop words and 1-2 letter tokens dropped."""
    return {w.rstrip("s") for w in re.split(r"[^a-z0-9]+", (t or "").lower()) if len(w) > 2 and w not in _STOP}

def unaccounted_must_haves(result):
    """must-haves with no proof that no gap or blocker covers (shares a distinctive word with).
    Empty list = every must-have is proven or listed in gaps/blockers (eval check d)."""
    raw = list(result.gaps) + list(result.blockers)
    listed = [_keys(g) for g in raw]
    norm = lambda t: " ".join(re.split(r"[^a-z0-9]+", (t or "").lower())).strip()
    out = []
    for m in result.must_haves:
        if m.proof and m.proof.strip():
            continue
        k = _keys(m.need)
        covered = any(k & g for g in listed) if k else any(norm(m.need) and norm(m.need) in norm(g) for g in raw)
        if not covered:
            out.append(m.need)
    return out

def check(obj):
    """-> (FitResult, None) or (None, error text)"""
    try:
        return FitResult.model_validate(obj), None
    except ValidationError as e:
        return None, "; ".join(f"{'.'.join(map(str, x['loc'])) or 'result'}: {x['msg']}" for x in e.errors())
