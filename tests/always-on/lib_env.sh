#!/bin/bash
# Shared environment resolution for every run_*.sh / judge_*.sh in this
# directory. Sourced, never executed directly. The caller must already have
# set `ROOT` and `REPO` (every script does this as its first two lines).
#
# Fixes the judge-reads-live-skills hole (docs/evals/rule-inventory.md item
# 8): a judge that `cat`s "$REPO/skills/..." grades an ablation arm against
# the ABLATED text, so a removed rule also vanishes from the judge's
# standard. The fix is a frozen snapshot of the real (unablated) skills/
# tree, identified by its own content (not just the commit — a dirty
# working tree can change between two invocations at the same commit), that
# the judge reads instead of the live tree.
#
#   RUNNER_SKILLS_DIR  what gets copied into the agent-under-test's
#                       workspace. Default: $REPO/skills (today's
#                       behaviour). Set this to an ablated tree to give the
#                       RUNNER a different skill text than the judge sees.
#   JUDGE_SKILLS_DIR    what a judge reads when it quotes "the skill says
#                       X". Default: the frozen snapshot this run took at
#                       start, which — so long as nobody has set
#                       RUNNER_SKILLS_DIR to something ablated — is byte-
#                       identical to $REPO/skills at run time, i.e. today's
#                       behaviour. The snapshot is ALWAYS taken from the
#                       real $REPO/skills, never from RUNNER_SKILLS_DIR, so
#                       an ablation never also erases the judge's standard.
#                       The snapshot ITSELF is write-once (same commit +
#                       content hash -> same directory, never recopied);
#                       what's NOT write-once is the per-tag record of which
#                       models/dirs were used — see run-info.txt below.
#
#   RUNNER_MODEL  the model under test. Default: claude-sonnet-5 (Sonnet 5,
#                 the owner's stated web default; docs/evals/rule-inventory.md
#                 item 8, confirmed as what `sonnet` resolved to in the
#                 August runs). MODEL is kept as an alias for back-compat.
#                 Sonnet 5 may have no dated id, so the DEFAULT path sets
#                 RUNNER_MODEL_UNDATED_OK=1 for you (recorded as such); an
#                 explicit override to something undated needs that same
#                 escape set explicitly, or it's rejected.
#   JUDGE_MODEL   the grading model. REQUIRED — no default, and REJECTED if
#                 it's a bare alias (opus, sonnet, haiku, fable, ...) or has
#                 no dated suffix (`...-20YYMMDD`), unless
#                 JUDGE_MODEL_UNDATED_OK=1 is set explicitly (recorded).
#                 Pinning to a DATE, not just a version number, is what
#                 keeps the judge fixed for the life of a B1 measurement.
#   SIM_MODEL     (t19 only) the persona simulator. Same dated-or-escape
#                 rule as RUNNER_MODEL, default claude-sonnet-5,
#                 SIM_MODEL_UNDATED_OK=1 auto-set on that default path.
#
# run-info.txt / judge-info.txt (in each results/<tag>/ dir) are APPEND-ONLY
# logs. Every line that belongs to a record starts with `ts=`; readers MUST
# select record lines with `grep '^ts='` before `tail -1` — extra per-runner
# fields (e.g. t19's sim_model) are appended to the SAME record line via
# snapshot_and_record_run_info's second argument, never as a bare stray
# line, or a naive `tail -1` reader silently falls off the record (found
# 2026-09-22: an earlier fix appended a bare `sim_model=` line after the
# record and broke every `tail -1`-based reader for t19 — including the
# judge's snapshot lookup, which then silently fell back to the LIVE tree).
#
# A same-tag invocation whose runner model/skills-dir/skills-hash (or judge
# model/skills-dir) differs from the immediately preceding record gets a
# loud WARN, since that means the tag's results now mix two configurations
# — including a skills_hash change alone (e.g. an edit between two runs at
# the same commit), which a model/dir-only comparison would miss.
set -u

_KNOWN_MODEL_ALIASES="opus sonnet haiku fable"
# A dated model id ends in -20YYMMDD (e.g. -20250514). This is what actually
# pins a judge/runner against drift — a bare version number is not enough.
_lib_env_is_dated() { printf '%s' "$1" | grep -qE -- '-20[0-9]{6}$'; }

