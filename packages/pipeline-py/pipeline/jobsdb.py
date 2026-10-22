#!/usr/bin/env python3
"""jobsdb — SQLite source of truth for a job-search workspace.

Generic (no user-specific content). All files live in the data folder resolved by pipeline/home.py
($JOBSEARCH_HOME, default ./jobsearch-data):
  <home>/jobs.db                 the database (source of truth)
  <home>/jobs.md                 GENERATED read-only view (same 6-column table)
  <home>/active.md               GENERATED short view
  <home>/state/                  last-rendered jobs.md copy + lock + logs

Every writer goes through this module: it takes a file lock, runs
reconcile() first (imports hand edits made to jobs.md since the last render),
applies the change, then re-renders the views.
"""
import contextlib, csv, datetime as dt, fcntl, hashlib, json, os, re, sqlite3, time

from pipeline import home as H
from pipeline.fitcheck import combined_fit  # noqa: F401  (single definition of the two-way rule)

HERE = os.path.dirname(os.path.abspath(__file__))       # code folder (prompt, schema)


def configure():
    """(re)bind the data-folder paths from pipeline/home.py; runs at import, and again if $JOBSEARCH_HOME changes."""
    global WS, DB_PATH, STATE, JOBS_MD, ACTIVE_MD, LAST_RENDER, LOCK, LOG
    WS = str(H.home())                                  # the user's data folder
    DB_PATH = str(H.path("jobs_db"))
    STATE = str(H.path("state_dir"))
    JOBS_MD = os.path.join(str(H.path("views_dir")), "jobs.md")
    ACTIVE_MD = os.path.join(str(H.path("views_dir")), "active.md")
    LAST_RENDER = os.path.join(STATE, "jobs.md.last-render")
    LOCK = os.path.join(STATE, ".lock")
    LOG = os.path.join(STATE, "pipeline.log")


configure()

STATUSES = ["To Review", "Interested", "Packaged", "Applied", "Interviewing", "Offer",
            "Rejected", "Withdrawn", "Held", "Blocked", "Closed", "Skipped"]
FITS = ["Strong", "Solid", "Stretch", "Weak", "Skip"]
# higher = further along; used to pick the survivor when duplicates merge
RANK = {"Offer": 11, "Interviewing": 10, "Rejected": 9, "Withdrawn": 8, "Applied": 7, "Packaged": 6,
        "Held": 5, "Blocked": 4, "Interested": 3, "To Review": 2, "Closed": 1, "Skipped": 0}
FIT_RANK = {"Strong": 0, "Solid": 1, "Stretch": 2, None: 3, "Weak": 4, "Skip": 5}

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                 -- first-seen date shown in jobs.md (YYYY-MM-DD)
  company TEXT NOT NULL, company_key TEXT NOT NULL,
  title TEXT NOT NULL, title_key TEXT NOT NULL,
  req_id TEXT, url TEXT, url_canon TEXT,
  lane TEXT,
  status TEXT NOT NULL DEFAULT 'To Review' CHECK (status IN ('To Review','Interested','Packaged','Applied','Interviewing','Offer','Rejected','Withdrawn','Held','Blocked','Closed','Skipped')),
  fit TEXT CHECK (fit IN ('Strong','Solid','Stretch','Weak','Skip') OR fit IS NULL),
  source TEXT NOT NULL, source_detail TEXT,
  location TEXT, pay_text TEXT, posted_at TEXT,
  first_seen TEXT NOT NULL, updated_at TEXT NOT NULL,
  applied_at TEXT, closed_at TEXT, told_at TEXT,
  analysis_path TEXT, package_path TEXT,
  notes TEXT NOT NULL DEFAULT '',
  legacy_status TEXT, legacy_line INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_co_title ON jobs(company_key, title_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_co_req ON jobs(company_key, req_id) WHERE req_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_url ON jobs(url_canon) WHERE url_canon IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_status ON jobs(status);
CREATE TABLE IF NOT EXISTS status_history (job_id INTEGER, old TEXT, new TEXT, at TEXT, by TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, kind TEXT, started_at TEXT, ended_at TEXT,
  window_start TEXT, window_end TEXT, dry_run INTEGER DEFAULT 0, summary TEXT);
CREATE TABLE IF NOT EXISTS run_sources (run_id TEXT, source TEXT, requests INT, ok INT, failed INT,
  fetched INT, in_window INT, matched INT, new_rows INT, gap TEXT);
CREATE TABLE IF NOT EXISTS sightings (job_id INTEGER, run_id TEXT, source TEXT, seen_at TEXT, url TEXT,
  UNIQUE(job_id, run_id, source));
CREATE TABLE IF NOT EXISTS run_notes (id INTEGER PRIMARY KEY, date TEXT, cells TEXT NOT NULL,
  legacy_line INTEGER, sort_order INTEGER NOT NULL DEFAULT 0, raw_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
-- records that failed the shared job-record schema (schema.JobRecord) before insert
CREATE TABLE IF NOT EXISTS rejected (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, source TEXT, company TEXT, title TEXT,
  url TEXT, reason TEXT NOT NULL, raw TEXT, at TEXT NOT NULL) STRICT;
-- per run, per source health
CREATE TABLE IF NOT EXISTS source_health (run_id TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','failed','empty','broken')),
  jobs INTEGER NOT NULL, matched INTEGER NOT NULL, rejects INTEGER NOT NULL, seconds REAL, attempts INTEGER NOT NULL,
  flags TEXT, at TEXT NOT NULL, PRIMARY KEY (run_id, source)) STRICT;
-- type enforcement on jobs (the table predates STRICT; triggers give the same guarantees)
CREATE TRIGGER IF NOT EXISTS jobs_types_ins BEFORE INSERT ON jobs BEGIN
  SELECT RAISE(ABORT, 'jobs: date must be YYYY-MM-DD') WHERE NEW.date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
  SELECT RAISE(ABORT, 'jobs: company/title must be non-empty text') WHERE typeof(NEW.company)!='text' OR typeof(NEW.title)!='text' OR trim(NEW.company)='' OR trim(NEW.title)='';
  SELECT RAISE(ABORT, 'jobs: url must be http(s)') WHERE NEW.url IS NOT NULL AND NEW.url NOT LIKE 'http%';
  SELECT RAISE(ABORT, 'jobs: source must be non-empty text') WHERE typeof(NEW.source)!='text' OR trim(NEW.source)='';
END;
CREATE TRIGGER IF NOT EXISTS jobs_types_upd BEFORE UPDATE ON jobs BEGIN
  SELECT RAISE(ABORT, 'jobs: date must be YYYY-MM-DD') WHERE NEW.date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
  SELECT RAISE(ABORT, 'jobs: company/title must be non-empty text') WHERE typeof(NEW.company)!='text' OR typeof(NEW.title)!='text' OR trim(NEW.company)='' OR trim(NEW.title)='';
  SELECT RAISE(ABORT, 'jobs: url must be http(s)') WHERE NEW.url IS NOT NULL AND NEW.url NOT LIKE 'http%';
  SELECT RAISE(ABORT, 'jobs: replied must be 0/1') WHERE NEW.replied IS NOT NULL AND NEW.replied NOT IN (0,1);
END;
-- apply outcome traceability: one row per stamped package review, linked to later outcomes
CREATE TABLE IF NOT EXISTS package_runs (id INTEGER PRIMARY KEY, job_id INTEGER, package_path TEXT NOT NULL, package TEXT NOT NULL,
  base TEXT, lane TEXT, cover_format TEXT CHECK (cover_format IN ('bullets','paragraphs','none') OR cover_format IS NULL),
  lint_version TEXT, claims_version TEXT, rubric_version TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('PASS','REVISE','FAIL','LEGACY','BUILT')), round INTEGER,
  stamped_at TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('stamp_review','backfill','build_package')),
  UNIQUE(package_path, stamped_at)) STRICT;
