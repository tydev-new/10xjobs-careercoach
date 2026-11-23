#!/usr/bin/env python3
"""Report missing intake fields, and merge one answered field into the private files.

A missing field is not a disabled check. set stores a user-stated claim as
approved, with the source and date. An extracted claim stays unconfirmed until
confirm --source user-stated sets it approved. This script does not authorize
submit or send.
"""
from pathlib import Path
import argparse, copy, json, re, sys
import yaml

FIELDS = (
    "target_roles",
    "location",
    "work_mode",
    "pay_floor",
    "dealbreakers",
    "work_auth",
    "claims",
    "preferred_sources",
)
TASKS = ("source", "evaluate", "apply", "outreach", "coach")
PROVENANCE = (
    "user-stated",
    "extracted-from-resume",
    "extracted-from-linkedin",
    "extracted-from-file",
)
WORK_MODES = ("remote", "hybrid", "onsite", "mixed")
BOARD_ATS = ("ashby", "greenhouse", "lever", "smartrecruiters")
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._%-]{0,80}$")
URL = re.compile(r"^https?://\S+$")
CLAIM_ID = re.compile(r"^pending\.[a-z0-9][a-z0-9-]{0,48}$")
TITLES = {
    "target_roles": "Target roles",
    "location": "Location",
    "work_mode": "Work mode",
    "pay_floor": "Pay floor",
    "dealbreakers": "Dealbreakers",
    "work_auth": "Work authorization",
    "preferred_sources": "Preferred sources",
}
# task -> why this field stops that step while it is still unknown
USED_BY = {
    "target_roles": {
        "source": "which roles to search",
        "evaluate": "assigning a lane",
    },
    "location": {
        "source": "geo filter",
        "evaluate": "a geo dealbreaker",
        "apply": "a location check",
    },
    "work_mode": {
        "source": "remote or on-site filter",
        "evaluate": "an on-site dealbreaker",
        "apply": "an on-site check",
    },
    "pay_floor": {
        "evaluate": "a pay comparison",
        "apply": "a pay check",
    },
    "dealbreakers": {
        "evaluate": "the dealbreaker stop",
    },
    "work_auth": {
        "evaluate": "a posting that mentions sponsorship or citizenship",
        "apply": "a work-authorization answer",
    },
    "claims": {
        "apply": "proof lines",
        "outreach": "proof lines",
    },
    "preferred_sources": {
        "source": "companies to search when asked",
    },
}
OPTIONAL = {"preferred_sources"}
LIST_FIELDS = {"target_roles", "location", "dealbreakers"}


class IntakeError(Exception):
    pass


class Dumper(yaml.SafeDumper):
    pass


def _represent_str(dumper, data):
    simple = re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 .,'/+-]*", data or "")
    reserved = data.lower() in {"yes", "no", "true", "false", "null", "~"}
    if "\n" in data:
        style = "|"
    elif simple and not reserved and not re.fullmatch(r"\d+", data) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data):
        style = None
    else:
        style = "'"
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


Dumper.add_representer(str, _represent_str)


def kit_root():
    return Path(__file__).resolve().parents[1]


def search_dir(root):
    return Path(root) / "workspace/job-search"


def load_yaml(path):
    path = Path(path)
    if not path.is_file():
        raise IntakeError(f"missing {path}")
    data = yaml.safe_load(path.read_text()) or {}
    if not isinstance(data, dict):
        raise IntakeError(f"{path.name} is not a mapping")
    return data


def dump_yaml(path, data):
    path = Path(path)
    text = yaml.dump(data, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=4096)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def load_bundle(root):
    root = Path(root)
    search = search_dir(root)
    intake_path = search / "profile/intake.yaml"
    candidate = load_yaml(search / "profile/candidate.yaml")
    if intake_path.is_file():
        intake = load_yaml(intake_path)
    else:
        intake = {
            "schema": "intake-v1",
            "synthetic": candidate.get("synthetic") is True,
            "submit_authorized": False,
            "send_authorized": False,
            "fields": {},
        }
    intake.setdefault("schema", "intake-v1")
    intake.setdefault("fields", {})
    intake.setdefault("submit_authorized", False)
    intake.setdefault("send_authorized", False)
    if not isinstance(intake["fields"], dict):
        raise IntakeError("intake.yaml fields is not a mapping")
    criteria_path = search / "criteria.md"
    criteria = criteria_path.read_text() if criteria_path.is_file() else ""
    return {
        "candidate": candidate,
        "claims": load_yaml(search / "profile/claims.yaml"),
        "policy": load_yaml(search / "profile/policy.yaml"),
        "sources": load_yaml(search / "pipeline/sources.yaml"),
        "intake": intake,
        "criteria": criteria,
    }