# $1 = var name (for messages), $2 = value, $3 = escape var name,
# $4 = escape value ("1" allows undated). Exits 2 on a bad value.
_lib_env_check_model() {
  local name="$1" val="$2" escname="$3" escval="$4" a
  [ -n "$val" ] || return 0   # emptiness handled by the caller (JUDGE_MODEL's requiredness)
  for a in $_KNOWN_MODEL_ALIASES; do
    if [ "$(printf '%s' "$val" | tr 'A-Z' 'a-z')" = "$a" ]; then
      echo "$name=$val is a bare alias, not a pinned id." >&2
      echo "Aliases float (their target model can change); a B1 measurement needs" >&2
      echo "a fixed model. Use an explicit, DATED model id, or set $escname=1 to" >&2
      echo "explicitly allow an undated one (recorded in the results)." >&2
      echo "(see tests/always-on/README.md, 'Pinned models')." >&2
      exit 2
    fi
  done
  _lib_env_is_dated "$val" && return 0
  [ "$escval" = "1" ] && return 0
  echo "$name=$val is not a DATED model id (expected a ...-20YYMMDD suffix)." >&2
  echo "Set $escname=1 to explicitly allow an undated id (recorded in the results)." >&2
  echo "(see tests/always-on/README.md, 'Pinned models')." >&2
  exit 2
}

# The owner-named default. Spelling this out explicitly must be treated
# EXACTLY like leaving RUNNER_MODEL/SIM_MODEL unset — both get the escape
# set FOR you and recorded as undated_ok=1. Any OTHER undated id still needs
# the caller's own explicit *_UNDATED_OK=1.
_LIB_ENV_OWNER_DEFAULT_MODEL="claude-sonnet-5"

# Caller is a judge script (judge_*.sh) if true. Judges don't use
# RUNNER_MODEL/MODEL at all (they only ever pass $JUDGE_MODEL to `claude`),
# so they must not be forced through its dated-or-escape validation.
_lib_env_caller_is_judge() {
  case "$(basename "${0:-}")" in
    judge_*) return 0 ;;
    *) return 1 ;;
  esac
}

RUNNER_MODEL="${RUNNER_MODEL:-${MODEL:-}}"
if [ -z "$RUNNER_MODEL" ]; then
  RUNNER_MODEL="$_LIB_ENV_OWNER_DEFAULT_MODEL"
fi
if [ "$RUNNER_MODEL" = "$_LIB_ENV_OWNER_DEFAULT_MODEL" ]; then
  # unset OR explicitly spelled-out default -> escape set FOR you either way
  RUNNER_MODEL_UNDATED_OK="${RUNNER_MODEL_UNDATED_OK:-1}"
fi
RUNNER_MODEL_UNDATED_OK="${RUNNER_MODEL_UNDATED_OK:-0}"
if ! _lib_env_caller_is_judge; then
  _lib_env_check_model RUNNER_MODEL "$RUNNER_MODEL" RUNNER_MODEL_UNDATED_OK "$RUNNER_MODEL_UNDATED_OK"
fi
MODEL="$RUNNER_MODEL"   # back-compat: every existing script reads $MODEL

RUNNER_SKILLS_DIR="${RUNNER_SKILLS_DIR:-$REPO/skills}"

_lib_env_require_judge_model() {
  if [ -z "${JUDGE_MODEL:-}" ]; then
    echo "JUDGE_MODEL is not set." >&2
    echo "It must be an explicit, DATED Opus model id — not the 'opus' alias" >&2
    echo "(see tests/always-on/README.md, 'Pinned models', for how to find one)." >&2
    echo "Example: JUDGE_MODEL=<dated-opus-id> $0 <tag>" >&2
    exit 2
  fi
  JUDGE_MODEL_UNDATED_OK="${JUDGE_MODEL_UNDATED_OK:-0}"
  _lib_env_check_model JUDGE_MODEL "$JUDGE_MODEL" JUDGE_MODEL_UNDATED_OK "$JUDGE_MODEL_UNDATED_OK"
}

git_commit() { git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo nogit; }

# "1" if skills/ differs from HEAD (staged, unstaged, or untracked files
# under skills/), "0" if clean, "unknown" outside a git repo.
skills_dirty() {
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo unknown; return; }
  if [ -n "$(git -C "$REPO" status --porcelain -- skills 2>/dev/null)" ]; then
    echo 1
  else
    echo 0
  fi
}

