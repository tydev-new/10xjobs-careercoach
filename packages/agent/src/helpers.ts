// Pure helpers from docs/design-web-agent.md — matchGateReply (§ 3),
// statusOf (§ 6.1), parsePlanTodo (§ 6.2). No window/document/localStorage/
// Node-only API: these run the same in the browser and on a server.
//
// MOVED from apps/web/src/agent-helpers.ts (2026-09) — apps/web now
// re-exports from here; this is the one copy.
import type { AppMessage, GateStatus, MessageOrigin, Status } from "./types.ts";

export type GateReplyResult = "approve" | "decline" | "none";

const DECLINE_WORDS = new Set(["no", "don't", "cancel", "stop"]);

/**
 * matchGateReply — § 3, point 2/3: the next message approves only if its
 * origin is "typed" and the whole message, trimmed and lowercased, with at
 * most one trailing "." or "!", is exactly "yes". An exact no/don't/cancel/
 * stop declines. Anything else leaves the gate open ("none").
 */
export function matchGateReply(text: string, origin: MessageOrigin): GateReplyResult {
  if (origin !== "typed") return "none";
  const trimmed = text.trim();
  const stripped = /[.!]$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed;
  const normalized = stripped.toLowerCase();
  if (normalized === "yes") return "approve";
  if (DECLINE_WORDS.has(normalized)) return "decline";
  return "none";
}

// ---------------------------------------------------------------------
// statusOf — § 6.1. { state, action? }, first match wins.
// ---------------------------------------------------------------------

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

/** UI-owned one-line label per tool name (design-web-ui.md § 1.3). */
const TOOL_LABELS: Record<string, string> = {
  load_skill: "loading a skill",
  read_file: "reading a file",
  write_file: "writing a file",
  list_files: "listing files",
  bash: "running a checker",
  web_search: "searching the web",
  fetch_job: "fetching the posting",
  estimate_cost: "estimating cost",
  check_language: "checking language",
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
}

function toolPartName(type: string): string | null {
  if (!type.startsWith("tool-")) return null;
  return type.slice("tool-".length);
}

function isToolPartDone(part: { type: string; state?: string }): boolean {
  return part.state === "output-available" || part.state === "output-error";
}

/** Latest status per gateId, scanning every data-gate-status part in order. */
export function latestGateStatuses(
  messages: AppMessage[],
): Map<string, { status: GateStatus; label?: string }> {
  const byGate = new Map<string, { status: GateStatus; label?: string }>();
  for (const message of messages) {
    for (const part of message.parts as Array<{ type: string; data?: unknown }>) {
      if (part.type === "data-gate") {
        const data = part.data as { gateId: string; label: string };
        const existing = byGate.get(data.gateId);
        byGate.set(data.gateId, { status: existing?.status ?? "pending", label: data.label });
      } else if (part.type === "data-gate-status") {
        const data = part.data as { gateId: string; status: GateStatus };
        const existing = byGate.get(data.gateId);
        byGate.set(data.gateId, { status: data.status, label: existing?.label });
      }
    }
  }
  return byGate;
}

export function statusOf(messages: AppMessage[], chat: ChatStatus): Status {
  const hasTurn = messages.some((m) => m.role === "assistant");
  const lastMessage = messages[messages.length - 1];
  const lastAssistant =
    lastMessage && lastMessage.role === "assistant" ? lastMessage : undefined;
  const lastPart = lastAssistant?.parts[lastAssistant.parts.length - 1] as
    | { type: string; state?: string }
    | undefined;

  // 1. working: streaming, and the latest part is a tool part not yet done.
  if (chat === "streaming" && lastPart) {
    const toolName = toolPartName(lastPart.type);
    if (toolName && !isToolPartDone(lastPart)) {
      return { state: "working", action: toolLabel(toolName) };
    }
  }

  // 2. thinking: submitted, or streaming with any other latest part.
  if (chat === "submitted" || chat === "streaming") {
    return { state: "thinking" };
  }

  // 3. needs-you: ready, and some gateId's latest status is pending.
  if (chat === "ready") {
    const gates = latestGateStatuses(messages);
    for (const { status, label } of gates.values()) {
      if (status === "pending") {
        return { state: "needs-you", action: label };
      }
    }
  }

  // 4. done: ready or error after at least one turn in this chat.
  if ((chat === "ready" || chat === "error") && hasTurn) {
    return { state: "done" };
  }

  // 5. idle: no turn yet.
  return { state: "idle" };
}

// ---------------------------------------------------------------------
// parsePlanTodo — § 6.2: lines under "To do", up to the next board
// heading or "##". Accepts "1. ", "- ", "* " bullets. text = the line
// minus its bullet, word for word. ref = the first backticked workspace
// path in the line, else absent.
// ---------------------------------------------------------------------

export interface PlanTodoItem {
  text: string;
  ref?: string;
}

const BULLET_RE = /^(?:\d+\.|-|\*)\s+(.*)$/;
// "To do" or "To do (2)" (apps/workspace-ui's own board-count heading form,
// which § 6.2 says parsePlanTodo also has to accept).
const TODO_HEADING_RE = /^to do\b/i;

/** The first backticked span in `text` that looks like a workspace path
 *  (contains "/" or ends in a file extension) — not just the first
 *  backticked span (a line can quote a non-path word first, e.g. "keep"). */
function firstPathRef(text: string): string | undefined {
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const candidate = m[1];
    if (candidate.includes("/") || /\.[A-Za-z0-9]+$/.test(candidate)) return candidate;
  }
  return undefined;
}

export function parsePlanTodo(md: string): PlanTodoItem[] {
  // CRLF files keep every line word for word (no trailing \r on `text`).
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => TODO_HEADING_RE.test(line.trim()));
  if (startIndex === -1) return [];

  const items: PlanTodoItem[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // blank lines inside the section are skipped
    if (line.trim().startsWith("#")) break; // next "##" heading
    const match = line.match(BULLET_RE);
    if (!match) break; // next board heading (e.g. "Doing")
    const text = match[1];
    const ref = firstPathRef(text);
    items.push(ref ? { text, ref } : { text });
  }
  return items;
}
