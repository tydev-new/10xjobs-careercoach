#!/usr/bin/env python3
"""Report the profile and write one answered field into profile.yaml.

Claims are stored only in claims.yaml. A claim the user states is approved.
An extracted claim stays unconfirmed until confirm approves it. This script
does not authorize submit or send.
"""
from pathlib import Path
import argparse, copy, datetime, json, re, sys
import yaml

FIELDS = ("target_roles", "location", "work_mode", "pay_floor", "dealbreakers", "work_auth", "claims", "preferred_sources")
TASKS = ("source", "evaluate", "apply", "outreach", "coach")
PROVENANCE = ("user-stated", "extracted-from-resume", "extracted-from-linkedin", "extracted-from-file")
WORK_MODES = ("remote", "hybrid", "onsite", "mixed")
BOARD_ATS = ("ashby", "greenhouse", "lever", "smartrecruiters")
POLICY_KEYS = (
    "age_cutoff_year", "max_pages", "experience_words", "summary_words", "summary_bullets",
    "max_review_rounds", "travel_max", "timezone", "excluded_locations",
    "workday_search_terms", "workday_lanes", "cover_words", "outreach_words", "outreach_batch_size",
    "outreach_followup_days", "outreach_max_followups",
)
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._%-]{0,80}$")
URL = re.compile(r"^https?://\S+$")
CLAIM_ID = re.compile(r"^pending\.[a-z0-9][a-z0-9-]{0,48}$")
# task -> why this field stops that step while it is still unknown
USED_BY = {
    "target_roles": {"source": "which roles to search", "evaluate": "assigning a lane"},
    "location": {"source": "geo filter", "evaluate": "a geo dealbreaker", "apply": "a location check"},
    "work_mode": {"source": "remote or on-site filter", "evaluate": "an on-site dealbreaker", "apply": "an on-site check"},
    "pay_floor": {"evaluate": "a pay comparison", "apply": "a pay check"},
    "dealbreakers": {"evaluate": "the dealbreaker stop"},
    "work_auth": {"evaluate": "a posting that mentions sponsorship or citizenship", "apply": "a work-authorization answer"},
    "claims": {"apply": "proof lines", "outreach": "proof lines"},
    "preferred_sources": {"source": "companies to search when asked"},
}
OPTIONAL = {"preferred_sources"}
LIST_FIELDS = {"target_roles", "location", "dealbreakers"}
MODE_ALIASES = {"on-site": "onsite", "on site": "onsite", "in-office": "onsite", "in office": "onsite"}

class IntakeError(Exception):
    pass

class Dumper(yaml.SafeDumper):
    pass

def _represent_str(dumper, data):
    simple = re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 .,'/+-]*", data or "")
    reserved = (data or "").lower() in {"yes", "no", "true", "false", "null", "~"}
    dated = re.fullmatch(r"\d{4}-\d{2}-\d{2}", data or "") or re.fullmatch(r"\d+", data or "")
    style = "|" if "\n" in (data or "") else None if simple and not reserved and not dated else "'"
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)

Dumper.add_representer(str, _represent_str)

def kit_root():
    return Path(__file__).resolve().parents[1]

def search_dir(root):
    return Path(root) / "workspace/job-search"

def profile_path(root):
    return search_dir(root) / "profile/profile.yaml"

def claims_path(root):
    return search_dir(root) / "profile/claims.yaml"

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
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(yaml.dump(data, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=4096))
    tmp.replace(path)

def load_profile(root):
    path = profile_path(root)
    if not path.is_file():
        data = {"schema": "profile-v1", "synthetic": False, "identity": {}, "fields": {}, "lanes": [], "criteria": ""}
    else:
        data = load_yaml(path)
    for key, empty in (("fields", {}), ("identity", {}), ("lanes", []), ("criteria", "")):
        data.setdefault(key, empty)
    data.setdefault("schema", "profile-v1")
    data.setdefault("submit_authorized", False)
    data.setdefault("send_authorized", False)
    if not isinstance(data["fields"], dict):
        raise IntakeError("profile.yaml fields is not a mapping")
    return data

def guard(profile):
    if profile.get("submit_authorized") is True:
        raise IntakeError("intake cannot authorize submit")
    if profile.get("send_authorized") is True:
        raise IntakeError("intake cannot authorize send")
    profile["submit_authorized"] = False
    profile["send_authorized"] = False