def save_bundle(root, original, bundle):
    root = Path(root)
    search = search_dir(root)
    paths = {
        "candidate": search / "profile/candidate.yaml",
        "claims": search / "profile/claims.yaml",
        "policy": search / "profile/policy.yaml",
        "sources": search / "pipeline/sources.yaml",
        "intake": search / "profile/intake.yaml",
    }
    for key, path in paths.items():
        if bundle[key] != original[key] or (key == "intake" and not path.is_file()):
            dump_yaml(path, bundle[key])
    if bundle["criteria"] != original["criteria"]:
        (search / "criteria.md").write_text(bundle["criteria"])


def guard(intake):
    if intake.get("submit_authorized") is True:
        raise IntakeError("intake cannot authorize submit")
    if intake.get("send_authorized") is True:
        raise IntakeError("intake cannot authorize send")
    intake["submit_authorized"] = False
    intake["send_authorized"] = False
    intake["schema"] = intake.get("schema") or "intake-v1"


def check_source(source):
    if source not in PROVENANCE:
        raise IntakeError("source must be user-stated, extracted-from-resume, extracted-from-linkedin, or extracted-from-file")
    return source


def check_date(date):
    if date is None:
        import datetime
        return datetime.date.today().isoformat()
    if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise IntakeError("date must be YYYY-MM-DD")
    import datetime
    try:
        datetime.date.fromisoformat(date)
    except ValueError as exc:
        raise IntakeError("date must be YYYY-MM-DD") from exc
    return date


def clean_phrase(value, label, limit):
    if not isinstance(value, str):
        raise IntakeError(f"{label} must be text")
    text = " ".join(value.split())
    if not text:
        raise IntakeError(f"{label} is empty")
    if len(text) > limit:
        raise IntakeError(f"{label} is too long")
    return text


def as_strings(value, label, limit, item_limit, allow_empty=True):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise IntakeError(f"{label} must be text or a list of text")
    if not value and not allow_empty:
        raise IntakeError(f"{label} is empty")
    if len(value) > limit:
        raise IntakeError(f"{label} has too many items")
    out = []
    seen = set()
    for item in value:
        text = clean_phrase(item, label, item_limit)
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def parse_pay(value):
    if isinstance(value, bool):
        raise IntakeError("pay_floor must be a whole number of dollars or null")
    if value is None:
        return None
    if isinstance(value, int):
        number = value
    elif isinstance(value, float) and value.is_integer():
        number = int(value)
    elif isinstance(value, str):
        text = value.strip().lower().replace(",", "").replace("$", "").replace(" ", "")
        if text in {"none", "null", "no", "n/a", "na"}:
            return None
        match = re.fullmatch(r"(\d+)(k)?", text)
        if not match:
            raise IntakeError("pay_floor must be a whole number of dollars, optional k, or null")
        number = int(match.group(1)) * (1000 if match.group(2) else 1)
    else:
        raise IntakeError("pay_floor must be a whole number of dollars or null")
    if number < 0 or number > 10000000:
        raise IntakeError("pay_floor is out of range")
    return number


def parse_mode(value):
    if not isinstance(value, str):
        raise IntakeError("work_mode must be remote, hybrid, onsite, or mixed")
    mode = value.strip().lower().replace("_", "-")
    aliases = {"on-site": "onsite", "on site": "onsite", "in-office": "onsite", "in office": "onsite"}
    mode = aliases.get(mode, mode)
    if mode not in WORK_MODES:
        raise IntakeError("work_mode must be remote, hybrid, onsite, or mixed")
    return mode


