#!/bin/bash
# run_step_trace.sh — the step counter (docs/design-fewer-steps.md § 1.2): how
# many model calls ("steps") each reply of a first session takes on the SITE's
# loop, through the headless runner (packages/agent/bin/run.mjs --trace --turns),
# with your own OpenRouter key. Built from run_headless_voice.sh's guards, in the
# same order.
#
# Usage:
#   [TRIALS=1] [KEY_ENV=OPENROUTER_API_KEY] [MAX_USD=1] \
#     ./run_step_trace.sh <model-id> <tag>
#
#   <model-id>  one of the proxy's MODEL_IDS (ten-model-proxy/core.ts), e.g.
#               deepseek/deepseek-v4.1-flash; anything else is refused.
#   <tag>       results land in results/st-<tag>/<trial>/.
#
# The script (cases/s1-first-session/turns.json), four turns in one chat:
#   1 "I'm looking for FDE job in SF Bay Area"   2 "here's my resume" + resume.pdf
#   3 "what's next?"                              4 "thanks, that's all for today"
#
# Per trial: a FRESH mktemp workspace staged the way the site starts — the
# template CLAUDE.md (the app's own create-only write) and NOTHING else; the
# résumé arrives by upload in turn 2. The PDF is built at run time from
# fixtures/resume-330w.md (Alex Chen, invented) into the TRIAL folder, never into
# the workspace. Saved under results/st-<tag>/<trial>/:
#   stderr.txt   run.mjs's [trace] / [cost] / [gate] / [error] lines
#   replies.md   the replies (kept locally; never send it on)
#   exit.txt     run.mjs's exit code (0 done; 3 an error turn; 4 stopped above $MAX_USD)
#   resume.pdf   the built fixture
#   ws/          the workspace after the run (kept locally; never send it on)
# Score it:  python3 score_step_trace.py results/st-<tag> > results/st-<tag>/tables.txt
#
# NO model call happens unless the key variable is set; the key's VALUE is never
# printed (only KEY_ENV's name). Workspaces are temp dirs only; run.mjs refuses
# any folder outside the system temp folder. The real vault (~/job-search) is
# locked for the run like every other runner. COST: a run is stopped above $1
# (MAX_USD) and the driver stops with it: report, don't re-run. A trial whose
# exit.txt says 0 is skipped on a re-run of the same tag.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"