def check_source(source):
    if source not in PROVENANCE:
        raise IntakeError("source must be user-stated, extracted-from-resume, extracted-from-linkedin, or extracted-from-file")
    return source

def check_date(date):
    if date is None:
        return datetime.date.today().isoformat()
    if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise IntakeError("date must be YYYY-MM-DD")
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

def as_strings(value, label, limit, item_limit):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise IntakeError(f"{label} must be text or a list of text")
    if len(value) > limit:
        raise IntakeError(f"{label} has too many items")
    out, seen = [], set()
    for item in value:
        text = clean_phrase(item, label, item_limit)
        if text.casefold() not in seen:
            seen.add(text.casefold())
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
    mode = MODE_ALIASES.get(value.strip().lower().replace("_", "-"), value.strip().lower().replace("_", "-"))
    if mode not in WORK_MODES:
        raise IntakeError("work_mode must be remote, hybrid, onsite, or mixed")
    return mode

def normalize_sources(value):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise IntakeError("preferred_sources must be a name or a list")
    if len(value) > 30:
        raise IntakeError("preferred_sources has too many items")
    out, seen = [], set()
    for item in value:
        if isinstance(item, str):
            row = {"company": clean_phrase(item, "company", 120)}
        elif isinstance(item, dict):
            row = {"company": clean_phrase(item.get("company") or "", "company", 120)}
            ats, slug, url = item.get("ats_type"), item.get("slug"), item.get("url")
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
        if key not in seen:
            seen.add(key)
            out.append(row)
    return out

def claim_items(value):
    if value in (None, []):
        return []
    if isinstance(value, dict) and set(value) == {"none"} and value.get("none") is True:
        return []
    if isinstance(value, str):
        return [{"text": value}]
    if isinstance(value, dict):
        return [value]
    if not isinstance(value, list):
        raise IntakeError("claims must be text, a claim, or a list of claims")
    return value

def normalize_claims(value):
    items = claim_items(value)
    if len(items) > 20:
        raise IntakeError("too many claims in one write")
    out = []
    for item in items:
        if not isinstance(item, dict):
            raise IntakeError("each claim must be a mapping with text")
        if item.get("status") not in (None, "unconfirmed"):
            raise IntakeError(f"intake refuses status {item.get('status')}; pass the text and let the source decide")
        text = clean_phrase(item.get("text") or "", "claim text", 400)
        numbers = item.get("numbers") or []
        if not isinstance(numbers, list):
            raise IntakeError("claim numbers must be a list")
        cleaned = []
        for number in numbers:
            token = clean_phrase(str(number), "claim number", 40)
            if token not in text:
                raise IntakeError("claim number is not in the claim text")
            cleaned.append(token)
        cid = item.get("id")
        if cid is not None and (not isinstance(cid, str) or not CLAIM_ID.fullmatch(cid)):
            raise IntakeError("claim id must look like pending.short-name")
        out.append({"id": cid, "text": text, "numbers": cleaned})
    return out

def normalize_value(field, value):
    if field in LIST_FIELDS:
        limit, item_limit = (20, 120) if field == "dealbreakers" else (12, 80)
        return as_strings(value, field, limit, item_limit)
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

def remember(fields, field, value, source, date):
    old = fields.get(field) if isinstance(fields.get(field), dict) else None
    record = {"value": value, "source": source, "date": date, "explicit": True}
    if old and old.get("value") != value:
        record["previous"] = {"value": old.get("value"), "source": old.get("source"), "date": old.get("date")}
    fields[field] = record

def union_text(existing, incoming, replace):
    base = [] if replace else list(existing or [])
    seen = {item.casefold() for item in base}
    for item in incoming:
        if item.casefold() not in seen:
            base.append(item)
            seen.add(item.casefold())
    return base

def merge_sources(existing, incoming, replace):
    base = [] if replace else [dict(item) for item in existing if isinstance(item, dict)]
    index = {(item.get("company", "").casefold(), item.get("ats_type"), item.get("slug"), item.get("url")): i for i, item in enumerate(base)}
    for item in incoming:
        key = (item["company"].casefold(), item.get("ats_type"), item.get("slug"), item.get("url"))
        if key in index:
            base[index[key]]["enabled"] = True
        else:
            index[key] = len(base)
            base.append(item)
    return base

