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
