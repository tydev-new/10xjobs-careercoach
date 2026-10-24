# Team agents

Role definitions for the subagent team in
`docs/plan-portable-skills-and-web-agent.md` § The team. Tracked here so
they are reviewed like any other change; `.claude/` is gitignored.
This folder is deliberately not named `agents/`: the plugin is published
from the repo root, and Claude Code loads a plugin's root `agents/` folder
as plugin agents, which would hand these build-team roles to every user.

Install (Claude Code loads them at session start):

    mkdir -p .claude/agents && cp team/*.md .claude/agents/ && rm .claude/agents/README.md

The main session is the lead and the only coordinator: it spawns every
agent, verifies each hand-back by reading files and re-running commands,
merges, and brings the owner every approval. There is no coordinator agent.
