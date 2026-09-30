// The collapsed "ran …" line (design-web-ui.md § 3): groups consecutive
// tool-<name> parts, repeats collapse to a count. Expanded shows each
// part's literal input and output/errorText, word for word — never a
// restated description.
import { useState, type ReactElement } from "react";
import { Icon } from "../icons.tsx";
// Moved to tool-run-summary.ts (plain .ts, no JSX; see its own header) —
// re-exported here so this file stays the one design-web-ui.md § 3/§ 5.3
// points at, and used below for this component's own rendering.
import { activityLine, displayName, summarize, toolName, type ToolPartLike } from "./tool-run-summary.ts";
export { summarize, type ToolPartLike };

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface WriteReceipt {
  path: string;
  lines: number;
}

// The honest receipt for a write step (design-web-ui-refresh.md): the
// file name and the one real number the tool result itself carries — the
// new content's own line count, counted from `input.content` (a field
// the part actually has), never a diff the tool never reported (rule 11:
// the file, not a restated description of what changed).
function writeReceipt(part: ToolPartLike): WriteReceipt | null {
  if (toolName(part.type) !== "write_file") return null;
  const output = part.output as { path?: string } | undefined;
  const input = part.input as { path?: string; content?: string } | undefined;
  const path = output?.path ?? input?.path;
  if (!path || typeof input?.content !== "string") return null;
  return { path, lines: input.content.split("\n").length };
}

// A part is done once its state resolves to output-available/output-error
// (mock-transport.ts's own naming); a part with no state at all (a fixture
// shorthand) counts as done only once it actually carries output or an
// error — never guessed done from just existing.
function isDone(part: ToolPartLike): boolean {
  if (part.state) return part.state === "output-available" || part.state === "output-error";
  return part.output !== undefined || part.errorText !== undefined;
}

export function ToolRun({ parts }: { parts: ToolPartLike[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const live = parts.some((p) => !isDone(p));
  return (
    <div className="tool-run">
      <button
        type="button"
        className={`tool-run-toggle${live ? " tool-run-toggle--live" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* A fixed-size slot: swapping the spinner for the check icon as a
            part resolves mid-stream must never nudge anything next to it
            (measured CLS otherwise, § 5.9's "no layout shift"). */}
        <span className="tool-run-status-icon">
          {live ? <Icon name="loaderCircle" size={15} className="spin" /> : <Icon name="circleCheck" size={15} className="tool-run-done-icon" />}
        </span>
        {/* § 5.6 places the chevron AFTER the label; it sits before it
            here instead. As parts stream in, `summarize(parts)` grows
            (e.g. "write file" -> "write file ×2") — a TRAILING chevron's
            own position would shift every time (measured: real CLS from
            this exact cause, sources = .tool-run-caret svg moving as the
            label beside it resized). A caret before the label never
            moves when only the text after it changes width. */}
        <span className="tool-run-caret">
          <Icon name="chevronRight" size={14} />
        </span>
        <span className={`tool-run-label${live ? " tool-run-label--shimmer" : ""}`}>{activityLine(parts)}</span>
      </button>
      {open ? (
        <div className="tool-run-detail">
          {parts.map((part, i) => {
            const receipt = writeReceipt(part);
            return (
              <div className="tool-run-row" key={part.toolCallId ?? i}>
                <div className="tool-run-row-name">{displayName(toolName(part.type))}</div>
                {receipt ? (
                  <div className="tool-run-write">
                    <span className="tool-run-write-verb">wrote</span>
                    <span className="tool-run-write-name">{receipt.path}</span>
                    <span className="tool-run-write-meta">{receipt.lines} lines</span>
                  </div>
                ) : (
                  <>
                    <div className="tool-run-row-block">
                      <div className="tool-run-row-label">input</div>
                      <pre>{pretty(part.input)}</pre>
                    </div>
                    <div className="tool-run-row-block">
                      <div className="tool-run-row-label">
                        {part.errorText ? "error" : "output"}
                      </div>
                      <pre>{part.errorText ? part.errorText : pretty(part.output)}</pre>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
