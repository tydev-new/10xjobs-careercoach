#!/bin/bash
# run_headless_voice.sh — the plain-replies voice rule (docs/design-plain-
# replies.md § 4) measured on ANY site model through the HEADLESS runner
# (packages/agent/bin/run.mjs: the web app's own coach loop, skill bundle
# and real ScriptRunner), not `claude -p`. Built for issue #33: the owner
# measures DeepSeek (the proxy's DEEPSEEK_MODEL_ID) with their own
# OpenRouter key, cheaply — one trial per case first, score with
# scan_voice.py, re-run only the failures.
#
# Usage:
#   [TRIALS=1] [PAR=1] [KEY_ENV=OPENROUTER_API_KEY] \
#     ./run_headless_voice.sh <model-id> <tag> [case ...]
#
#   <model-id>  one of the proxy's MODEL_IDS (ten-model-proxy/core.ts);
#               anything else is refused before any run starts.
#   <tag>       results land in results/hv-<tag>/<case>/<trial>/.
#   [case ...]  default: the nine cases of design-plain-replies.md § 4.
#
# Per case/trial it stages a FRESH mktemp workspace with the same data
# files that case's own runner plants (run_t4/t6/t8/t10/t13/t21.sh — an
# allow-list, so the case's grading files, expected.md, prompt.md,
# turn*.md and _*.txt captures, never enter it), runs ONE headless turn,
# and saves under the trial dir:
#   planted/      the workspace as staged (before the turn)
#   ws/           the workspace after the turn
#   reply.md      run.mjs stdout — the reply text
#   stderr.txt    run.mjs diagnostics ([ran] <tool> lines, [gate], [error],
#                 and the turn's spend: "[cost] usd=<x> steps=<n>" or
#                 "[cost] unknown ..." when the provider reported none)
#   exit.txt      run.mjs exit code
#   prompt.txt    the user message sent
#   plan-added.txt  plan.md lines added this turn (diff vs planted)
#   scan.txt      scan_voice.py hits (HARD/REVIEW), candidate args as
#                 judge_voice.sh passes them
# then prints a summary table. A trial whose exit.txt says 0 is SKIPPED
# on a re-run of the same tag, so `TRIALS=3 ... <tag> <failing cases>`
# adds trials 2-3 for just those cases; an unfinished trial (non-zero
# exit, e.g. run.mjs's 3 for a provider error, or an empty reply) shows
# as FAILED in the table, makes the driver exit 1, and is re-run.
#
# NO model call happens unless the key variable is set; the key's VALUE is
# never printed (only KEY_ENV's name). Harness workspaces are temp dirs
# only; the real vault is locked for the run like every other runner.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"

