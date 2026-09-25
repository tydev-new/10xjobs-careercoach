# Security

## Reporting a vulnerability

Please report it privately, not in a public issue.

- **If private vulnerability reporting is enabled on this repository,**
  use it: open the **Security** tab and choose **Report a
  vulnerability**. Include what you found, how to reproduce it, and what
  it could expose.
- **Otherwise,** open a public issue that says only "security report —
  please contact me", with no details. A maintainer will reach out and
  move the conversation somewhere private.

Never include anyone's real data in a report.

## How secrets are kept

- **Keys live in two places only:** git-ignored env files on your own
  machine (`.env`, `.env.local` and similar), and the settings of the
  hosting services (Supabase function secrets, Vercel environment
  variables). Never commit a key, and never paste one into an issue, a
  pull request or an agent's prompt.
- **The browser holds no secret.** The site ships only the Supabase URL
  and its public anon key; row-level security is the real boundary. The
  model key is a Supabase function secret, used only by the
  `ten-model-proxy` function. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
  [`docs/design-web-agent.md` § 8](docs/design-web-agent.md#8-model-proxy-balance-and-the-production-project).

## Personal data

- **No candidate data enters this repo:** no workspaces, no chat
  transcripts, no real names, emails or phone numbers. Tests use
  invented personas and fresh temp workspaces.
- **Two tests guard it.** They fail on a home-directory path, an email,
  a phone number or a profile link:
  - `tests/test_invariants.py` scans `skills/`, `plugins/`, `kit/`,
    `.claude-plugin/`, `apps/`, `scripts/` and `design/`;
  - `tests/test_docs_guard.py` scans the root `*.md` files, `docs/` and
    `agents/`, plus the non-Markdown files in `packages/agent/src`,
    `packages/checkers/src`, `packages/checkers/bin` and `supabase/`.

  Anything outside those folders is not scanned. Build output and
  `node_modules` are skipped. Separately, the production deploy script
  refuses a bundle that contains a home path.

## Production

Production changes only through the owner-approved deploy path:
migrations, server functions and the site
(`apps/web/scripts/deploy-prod.sh`), each with the owner's approval.
Contributors and agents never hold production keys and never touch
production data. For local work, use your own accounts
([`CONTRIBUTING.md`](CONTRIBUTING.md)).