CREATE INDEX IF NOT EXISTS ix_runs_job ON package_runs(job_id);
CREATE TABLE IF NOT EXISTS package_outcomes (run_id INTEGER NOT NULL, job_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','replied','rejected','interviewing','offer','withdrawn','closed')),
  at TEXT NOT NULL, by TEXT, note TEXT, UNIQUE(run_id, outcome)) STRICT;
CREATE VIEW IF NOT EXISTS package_results AS
  SELECT r.*, j.company, j.title, j.status,
    EXISTS(SELECT 1 FROM package_outcomes o WHERE o.run_id=r.id AND o.outcome='applied') AS applied,
    EXISTS(SELECT 1 FROM package_outcomes o WHERE o.run_id=r.id AND o.outcome IN ('replied','interviewing','offer')) AS replied,
    EXISTS(SELECT 1 FROM package_outcomes o WHERE o.run_id=r.id AND o.outcome='rejected') AS rejected,
    EXISTS(SELECT 1 FROM package_outcomes o WHERE o.run_id=r.id AND o.outcome IN ('interviewing','offer')) AS interviewed
  FROM package_runs r LEFT JOIN jobs j ON j.id=r.job_id;
-- submit-time gate: one row per submit_gate.py check; never contacts anyone, reads public postings only
CREATE TABLE IF NOT EXISTS submit_checks (id INTEGER PRIMARY KEY, job_id INTEGER, package_path TEXT, run_id INTEGER,
  checked_at TEXT NOT NULL, url TEXT, posting TEXT NOT NULL CHECK (posting IN ('live','closed','unknown')), posting_detail TEXT,
  db_status TEXT, stamp_verdict TEXT, stamp_current INTEGER CHECK (stamp_current IN (0,1)),
  result TEXT NOT NULL CHECK (result IN ('OK','BLOCK')), reasons TEXT) STRICT;