usage() {
  echo "usage: [TRIALS=n] [PAR=n] [KEY_ENV=OPENROUTER_API_KEY] $0 <model-id> <tag> [case ...]" >&2
  exit 2
}
[ $# -ge 2 ] || usage
MODEL_ID="$1"; TAG="$2"; shift 2
case "$TAG" in ""|*/*|.*) echo "bad tag: '$TAG'" >&2; exit 2 ;; esac
TRIALS="${TRIALS:-1}"
case "$TRIALS" in ''|*[!0-9]*|0) echo "TRIALS must be a positive integer, got '$TRIALS'" >&2; exit 2 ;; esac
KEY_ENV="${KEY_ENV:-OPENROUTER_API_KEY}"

# 1. the key: refuse before anything else. Name only, never the value.
if [ -z "${!KEY_ENV:-}" ]; then
  echo "refusing to start: the $KEY_ENV environment variable is not set (KEY_ENV names which variable holds your OpenRouter key)." >&2
  exit 1
fi

# 2. the model: must be one the site's proxy allows (bin/run.mjs refuses
#    others too — checked here once so a typo fails before any staging).
MODEL_IDS="$(node --input-type=module -e "
  const m = await import('$REPO/supabase/functions/ten-model-proxy/core.ts');
  console.log(m.MODEL_IDS.join(' '));
" 2>/dev/null)"
[ -n "$MODEL_IDS" ] || { echo "could not read MODEL_IDS from ten-model-proxy/core.ts" >&2; exit 2; }
case " $MODEL_IDS " in
  *" $MODEL_ID "*) ;;
  *) echo "model '$MODEL_ID' is not one of the proxy's MODEL_IDS: $MODEL_IDS" >&2; exit 2 ;;
esac

# lib_env.sh for the vault lock, the skills snapshot and run-info record.
# Its RUNNER_MODEL is the model under test HERE (an OpenRouter id, never
# dated — the escape is set and recorded).
RUNNER_MODEL="$MODEL_ID"; RUNNER_MODEL_UNDATED_OK=1; unset MODEL
source "$ROOT/lib_env.sh"

# 3. the cases: design-plain-replies.md § 4's table (t4-intake runs its
#    turn1.md only — see stage_case).
DEFAULT_CASES="t4-intake t6-track-assignment t6-duplicate-row t8-stage-sensing t8-honesty-thresholds t10-over-budget t10-verbatim-panel t13-ceiling t21-plain-report"
CASES="${*:-$DEFAULT_CASES}"
for c in $CASES; do
  [ -d "$ROOT/cases/$c" ] || { echo "no such case: cases/$c" >&2; exit 2; }
done

RESULTS="${RESULTS_ROOT:-$ROOT/results}/hv-$TAG"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS" "runner=headless trials=$TRIALS cases=$(echo $CASES | tr ' ' ',')"
maybe_dry_run runner "$RESULTS" && exit 0

vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; kill 0 2>/dev/null' INT TERM

FIX="$ROOT/fixtures/apply"

# The data files each case's OWN runner plants, and nothing else — the
# claude-CLI wiring those runners add (workspace CLAUDE.md, .claude/skills/)
# is replaced here by run.mjs's --skills bundle and its always-on system
# prompt (the web app's shape). Echoes the prompt file to send.
stage_case() { # $1 case name, $2 workspace dir
  local c="$1" ws="$2" CASE="$ROOT/cases/$1" f d EXTRA
  case "$c" in
    t4-*)   # run_t4.sh
      cp "$CASE/resume.md" "$ws/"
      echo "$CASE/turn1.md" ;;   # single-turn runner: turn2.md is NOT sent
    t6-*)   # run_t6.sh
      cp "$CASE/profile.md" "$ws/" 2>/dev/null || cp "$ROOT/fixtures/profile.md" "$ws/"
      cp "$CASE/criteria.md" "$ws/" 2>/dev/null || cp "$ROOT/fixtures/criteria.md" "$ws/"
      cp "$CASE/jobs.md" "$ws/"
      cp -r "$CASE/jd-inbox" "$ws/"
      echo "$CASE/prompt.md" ;;
    t8-*)   # run_t8.sh
      cp "$ROOT/fixtures/profile.md" "$ws/"
      cp "$CASE/criteria.md" "$ws/" 2>/dev/null || cp "$ROOT/fixtures/criteria.md" "$ws/"
      for f in jobs.md plan.md knowledge.md storybank.md pitch.md base-resume.md; do
        [ -f "$CASE/$f" ] && cp "$CASE/$f" "$ws/"
      done
      for d in jd-analysis courses stories; do
        [ -d "$CASE/$d" ] && cp -r "$CASE/$d" "$ws/"
      done
      echo "$CASE/prompt.md" ;;
    t10-*|t13-*)   # run_t10.sh / run_t13.sh — the Alex Chen apply workspace
      cp "$ROOT/fixtures/profile.md" "$ws/"
      cp "$FIX"/base-resume.md "$FIX"/voice.md "$FIX"/storybank.md "$FIX"/jobs.md "$ws/"
      cp -r "$FIX/stories" "$FIX/jd-inbox" "$FIX/jd-analysis" "$FIX/company" "$ws/"
      if [ "${c%%-*}" = t10 ]; then
        [ -f "$CASE/base-resume.md" ] && cp "$CASE/base-resume.md" "$ws/"
        [ -d "$CASE/jd-analysis" ] && cp "$CASE/jd-analysis/"*.md "$ws/jd-analysis/"
      else
        EXTRA="$CASE/ws-extra"; [ -d "$EXTRA" ] || EXTRA="$ROOT/cases/t13-ceiling/ws-extra"
        cp -r "$EXTRA/." "$ws/"
      fi
      echo "$CASE/prompt.md" ;;
    t21-*)  # run_t21.sh
      cp "$CASE/plan.md" "$CASE/criteria.md" "$CASE/jobs.md" "$CASE/base-resume.md" "$ws/"
      mkdir -p "$ws/applications"
      cp "$CASE/applications/"*.md "$ws/applications/"
      echo "$CASE/prompt.md" ;;
    *) echo "no staging rule for case '$c' (add one mirroring its run_*.sh)" >&2; return 1 ;;
  esac
}

# A trial is FINISHED only when run.mjs exited 0 AND the reply has text.
# Anything else — a provider error (run.mjs exit 3, an [error] line), a
# crash, an empty reply — is a failed, unfinished trial: an empty reply
# scans as 0 HARD, so counting it would read as a clean pass. Unfinished
# trials are re-run on the next same-tag invocation.
trial_status() { # $1 trial dir -> "ok" or "FAILED:<why>"
  local ex; ex="$(cat "$1/exit.txt" 2>/dev/null)"
  if [ -z "$ex" ]; then echo "FAILED:not-run"
  elif [ "$ex" != 0 ]; then echo "FAILED:exit-$ex"
  elif ! grep -q '[^[:space:]]' "$1/reply.md" 2>/dev/null; then echo "FAILED:empty-reply"
  else echo ok
  fi
}

run_trial() { # $1 case, $2 trial
  local c="$1" t="$2" CASE="$ROOT/cases/$1" out="$RESULTS/$1/$2" WS PROMPT_FILE leak
  if [ "$(trial_status "$out")" = ok ]; then
    echo "skip $c trial $t (exists)"; return 0
  fi
  rm -rf "$out"; mkdir -p "$out"
  WS="$(mktemp -d)"
  PROMPT_FILE="$(stage_case "$c" "$WS")" || { rm -rf "$WS"; echo 2 > "$out/exit.txt"; return 1; }
  # Belt and braces over the allow-list above: a grading file in the
  # workspace would hand the model its own answer key.
  leak="$(cd "$WS" && find . \( -name expected.md -o -name prompt.md -o -name 'turn*.md' -o -name '_*.txt' \) -print)"
  if [ -n "$leak" ]; then
    echo "FATAL: grading files staged into the workspace for $c: $leak" >&2
    rm -rf "$WS"; echo 2 > "$out/exit.txt"; return 1
  fi
  mkdir -p "$out/planted"
  cp -r "$WS/." "$out/planted/"
  cp "$PROMPT_FILE" "$out/prompt.txt"
  echo "=== $c / trial $t -> $WS"
  ( cd "$REPO" && node packages/agent/bin/run.mjs --workspace "$WS" --skills "$RUNNER_SKILLS_DIR" \
      --model "$MODEL_ID" --key-env "$KEY_ENV" --prompt "$(cat "$PROMPT_FILE")" --chat-id "$c-$t" \
  ) > "$out/reply.md" 2> "$out/stderr.txt"
  echo $? > "$out/exit.txt"
  mkdir -p "$out/ws"
  cp -r "$WS/." "$out/ws/" 2>/dev/null
  rm -rf "$WS"

  # plan.md lines added this turn, against the copy actually planted.
  : > "$out/plan-added.txt"
  if [ -f "$out/ws/plan.md" ] && [ -f "$out/planted/plan.md" ]; then
    diff "$out/planted/plan.md" "$out/ws/plan.md" | grep '^> ' | sed 's/^> //' > "$out/plan-added.txt"
  elif [ -f "$out/ws/plan.md" ]; then
    cp "$out/ws/plan.md" "$out/plan-added.txt"
  fi

  # scan_voice.py, candidate args exactly as judge_voice.sh builds them.
  local CANDIDATE_ARGS=() f
  for f in "$CASE"/prompt.md "$CASE"/turn*.md; do
    [ -f "$f" ] && CANDIDATE_ARGS+=(--candidate "$f")
  done
  [ -d "$CASE/ws-extra" ] && CANDIDATE_ARGS+=(--candidate "$CASE/ws-extra")
  if [ -s "$out/plan-added.txt" ]; then
    python3 "$ROOT/scan_voice.py" --reply "$out/reply.md" --plan-added "$out/plan-added.txt" \
      "${CANDIDATE_ARGS[@]}" > "$out/scan.txt"
  else
    python3 "$ROOT/scan_voice.py" --reply "$out/reply.md" "${CANDIDATE_ARGS[@]}" > "$out/scan.txt"
  fi
}

for t in $(seq 1 "$TRIALS"); do
  for c in $CASES; do
    while [ "$(jobs -rp | wc -l)" -ge "${PAR:-1}" ]; do sleep 1; done
    run_trial "$c" "$t" &
  done
done
wait

# Summary. HARD/REVIEW = scan_voice.py hit counts (reply + plan.md added
# lines); gate/error = run.mjs's [gate]/[error] lines (a turn that stopped
# on the spend gate or an error is not a clean measurement); search = the
# model's web_search calls (not configured headless — see README).
cnt() { if [ -f "$2" ]; then grep -c -- "$1" "$2"; else echo -; fi; }
# run.mjs's own last line: "[cost] usd=<x> steps=<n>" or "[cost] unknown ...".
cost_of() {
  local line; line="$(grep '^\[cost\] ' "$1" 2>/dev/null | tail -1)"
  case "$line" in
    "[cost] usd="*) printf '%s' "$line" | sed -E 's/^\[cost\] usd=([0-9.]+).*/\1/' ;;
    "[cost] unknown"*) echo unknown ;;
    *) echo - ;;
  esac
}
total=0; unpriced=0
bad=0
echo
echo "== hv-$TAG  model=$MODEL_ID  skills=$RUNNER_SKILLS_DIR"
printf '%-24s %5s %5s %6s %4s %5s %5s %6s %-24s %10s\n' case trial HARD REVIEW exit gate error search status cost_usd
for c in $CASES; do
  for t in $(seq 1 "$TRIALS"); do
    out="$RESULTS/$c/$t"
    ex="$(cat "$out/exit.txt" 2>/dev/null || echo -)"
    status="$(trial_status "$out")"
    hard="$(cnt '^HARD' "$out/scan.txt")"; review="$(cnt '^REVIEW' "$out/scan.txt")"
    # an unfinished trial reports no scan counts — its 0 HARD means nothing
    [ "$status" = ok ] || { bad=1; hard=-; review=-; }
    # t4-intake is two turns in the harness; here only turn1.md is sent,
    # so its row is a screen, not comparable to a run_t4.sh trial.
    case "$c" in t4-*) status="$status,turn1-only" ;; esac
    cost="$(cost_of "$out/stderr.txt")"
    case "$cost" in
      [0-9]*) total="$(awk -v a="$total" -v b="$cost" 'BEGIN{printf "%.6f", a+b}')" ;;
      *) unpriced=$((unpriced + 1)) ;;
    esac
    printf '%-24s %5s %5s %6s %4s %5s %5s %6s %-24s %10s\n' "$c" "$t" \
      "$hard" "$review" "$ex" \
      "$(cnt '^\[gate\]' "$out/stderr.txt")" "$(cnt '^\[error\]' "$out/stderr.txt")" \
      "$(cnt '^\[ran\] web_search' "$out/stderr.txt")" "$status" "$cost"
  done
done
# The total covers every trial listed, including ones skipped as already
# done on an earlier invocation of this tag (their stderr.txt is kept).
echo "total cost_usd=$total  (trials without a reported cost: $unpriced — check OpenRouter's activity page for those)"
[ "$bad" = 0 ] || echo "FAILED trials above are unfinished (provider error, crash or empty reply) — not measurements; re-run the same tag to retry them."
echo "hits: $RESULTS/<case>/<trial>/scan.txt   done: $RESULTS"
exit "$bad"
