"""Optional: pick the base resume from a job title. Return None to fall back to scoring.yaml lane_to_base."""
import re


def base_for(title):
    t = (title or "").lower()
    if re.search(r"\bmanager\b|\bhead of\b", t):
        return "eng-manager"
    if re.search(r"engineer|developer|\bsre\b", t):
        return "ic-builder"
    return None