CREATE INDEX IF NOT EXISTS ix_submit_job ON submit_checks(job_id);
"""

PACKAGE_RUNS_SCHEMA = "2026-10-21p3"

def migrate_package_runs(c):
    """widen package_runs CHECKs for prep runs (verdict BUILT, source build_package). Rows are copied unchanged."""
    sql = (c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='package_runs'").fetchone() or [""])[0]
    if "build_package" in sql:
        return False
    cols = "id,job_id,package_path,package,base,lane,cover_format,lint_version,claims_version,rubric_version,verdict,round,stamped_at,source"
    new = SCHEMA[SCHEMA.index("CREATE TABLE IF NOT EXISTS package_runs"):SCHEMA.index("CREATE INDEX IF NOT EXISTS ix_runs_job")]
    view = SCHEMA[SCHEMA.index("CREATE VIEW IF NOT EXISTS package_results"):SCHEMA.index("-- submit-time gate")]
    c.execute("BEGIN IMMEDIATE")
    try:
        c.execute("DROP VIEW IF EXISTS package_results")
        c.execute("ALTER TABLE package_runs RENAME TO package_runs_old")
        c.execute(new.replace("IF NOT EXISTS ", ""))
        c.execute(f"INSERT INTO package_runs({cols}) SELECT {cols} FROM package_runs_old")
        n_old = c.execute("SELECT count(*) FROM package_runs_old").fetchone()[0]
        assert c.execute("SELECT count(*) FROM package_runs").fetchone()[0] == n_old
        c.execute("DROP TABLE package_runs_old")
        c.execute("CREATE INDEX IF NOT EXISTS ix_runs_job ON package_runs(job_id)")
        c.execute(view)
        c.execute("INSERT OR REPLACE INTO meta(k,v) VALUES ('schema_package_runs', ?)", (PACKAGE_RUNS_SCHEMA,))
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK"); raise
    return True

def now_iso():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")

def today():
    return dt.date.today().isoformat()

def log(msg):
    os.makedirs(STATE, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(f"{now_iso()} {msg}\n")

EXTRA_COLUMNS = {"skip_reason": "TEXT", "skipped_by": "TEXT", "replied": "INTEGER DEFAULT 0",
                 # two-way fit: want = meets criteria.md (pass/fail), win = JD vs the lane base resume (high/medium/low)
                 "want": "TEXT CHECK (want IN ('pass','fail') OR want IS NULL)", "win": "TEXT CHECK (win IN ('high','medium','low') OR win IS NULL)",
                 "scored_with": "TEXT", "base_resume": "TEXT", "ats_type": "TEXT",
                 # where the role can be worked from, as verified at scoring: local | remote-us | out-of-area | unverified
                 "remote_check": "TEXT CHECK (remote_check IN ('local','remote-us','out-of-area','unverified') OR remote_check IS NULL)"}

BUSY_TIMEOUT_S = 30   # wait up to 30 s for another writer instead of failing at once

def connect(path=None):
    target = os.path.abspath(path or DB_PATH)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    c = sqlite3.connect(target, timeout=BUSY_TIMEOUT_S)
    c.row_factory = sqlite3.Row
    c.execute(f"PRAGMA busy_timeout={int(BUSY_TIMEOUT_S * 1000)}")
    # Setup writes (schema, added columns, migration, meta stamp) are committed here. Python's sqlite3 opens an
    # implicit transaction before any INSERT/UPDATE, even one that ends up ignored, and holds the write lock until
    # commit; an uncommitted setup write would leave every connect() holding the write lock, and the next connect()
    # in the same run (score.py -> open_for_write) would die with "database is locked".
    try:
        c.executescript(SCHEMA)
        have = {r[1] for r in c.execute("PRAGMA table_info(jobs)")}
        for col, typ in EXTRA_COLUMNS.items():
            if col not in have:
                c.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")
        c.commit()
        migrate_package_runs(c)   # after the jobs columns exist (the rename re-parses the jobs triggers); commits itself
        if c.execute("SELECT 1 FROM meta WHERE k='schema_package_runs'").fetchone() is None:   # write only when missing
            c.execute("INSERT OR IGNORE INTO meta(k,v) VALUES ('schema_package_runs', ?)", (PACKAGE_RUNS_SCHEMA,))
        c.commit()
    except Exception:
        c.close(); raise
    assert not c.in_transaction, "connect() must not return holding a write transaction"
    return c

# skip reasons: short, fixed vocabulary so the weekly report can count them
SKIP_REASONS = [
    ("hard-requirement gap", r"hard[- ]requirement|missing (?:a )?must-have"),   # honest package, but a JD must-have is not met
    ("geo", r"\b(geo|relocat|on-?site in|not remote|outside (?:the )?(?:area|region)|too far|commute)"),
    ("pay", r"(pay|cash|base|comp)[^.;]{0,30}(floor|under|below|light|n/d|not (?:posted|disclosed))"),
    ("one-role-per-company", r"one[- ]role|already (?:applied|packaged)|company in play|pick[- ]one|pending app"),
    ("stage/size", r"series [c-z]\b|late-stage|growth|public co|big tech|subsidiar|pe-owned"),
    ("seniority", r"too junior|down-?level|junior|too senior|level mismatch|\bmid\b|ic only"),
    ("off-lane", r"off-lane|not lane|non-lane|sales|account exec|quota|marketing|recruit|data scien|ml research|deep-ml|hardware|\bhw\b|firmware|embedded|it endpoint"),
    ("domain/specialty", r"specialt|domain|security|crypto|ads|gaming|networking|storage|kernel|infiniband|ehr"),
    ("brand/hot rule", r"brand|hot |ai-lab|no auto-package"),
    ("clearance/sponsorship", r"clearance|sponsor|citizenship req|public trust"),
    ("closed/stale", r"closed|filled|no longer|stale|404|expired|reposted old"),
    ("duplicate", r"duplicate|dup\b|already (?:logged|tracked|told|skipped)|twin"),
]

def skip_reason_of(text):
    t = (text or "").lower()
    for name, rx in SKIP_REASONS:
        if re.search(rx, t):
            return name
    return "other"

def skipped_by_of(raw_status, notes):
    """'user' when the candidate made the call (e.g. "Skipped (user, ...)", "candidate pass"), else 'agent'"""
    t = (raw_status or "") + " " + (notes or "")[:200]
    if re.search(r"\(\s*(?:user|candidate)\b|\b(?:user|candidate)[^.;]{0,25}\b(?:skip|pass|no\b|declin|not interested|too far)", t, re.I):
        return "user"
    return "agent"

@contextlib.contextmanager
def locked():
    os.makedirs(STATE, exist_ok=True)
    with open(LOCK, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)

def meta_get(c, k, d=None):
    r = c.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r[0] if r else d

def meta_set(c, k, v):
    c.execute("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))

# ---------------------------------------------------------------- normalizing
_SUFFIX = {"inc", "llc", "ltd", "corp", "corporation", "co", "company", "the", "gmbh", "plc"}

def company_key(s):
    s = (s or "").lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    w = [x for x in s.split() if x not in _SUFFIX]
    return " ".join(w).strip() or (s or "").strip()

def title_key(s):
    s = (s or "").lower()
    s = re.sub(r"\([^)]*\d{4,}[^)]*\)", " ", s)          # (JR2028220), (REQ-2026-1)
    s = re.sub(r"\bsr\.?\b", "senior", s)
    s = re.sub(r"\bmgr\.?\b", "manager", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

JOB_HOSTS = r"(ashbyhq\.com|greenhouse\.io|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|linkedin\.com/jobs/view|governmentjobs\.com|usajobs\.gov|icims\.com|oraclecloud\.com|workable\.com|rippling|eightfold|calcareers|jobvite|bamboohr|recruitee|teamtailor|dover\.com|ycombinator\.com/companies/[^/]+/jobs|wellfound|getro|careers)"

def urls_in(text):
    return [u.rstrip(".,;:)]*`'\"") for u in re.findall(r"https?://[^\s|`<>\"')\]]+", text or "")]

def primary_url(text):
    us = urls_in(text)
    for u in us:
        if re.search(JOB_HOSTS, u, re.I):
            return u
    m = re.search(r"\bli:(\d{9,11})\b", text or "")
    if m:
        return f"https://www.linkedin.com/jobs/view/{m.group(1)}"
    return us[0] if us else None

def canon_url(u):
    if not u:
        return None
    u = u.strip()
    m = re.search(r"linkedin\.com/jobs/view/(?:[^/?]*-)?(\d{8,12})", u)
    if m:
        return f"linkedin.com/jobs/view/{m.group(1)}"
    m = re.match(r"https?://([^/]+)(/[^?#]*)?(\?[^#]*)?", u, re.I)
    if not m:
        return u.lower()
    host, path, q = m.group(1).lower(), (m.group(2) or "").rstrip("/"), m.group(3) or ""
    host = re.sub(r"^www\.", "", host)
    keep = re.findall(r"(?:gh_jid|jobId|id)=[\w-]+", q)
    return host + path + ("?" + "&".join(keep) if keep else "")

REQ_RE = re.compile(r"\b((?:JR|R|REQ|R-|JOB|P)[-_]?\d{4,}(?:[-_]\d+)?|\d{4}-\d{4,})\b")

def req_from(title, url=None):
    m = re.search(r"\(([^)]*\d{4,}[^)]*)\)", title or "")
    if m:
        m2 = REQ_RE.search(m.group(1))
        if m2:
            return m2.group(1).upper()
    if url:
        m = re.search(r"_((?:JR|R|REQ)[-_]?\d{4,})(?:-\d+)?(?:$|[/?])", url)
        if m:
            return m.group(1).upper()
    return None

# ---------------------------------------------------------------- status/fit/source parsing
_STATUS_PREFIX = [("To Review Stretch", "To Review", "Stretch"), ("To Review", "To Review", None),
                  ("Applied", "Applied", None), ("Packaged", "Packaged", None), ("Held", "Held", None),
                  ("Hold", "Held", None), ("Skipped", "Skipped", None), ("Skip", "Skipped", None),
                  ("Rejected", "Rejected", None), ("Interested", "Interested", None),
                  ("Blocked", "Blocked", None), ("Closed", "Closed", None),
                  ("Interviewing", "Interviewing", None), ("Offer", "Offer", None),
                  ("Withdrawn", "Withdrawn", None)]

def map_status(raw):
    """free-text status -> (enum status or None, fit hint or None)"""
    s = re.sub(r"\*+", "", raw or "").strip()
    for pre, st, fit in _STATUS_PREFIX:
        if s.lower().startswith(pre.lower()):
            return st, fit
    return None, None

def fit_from_notes(notes):
    head = re.sub(r"[*`_]", "", notes or "")[:160]
    m = re.search(r"\b(Strong|Solid|Stretch|Weak)\b", head)
    return m.group(1) if m else None

def infer_source(text):
    t = (text or "").lower()
    m = re.search(r"\bsrc[: ]+((?:li|ats|vc|peer|news|gov|browser|web|workday|hn)[:a-z0-9.\-]*)", t)
    if m:
        v = m.group(1).rstrip(".")
        v = {"li:signed-in": "li:signed-in", "li-signed-in": "li:signed-in", "li:guest": "li:guest", "li-guest": "li:guest",
             "browser:li-signed-in": "li:signed-in", "browser:linkedin": "li:signed-in", "browser:hiring.cafe": "hiring.cafe"}.get(v, v)
        if v.startswith("workday"): v = "workday"
        if v.startswith("web"): v = "web"
        return v, "tagged"
    m = re.search(r"\b(peer:[a-z0-9.\-]+)", t)
    if m: return m.group(1), "inferred"
    m = re.search(r"\b(vc:[a-z0-9.\-]+)", t)
    if m: return m.group(1), "inferred"
    m = re.search(r"\b(news:[a-z0-9.\-]+)", t)
    if m: return m.group(1), "inferred"
    if re.search(r"hiring\.cafe|hiring-cafe|browser:hiring|\bhc\b", t): return "hiring.cafe", "inferred"
    if re.search(r"usajobs|calcareers|governmentjobs|neogov", t): return "gov", "inferred"
    if re.search(r"li:signed|signed-in|signedin|browser:li|browser:linkedin", t): return "li:signed-in", "inferred"
    if re.search(r"myworkdayjobs|workday", t): return "workday", "inferred"
    if "ashbyhq" in t or "ats:ashby" in t: return "ats:ashby", "inferred"
    if "greenhouse" in t or "gh_jid" in t: return "ats:greenhouse", "inferred"
    if "lever.co" in t: return "ats:lever", "inferred"
    if "smartrecruiters" in t: return "ats:smartrecruiters", "inferred"
    if "linkedin" in t or re.search(r"\bli:", t): return "li:guest", "inferred"
    if "next play" in t or "nextplay" in t: return "nextplay", "inferred"
    if "websearch" in t or "web:" in t: return "web", "inferred"
    return "legacy:unknown", "inferred"

def is_run_note(cells):
    """scout logs / multi-company clusters / board rechecks that were written as table rows"""
    if len(cells) <= 5:
        return True
    date, company, title, lane, status = cells[:5]
    st = status.strip("* ")
    if st.startswith("Note"):
        return True
    if re.match(r"20\d\d-\d\d-\d\d", company) or re.match(r"\d{1,2}-\d{1,2} ", company):
        return True
    if re.fullmatch(r"\([^()]*\)", title.strip()):          # "(board recheck)", "(funding 7-14d light)"
        return True
    if company.count(" / ") >= 2 or company.count("·") >= 2:
        return True
    if re.search(r"\b(cluster|sweep|dry-run|boards|packages|batch|recheck)\b", company, re.I):
        return True
    return False

# ---------------------------------------------------------------- jobs.md parsing
ROW_START = re.compile(r"^\s*\|")

def split_row(line):
    s = line.strip()
    if s.startswith("|"): s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"): s = s[:-1]
    return [c.strip() for c in re.split(r"(?<!\\)\|", s)]

def parse_jobs_md(text):
    """-> (rows, search_notes_text). rows: dicts {line, cells, kind: job|note|cont}"""
    lines = text.split("\n")
    rows, notes_lines, in_notes = [], [], False
    for i, line in enumerate(lines, 1):
        if line.startswith("## Search notes"):
            in_notes = True
            continue
        if ROW_START.match(line):
            st = line.strip()
            if st.startswith("|---") or st.startswith("| Date |"):
                continue
            cells = split_row(line)
            if not re.match(r"20\d\d-\d\d-\d\d$", cells[0] if cells else ""):
                prev = rows[-1] if rows else None
                if (prev and prev["kind"] == "note" and len(prev["cells"]) == 5 and map_status(cells[0])[0]
                        and not map_status(prev["cells"][3])[0]):
                    # broken row split across two lines: date|company|title|lane+notes|  +  status|notes
                    p = prev["cells"]
                    lane_notes = p[3].split(None, 1) + [""]
                    prev["cells"] = [p[0], p[1], p[2], lane_notes[0], cells[0],
                                     (lane_notes[1] + " " + p[4] + " " + " ".join(cells[1:])).strip()]
                    prev["kind"] = "job"
                    prev["raw"] += "\n" + line
                    continue
                rows.append({"line": i, "cells": cells, "kind": "cont", "raw": line})
                continue
            if len(cells) > 6:
                cells = cells[:5] + [" \\| ".join(cells[5:])]
            kind = "note" if is_run_note(cells) else "job"
            rows.append({"line": i, "cells": cells, "kind": kind, "raw": line})
        elif in_notes:
            notes_lines.append(line)
    sn = "\n".join(notes_lines).strip("\n")
    return rows, sn

def esc(s):
    return re.sub(r"(?<!\\)\|", r"\\|", (s or "").replace("\n", " ").strip())

# ---------------------------------------------------------------- rendering
HEADER = ("# Jobs board\n\n"
          "<!-- GENERATED from pipeline/jobs.db - edit via pipeline/update_status.py or pipeline/upsert.py. "
          "Hand edits are imported by the next pipeline call (reconcile) and then re-rendered. -->\n\n"
          "Statuses: " + " | ".join(STATUSES) + "  (\"To Review Stretch\" = To Review with fit Stretch)\n\n"
          "| Date | Company | Title | Lane | Status | Notes |\n|---|---|---|---|---|---|\n")

def display_status(r):
    if r["status"] == "To Review" and r["fit"] == "Stretch":
        return "To Review Stretch"
    return r["status"]

def job_row_line(r):
    return "| " + " | ".join([r["date"], esc(r["company"]), esc(r["title"]), esc(r["lane"] or ""),
                               display_status(r), esc(r["notes"])]) + " |"

def render_jobs_md(c):
    items = []
    for r in c.execute("SELECT * FROM jobs"):
        items.append((r["date"], r["sort_order"], job_row_line(r)))
    for r in c.execute("SELECT * FROM run_notes"):
        cells = json.loads(r["cells"])
        items.append((r["date"], r["sort_order"], "| " + " | ".join(esc(x) for x in cells) + " |"))
    items.sort(key=lambda x: (_neg_date(x[0]), x[1]))
    body = HEADER + "\n".join(x[2] for x in items) + "\n"
    sn = meta_get(c, "search_notes", "")
    body += "\n## Search notes\n" + (sn + "\n" if sn else "")
    return body

def _neg_date(d):
    try:
        return -dt.date.fromisoformat(d).toordinal()
    except Exception:
        return 0

def write_views(c):
    body = render_jobs_md(c)
    tmp = JOBS_MD + ".tmp"
    with open(tmp, "w") as f:
        f.write(body)
    os.replace(tmp, JOBS_MD)
    with open(LAST_RENDER, "w") as f:
        f.write(body)
    meta_set(c, "jobs_md_sha", hashlib.sha256(body.encode()).hexdigest())
    render_active(c)
    c.commit()

def render_active(c, n_review=50):
    counts = {s: 0 for s in STATUSES}
    for r in c.execute("SELECT status, COUNT(*) n FROM jobs GROUP BY status"):
        counts[r["status"]] = r["n"]
    total = sum(counts.values())
    fitc = {r["fit"]: r["n"] for r in c.execute("SELECT fit, COUNT(*) n FROM jobs WHERE status='To Review' GROUP BY fit")}
    cutoff30 = (dt.date.today() - dt.timedelta(days=30)).isoformat()
    cutoff14 = (dt.date.today() - dt.timedelta(days=14)).isoformat()
    out = [f"# Active pipeline (generated {now_iso()} from pipeline/jobs.db)", "",
           f"**Full counts ({total} roles):** " + " · ".join(f"{s} {counts[s]}" for s in STATUSES),
           f"To Review by fit: Strong {fitc.get('Strong',0)} · Solid {fitc.get('Solid',0)} · Stretch {fitc.get('Stretch',0)} · unrated {fitc.get(None,0)}",
           "", "Shown: Interviewing/Offer, Applied in the last 30 days, Packaged, Held, and the newest To Review (≤14 days, best fit first, max %d). Full list: jobs.md." % n_review, ""]

    def tbl(title, rows, cols):
        out.append(f"## {title} ({len(rows)})")
        out.append("")
        if not rows:
            out.append("_none_"); out.append(""); return
        out.append("| " + " | ".join(h for h, _ in cols) + " |")
        out.append("|" + "---|" * len(cols))
        for r in rows:
            out.append("| " + " | ".join(esc(str(f(r) or "")) for _, f in cols) + " |")
        out.append("")
    link = lambda r: r["url"] or ""
    short = lambda r: (r["notes"] or "")[:140]
    tbl("Interviewing / Offer", c.execute("SELECT * FROM jobs WHERE status IN ('Interviewing','Offer') ORDER BY updated_at DESC").fetchall(),
        [("Company", lambda r: r["company"]), ("Title", lambda r: r["title"]), ("Status", lambda r: r["status"]), ("Link", link)])
    tbl("Applied, last 30 days", c.execute("SELECT * FROM jobs WHERE status='Applied' AND COALESCE(applied_at, date) >= ? ORDER BY COALESCE(applied_at, date) DESC", (cutoff30,)).fetchall(),
        [("Applied", lambda r: r["applied_at"] or r["date"]), ("Company", lambda r: r["company"]), ("Title", lambda r: r["title"]), ("Lane", lambda r: r["lane"])])
    tbl("Packaged (not submitted)", c.execute("SELECT * FROM jobs WHERE status='Packaged' ORDER BY date DESC").fetchall(),
        [("Date", lambda r: r["date"]), ("Company", lambda r: r["company"]), ("Title", lambda r: r["title"]), ("Fit", lambda r: r["fit"]), ("Package", lambda r: r["package_path"])])
    tbl("Held", c.execute("SELECT * FROM jobs WHERE status='Held' ORDER BY date DESC").fetchall(),
        [("Date", lambda r: r["date"]), ("Company", lambda r: r["company"]), ("Title", lambda r: r["title"]), ("Why", short)])
    rev = c.execute("SELECT * FROM jobs WHERE status='To Review' AND date >= ? AND COALESCE(fit,'') NOT IN ('Weak','Skip')", (cutoff14,)).fetchall()
    rev = sorted(rev, key=lambda r: (FIT_RANK.get(r["fit"], 3), _neg_date(r["date"]), r["sort_order"]))[:n_review]
    tbl("To Review, newest by fit", rev,
        [("Date", lambda r: r["date"]), ("Fit", lambda r: r["fit"]), ("Company", lambda r: r["company"]), ("Title", lambda r: r["title"]), ("Lane", lambda r: r["lane"]), ("Link", link)])
    with open(ACTIVE_MD + ".tmp", "w") as f:
        f.write("\n".join(out) + "\n")
    os.replace(ACTIVE_MD + ".tmp", ACTIVE_MD)

# ---------------------------------------------------------------- lookups / writes
def find(c, company=None, title=None, url=None, req_id=None):
    if url:
        r = c.execute("SELECT * FROM jobs WHERE url_canon=?", (canon_url(url),)).fetchone()
        if r: return r
    if company and req_id:
        r = c.execute("SELECT * FROM jobs WHERE company_key=? AND req_id=?", (company_key(company), req_id.upper())).fetchone()
        if r: return r
    if company and title:
        r = c.execute("SELECT * FROM jobs WHERE company_key=? AND title_key=?", (company_key(company), title_key(title))).fetchone()
        if r: return r
        # fallback: same company, same title once parenthetical qualifiers and req IDs are dropped
        # ("Senior / Staff Platform Software Engineer (AI copilot platform)" == "Senior / Staff Platform Software Engineer")
        bare = lambda t: title_key(re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", t or ""))
        b = bare(title)
        if len(b) >= 8:
            for r in c.execute("SELECT * FROM jobs WHERE company_key=?", (company_key(company),)):
                if bare(r["title"]) == b:
                    return r
    return None

# ---- apply outcome traceability
OUTCOME_OF = {"Applied": "applied", "Rejected": "rejected", "Interviewing": "interviewing", "Offer": "offer",
              "Withdrawn": "withdrawn", "Closed": "closed"}

def record_package_run(c, *, package_path, verdict, stamped_at, source="stamp_review", job_id=None, base=None, lane=None,
                       cover_format=None, lint_version=None, claims_version=None, rubric_version=None, round=None):
    """one row per stamp; job_id resolved from jobs.package_path when not given. Returns the run id."""
    pp = os.path.normpath(package_path)
    if job_id is None:
        r = c.execute("SELECT id FROM jobs WHERE rtrim(package_path,'/')=?", (pp,)).fetchone()
        job_id = r[0] if r else None
    if job_id is not None and lane is None:
        r = c.execute("SELECT lane FROM jobs WHERE id=?", (job_id,)).fetchone()
        lane = r[0] if r else None
    for _ in range(60):
        # (package_path, stamped_at) is unique: a build and its review in the same second must not collide, so a
        # clash with a different run moves this stamp on by one second instead of silently keeping the old row
        clash = c.execute("SELECT verdict, source FROM package_runs WHERE package_path=? AND stamped_at=?", (pp, stamped_at)).fetchone()
        if clash is None or tuple(clash) == (verdict, source):
            break
        stamped_at = (dt.datetime.fromisoformat(stamped_at) + dt.timedelta(seconds=1)).isoformat(timespec="seconds")
    c.execute("""INSERT OR IGNORE INTO package_runs(job_id,package_path,package,base,lane,cover_format,lint_version,claims_version,
                 rubric_version,verdict,round,stamped_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (job_id, pp, os.path.basename(pp), base, lane, cover_format, lint_version, claims_version, rubric_version,
               verdict, round, stamped_at, source))
    r = c.execute("SELECT id FROM package_runs WHERE package_path=? AND stamped_at=? AND verdict=? AND source=?",
                  (pp, stamped_at, verdict, source)).fetchone()
    if r is None:  # OR IGNORE also swallows CHECK failures; never lose a run silently
        raise ValueError(f"package_runs row not recorded (check constraint?): verdict={verdict!r} source={source!r}")
    return r[0]