def normalize_value(field, value):
    if field == "target_roles":
        return as_strings(value, "target_roles", 12, 80)
    if field == "location":
        return as_strings(value, "location", 12, 80)
    if field == "dealbreakers":
        return as_strings(value, "dealbreakers", 20, 120)
    if field == "work_mode":
        return parse_mode(value)
    if field == "pay_floor":
        return parse_pay(value)
    if field == "work_auth":
        return clean_phrase(value, "work_auth", 120)
    if field == "preferred_sources":
        return normalize_sources(value)
    if field == "claims":
        return normalize_claims(value)
    raise IntakeError(f"unknown field {field}")


def normalize_sources(value):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise IntakeError("preferred_sources must be a name or a list")
    if len(value) > 30:
        raise IntakeError("preferred_sources has too many items")
    out = []
    seen = set()
    for item in value:
        if isinstance(item, str):
            row = {"company": clean_phrase(item, "company", 120)}
        elif isinstance(item, dict):
            row = {"company": clean_phrase(item.get("company") or "", "company", 120)}
            ats = item.get("ats_type")
            slug = item.get("slug")
            url = item.get("url")
            if any(part not in (None, "") for part in (ats, slug, url)):
                if ats not in BOARD_ATS:
                    raise IntakeError("preferred source ats_type must be ashby, greenhouse, lever, or smartrecruiters")
                if slug in (None, "") and url in (None, ""):
                    raise IntakeError("preferred source board needs a slug or a url")
                if slug not in (None, "") and not SLUG.fullmatch(str(slug)):
                    raise IntakeError("preferred source slug is not a single board id")
                if url not in (None, "") and not URL.fullmatch(str(url)):
                    raise IntakeError("preferred source url must be http or https")
                row["ats_type"] = ats
                if slug not in (None, ""):
                    row["slug"] = str(slug)
                if url not in (None, ""):
                    row["url"] = str(url)
        else:
            raise IntakeError("preferred source must be a name or a mapping")
        row["enabled"] = True
        key = (row["company"].casefold(), row.get("ats_type"), row.get("slug"), row.get("url"))
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def claim_items(value):
    if value in (None, []):
        return []
    if isinstance(value, dict) and value.get("none") is True and len(value) == 1:
        return []
    if isinstance(value, str):
        value = [{"text": value}]
    elif isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        raise IntakeError("claims must be text, a claim, or a list of claims")
    return value


def normalize_claims(value):
    """Return a list of claim payloads. Does not approve them."""
    items = claim_items(value)
    if len(items) > 20:
        raise IntakeError("too many claims in one write")
    out = []
    for item in items:
        if not isinstance(item, dict):
            raise IntakeError("each claim must be a mapping with text")
        status = item.get("status")
        if status not in (None, "unconfirmed"):
            raise IntakeError(f"intake refuses status {status}; pass the text and let the source decide")
        text = clean_phrase(item.get("text") or "", "claim text", 400)
        numbers = item.get("numbers") or []
        if not isinstance(numbers, list):
            raise IntakeError("claim numbers must be a list")
        cleaned_numbers = []
        for number in numbers:
            token = clean_phrase(str(number), "claim number", 40)
            if token not in text:
                raise IntakeError("claim number is not in the claim text")
            cleaned_numbers.append(token)
        cid = item.get("id")
        if cid is not None:
            if not isinstance(cid, str) or not CLAIM_ID.fullmatch(cid):
                raise IntakeError("claim id must look like pending.short-name")
        out.append({"id": cid, "text": text, "numbers": cleaned_numbers})
    return out


def union_text(existing, incoming, replace):
    base = [] if replace else list(existing or [])
    seen = {item.casefold() for item in base}
    for item in incoming:
        key = item.casefold()
        if key not in seen:
            base.append(item)
            seen.add(key)
    return base


def remember(fields, field, value, source, date):
    old = fields.get(field) if isinstance(fields.get(field), dict) else None
    record = {"value": value, "source": source, "date": date, "explicit": True}
    if old and old.get("value") != value:
        record["previous"] = {"value": old.get("value"), "source": old.get("source"), "date": old.get("date")}
    fields[field] = record
    return old or {}


