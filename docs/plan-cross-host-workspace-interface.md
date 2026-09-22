# Plan - Cross-host workspace interface

**Status:** Phase 4 adapter layer implemented; host deployment validation remains  
**Date:** 2026-08-26  
**Owner:** Yong

## Priority

Build the clean workspace interface and host-neutral context path first.
OpenClaw and the existing cloud WebUI are the final integration target, not the
foundation that constrains the design.

No phase creates a second durable store for career facts or a second CareerCoach
chat.

## Phase 1 - Shared workspace UI

**Status:** Complete

Build the interface as reusable React components with fixture-backed previews:

- Workspace shell and responsive navigation
- Today and plan table
- Jobs table and job detail
- Interview preparation and practice
- Document explorer, viewer, upload, and editor
- Profile and skills views
- Shared empty, loading, unavailable, and error states

The component package must not import OpenClaw, Supabase, Fly, or a host SDK. It
receives typed resource data and actions through props or provider interfaces.

**Exit:** The complete desktop and mobile workflow can be reviewed with realistic
fixtures, without a running agent host.

## Phase 2 - Workspace resource contract

**Status:** Complete

Define one host-neutral resource interface for listing, reading, updating, and
uploading authoritative workspace items. Add action descriptors for operations such
as resume review, interview preparation, and skill editing.

Start with a local workspace adapter for file-backed career data. Keep job and plan
tables as projections of authoritative files or rows, not independent copies.

**Exit:** The shared UI works against a real local workspace without knowing which
agent will handle an action.

Implementation notes:

- One normalized snapshot feeds all views; no screen imports storage details.
- Fixture and local HTTP providers implement the same four operations: snapshot,
  read, versioned update, and upload.
- Jobs, plan, profile, and skills are read-only projections of their canonical
  Markdown sources. Only explicit document saves and uploads write files.
- Local writes are contained to the configured workspace, reject hidden/parent and
  outside-symlink paths, use optimistic versions, and do not overwrite uploads.

## Phase 3 - Active context and MCP

**Status:** Complete

Implement the agreed active-selection seam:

- Record only selected item reference and requested action on `Ask in...`.
- Resolve one authenticated workspace per connection.
- Read authoritative sources when `get_active_context()` is called.
- Return the smallest sufficient payload with provenance.
- Compare the visible item label and action with the lookup before agent work.

Package host instructions separately from the resolver. The resolver owns data and
identity; host instructions own when the tool is called.

**Exit:** Contract tests prove fresh reads, identity isolation, no copied active
data, one-call lookup, and mismatch failure.

Implementation notes:

- Stable typed references address resources, jobs, plan items, and skills without
  copying their data into active state.
- A local process-bound identity derives from the operating-system user and
  canonical workspace root; one stdio process resolves exactly one workspace.
- The active pointer is stored atomically in per-user application state outside the
  career workspace and contains only workspace ID, item reference, and action.
- `get_active_context()` is the only MCP tool and rereads authoritative sources on
  every call. Projected rows return only the selected row plus source provenance.
- Visible messages use action-specific wording, and a shared matcher fails closed
  on an action or label mismatch.
- Host instructions are separate from the resolver. Host-specific configuration,
  copy/launch behavior, and remote authentication remain Phase 4.

## Phase 4 - External host adapters

**Status:** In progress

Ship the copy-message adapter first. Validate MCP setup and invocation separately
for each target host, beginning with hosts that can use the local MCP server.

Direct launch or message insertion is optional and is added only where the host
provides a reliable supported mechanism. ChatGPT remote MCP support may require a
cloud adapter and is not allowed to reshape the local contract.

Implementation notes:

- One shared copy-first handoff presents the exact visible request for Antigravity,
  Claude Cowork, and ChatGPT Work. No adapter creates another conversation or
  writes host-specific active state.
- Antigravity has a generated local stdio configuration and an end-to-end test that
  launches that generated command and calls `get_active_context()`.
- Cowork is correctly classified as a desktop-plugin deployment; a manual Claude
  Desktop MCP entry is not advertised as Cowork support.
- ChatGPT Work is correctly classified as a Secure MCP Tunnel deployment. The
  tunnel remains transport only and does not alter the active-context contract.
- Direct app launching and message injection are omitted because no dependable
  cross-host mechanism is needed for the copy-first flow.

Remaining exit work: package and validate the local MCP inside the existing Claude
plugin, validate the ChatGPT secure-tunnel connection, and run each through its
actual host UI. These deployment actions are not prerequisites for reviewing the
shared workspace or using the tested Antigravity configuration.

**Exit:** Each advertised host has an adapter test, setup instructions, and a
verified end-to-end context lookup.

## Phase 5 - OpenClaw and cloud WebUI integration

Integrate the shared pieces into the existing CareerCoach application last:

- Mount the shared workspace shell in the WebUI.
- Adapt existing file APIs, workspace-read helpers, job/coaching routes, and
  Supabase authentication to the resource contract.
- Reuse the existing shared file explorer, data table, editor, and chat components
  where they satisfy the new component contracts.
- Route `Ask in CareerCoach` to the existing canonical chat and message-injection
  path.
- Add cloud-backed active-selection storage and a remote authenticated MCP endpoint
  without copying source documents into the selection record.

Do not replace the existing chat transport, session persistence, OpenClaw gateway,
or per-user machine architecture unless integration tests expose a concrete need.

**Exit:** The cloud product uses the same workspace components and context contract
as local/external hosts while preserving the existing chat investment.

## Rollout gates

- Approve fixture-based desktop and mobile design before connecting live data.
- Approve local resource behavior before adding MCP.
- Pass identity and source-freshness tests before advertising any host.
- Validate each external host independently.
- Feature-flag the OpenClaw/WebUI integration and roll it out last.
