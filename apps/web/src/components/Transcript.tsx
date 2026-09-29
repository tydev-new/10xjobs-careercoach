import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { latestGateStatuses } from "../agent-helpers";
import type { AppMessage, DataCardData, DataErrorData, GateRequest } from "../types";
import { BrandMark } from "./BrandMark";
import { Card } from "./Cards";
import { ErrorPart } from "./ErrorPart";
import { GateCard } from "./GateCard";
import { Icon } from "../icons.tsx";
import { ToolRun } from "./ToolRun";
// Exported here (design-web-ui.md § 5.9, 3c: "groupParts' groups
// (Transcript.tsx:35, exported)") — the implementation moved to
// group-parts.ts (plain .ts, no JSX) so Home's activity line and its own
// unit test can import it without a .tsx file in the graph; this file
// both uses it below AND keeps the one export Home's contract names.
import { groupParts, type Group } from "./group-parts.ts";
export { groupParts, type Group };

// A plain stroke icon, not an emoji (banned defaults: no emoji standing
// in for an icon) — a single small attach mark, same weight as the rest
// of the chip's muted text.
function AttachmentIcon(): ReactElement {
  return (
    <svg
      className="attachment-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function Transcript({
  messages,
  onOpen,
  onPrint,
}: {
  messages: AppMessage[];
  onOpen: (ref: string) => void;
  onPrint: (htmlPath: string) => void;
}): ReactElement {
  const gateStatuses = useMemo(() => latestGateStatuses(messages), [messages]);

  // design-web-ui.md § 1.1: "oldest first, autoscroll" — a new message, a
  // streaming delta, a tool row completing, or a card landing all extend
  // this same container, so scrolling it to bottom on every messages
  // update (a new array reference each chunk, ai@7.0.111's own update
  // model) keeps whatever just arrived in view without the candidate
  // scrolling by hand.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="transcript" ref={scrollRef}>
      {messages.map((message) => {
        if (message.role === "user") {
          const text = message.parts.find((p) => p.type === "text") as
            | { type: "text"; text: string }
            | undefined;
          const files = message.parts.filter((p) => p.type === "file") as Array<{
            type: "file";
            filename?: string;
          }>;
          return (
            <div className="bubble bubble--user" key={message.id}>
              {/* § 5.6 "Messages (Stage 2)": "Yours is a 28px circle,
                  --bg-muted, holding user 15px in --fg-muted." — a
                  sibling FIRST child, not a wrapping column, so it never
                  changes which element is .bubble's lastElementChild
                  (a card, when one lands last, stays reachable exactly
                  the same way it did before this layout). */}
              <span className="bubble-avatar bubble-avatar--user" aria-hidden="true">
                <Icon name="user" size={15} />
              </span>
              <div className="bubble-role">You</div>
              {text ? <p>{text.text}</p> : null}
              {files.map((f, i) => (
                <div key={i} className="attachment-chip">
                  <AttachmentIcon />
                  <span className="mono">{f.filename ?? "attachment"}</span>
                </div>
              ))}
            </div>
          );
        }

        const groups = groupParts(message.parts as Array<Record<string, unknown>>);
        return (
          <div className="bubble bubble--assistant" key={message.id}>
            {/* § 5.6: "Ten's avatar is the 28px mark." Plain — no ring,
                no state; this is a historical turn, not the live header
                avatar (Avatar.tsx). */}
            <span className="bubble-avatar bubble-avatar--ten" aria-hidden="true">
              <BrandMark size={28} />
            </span>
            <div className="bubble-role">Ten</div>
            {groups.map((group, gi) => {
              if (group.kind === "tool") {
                return <ToolRun key={gi} parts={group.parts} />;
              }
              const part = group.part;
              switch (part.type) {
                case "text":
                  return <p key={gi}>{part.text as string}</p>;
                case "data-card":
                  return (
                    <Card
                      key={gi}
                      data={part.data as DataCardData}
                      onOpen={onOpen}
                      onPrint={onPrint}
                    />
                  );
                case "data-gate": {
                  const gate = part.data as GateRequest;
                  const status = gateStatuses.get(gate.gateId)?.status ?? "pending";
                  return <GateCard key={gi} gate={gate} status={status} />;
                }
                case "data-gate-status":
                  return null; // reflected in the gate card's status, not shown standalone
                case "data-error":
                  return <ErrorPart key={gi} data={part.data as DataErrorData} />;
                default:
                  return null;
              }
            })}
          </div>
        );
      })}
    </div>
  );
}