def new_claim_id(text, taken):
    base = ("-".join(re.findall(r"[a-z0-9]+", text.lower())[:4]) or "note")[:40].strip("-") or "note"
    cid, number = "pending." + base, 2
    while cid in taken or cid.startswith("example."):
        cid, number = f"pending.{base}-{number}", number + 1
    if not CLAIM_ID.fullmatch(cid):
        raise IntakeError("could not build a claim id")
    taken.add(cid)
    return cid

def approve_claim(row, date):
    """Mark a claim approved from the user's own words. Scope defaults to all so it can be proof."""
    row["status"] = "approved"
    row["approved"] = date
    if not row.get("scope"):
        row["scope"] = ["all"]
    meta = dict(row.get("intake") or {})
    meta.update(user_confirmed=True, confirmed_date=date, confirmed_source="user-stated")
    row["intake"] = meta

def user_claim_rows(claims):
    return [row for row in claims.get("claims") or [] if isinstance(row, dict) and not str(row.get("id", "")).startswith("example.")]

def append_claims(claims, payloads, source, date):
    rows = list(claims.get("claims") or [])
    by_id = {str(item.get("id")): item for item in rows if isinstance(item, dict)}
    stated = source == "user-stated"
    for payload in payloads:
        cid = payload["id"] or new_claim_id(payload["text"], set(by_id))
        payload = dict(payload, id=cid)
        current = by_id.get(cid)
        if current is not None:
            if current.get("text") != payload["text"]:
                raise IntakeError(f"{cid} already exists with different text")
            if current.get("status") == "approved":
                raise IntakeError(f"{cid} is already approved; intake will not edit it")
            if stated:
                approve_claim(current, date)
            continue
        record = {
            "id": cid, "status": "approved" if stated else "unconfirmed", "text": payload["text"], "source": source,
            "scope": ["all"] if stated else [], "numbers": list(payload["numbers"]),
            "anchors": [re.escape(number) for number in payload["numbers"]], "forbid_with": [],
            "intake": {"source": source, "date": date, "user_confirmed": stated},
        }
        if stated:
            record["approved"] = date
            record["intake"].update(confirmed_date=date, confirmed_source="user-stated")
        rows.append(record)
        by_id[cid] = record
    claims["claims"] = rows

def apply_field(profile, claims, field, value, source, date, replace):
    guard(profile)
    normalized = normalize_value(field, value)
    fields = profile.setdefault("fields", {})
    old = fields.get(field) if isinstance(fields.get(field), dict) else {}
    if field == "claims":
        if normalized == [] and not claim_items(value):
            remember(fields, field, [], source, date)
            return
        for payload in normalized:
            if payload["id"] is not None and str(payload["id"]).startswith("example."):
                raise IntakeError("bundled example claims are not user claims")
        append_claims(claims, normalized, source, date)
        remember(fields, field, [row.get("id") for row in user_claim_rows(claims)], source, date)
        return
    old_value = old.get("value") if isinstance(old, dict) else None
    if field in LIST_FIELDS or field == "preferred_sources":
        base = list(old_value or []) if isinstance(old_value, list) else []
        merged = merge_sources(base, normalized, replace) if field == "preferred_sources" else union_text(base, normalized, replace)
        remember(fields, field, merged, source, date)
        return
    remember(fields, field, normalized, source, date)

def set_field(root, field, value, source, date=None, replace=False):
    if field not in FIELDS:
        raise IntakeError(f"unknown field {field}")
    source, date, root = check_source(source), check_date(date), Path(root)
    profile = load_profile(root)
    claims = load_yaml(claims_path(root)) if field == "claims" else None
    original, original_claims = copy.deepcopy(profile), copy.deepcopy(claims)
    apply_field(profile, claims, field, value, source, date, replace)
    if profile != original or not profile_path(root).is_file():
        dump_yaml(profile_path(root), profile)
    if claims is not None and claims != original_claims:
        dump_yaml(claims_path(root), claims)
    return {"field": field, "submit_authorized": False, "send_authorized": False}

