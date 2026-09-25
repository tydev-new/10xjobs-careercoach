# Security

## Reporting a vulnerability

Please report it privately, not in a public issue. On GitHub, open the
repository's **Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/tydev-new/10xjobs-careercoach/security/advisories/new)).
Include what you found, how to reproduce it, and what it could expose.
Don't include anyone's real data.

If the button isn't there, open a public issue that says only "security
report, please contact me", with no details. We will reply there and move
the conversation somewhere private.

## How secrets are kept

- **Keys live in two places only:** git-ignored env files on your own
  machine (`.env`, `.env.local` and similar), and the settings of the
  hosting services (Supabase function secrets, Vercel environment
  variables). Never commit a key, and never paste one into an issue, a
  pull request or an agent's prompt.
- **The browser holds no secret.** The site ships only the Supabase URL
  and its public (anon) key. Row-level security is the real boundary.
  The model key lives only in the `ten-model-proxy` server function.
  See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
  [`docs/design-web-agent.md` § 8](docs/design-web-agent.md#8-model-proxy-balance-and-the-production-project).

## Personal data

- **No candidate data enters this repo:** no workspaces, no chat
  transcripts, no real names, emails or phone numbers. Tests use
  invented personas and fresh temp workspaces.
- **The PII guard:** `tests/test_invariants.py` fails if a shipped folder
  (`skills/`, `apps/`, `scripts/`, `design/` and others) contains a home
  path, an email, a phone number or a profile link. Separately, the
  production deploy script refuses a bundle that contains a home path.

## Production

Production changes only through the owner-approved deploy path: the
owner applies migrations, deploys the server functions and runs
`apps/web/scripts/deploy-prod.sh`. Contributors and agents never write to
production, never hold production keys, and never touch production data.
For local work, use your own accounts ([`CONTRIBUTING.md`](CONTRIBUTING.md)).
