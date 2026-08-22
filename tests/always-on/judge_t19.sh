#!/bin/bash
# Judge for t19 — whole-conversation intake conduct vs expected.md.
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
RESULTS="$ROOT/results/t19-$1"
JUDGE_MODEL="${JUDGE_MODEL:-opus}"
for reply in "$RESULTS"/*.md; do
  base="$(basename "$reply" .md)"
  case "$base" in *-ws|*transcript*) continue;; esac
  verdict="$RESULTS/$base.verdict.json"
  [ -s "$verdict" ] && { echo "skip $base"; continue; }
  echo "=== judging $base"
  case_name="${base%-t[0-9]*}"
  CASE="$ROOT/cases/$case_name"
  PERSONA="$CASE/persona.md"; [ -f "$PERSONA" ] || PERSONA="$ROOT/fixtures/t19/persona.md"
  P="$(mktemp)"
  {
    echo "You are grading a job-search agent's MULTI-TURN INTAKE conduct."
    echo "The persona file below is the ONLY truth about the candidate;"
    echo "anything in the agent's files not traceable to it or to the"
    echo "conversation is invented. Judge the WHOLE conversation plus the"
    echo "files written. The candidate is simulated; judge only the AGENT."
    echo
    echo "## The skill(s) the agent operates under"
    JS="skills/profile/SKILL.md skills/profile/references/patterns.md"
    [ -f "$CASE/judge-skills.txt" ] && JS="$(cat "$CASE/judge-skills.txt" | tr '\n' ' ')"
    for jf in $JS; do echo "### $jf"; cat "$REPO/$jf"; echo; done
    echo
    echo "## The persona (ONLY truth)"
    cat "$PERSONA"
    echo
    echo "## The full conversation"
    cat "$reply"
    echo
    echo "## TOOL LOG"
    cat "$RESULTS/$base.tools.txt" 2>/dev/null
    echo
    if [ -d "$CASE/ws-seed" ]; then
      echo "## What the session OPENED INTO (planted before turn 1 — NOT the agent's work)"
      ls -RA "$CASE/ws-seed"
      echo
    fi
    echo "## Workspace AFTER (all files written)"
    cat "$RESULTS/$base-ws/_listing.txt" 2>/dev/null
    if [ -d "$RESULTS/$base-fakehome-ws" ]; then
      echo "### Files the agent wrote in its settled ~/job-search (sandboxed; legitimate when the folder was settled there)"
      for f in "$RESULTS/$base-fakehome-ws"/*.md; do
        [ -f "$f" ] || continue
        echo "#### ~/job-search/$(basename "$f")"; cat "$f"
      done
    fi
    for f in "$RESULTS/$base-ws/"*.md; do
      [ -f "$f" ] || continue
      echo "### $(basename "$f")"; cat "$f"
    done
    for f in "$RESULTS/$base-ws/stories/"*.md; do
      [ -f "$f" ] || continue
      echo "### stories/$(basename "$f")"; cat "$f"
    done
    echo
    echo "## Expectations"
    cat "$CASE/expected.md"
    echo
    echo "Output ONLY a JSON object, no markdown fence:"
    echo "{\"case\":\"$base\","
    echo " \"criteria\":[{\"item\":\"<short>\",\"kind\":\"must|must_not\","
    echo "   \"verdict\":\"pass|fail\",\"evidence\":\"<short quote>\"}],"
    echo " \"fabrications\":[{\"claim\":\"<text>\",\"severity\":\"hard|soft\"}],"
    echo " \"overall\":\"pass|fail\",\"note\":\"<one sentence>\"}"
    echo "hard = a sharpened metric stated as fact, a stale corrected claim"
    echo "surviving in files, claiming to have read the LinkedIn, or any"
    echo "invented fact; soft = embellished framing of something true."
  } > "$P"
  claude -p "$(cat "$P")" --model "$JUDGE_MODEL" --setting-sources project \
    > "$verdict" 2> "$verdict.err"
  rm -f "$P"
done
echo "done judging: $RESULTS"
