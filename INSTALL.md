# Installing in Claude Code / Claude Cowork

The repo is an installable plugin: the full skill pack (`profile`,
`coach`, `search`, `evaluate`, `apply`, `outreach`, `storybank`,
`interview`, `learn`, `feedback`). All candidate data stays in a folder on
your machine. The one exception is a note about Ten itself that you choose
to send with the `feedback` skill: you see exactly what would go first, and
nothing is sent until you say yes (see "Requirements" for the one network
call).

## Option A — plugin marketplace

`/plugin` works in the **Claude Code terminal** (run `claude` in any
terminal). Plugins installed there surface in Cowork too (shared
`~/.claude` config).

```
/plugin marketplace add tydev-new/10xjobs-careercoach
/plugin install 10xjobs@10xjobs-marketplace
```

## Option B — copy the skills

Copy the skill folders into `~/.claude/skills/` (all projects) or a
project's `.claude/skills/`:

```bash
git clone https://github.com/tydev-new/10xjobs-careercoach
cp -r 10xjobs-careercoach/skills/* ~/.claude/skills/
```

## First session

Open a folder you want the search to live in and say "I need a job" or
"help me get started". The `profile` skill sets the folder up (it writes
a `CLAUDE.md` of guardrails first, then asks for your documents) and the
`coach` skill takes it from there — "what's next?" is the only command
you need.

## Requirements

Node.js 18 or newer for the skills' scripts (check with `node --version`;
Ubuntu 24.04's own `nodejs` package is enough, and any current Node LTS
works). The scripts need no packages. Only one of them uses the network:
`feedback`'s `scripts/feedback.mjs`, and only when you have seen your note and
said yes. It posts your own words (an email address, phone number, profile
link or folder path in them blanked out), a rating if you gave one, which skill
was running, Ten's version, and a random id made once on your computer
(`~/.cache/ten/installation-id`, or under `$XDG_CACHE_HOME`; never in your
workspace) to Ten's feedback endpoint; nothing from your workspace or the
conversation goes with it. If your Claude Code or Cowork settings block
network access for the command, you get "This couldn't be sent just now, so
nothing went", and the work carries on. Copied with `cp -r skills/*`, the note
carries the version `unknown`, because there is no plugin file above the script. `render_resume.mjs` uses headless
Chrome if present, to make the PDF and count its pages. The harness in
`tests/always-on/` needs the `claude` CLI.
