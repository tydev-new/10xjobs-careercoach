# Design - Cross-host active context

**Status:** Agreed  
**Date:** 2026-08-26  
**Owner:** Yong

## Decision

CareerCoach uses one active selection per authenticated workspace. It is a small
routing pointer, not a copy of career data.

Four rules define the design:

1. Clicking `Ask in...` records only the selected workspace item and requested
   action. Browsing or selecting an item without launching an agent has no effect.
2. The agent calls `get_active_context()` once. The tool resolves the authenticated
   workspace, reads the authoritative files at call time, and returns the smallest
   sufficient payload with source provenance.
3. The visible launch message names the item and action. The agent compares that
   message with the tool result and stops if they disagree.
4. CareerCoach has one persistent canonical chat. External host conversations are
   not synchronized; they receive current workspace context through the tool.

Normal use has no context IDs, context picker, or multiple context lookups.

## User flow

1. The user views a job, resume, interview plan, skill, or other workspace item.
2. The user chooses an action such as `Ask in Claude` or `Ask in ChatGPT`.
3. CareerCoach atomically records the item reference and requested action as the
   workspace's active selection.
4. CareerCoach injects or copies a short visible message, for example:

   ```text
   Review the tailored resume for Acme using CareerCoach.
   ```

5. The host agent calls `get_active_context()` before acting.
6. The tool reads the relevant workspace files and returns current content,
   selection label, requested action, and source provenance.
7. The agent checks that the returned label and action match the visible message.
   On a mismatch, it stops and asks the user to launch the action again.

The active selection remains until the next `Ask in...` action replaces it. It has
no separate history or expiry. Workspace files and database rows remain the only
durable sources of career facts.

## Shared contract

### Active selection

The stored routing state contains only:

- An authenticated user and workspace boundary
- A reference to the selected workspace item
- The requested action

It must not contain copied document text, job data, profile summaries, or chat
history.

### Context lookup

```text
get_active_context()
```

The zero-argument call is valid only because the authenticated MCP connection
resolves exactly one user and workspace. The tool must fail closed if that boundary
is missing or ambiguous.

The response contains only what the requested action needs. Each returned fact or
document includes enough provenance to identify its authoritative workspace source.
Generated summaries are not persisted as part of active context.

## Chat boundary

CareerCoach provides one persistent canonical chat. Changing workspace sections or
selected files does not create another CareerCoach conversation.

An external host may maintain its own conversation history, but that history is not
shared with CareerCoach or other hosts. The active-context tool shares current task
material, not conversation state.

## Host adapters

All supported hosts use the same active-selection state and MCP tool contract. An
adapter provides one of two launch behaviors:

- Direct: set the active selection, open the host, and inject the visible message.
- Copy: set the active selection and copy the visible message for the user to paste.

A host is supported only after its adapter, MCP configuration, authentication, and
tool invocation behavior have been tested. Shared MCP support does not imply that
launch behavior or setup is identical across hosts.

## Failure behavior

- No authenticated workspace: fail without returning workspace data.
- No active selection: ask the user to launch an item from CareerCoach.
- Missing or deleted source: report which selected item is unavailable.
- Message and lookup mismatch: stop before substantive work and relaunch.

The agent never guesses a workspace, selected item, or requested action.

## Deferred complexity

The first version intentionally excludes:

- Context IDs in user-visible prompts
- Immutable context snapshots
- Context history, expiry, or a context picker
- Separate active selections for each host
- Multiple MCP lookups to assemble one request
- Cross-host conversation synchronization

These features should be added only in response to observed usage.

## Acceptance criteria

- Browsing and ordinary selection do not change active context.
- `Ask in...` atomically replaces the active item reference and action.
- Active-selection storage contains no copied career facts or document content.
- One authenticated `get_active_context()` call reads current authoritative sources
  and returns everything needed for the requested action.
- The launch message contains a human-readable item label and action, but no context
  ID.
- The agent stops when the launch message and lookup result disagree.
- CareerCoach exposes one canonical chat and does not synchronize external chat
  history.
- Every supported host passes adapter, authentication, and MCP invocation tests.

