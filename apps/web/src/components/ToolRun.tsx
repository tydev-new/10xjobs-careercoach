// The collapsed "ran …" line (design-web-ui.md § 3): groups consecutive
// tool-<name> parts, repeats collapse to a count. Expanded shows each
// part's literal input and output/errorText, word for word — never a
// restated description.
import { useState, type ReactElement } from "react";

export interface ToolPartLike {
  type: string; // "tool-<name>"
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  state?: string;
}

function toolName(type: string): string {
  return type.startsWith("tool-") ? type.slice(5) : type;
}

function displayName(name: string): string {
  return name.replace(/_/g, " ");
}

function summarize(parts: ToolPartLike[]): string {
  const labels: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const name = toolName(parts[i].type);
    let count = 1;
    while (i + count < parts.length && toolName(parts[i + count].type) === name) count++;
    labels.push(count > 1 ? `${displayName(name)} ×${count}` : displayName(name));
    i += count;
  }
  return labels.join(" · ");
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolRun({ parts }: { parts: ToolPartLike[] }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-run">
      <button
        type="button"
        className="tool-run-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="tool-run-caret">{open ? "▾" : "▸"}</span> ran {summarize(parts)}
      </button>
      {open ? (
        <div className="tool-run-detail">
          {parts.map((part, i) => (
            <div className="tool-run-row" key={part.toolCallId ?? i}>
              <div className="tool-run-row-name">{displayName(toolName(part.type))}</div>
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
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
