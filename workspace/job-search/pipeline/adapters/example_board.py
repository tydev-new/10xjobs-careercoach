"""Sample adapter. Offline, fixture only. Not a live board.

Copy this file to adapters/<type>.py when the ATS is new. Point fetch at the real
endpoint the way the closest fetch_* in sweep.py does. Leave this sample disabled
in sources.yaml. Discovery test: sweep.py --test-one example_board:demo
"""

import json
import os

TYPE = "example_board"

_FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures", "example_board.json")


def _stats():
    return {"requests": 0, "ok": 0, "failed": 0, "fetched": 0, "gap": None, "errors": []}


def fetch(cfg, since, ctx):
    """Read the invented fixture. cfg['slug'] limits rows that name a slug. No network."""
    st, out = _stats(), []
    path = (cfg or {}).get("fixture") or _FIXTURE
    st["requests"] = 1
    try:
        rows = json.load(open(path))
    except Exception as e:
        st["failed"] = 1
        st["errors"].append(f"fixture:{type(e).__name__}: {e}")
        return out, st
    st["ok"] = 1
    want = (cfg or {}).get("slug")
    for row in rows:
        if want and row.get("slug") and row.get("slug") != want:
            continue
        st["fetched"] += 1
        out.append({
            "source": "ats:example_board",
            "company": (row.get("company") or "").strip(),
            "title": (row.get("title") or "").strip(),
            "location": (row.get("location") or "").strip(),
            "url": row.get("url"),
            "posted_at": row.get("posted_at"),
            "pay": row.get("pay"),
            "req": row.get("req"),
            "tag": row.get("tag"),
            "extra": row.get("extra") or {},
        })
    return out, st