usage() {
  echo "usage: [TRIALS=n] [KEY_ENV=OPENROUTER_API_KEY] [MAX_USD=1] $0 <model-id> <tag>" >&2
  exit 2
}
[ $# -eq 2 ] || usage
MODEL_ID="$1"; TAG="$2"
case "$TAG" in ""|*/*|.*) echo "bad tag: '$TAG'" >&2; exit 2 ;; esac
TRIALS="${TRIALS:-1}"
case "$TRIALS" in ''|*[!0-9]*|0) echo "TRIALS must be a positive integer, got '$TRIALS'" >&2; exit 2 ;; esac
MAX_USD="${MAX_USD:-1}"
case "$MAX_USD" in ''|*[!0-9.]*) echo "MAX_USD must be a number of dollars, got '$MAX_USD'" >&2; exit 2 ;; esac
KEY_ENV="${KEY_ENV:-OPENROUTER_API_KEY}"

# 1. the key: refuse before anything else. Name only, never the value.
if [ -z "${!KEY_ENV:-}" ]; then
  echo "refusing to start: the $KEY_ENV environment variable is not set (KEY_ENV names which variable holds your OpenRouter key)." >&2
  exit 1
fi

# 2. the model: only the two the site's proxy allows.
MODEL_IDS="$(node --input-type=module -e "
  const m = await import('$REPO/supabase/functions/ten-model-proxy/core.ts');
  console.log(m.MODEL_IDS.join(' '));
" 2>/dev/null)"
[ -n "$MODEL_IDS" ] || { echo "could not read MODEL_IDS from ten-model-proxy/core.ts" >&2; exit 2; }
case " $MODEL_IDS " in
  *" $MODEL_ID "*) ;;
  *) echo "model '$MODEL_ID' is not one of the proxy's MODEL_IDS: $MODEL_IDS" >&2; exit 2 ;;
esac

# 3. lib_env.sh: the skills snapshot, run-info (the commit, whether the skills
#    are dirty), DRY_RUN, and the shared vault lock. RUNNER_MODEL is the model
#    under test here (an OpenRouter id, never dated — the escape is recorded).
RUNNER_MODEL="$MODEL_ID"; RUNNER_MODEL_UNDATED_OK=1; unset MODEL
source "$ROOT/lib_env.sh"

CASE="$ROOT/cases/s1-first-session"
RESULTS="${RESULTS_ROOT:-$ROOT/results}/st-$TAG"
mkdir -p "$RESULTS"
snapshot_and_record_run_info "$RESULTS" "runner=headless-step-trace trials=$TRIALS max_usd=$MAX_USD"
maybe_dry_run runner "$RESULTS" && exit 0

vault_lock; trap vault_unlock EXIT; trap 'vault_unlock; exit 130' INT TERM

total=0; unpriced=0; stopped=0
for t in $(seq 1 "$TRIALS"); do
  out="$RESULTS/$t"
  if [ "$(cat "$out/exit.txt" 2>/dev/null)" = 0 ]; then echo "skip trial $t (exists)"; continue; fi
  rm -rf "$out"; mkdir -p "$out"

  # 4. the workspace as the site starts: CLAUDE.md, and nothing else.
  WS="$(mktemp -d)"
  cp "$RUNNER_SKILLS_DIR/profile/templates/workspace-CLAUDE.md" "$WS/CLAUDE.md"
  # 5. the fixture PDF, built now, into the trial folder (never the workspace).
  node "$ROOT/make_resume_pdf.mjs" "$ROOT/fixtures/resume-330w.md" "$out/resume.pdf" || { echo "could not build the PDF" >&2; rm -rf "$WS"; exit 2; }

  echo "=== step trace / trial $t -> $WS"
  # 6. one process, one chat, four turns.
  ( cd "$REPO" && node packages/agent/bin/run.mjs --trace --turns "$CASE/turns.json" --fixtures "$out" \
      --workspace "$WS" --skills "$RUNNER_SKILLS_DIR" --model "$MODEL_ID" --key-env "$KEY_ENV" \
      --max-usd "$MAX_USD" --chat-id "st-$TAG-$t" \
  ) > "$out/replies.md" 2> "$out/stderr.txt"
  echo $? > "$out/exit.txt"
  mkdir -p "$out/ws"
  cp -r "$WS/." "$out/ws/" 2>/dev/null
  rm -rf "$WS"

  line="$(grep '^\[cost\] ' "$out/stderr.txt" 2>/dev/null | tail -1)"
  case "$line" in
    "[cost] usd="*) total="$(awk -v a="$total" -v b="$(printf '%s' "$line" | sed -E 's/^\[cost\] usd=([0-9.]+).*/\1/')" 'BEGIN{printf "%.6f", a+b}')" ;;
    *) unpriced=$((unpriced + 1)) ;;
  esac
  ex="$(cat "$out/exit.txt")"
  echo "trial $t: exit=$ex  ${line:-no cost line}"
  if [ "$ex" = 4 ]; then
    echo "STOPPED: trial $t cost more than \$$MAX_USD. Not running further trials. Report this; do not re-run it." >&2
    stopped=1
    break
  fi
done

echo
echo "== st-$TAG  model=$MODEL_ID  skills=$RUNNER_SKILLS_DIR"
echo "total cost_usd=$total  (trials without a reported cost: $unpriced — check OpenRouter's activity page for those)"
echo "score:  python3 score_step_trace.py results/st-$TAG > results/st-$TAG/tables.txt"
[ "$stopped" = 0 ] || exit 4
exit 0