def latest_run(c, job_id, before=None, reviewed=True):
    """the most recent package run for a job (optionally stamped at or before `before`).
    reviewed=True (default) skips BUILT prep runs, so outcomes link to the review stamp that was approved."""
    q, args = "SELECT * FROM package_runs WHERE job_id=?", [job_id]
    if reviewed: q += " AND verdict!='BUILT'"
    if before: q += " AND stamped_at<=?"; args.append(before)
    return c.execute(q + " ORDER BY stamped_at DESC, id DESC LIMIT 1", args).fetchone()

def record_outcome(c, job_id, outcome, at, by=None, note=None):
    """link an outcome to the package the role was last stamped with. No run -> nothing recorded (returns None)."""
    run = latest_run(c, job_id, before=at) or latest_run(c, job_id)
    if not run:
        return None
    c.execute("INSERT OR IGNORE INTO package_outcomes(run_id,job_id,outcome,at,by,note) VALUES (?,?,?,?,?,?)",
              (run["id"], job_id, outcome, at, by, note))
    return run["id"]

def set_status(c, job_id, status, by, note=None, fit=None, package=None, when=None):
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    r = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not r:
        raise KeyError(job_id)
    ts = when or now_iso()
    notes = r["notes"] or ""
    if note:
        notes = (notes + " · " if notes else "") + f"[{ts[:10]} {status}] {note}"
    fields = {"status": status, "updated_at": ts, "notes": notes}
    if fit: fields["fit"] = fit
    if package: fields["package_path"] = package
    if status == "Applied" and not r["applied_at"]: fields["applied_at"] = ts[:10]
    if status in ("Rejected", "Closed", "Withdrawn") and not r["closed_at"]: fields["closed_at"] = ts[:10]
    c.execute("UPDATE jobs SET " + ",".join(f"{k}=?" for k in fields) + " WHERE id=?", (*fields.values(), job_id))
    if r["status"] != status:
        c.execute("INSERT INTO status_history VALUES (?,?,?,?,?,?)", (job_id, r["status"], status, ts, by, note))
        if status in OUTCOME_OF:
            record_outcome(c, job_id, OUTCOME_OF[status], ts, by, note)
        if status in ("Interviewing", "Offer"):
            record_outcome(c, job_id, "replied", ts, by, note)

