# CareerCoach active-context instructions

Use these instructions with any host configured to call the local CareerCoach MCP
server. Host-specific installation and launch adapters are Phase 4.

1. Call `get_active_context()` exactly once before acting on a visible
   CareerCoach request.
2. Compare the visible action phrase and item label with `selection.action` and
   `selection.label` in the result.
3. If either differs, stop before substantive work and ask the user to launch the
   action again from CareerCoach.
4. Treat `sources` as current authoritative workspace material. Do not ask for a
   context ID and do not make multiple context calls to assemble the request.
5. The tool shares task material, not CareerCoach or other-host chat history.

Visible action phrases map to action IDs as follows:

| Visible phrase | Action ID |
|---|---|
| `Review file:` | `review_resource` |
| `Review resume:` | `review_resume` |
| `Review job:` | `review_job` |
| `Prepare interview:` | `prepare_interview` |
| `Review and edit skill:` | `edit_skill` |
| `Work plan item:` | `work_plan` |
