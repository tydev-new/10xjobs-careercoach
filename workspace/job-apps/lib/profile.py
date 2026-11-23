#!/usr/bin/env python3
"""Read workspace/job-search/profile/profile.yaml.

Identity, the eight intake answers, lane rules, and the criteria note live here.
Claims stay in claims.yaml. Tuning stays in policy.yaml. Paths stay in agent-config.yaml.

  python3 profile.py            print the profile
  python3 profile.py identity   name and contact, without the address
  python3 profile.py value <field>
  python3 profile.py prompt     criteria text plus answered fields, for scoring
"""
from pathlib import Path
import copy, os, re, sys
import yaml

def kit_root():
    return Path(os.environ.get("JOBBI_ROOT", Path(__file__).resolve().parents[3]))

def profile_path(root=None):
    return Path(root or kit_root()) / "workspace/job-search/profile/profile.yaml"

def load(root=None):
    path = profile_path(root)
    if not path.is_file():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    return data if isinstance(data, dict) else {}

def identity(root=None):
    found = load(root).get("identity")
    return dict(found) if isinstance(found, dict) else {}

def record(name, root=None):
    fields = load(root).get("fields") or {}
    if not isinstance(fields, dict):
        return None
    row = fields.get(name)
    if isinstance(row, dict) and row.get("explicit") is True:
        return row
    return None

def value(name, root=None, default=None):
    row = record(name, root)
    if row is None:
        return default
    return row.get("value", default)

def criteria_for_prompt(root=None):
    """Criteria note, lane rules, and any intake answers that have been set."""
    data = load(root)
    parts = []
    text = (data.get("criteria") or "").strip()
    if text:
        parts.append(text)
    lines = []
    for lane in data.get("lanes") or []:
        if not isinstance(lane, dict):
            continue
        name = lane.get("name") or "lane"
        desc = (lane.get("description") or "").strip()
        rule = (lane.get("competitiveness") or "").strip()
        lines.append(f"- {name}: {desc}" if desc else f"- {name}")
        if rule:
            lines.append(f"  competitiveness: {rule}")
    if lines:
        parts.append("Lanes:\n" + "\n".join(lines))
    answered = []
    labels = (
        ("target_roles", "Target roles"),
        ("location", "Location"),
        ("work_mode", "Work mode"),
        ("pay_floor", "Pay floor"),
        ("dealbreakers", "Dealbreakers"),
        ("work_auth", "Work authorization"),
    )
    for name, label in labels:
        row = record(name, root)
        if row is not None:
            answered.append(f"{label}: {row.get('value')}")
    if answered:
        parts.append("\n".join(answered))
    return "\n\n".join(parts)

def overlay_sources(cfg, root=None):
    """Copy a sources.yaml mapping and apply profile roles, places, and named boards.

    The file on disk is left alone. Named boards are enabled.
    """
    out = copy.deepcopy(cfg or {})
    roles = value("target_roles", root) or []
    if roles:
        lanes = dict(out.get("lanes") or {})
        for role in roles:
            pattern = "(?i)" + re.escape(str(role))
            current = list(lanes.get(role) or [])
            if pattern not in current:
                current.append(pattern)
            lanes[role] = current
        lanes.setdefault("unconfigured", ["(?!)"])
        out["lanes"] = lanes
    places = value("location", root) or []
    if places:
        geo = dict(out.get("geo") or {})
        include = list(geo.get("include") or [])
        for place in places:
            pattern = "(?i)" + re.escape(str(place))
            if pattern not in include:
                include.append(pattern)
        geo["include"] = include
        for key in ("exclude", "remote_us", "non_us"):
            if not isinstance(geo.get(key), list):
                geo[key] = []
        out["geo"] = geo
    groups = dict(out.get("sources") or {})
    for row in value("preferred_sources", root) or []:
        if not isinstance(row, dict) or row.get("enabled") is False or "ats_type" not in row:
            continue
        ats = row["ats_type"]
        group = dict(groups.get(ats) or {})
        boards = [dict(item) for item in (group.get("boards") or []) if isinstance(item, dict)]
        board = {"company": row["company"], "ats_type": ats}
        if row.get("slug"):
            board["slug"] = row["slug"]
        if row.get("url"):
            board["url"] = row["url"]
        if not any(item.get("company") == board["company"] and item.get("slug") == board.get("slug") and item.get("url") == board.get("url") for item in boards):
            boards.append(board)
        group["enabled"] = True
        group["boards"] = boards
        groups[ats] = group
    out["sources"] = groups
    return out

def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(yaml.safe_dump(load(), sort_keys=False, allow_unicode=True))
    elif args[0] == "identity":
        found = identity()
        found.pop("address", None)
        print(yaml.safe_dump(found, sort_keys=False, allow_unicode=True))
    elif args[0] == "value" and len(args) == 2:
        print(yaml.safe_dump(value(args[1]), sort_keys=False, allow_unicode=True).rstrip())
    elif args[0] == "prompt":
        print(criteria_for_prompt())
    else:
        sys.exit(__doc__)
    return 0

if __name__ == "__main__":
    sys.exit(main())