def confirm_claim(root, claim_id, source, date=None):
    if check_source(source) != "user-stated":
        raise IntakeError("confirmation must be user-stated")
    if not isinstance(claim_id, str) or claim_id.startswith("example."):
        raise IntakeError("bundled example claims are not user claims")
    date, root = check_date(date), Path(root)
    profile, claims = load_profile(root), load_yaml(claims_path(root))
    guard(profile)
    found = next((row for row in claims.get("claims") or [] if row.get("id") == claim_id), None)
    if found is None:
        raise IntakeError(f"no claim {claim_id}")
    if found.get("status") == "approved":
        return {"id": claim_id, "status": "approved", "changed": False}
    if found.get("status") != "unconfirmed":
        raise IntakeError(f"{claim_id} cannot be confirmed from status {found.get('status')}")
    approve_claim(found, date)
    fields = profile.setdefault("fields", {})
    old = fields.get("claims") if isinstance(fields.get("claims"), dict) else {}
    remember(fields, "claims", [row.get("id") for row in user_claim_rows(claims)], old.get("source") or source, date)
    dump_yaml(claims_path(root), claims)
    dump_yaml(profile_path(root), profile)
    return {"id": claim_id, "status": "approved", "changed": True}

def blocks_for(name, active):
    return {task: reason for task, reason in USED_BY[name].items() if task in active}

def plain_row(name, profile):
    record = (profile.get("fields") or {}).get(name)
    explicit = isinstance(record, dict) and record.get("explicit") is True
    if explicit:
        state, ask, active = "set", "no", set()
        value, source, date = record.get("value"), record.get("source"), record.get("date")
    else:
        state, ask = "missing", "no" if name in OPTIONAL else "value"
        value = source = date = None
        active = set() if name in OPTIONAL else set(USED_BY[name])
    return {"state": state, "value": value, "source": source, "date": date, "ask": ask,
            "blocks": blocks_for(name, active), "optional": name in OPTIONAL}

def claims_row(profile, claims):
    record = (profile.get("fields") or {}).get("claims")
    source = record.get("source") if isinstance(record, dict) else None
    date = record.get("date") if isinstance(record, dict) else None
    rows = user_claim_rows(claims)
    approved = [row for row in rows if row.get("status") == "approved"]
    pending = [row for row in rows if row.get("status") != "approved"]
    explicit_empty = isinstance(record, dict) and record.get("explicit") is True and not rows
    if pending:
        state, ask, active = "pending", ("confirm" if any(not (row.get("intake") or {}).get("user_confirmed") for row in pending) else "no"), set(USED_BY["claims"])
    elif approved:
        state, ask, active = "set", "no", set()
    elif explicit_empty:
        state, ask, active = "set", "no", set(USED_BY["claims"])
    else:
        state, ask, active, source, date = "missing", "value", set(USED_BY["claims"]), None, None
    brief = lambda row: {"id": row.get("id"), "status": row.get("status"), "user_confirmed": bool((row.get("intake") or {}).get("user_confirmed"))}
    return {
        "state": state, "value": [brief(row) for row in rows],
        "source": source if rows or explicit_empty else None, "date": date if rows or explicit_empty else None,
        "ask": ask, "blocks": blocks_for("claims", active), "optional": False,
        "confirm": [row.get("id") for row in pending if not (row.get("intake") or {}).get("user_confirmed")],
        "waiting_approval": [row.get("id") for row in pending if (row.get("intake") or {}).get("user_confirmed")],
        "approved": [row.get("id") for row in approved],
    }

def build_report(root):
    root = Path(root)
    profile, claims = load_profile(root), load_yaml(claims_path(root))
    policy = load_yaml(search_dir(root) / "profile/policy.yaml")
    sources = load_yaml(search_dir(root) / "pipeline/sources.yaml")
    ident = profile.get("identity") or {}
    synthetic = all(item is True for item in (profile.get("synthetic"), ident.get("synthetic"), claims.get("synthetic"), policy.get("synthetic")))
    fields = {name: claims_row(profile, claims) if name == "claims" else plain_row(name, profile) for name in FIELDS}
    empty = [key for key in POLICY_KEYS if policy.get(key) in (None, [], {}, "")]
    return {
        "schema": "profile-v1", "submit_authorized": profile.get("submit_authorized") is True,
        "send_authorized": profile.get("send_authorized") is True, "synthetic": synthetic,
        "sources_configured": bool(sources.get("sources")), "standing_answers": bool(ident.get("standing_answer_rules")),
        "policy_unconfigured": empty, "policy_set": [key for key in POLICY_KEYS if key not in empty and key in policy],
        "publish_warning": not synthetic, "missing": [name for name, row in fields.items() if row["state"] == "missing"],
        "fields": fields,
    }

