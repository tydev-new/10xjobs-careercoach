---
name: careercoach
description: Use the active CareerCoach workspace item for a visible CareerCoach request.
---

# CareerCoach

When the user sends a visible CareerCoach request, such as `Review job: <label> using CareerCoach.`, call `get_active_context` exactly once before doing substantive work.

Compare the visible item label and action phrase with `selection.label` and `selection.action.label` from the tool result. If either differs, stop and ask the user to launch the action again from CareerCoach.

Treat `sources` as the current authoritative workspace material. Read only the source paths needed for the requested work. Do not ask for a context ID and do not call `get_active_context` again to assemble additional context.

The tool shares workspace material only. It does not share CareerCoach or other-host chat history.