def split_criteria(text):
    preamble = []
    sections = {}
    order = []
    current = None
    buf = []
    for line in text.splitlines():
        match = re.fullmatch(r"## (.+)", line.strip()) if line.startswith("## ") else None
        if match:
            if current is None:
                preamble = buf
            else:
                sections[current] = "\n".join(buf).strip()
            current = match.group(1).strip()
            order.append(current)
            buf = []
        else:
            buf.append(line)
    if current is None:
        preamble = buf
    else:
        sections[current] = "\n".join(buf).strip()
    return preamble, sections, order


def render_criteria(preamble, sections, order):
    chunks = []
    head = "\n".join(preamble).rstrip()
    if head:
        chunks.append(head)
    for title in order:
        chunks.append(f"## {title}\n{sections.get(title, '').strip()}")
    return "\n\n".join(chunks).rstrip() + "\n"


def format_section(field, value):
    empty = value is None or value == []
    if empty:
        return "(none)"
    if field == "preferred_sources":
        lines = []
        for item in value:
            if item.get("slug"):
                lines.append(f"- {item['company']} ({item['ats_type']}:{item['slug']})")
            elif item.get("ats_type"):
                lines.append(f"- {item['company']} ({item['ats_type']})")
            else:
                lines.append(f"- {item['company']}")
        return "\n".join(lines)
    if field in LIST_FIELDS:
        return "\n".join(f"- {item}" for item in value)
    return str(value)


def write_section(criteria, field, value):
    title = TITLES[field]
    preamble, sections, order = split_criteria(criteria)
    sections[title] = format_section(field, value)
    if title not in order:
        order.append(title)
    return render_criteria(preamble, sections, order)


def place_pattern(place):
    return "(?i)" + re.escape(place)


def sync_lanes(sources, old_roles, new_roles, replace):
    lanes = dict(sources.get("lanes") or {})
    if replace:
        keep = {role.casefold() for role in new_roles}
        for role in old_roles or []:
            if role.casefold() in keep or role == "unconfigured":
                continue
            pattern = place_pattern(role)
            current = list(lanes.get(role) or [])
            if current == [pattern]:
                lanes.pop(role, None)
            elif pattern in current:
                lanes[role] = [item for item in current if item != pattern]
    for role in new_roles:
        pattern = place_pattern(role)
        current = list(lanes.get(role) or [])
        if pattern not in current:
            current.append(pattern)
        lanes[role] = current
    if "unconfigured" not in lanes:
        lanes["unconfigured"] = ["(?!)"]
    sources["lanes"] = lanes


def sync_geo(sources, old_places, new_places, replace):
    geo = dict(sources.get("geo") or {})
    include = list(geo.get("include") or [])
    if replace:
        drop = {place_pattern(place) for place in (old_places or [])}
        keep = {place_pattern(place) for place in new_places}
        include = [item for item in include if item not in drop or item in keep]
    for place in new_places:
        pattern = place_pattern(place)
        if pattern not in include:
            include.append(pattern)
    geo["include"] = include
    for key in ("exclude", "remote_us", "non_us"):
        geo.setdefault(key, geo.get(key) if isinstance(geo.get(key), list) else [])
    sources["geo"] = geo


def sync_boards(sources, rows):
    groups = dict(sources.get("sources") or {})
    for row in rows:
        if "ats_type" not in row:
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
    sources["sources"] = groups


def approve_claim(row, date):
    """Mark a claim approved from the user's own words. Scope defaults to all so it can be proof."""
    row["status"] = "approved"
    row["approved"] = date
    if not row.get("scope"):
        row["scope"] = ["all"]
    meta = dict(row.get("intake") or {})
    meta["user_confirmed"] = True
    meta["confirmed_date"] = date
    meta["confirmed_source"] = "user-stated"
    row["intake"] = meta