def format_value(value):
    if value in (None, []):
        return "none"
    if isinstance(value, list):
        parts = []
        for item in value:
            parts.append(str(item.get("company") or item.get("id") or item) if isinstance(item, dict) else str(item))
        return ", ".join(parts) if parts else "none"
    return str(value)

def render_report(report, task=None):
    lines = [
        f"SUBMIT_AUTHORIZED: {'yes' if report['submit_authorized'] else 'no'}",
        f"SEND_AUTHORIZED: {'yes' if report['send_authorized'] else 'no'}",
        f"SYNTHETIC_PROFILE: {'yes' if report['synthetic'] else 'no'}",
        f"SOURCES_CONFIGURED: {'yes' if report['sources_configured'] else 'no'}",
        f"STANDING_ANSWERS: {'present' if report['standing_answers'] else 'none'}",
        "UNCONFIGURED: " + (", ".join(report["policy_unconfigured"]) or "(none of the listed keys)"),
        "SET: " + (", ".join(report["policy_set"]) or "(none of the listed keys)"),
    ]
    if report["publish_warning"]:
        lines.append("PRIVATE_OR_UNMARKED_PROFILE: do not publish this tree")
    lines.append("NOTE: unconfigured is not the same as deliberately disabled. Readiness is not permission to submit. Drafts are not sends.")
    lines.append("INTAKE_MISSING: " + (", ".join(report["missing"]) or "(none)"))
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
        blocks = row.get("blocks") or {}
        lines.append("BLOCKS: " + ("; ".join(f"{task_name} ({reason})" for task_name, reason in blocks.items()) or "(none)"))
        if row.get("optional") and row["state"] == "missing":
            lines.append(f"OPTIONAL: source ({USED_BY[name].get('source', 'when asked')})")
    if task and shown == 0:
        lines.append(f"TASK {task}: no intake field is required")
    return "\n".join(lines)

def filter_report(report, task):
    if not task:
        return report
    fields = {name: row for name, row in report["fields"].items() if task in USED_BY[name]}
    return dict(report, fields=fields, missing=[name for name in report["missing"] if name in fields], task=task)

def parse_cli_value(raw):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=None)
    commands = parser.add_subparsers(dest="cmd", required=True)
    report = commands.add_parser("report", help="list missing fields, empty policy, and the tasks each field blocks")
    report.add_argument("--task", choices=TASKS)
    report.add_argument("--json", action="store_true")
    setter = commands.add_parser("set", help="write one field into profile.yaml")
    setter.add_argument("--field", required=True)
    setter.add_argument("--value", required=True)
    setter.add_argument("--source", required=True)
    setter.add_argument("--date")
    setter.add_argument("--replace", action="store_true")
    confirm = commands.add_parser("confirm", help="approve one extracted claim")
    confirm.add_argument("--id", required=True)
    confirm.add_argument("--source", required=True)
    confirm.add_argument("--date")
    args = parser.parse_args(argv)
    root = (args.root or kit_root()).resolve()
    try:
        if args.cmd == "report":
            payload = build_report(root)
            print(json.dumps(filter_report(payload, args.task), indent=2, sort_keys=True) if args.json else render_report(payload, args.task))
        elif args.cmd == "set":
            set_field(root, args.field, parse_cli_value(args.value), args.source, args.date, args.replace)
            print(f"SET {args.field}\nSUBMIT_AUTHORIZED: no\nSEND_AUTHORIZED: no")
        else:
            result = confirm_claim(root, args.id, args.source, args.date)
            print(f"CONFIRMED {result['id']}\nSTATUS: {result['status']}\nSUBMIT_AUTHORIZED: no\nSEND_AUTHORIZED: no")
    except IntakeError as exc:
        print(f"INTAKE_ERROR: {exc}", file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
