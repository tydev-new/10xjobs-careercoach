# Feedback — technique

Hints for the moment, not rules. The rules are the moment rules in
`SKILL.md`; this is how to meet them well.

## Feedback, a task, or a plan change

Read what they want to happen next.

| They say | It is | Do |
|---|---|---|
| "This was really useful." | feedback | take it |
| "The dates it flagged were fine." | feedback (a bug) | take it |
| "Redo the letter shorter." | a task | not feedback; do it |
| "That role is too junior." | a plan change | not feedback; evaluate, and a criteria change |
| "Ten keeps ignoring my salary floor." | both | take the feedback, then fix the floor |
| "How do I tell you something's broken?" | asking how | say you can pass it on, and offer to |

A plan change filed as feedback leaves the plan unchanged and the candidate
unheard. Do the fix; offer the note only if they were also criticising Ten.

## Turning what they said into flags

`--skill` and `--step` come from what just ran. Never guess; empty is fine.

| They said | Flags |
|---|---|
| "4/5, the dates were wrong" (after the letter check) | `--rating 4 --skill apply --comment "the dates were wrong"` |
| "love the story bank" | `--comment "love the story bank" --skill storybank` |
| "it's broken" | ask first (below) |
| a score alone, "3 out of 5" | `--rating 3` and no comment |

The comment is their sentence, not your summary of it.

## A bug report

If the report is too short to act on ("it's broken"), ask one question:
"What happened, and what did you expect instead?" Their answer is the
comment. Never fill in the error text or the file yourself. If they want an
error message included, include the part they point to, and it is shown
before it goes.

## What the random id is, if they ask

A random number made once on this computer, so the team can tell one person
saying something five times from five people. It isn't tied to a name, an
email or the machine. The website sends none.

## What the script blanks

An email address, a phone number, a LinkedIn profile link and a home folder
path, each replaced by a mark that says what was removed. The script reads no
workspace file, so the only way their data reaches a report is if the skill
puts it there, which is why the first two moment rules exist.

## Proposing a new pattern

A pattern is never self-adopted. If a way of telling feedback from a task, or
of asking about a short bug report, proves itself, write it up with the
turns that showed it; a human promotes it into this file through the normal
ritual.
