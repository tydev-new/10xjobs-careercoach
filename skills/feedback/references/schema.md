# Feedback — the record that is sent

This skill owns no workspace file. What it has is one record, the payload,
and the plain text the person sees before it goes. `scripts/lib/feedback.mjs`
is the authority on both; this file says what they are.

## The payload

Eight fields, always all eight, in this order. Nothing else is ever sent.

| Key | Type | Rule | Filled by |
|---|---|---|---|
| `kind` | text | `bug` or `comment` (default `comment`) | the skill, `--kind` |
| `comment` | text | trimmed, redacted, at most 2,000 characters; required for `bug`; for `comment`, it or a rating | their words, `--comment` |
| `rating` | whole number or null | 1 to 5; only if they gave one | their words, `--rating` |
| `skill` | text | one of apply, coach, evaluate, feedback, interview, learn, outreach, profile, search, storybank; else empty | the skill, `--skill` |
| `step` | text | the title of the section that ran, without its bracket; at most 60 characters, one line, no `@`, `/` or `\`; else empty | the skill, `--step` |
| `version` | text | 1 to 40 of `0-9 A-Z a-z . + -`; the plugin's version, else `unknown` | code |
| `host` | text | `local` or `web` | code |
| `installationId` | text or null | local: 32 lowercase hex characters; web: null | code |

A `skill` not on the list, or a `step` that breaks its rule, is sent empty
and shown as "none", so what is shown is still what goes.

- **Line breaks and runs of spaces** in the words become one space, and other
  control characters are dropped, so the words are one line and the rendering
  stays one line per field. Nothing else about the words is changed except
  redaction.
- **Redaction** (before the length check): an email address becomes
  `[email removed]`; a phone number `[phone removed]`; a LinkedIn profile link
  `[profile link removed]`; a home folder path `[folder path removed]`. It is
  a safety net, not the guard: the script reads no workspace file, so the only
  way their data reaches a report is if the skill puts it there.
- **Never sent, by any host:** workspace text, file names or paths (beyond a
  redaction mark), the conversation, a script's output or error text unless
  the person asked for it and saw it, their search stage, the model's name,
  the operating system, their name or email, an account id, a network
  address.

## The rendering

One function builds it, and a send posts the object it was built from. Every
field has exactly one line; an empty or null value reads "none".

```
This is everything that would go to the Ten team:
Kind: bug report
Your words: the letter check keeps flagging dates that are right
Rating: none
Skill: apply
Step: Tailoring
Ten version: 0.9.2
Sent from: your computer
Random id: 3f9c0a7e5b2d4c18a6e0f1b2c3d4e5f6 (made once on this computer; not linked to your name or email)
```

Labels, in order: `Kind:` (`bug report` or `comment`), `Your words:`,
`Rating:` (`<n> of 5` or `none`), `Skill:`, `Step:`, `Ten version:`,
`Sent from:` (`your computer` or `the Ten website`), `Random id:`. On the web
the last two read `the Ten website` and `none`.

## The lines the person can get

Fixed strings, one home: `scripts/lib/feedback.mjs`. Sent: "Sent to the Ten
team. Thank you." A limit or closed: "Ten isn't taking feedback right now…".
Any other failure: "This couldn't be sent just now…". Four refusals for input
that cannot be sent (nothing to send, a bug with no words, over 2,000
characters, a bad rating). Each is one plain sentence, and the last line the
script prints is always the one to give.