def new_sort_order():
    return -int(time.time() * 1000)

def insert_job(c, *, company, title, source, lane=None, status="To Review", fit=None, url=None, req_id=None,
               location=None, pay_text=None, posted_at=None, notes="", date=None, source_detail=None,
               analysis_path=None, package_path=None, by="insert"):
    ts = now_iso()
    req_id = (req_id or req_from(title, url) or None)
    req_id = req_id.upper() if req_id else None
    cur = c.execute("""INSERT INTO jobs(date,company,company_key,title,title_key,req_id,url,url_canon,lane,status,fit,source,
        source_detail,location,pay_text,posted_at,first_seen,updated_at,notes,analysis_path,package_path,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (date or today(), company, company_key(company), title, title_key(title), req_id, url, canon_url(url), lane,
         status, fit, source, source_detail, location, pay_text, posted_at, ts, ts, notes or "", analysis_path,
         package_path, new_sort_order()))
    c.execute("INSERT INTO status_history VALUES (?,?,?,?,?,?)", (cur.lastrowid, None, status, ts, by, source))
    try:
        from pipeline import schema as _S
        c.execute("UPDATE jobs SET ats_type=? WHERE id=?", (_S.ats_type_of(source), cur.lastrowid))
    except ImportError:
        pass
    return cur.lastrowid

def add_rejected(c, run_id, posting, reason):
    import json as _j
    c.execute("INSERT INTO rejected(run_id,source,company,title,url,reason,raw,at) VALUES (?,?,?,?,?,?,?,?)",
              (run_id, posting.get("source"), posting.get("company"), posting.get("title"), posting.get("url"), reason,
               _j.dumps(posting, default=str)[:20000], now_iso()))

def add_health(c, run_id, source, status, jobs, matched, rejects, seconds, attempts, flags):
    c.execute("INSERT OR REPLACE INTO source_health VALUES (?,?,?,?,?,?,?,?,?,?)",
              (run_id, source, status, int(jobs or 0), int(matched or 0), int(rejects or 0), float(seconds or 0), int(attempts or 1), flags, now_iso()))

def add_sighting(c, job_id, run_id, source, url=None):
    c.execute("INSERT OR IGNORE INTO sightings VALUES (?,?,?,?,?)", (job_id, run_id, source, now_iso(), url))

# ---------------------------------------------------------------- reconcile hand edits
def reconcile(c, by="hand-edit"):
    """Import edits made directly to jobs.md since the last render. Returns a summary dict."""
    res = {"changed": 0, "inserted": 0, "notes_added": 0, "status_changes": [], "skipped": 0}
    if not os.path.exists(JOBS_MD) or not os.path.exists(LAST_RENDER):
        return res
    cur_text = open(JOBS_MD).read()
    if hashlib.sha256(cur_text.encode()).hexdigest() == meta_get(c, "jobs_md_sha"):
        return res
    last_rows, _ = parse_jobs_md(open(LAST_RENDER).read())
    last_set = {r["raw"].strip() for r in last_rows}
    rows, sn = parse_jobs_md(cur_text)
    if sn != meta_get(c, "search_notes", ""):
        meta_set(c, "search_notes", sn)
    prev_job = None
    for r in rows:
        if r["raw"].strip() in last_set:
            prev_job = None
            continue
        cells = r["cells"]
        if r["kind"] == "cont":
            res["skipped"] += 1
            continue
        if r["kind"] == "note":
            key = hashlib.sha1(r["raw"].strip().encode()).hexdigest()
            if not c.execute("SELECT 1 FROM run_notes WHERE raw_key=?", (key,)).fetchone():
                c.execute("INSERT INTO run_notes(date,cells,sort_order,raw_key) VALUES (?,?,?,?)",
                          (cells[0], json.dumps(cells), new_sort_order(), key))
                res["notes_added"] += 1
            continue
        date, company, title, lane, raw_status, notes = (cells + [""] * 6)[:6]
        status, fit_hint = map_status(raw_status)
        url = primary_url(notes)
        ex = find(c, company=company, title=title) or (find(c, url=url) if url else None)
        if status is None:
            status = ex["status"] if ex else "To Review"
            notes = f"[status text: {raw_status}] {notes}"
        detail = re.sub(r"\*+", "", raw_status).strip()
        if detail not in (status, "To Review Stretch") and not notes.startswith("[status"):
            notes = f"[status: {detail}] {notes}"
        if ex:
            fields = {}
            if ex["notes"] != notes: fields["notes"] = notes
            if fit_hint and ex["fit"] != fit_hint: fields["fit"] = fit_hint
            if lane and ex["lane"] != lane: fields["lane"] = lane
            if fields:
                fields["updated_at"] = now_iso()
                c.execute("UPDATE jobs SET " + ",".join(f"{k}=?" for k in fields) + " WHERE id=?", (*fields.values(), ex["id"]))
            if ex["status"] != status:
                set_status(c, ex["id"], status, by=by, note=None)
                if status == "Applied":
                    m = re.search(r"(20\d\d-\d\d-\d\d)", raw_status)
                    if m: c.execute("UPDATE jobs SET applied_at=? WHERE id=?", (m.group(1), ex["id"]))
                res["status_changes"].append(f"{company} | {title}: {ex['status']} -> {status}")
            if fields or ex["status"] != status:
                res["changed"] += 1
        else:
            src, det = infer_source(notes)
            try:
                jid = insert_job(c, company=company, title=title, source=src, source_detail="hand-edit",
                                 lane=lane, status=status, fit=fit_hint or fit_from_notes(notes), url=url,
                                 notes=notes, date=date, by=by)
                res["inserted"] += 1
            except sqlite3.IntegrityError as e:
                res["skipped"] += 1
                log(f"reconcile: could not insert {company} | {title}: {e}")
    c.commit()
    log(f"reconcile: {json.dumps(res)}")
    return res

def open_for_write():
    """lock must be held by caller. connect + reconcile."""
    c = connect()
    rec = reconcile(c)
    return c, rec
