# Team agents

Role definitions for the subagent team in
`docs/plan-portable-skills-and-web-agent.md` § The team. Tracked here so
they are reviewed like any other change; `.claude/` is gitignored.

Install (Claude Code loads them at session start):

    mkdir -p .claude/agents && cp agents/*.md .claude/agents/ && rm .claude/agents/README.md

The main session is the lead and the only coordinator: it spawns every
agent, verifies each hand-back by reading files and re-running commands,
merges, and brings the owner every approval. There is no coordinator agent.