def append_claims(claims, payloads, source, date):
    rows = list(claims.get("claims") or [])
    by_id = {str(item.get("id")): item for item in rows if isinstance(item, dict)}
    written = []
    stated = source == "user-stated"
    for payload in payloads:
        cid = payload["id"]
        if cid is None:
            cid = new_claim_id(payload["text"], set(by_id))
            payload = dict(payload, id=cid)
        current = by_id.get(cid)
        if current is not None:
            if current.get("text") != payload["text"]:
                raise IntakeError(f"{cid} already exists with different text")
            if current.get("status") == "approved":
                raise IntakeError(f"{cid} is already approved; intake will not edit it")
            if stated:
                approve_claim(current, date)
            written.append({"id": cid, "text": payload["text"], "status": current.get("status")})
            continue
        record = {
            "id": cid,
            "status": "approved" if stated else "unconfirmed",
            "text": payload["text"],
            "source": source,
            "scope": ["all"] if stated else [],
            "numbers": list(payload["numbers"]),
            "anchors": [re.escape(number) for number in payload["numbers"]],
            "forbid_with": [],
            "intake": {"source": source, "date": date, "user_confirmed": stated},
        }
        if stated:
            record["approved"] = date
            record["intake"]["confirmed_date"] = date
            record["intake"]["confirmed_source"] = "user-stated"
        rows.append(record)
        by_id[cid] = record
        written.append({"id": cid, "text": payload["text"], "status": record["status"]})
    claims["claims"] = rows
    return written


def new_claim_id(text, taken):
    words = re.findall(r"[a-z0-9]+", text.lower())
    base = "-".join(words[:4]) or "note"
    base = base[:40].strip("-") or "note"
    cid = "pending." + base
    number = 2
    while cid in taken or cid.startswith("example."):
        cid = f"pending.{base}-{number}"
        number += 1
    if not CLAIM_ID.fullmatch(cid):
        raise IntakeError("could not build a claim id")
    taken.add(cid)
    return cid


def apply_field(bundle, field, value, source, date, replace):
    if field not in TITLES and field != "claims":
        raise IntakeError(f"unknown field {field}")
    guard(bundle["intake"])
    normalized = normalize_value(field, value)
    fields = bundle["intake"].setdefault("fields", {})
    old = fields.get(field) if isinstance(fields.get(field), dict) else {}
    old_value = old.get("value") if isinstance(old, dict) else None
    if field == "claims":
        if normalized == [] and not claim_items(value):
            remember(fields, field, [], source, date)
            return
        for payload in normalized:
            if payload["id"] is not None and str(payload["id"]).startswith("example."):
                raise IntakeError("bundled example claims are not user claims")
        append_claims(bundle["claims"], normalized, source, date)
        ledger = []
        for row in bundle["claims"].get("claims") or []:
            if str(row.get("id", "")).startswith("example."):
                continue
            if str(row.get("id", "")).startswith("pending.") or (row.get("intake") or {}).get("source"):
                ledger.append({
                    "id": row.get("id"),
                    "text": row.get("text"),
                    "status": row.get("status"),
                    "user_confirmed": bool((row.get("intake") or {}).get("user_confirmed")),
                })
        remember(fields, field, ledger, source, date)
        return
    if field in LIST_FIELDS or field == "preferred_sources":
        base = list(old_value or []) if isinstance(old_value, list) else []
        if field == "preferred_sources":
            merged = merge_sources(base, normalized, replace)
        else:
            merged = union_text(base, normalized, replace)
        remember(fields, field, merged, source, date)
        bundle["criteria"] = write_section(bundle["criteria"], field, merged)
        if field == "target_roles":
            sync_lanes(bundle["sources"], base, merged, replace)
        elif field == "location":
            bundle["policy"]["home_locations"] = list(merged)
            sync_geo(bundle["sources"], base, merged, replace)
        elif field == "preferred_sources":
            sync_boards(bundle["sources"], merged)
        return
    remember(fields, field, normalized, source, date)
    bundle["criteria"] = write_section(bundle["criteria"], field, normalized)
    if field == "pay_floor":
        bundle["policy"]["pay_floor"] = normalized
    elif field == "work_auth":
        bundle["candidate"]["work_auth"] = normalized