# A content hash of the REAL $REPO/skills tree (never RUNNER_SKILLS_DIR) —
# identifies a snapshot by what it actually contains, not just the commit
# it was taken at, since a dirty tree can change between two invocations at
# the same commit. Two fixes baked in:
#  - hashed as paths RELATIVE to skills/ (cd into it first), so the hash
#    does not depend on where the repo checkout lives on disk;
#  - __pycache__/, *.pyc, and .DS_Store are excluded — build/OS litter that
#    carries no skill content and must not perturb the hash or the snapshot.
_skills_hashable_files() {
  ( cd "$REPO/skills" 2>/dev/null && \
    find . -type f \
      ! -path '*/__pycache__/*' \
      ! -name '*.pyc' \
      ! -name '.DS_Store' \
      -print0 | sort -z )
}
skills_content_hash() {
  _skills_hashable_files \
    | ( cd "$REPO/skills" 2>/dev/null && xargs -0 shasum -a 256 ) 2>/dev/null \
    | shasum -a 256 | awk '{print $1}' | cut -c1-12
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The RECORD lines only (readers must never `tail -1` a raw info file — a
# per-runner extra field or a future stray line must not be mistaken for
# the last record). Empty output if the file doesn't exist yet.
last_record() { [ -f "$1" ] && grep '^ts=' "$1" | tail -1; }

_field() { # $1 = record line, $2 = field name -> value or ""
  printf '%s\n' "$1" | grep -oE "$2=[^ ]*" | tail -1 | cut -d= -f2-
}

# Runner side. Call once, early, right after $RESULTS is known and before
# any `claude` call. The SNAPSHOT is write-once per (commit, content hash);
# the run-info.txt RECORD is appended every invocation, always as ONE line
# starting with `ts=`.
#   $1 = results dir
#   $2 = optional EXTRA fields to fold into the same record line (e.g.
#        t19's "sim_model=... sim_model_undated_ok=..."). Never write a
#        second line for per-runner extras — see the file-header note.
snapshot_and_record_run_info() {
  local results="$1" extra="${2:-}"
  local commit dirty hash snap prev
  commit="$(git_commit)"
  dirty="$(skills_dirty)"
  hash="$(skills_content_hash)"
  snap="$results/_skills-snapshot-$commit-$hash"
  if [ ! -d "$snap" ]; then
    mkdir -p "$snap"
    cp -r "$REPO/skills/." "$snap/"
    find "$snap" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null
    find "$snap" -name '*.pyc' -delete 2>/dev/null
    find "$snap" -name '.DS_Store' -delete 2>/dev/null
  fi
  if [ "$dirty" = "1" ]; then
    echo "WARN: skills/ has uncommitted changes (commit=$commit, content_hash=$hash)" >&2
    echo "      — the 'unablated' judge baseline just snapshotted INCLUDES them." >&2
    echo "      Commit first if the baseline should be the last committed text." >&2
  fi
  JUDGE_SKILLS_DIR="${JUDGE_SKILLS_DIR:-$snap}"

  prev="$(last_record "$results/run-info.txt")"
  if [ -n "$prev" ]; then
    local prev_model prev_dir prev_hash prev_judge_dir
    prev_model="$(_field "$prev" runner_model)"
    prev_dir="$(_field "$prev" runner_skills_dir)"
    prev_hash="$(_field "$prev" skills_hash)"
    # the OLD snapshot's REAL path: read from the previous record's own
    # judge_skills_dir field, never rebuilt from THIS invocation's commit —
    # a rebuilt path silently gives the wrong path across a commit change.
    prev_judge_dir="$(_field "$prev" judge_skills_dir)"
    if [ "$prev_model" != "$RUNNER_MODEL" ] || [ "$prev_dir" != "$RUNNER_SKILLS_DIR" ]; then
      echo "WARN: $results is a REUSED tag whose runner config just changed:" >&2
      echo "      was runner_model=$prev_model runner_skills_dir=$prev_dir" >&2
      echo "      now  runner_model=$RUNNER_MODEL runner_skills_dir=$RUNNER_SKILLS_DIR" >&2
      echo "      Existing case results in this tag came from the OLD config." >&2
    fi
    if [ "$prev_hash" != "$hash" ]; then
      echo "WARN: $results is a REUSED tag whose skills content just changed" >&2
      echo "      (was skills_hash=$prev_hash, now skills_hash=$hash) — a NEW snapshot" >&2
      echo "      was taken at $snap." >&2
      echo "      The OLD snapshot earlier trials in this tag were judged against is" >&2
      echo "      ${prev_judge_dir:-<unknown: no judge_skills_dir on the previous record>}." >&2
      echo "      From here on, a judge run against $results grades ALL trials in the" >&2
      echo "      tag — including the earlier ones — against the NEW snapshot, not the" >&2
      echo "      one they actually ran under. Pick a fresh tag for a clean measurement." >&2
    fi
    # Any OTHER extra field (e.g. t19's sim_model) that differs from the
    # previous record's own value WARNs the same way the fields above do —
    # a reused tag mixing two simulator models is just as mixed a config.
    if [ -n "$extra" ]; then
      local kv k v pv
      for kv in $extra; do
        k="${kv%%=*}" v="${kv#*=}"
        pv="$(_field "$prev" "$k")"
        if [ -n "$pv" ] && [ "$pv" != "$v" ]; then
          echo "WARN: $results is a REUSED tag whose $k just changed:" >&2
          echo "      was $k=$pv" >&2
          echo "      now  $k=$v" >&2
          echo "      Existing case results in this tag came from the OLD config." >&2
        fi
      done
    fi
  fi
  printf 'ts=%s commit=%s dirty=%s skills_hash=%s runner_model=%s runner_model_undated_ok=%s runner_skills_dir=%s judge_skills_dir=%s%s\n' \
    "$(now)" "$commit" "$dirty" "$hash" "$RUNNER_MODEL" "$RUNNER_MODEL_UNDATED_OK" "$RUNNER_SKILLS_DIR" "$JUDGE_SKILLS_DIR" \
    "${extra:+ $extra}" \
    >> "$results/run-info.txt"
}

# The most recent RECORDED runner_skills_dir for a tag (what the runner
# actually shipped), falling back to this invocation's own RUNNER_SKILLS_DIR
# default only when no record exists yet.
recorded_runner_skills_dir() {
  local results="$1" prev
  prev="$(last_record "$results/run-info.txt")"
  if [ -n "$prev" ]; then
    local d; d="$(_field "$prev" runner_skills_dir)"
    [ -n "$d" ] && { echo "$d"; return; }
  fi
  echo "$RUNNER_SKILLS_DIR (no run-info.txt record yet — this is only this invocation's own default)"
}

# Judge side. Call once, early, right after $RESULTS is known and before
# any `claude` call. Resolves JUDGE_SKILLS_DIR (explicit env wins, then the
# run's run-info.txt RECORD, then — only for results dirs made before this
# fix — the live $REPO/skills, loudly flagged) and appends ONE judge-info.txt
# record.
resolve_and_record_judge_info() {
  local results="$1"
  _lib_env_require_judge_model   # fail before touching the filesystem
  mkdir -p "$results"
  if [ -z "${JUDGE_SKILLS_DIR:-}" ]; then
    local prev; prev="$(last_record "$results/run-info.txt")"
    if [ -n "$prev" ]; then
      local d; d="$(_field "$prev" judge_skills_dir)"
      [ -n "$d" ] && [ -d "$d" ] && JUDGE_SKILLS_DIR="$d"
    fi
  fi
  if [ -z "${JUDGE_SKILLS_DIR:-}" ]; then
    echo "WARN: no skills snapshot recorded for $results — grading against" >&2
    echo "LIVE $REPO/skills (pre-fix behaviour). Re-run the runner to get a" >&2
    echo "frozen snapshot, or set JUDGE_SKILLS_DIR explicitly." >&2
    JUDGE_SKILLS_DIR="$REPO/skills"
  fi

  local prevj; prevj="$(last_record "$results/judge-info.txt")"
  if [ -n "$prevj" ]; then
    local prev_model prev_dir
    prev_model="$(_field "$prevj" judge_model)"
    prev_dir="$(_field "$prevj" judge_skills_dir)"
    if [ "$prev_model" != "$JUDGE_MODEL" ] || [ "$prev_dir" != "$JUDGE_SKILLS_DIR" ]; then
      echo "WARN: $results is a REUSED tag whose judge config just changed:" >&2
      echo "      was judge_model=$prev_model judge_skills_dir=$prev_dir" >&2
      echo "      now  judge_model=$JUDGE_MODEL judge_skills_dir=$JUDGE_SKILLS_DIR" >&2
      echo "      Existing verdicts in this tag came from the OLD config." >&2
    fi
  fi
  printf 'ts=%s judge_model=%s judge_model_undated_ok=%s judge_skills_dir=%s\n' \
    "$(now)" "$JUDGE_MODEL" "${JUDGE_MODEL_UNDATED_OK:-0}" "$JUDGE_SKILLS_DIR" >> "$results/judge-info.txt"
}

# Best-effort: record the model the Claude CLI's stream-json output actually
# SERVED, next to each result — a served id can differ from what was
# requested (fallback, alias resolution). The SERVED model is read from
# `message.model` on "type":"assistant" lines (the last one, so a mid-stream
# fallback wins over an earlier value) — that is what the API actually
# returned content from. If no assistant line carries a model (e.g. an
# errored/empty stream), falls back to the init line's `model` field,
# labelled `configured:` so it is never presented as served. UNTESTED
# against a real API response in this fix (no spend) — implemented
# defensively: any parse miss (bad JSON, missing field, python3 crash)
# writes UNKNOWN rather than failing the run, and this is safe to call
# under `set -euo pipefail` (no unguarded pipeline; the python3 call's exit
# status is caught explicitly, not left to propagate).
#   $1 = prefix for this case's *.stream.json files, e.g. "$out" matches
#        "$out.stream.json" and "$out.turnN.stream.json" — NOT a longer
#        sibling tag's files (a bare "$prefix"*.stream.json glob would also
#        match "${prefix}0.stream.json", so e.g. prefix ".../a-t1" would
#        wrongly sweep up ".../a-t10.stream.json"; the separating "." is
#        required between the prefix and whatever follows).
# Judge scripts do NOT call this: they invoke `claude -p` with the default
# text output (their prompt asks the model to print a bare JSON verdict,
# captured as-is), not --output-format json/stream-json, so no CLI-level
# `model` field is present to extract without changing that capture shape
# — out of scope for this fix.
record_served_models() {
  local prefix="$1" f out dest
  dest="${prefix}.served-model.txt"
  : > "$dest"
  for f in "$prefix.stream.json" "$prefix".*.stream.json; do
    [ -f "$f" ] || continue
    out="$(python3 -c '
import json, sys
model = None
configured = None
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        continue
    if not isinstance(ev, dict):
        continue
    t = ev.get("type")
    if t == "assistant":
        m = (ev.get("message") or {}).get("model")
        if m:
            model = m   # last assistant line wins
    elif t == "system" and configured is None:
        m = ev.get("model")
        if m:
            configured = m
if model:
    print("served:" + model)
elif configured:
    print("configured:" + configured)
else:
    print("UNKNOWN")
' "$f" 2>/dev/null)" || out="UNKNOWN"
    printf '%s: %s\n' "$(basename "$f")" "${out:-UNKNOWN}" >> "$dest"
  done
}

# DRY_RUN=1 support (A3): print resolved config and exit before any `claude`
# call. role = runner|judge. Every judge script calls
# resolve_and_record_judge_info BEFORE this (which already validates
# JUDGE_MODEL and fails, before touching the filesystem, if it's bad) — this
# does NOT call it again, so a dry run appends exactly ONE record, same as a
# real run. It only reports what that call already resolved.
maybe_dry_run() {
  local role="$1" results="$2"
  [ -n "${DRY_RUN:-}" ] || return 1
  echo "== $role dry run =="
  echo "commit=$(git_commit)"
  echo "dirty=$(skills_dirty)"
  echo "runner_model=$RUNNER_MODEL (undated_ok=$RUNNER_MODEL_UNDATED_OK)"
  if [ "$role" = judge ]; then
    echo "judge_model=$JUDGE_MODEL (undated_ok=${JUDGE_MODEL_UNDATED_OK:-0})"
    echo "runner_skills_dir=$(recorded_runner_skills_dir "$results")"
    echo "judge_skills_dir=${JUDGE_SKILLS_DIR:-<unresolved: call resolve_and_record_judge_info first>}"
  else
    echo "runner_skills_dir=$RUNNER_SKILLS_DIR"
    local hash; hash="$(skills_content_hash)"
    echo "judge_skills_dir=(snapshot target) $results/_skills-snapshot-$(git_commit)-$hash"
  fi
  echo "results=$results"
  echo "== end dry run (no model calls made) =="
  return 0
}
