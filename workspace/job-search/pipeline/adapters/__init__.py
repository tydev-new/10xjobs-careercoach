"""Load source adapters from this folder so a new ATS does not require a sweep.py edit.

A module is an adapter when it defines TYPE (str) and fetch(cfg, since, ctx) -> (postings, stats).
Files whose names start with _ are ignored. TYPE is also added to schema.ATS_TYPES when it is new,
so a posting with source ats:<TYPE> passes JobRecord. A name sweep.py already fetches is ignored.
"""

import importlib.util
import os

import schema as SC


def load(directory=None):
    """-> (fetchers, errors). fetchers maps TYPE to fetch. errors are import failures."""
    folder = directory or os.path.dirname(os.path.abspath(__file__))
    found, errors = {}, []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".py") or name.startswith("_"):
            continue
        path = os.path.join(folder, name)
        mod_name = "job_search_adapter_" + name[:-3]
        try:
            spec = importlib.util.spec_from_file_location(mod_name, path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        except Exception as e:
            errors.append(f"{name} failed to load: {type(e).__name__}: {e}")
            continue
        type_name = getattr(mod, "TYPE", None)
        fetch = getattr(mod, "fetch", None)
        if not isinstance(type_name, str) or not type_name or not callable(fetch):
            continue
        found[type_name] = fetch
        ats = getattr(mod, "ATS_TYPE", None) or type_name
        if isinstance(ats, str) and ats and ats not in SC.ATS_TYPES:
            SC.ATS_TYPES.append(ats)
    return found, errors


def merge(shipped, found):
    """shipped names win. -> (merged, errors)."""
    merged, errors = dict(shipped), []
    for name, fn in found.items():
        if name in shipped:
            errors.append(f"adapter {name} ignored; sweep.py already fetches that type")
            continue
        merged[name] = fn
    return merged, errors