def merge_sources(existing, incoming, replace):
    base = [] if replace else [dict(item) for item in existing if isinstance(item, dict)]
    index = {}
    for i, item in enumerate(base):
        key = (item.get("company", "").casefold(), item.get("ats_type"), item.get("slug"), item.get("url"))
        index[key] = i
    for item in incoming:
        key = (item["company"].casefold(), item.get("ats_type"), item.get("slug"), item.get("url"))
        if key in index:
            base[index[key]]["enabled"] = True
            continue
        base.append(item)
        index[key] = len(base) - 1
    return base


def set_field(root, field, value, source, date=None, replace=False):
    if field not in FIELDS:
        raise IntakeError(f"unknown field {field}")
    source = check_source(source)
    date = check_date(date)
    original = load_bundle(root)
    bundle = copy.deepcopy(original)
    apply_field(bundle, field, value, source, date, replace)
    save_bundle(root, original, bundle)
    return {"field": field, "submit_authorized": False, "send_authorized": False}


def confirm_claim(root, claim_id, source, date=None):
    source = check_source(source)
    if source != "user-stated":
        raise IntakeError("confirmation must be user-stated")
    if not isinstance(claim_id, str) or claim_id.startswith("example."):
        raise IntakeError("bundled example claims are not user claims")
    date = check_date(date)
    original = load_bundle(root)
    bundle = copy.deepcopy(original)
    guard(bundle["intake"])
    found = None
    for row in bundle["claims"].get("claims") or []:
        if row.get("id") == claim_id:
            found = row
            break
    if found is None:
        raise IntakeError(f"no claim {claim_id}")
    status = found.get("status")
    if status == "approved":
        save_bundle(root, original, original)
        return {"id": claim_id, "status": "approved", "changed": False}
    if status != "unconfirmed":
        raise IntakeError(f"{claim_id} cannot be confirmed from status {status}")
    approve_claim(found, date)
    fields = bundle["intake"].setdefault("fields", {})
    record = fields.get("claims") if isinstance(fields.get("claims"), dict) else {"value": [], "explicit": True}
    ledger = []
    for row in bundle["claims"].get("claims") or []:
        if str(row.get("id", "")).startswith("example."):
            continue
        if not ((row.get("intake") or {}).get("source") or str(row.get("id", "")).startswith("pending.")):
            continue
        ledger.append({
            "id": row.get("id"),
            "text": row.get("text"),
            "status": row.get("status"),
            "user_confirmed": bool((row.get("intake") or {}).get("user_confirmed")),
        })
    record = dict(record)
    record["value"] = ledger
    record["source"] = record.get("source") or "user-stated"
    record["date"] = date
    record["explicit"] = True
    fields["claims"] = record
    save_bundle(root, original, bundle)
    return {"id": claim_id, "status": "approved", "changed": True}


def user_claim_rows(claims):
    rows = []
    for row in claims.get("claims") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("id", "")).startswith("example."):
            continue
        rows.append(row)
    return rows


def section_map(criteria):
    _, sections, _ = split_criteria(criteria or "")
    return sections


def canonical_list(policy, key):
    value = policy.get(key)
    if isinstance(value, list) and value:
        return value
    return None


def build_report(root):
    bundle = load_bundle(root)
    intake = bundle["intake"]
    submit = intake.get("submit_authorized") is True
    send = intake.get("send_authorized") is True
    synthetic = (
        bundle["candidate"].get("synthetic") is True
        and bundle["claims"].get("synthetic") is True
        and bundle["policy"].get("synthetic") is True
    )
    sections = section_map(bundle["criteria"])
    fields = {}
    for name in FIELDS:
        if name == "claims":
            fields[name] = claims_row(bundle)
            continue
        fields[name] = plain_row(name, bundle, sections)
    return {
        "schema": "intake-v1",
        "submit_authorized": submit,
        "send_authorized": send,
        "synthetic": synthetic,
        "fields": fields,
    }


def provenance_of(record):
    if not isinstance(record, dict):
        return None, None
    return record.get("source"), record.get("date")


def blocks_for(name, active):
    used = USED_BY[name]
    return {task: reason for task, reason in used.items() if task in active}


def plain_row(name, bundle, sections):
    record = (bundle["intake"].get("fields") or {}).get(name)
    explicit = isinstance(record, dict) and record.get("explicit") is True
    source, date = provenance_of(record) if explicit else (None, None)
    value = record.get("value") if explicit else None
    canonical = canonical_for(name, bundle, sections)
    state = "missing"
    ask = "value"
    if explicit and canonical_conflicts(name, value, canonical):
        state = "drift"
        ask = "value"
    elif explicit:
        state = "set"
        ask = "no"
    elif canonical is not None:
        state = "set"
        value = canonical
        source = "untracked"
        ask = "no"
    if name in OPTIONAL and state == "missing":
        ask = "no"
    active = set()
    if state in {"missing", "drift"} and name not in OPTIONAL:
        active = set(USED_BY[name])
    row = {
        "state": state,
        "value": value,
        "source": source,
        "date": date,
        "ask": ask,
        "blocks": blocks_for(name, active),
        "optional": name in OPTIONAL,
    }
    if state == "drift":
        row["canonical"] = canonical
    return row


def canonical_for(name, bundle, sections):
    if name == "pay_floor":
        if "pay_floor" not in bundle["policy"] or bundle["policy"].get("pay_floor") is None:
            return None
        return bundle["policy"].get("pay_floor")
    if name == "work_auth":
        value = bundle["candidate"].get("work_auth")
        if value in (None, ""):
            return None
        return value
    if name == "location":
        return canonical_list(bundle["policy"], "home_locations")
    title = TITLES.get(name)
    body = sections.get(title, "").strip() if title else ""
    if not body:
        return None
    if body == "(none)":
        return [] if name in LIST_FIELDS or name == "preferred_sources" else None
    if name in LIST_FIELDS:
        return [line[2:].strip() for line in body.splitlines() if line.startswith("- ")]
    if name == "work_mode":
        try:
            return parse_mode(body)
        except IntakeError:
            return body
    if name == "preferred_sources":
        found = []
        for line in body.splitlines():
            if line.startswith("- "):
                found.append(line[2:].strip())
        return found or None
    return body


def canonical_conflicts(name, value, canonical):
    if canonical is None:
        if name == "pay_floor":
            return value is not None
        if name == "location":
            return bool(value)
        return False
    if name == "pay_floor":
        return value != canonical
    if name == "work_auth":
        return value != canonical
    if name == "location":
        left = [str(item).casefold() for item in (value or [])]
        right = [str(item).casefold() for item in canonical]
        return left != right
    return False


def claims_row(bundle):
    record = (bundle["intake"].get("fields") or {}).get("claims")
    source, date = provenance_of(record)
    rows = user_claim_rows(bundle["claims"])
    approved = [row for row in rows if row.get("status") == "approved"]
    pending = [row for row in rows if row.get("status") != "approved"]
    explicit_empty = isinstance(record, dict) and record.get("explicit") is True and not rows
    needs = [row for row in pending if not (row.get("intake") or {}).get("user_confirmed")]
    if approved and not pending:
        state = "set"
        ask = "no"
        active = set()
    elif pending:
        state = "pending"
        ask = "confirm" if needs else "no"
        active = set() if approved else set(USED_BY["claims"])
    elif explicit_empty:
        state = "set"
        ask = "no"
        active = set(USED_BY["claims"])
        source, date = provenance_of(record)
    else:
        state = "missing"
        ask = "value"
        active = set(USED_BY["claims"])
        source, date = None, None
    return {
        "state": state,
        "value": [
            {
                "id": row.get("id"),
                "status": row.get("status"),
                "user_confirmed": bool((row.get("intake") or {}).get("user_confirmed")),
            }
            for row in rows
        ],
        "source": source if rows or explicit_empty else None,
        "date": date if rows or explicit_empty else None,
        "ask": ask,
        "blocks": blocks_for("claims", active),
        "optional": False,
        "confirm": [row.get("id") for row in pending if not (row.get("intake") or {}).get("user_confirmed")],
        "waiting_approval": [row.get("id") for row in pending if (row.get("intake") or {}).get("user_confirmed")],
        "approved": [row.get("id") for row in approved],
    }


def format_value(value):
    if value is None or value == []:
        return "none"
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(str(item.get("company") or item.get("id") or item))
            else:
                parts.append(str(item))
        return ", ".join(parts) if parts else "none"
    return str(value)


def format_blocks(blocks):
    if not blocks:
        return "(none)"
    return "; ".join(f"{task} ({reason})" for task, reason in blocks.items())


def render_report(report, task=None):
    lines = [
        f"SUBMIT_AUTHORIZED: {'yes' if report['submit_authorized'] else 'no'}",
        f"SEND_AUTHORIZED: {'yes' if report['send_authorized'] else 'no'}",
        f"SYNTHETIC: {'yes' if report['synthetic'] else 'no'}",
    ]
    shown = 0
    for name, row in report["fields"].items():
        if task and task not in USED_BY[name]:
            continue
        shown += 1
        lines.append(f"FIELD {name}: {row['state']}")
        if row["state"] != "missing":
            lines.append(f"VALUE: {format_value(row.get('value'))}")
            if row.get("source"):
                lines.append(f"SOURCE: {row['source']}")
            if row.get("date"):
                lines.append(f"DATE: {row['date']}")
        if name == "claims":
            lines.append("APPROVED: " + (", ".join(row.get("approved") or []) or "(none)"))
            if row.get("confirm"):
                lines.append("CONFIRM: " + ", ".join(row["confirm"]))
            if row.get("waiting_approval"):
                lines.append("WAITING_APPROVAL: " + ", ".join(row["waiting_approval"]))
        lines.append(f"ASK: {row['ask']}")
        lines.append(f"BLOCKS: {format_blocks(row.get('blocks') or {})}")
        if row.get("optional") and row["state"] == "missing":
            reason = USED_BY[name].get("source", "when asked")
            lines.append(f"OPTIONAL: source ({reason})")
        if row["state"] == "drift":
            lines.append(f"CANONICAL: {format_value(row.get('canonical'))}")
    if task and shown == 0:
        lines.append(f"TASK {task}: no intake field is required")
    return "\n".join(lines)


def filter_report(report, task):
    if not task:
        return report
    fields = {name: row for name, row in report["fields"].items() if task in USED_BY[name]}
    return dict(report, fields=fields, task=task)


def parse_cli_value(raw):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def missing_names(root):
    report = build_report(root)
    return [name for name, row in report["fields"].items() if row["state"] == "missing"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=None)
    commands = parser.add_subparsers(dest="cmd", required=True)
    report = commands.add_parser("report", help="list missing fields and the tasks they block")
    report.add_argument("--task", choices=TASKS)
    report.add_argument("--json", action="store_true")
    setter = commands.add_parser("set", help="merge one field into the private files")
    setter.add_argument("--field", required=True)
    setter.add_argument("--value", required=True)
    setter.add_argument("--source", required=True)
    setter.add_argument("--date")
    setter.add_argument("--replace", action="store_true")
    confirm = commands.add_parser("confirm", help="approve one extracted claim after the user says yes")
    confirm.add_argument("--id", required=True)
    confirm.add_argument("--source", required=True)
    confirm.add_argument("--date")
    args = parser.parse_args(argv)
    root = (args.root or kit_root()).resolve()
    try:
        if args.cmd == "report":
            payload = build_report(root)
            if args.json:
                print(json.dumps(filter_report(payload, args.task), indent=2, sort_keys=True))
            else:
                print(render_report(payload, args.task))
        elif args.cmd == "set":
            set_field(root, args.field, parse_cli_value(args.value), args.source, args.date, args.replace)
            print(f"SET {args.field}")
            print("SUBMIT_AUTHORIZED: no")
            print("SEND_AUTHORIZED: no")
        else:
            result = confirm_claim(root, args.id, args.source, args.date)
            print(f"CONFIRMED {result['id']}")
            print(f"STATUS: {result['status']}")
            print("SUBMIT_AUTHORIZED: no")
            print("SEND_AUTHORIZED: no")
    except IntakeError as exc:
        print(f"INTAKE_ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
