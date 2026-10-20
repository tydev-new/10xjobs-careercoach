// The step counter's pure parts (docs/design-fewer-steps.md § 1.1): how one
// tool call becomes one `[trace]` line, how a line is masked, and how an
// assistant message's parts are walked into steps. Node-only (bin/), no
// network, no file access: everything here takes plain objects, so a test
// can drive it with a canned message.
//
// NEVER file contents: a write_file's content shows only as its length, a
// read_file's result only as a character count, a bash result only as an
// exit code and one FAIL/WARN line. The key never reaches a tool input; on
// top of that every line passes through `makeMask`.

/** A mask for trace lines: each secret VALUE given (the API key) and anything
 * shaped like an `sk-` key becomes `[redacted]`. Values shorter than 8
 * characters are not masked (they would mangle ordinary words). */
export function makeMask(secrets = []) {
  const values = secrets.filter((v) => typeof v === "string" && v.length >= 8);
  return (text) => {
    let out = String(text);
    for (const v of values) out = out.split(v).join("[redacted]");
    return out.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]");
  };
}

const oneLine = (s) => String(s).replace(/\r?\n/g, "⏎");
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
// "in=" and "out=" are split on the last " out=" by the scorer, so neither
// field may carry one.
const safe = (s) => oneLine(s).replace(/ out=/g, " out:");

function errorCode(output) {
  return output && typeof output === "object" && output.error && typeof output.error === "object"
    ? String(output.error.code ?? "error")
    : null;
}

/** The short, content-free `in=` text for one tool call (§ 1.1's table). */
export function shortInput(tool, input) {
  const i = input && typeof input === "object" ? input : {};
  switch (tool) {
    case "load_skill":
      return safe(i.name ?? "");
    case "read_file":
      return safe(i.path ?? "");
    case "write_file":
      return safe(`${i.path ?? ""} (${typeof i.content === "string" ? i.content.length : 0} chars)`);
    case "list_files":
      return safe(i.dir ? i.dir : "(all)");
    case "bash":
      return safe(clip(oneLine(i.command ?? ""), 160));
    case "web_search":
      return safe(clip(String(i.query ?? ""), 80));
    case "fetch_job": {
      let where = "(bad url)";
      try {
        const u = new URL(String(i.url ?? ""));
        where = u.host + u.pathname;
      } catch {
        // keep "(bad url)"
      }
      return safe(i.saveTo ? `${where} saveTo=${i.saveTo}` : where);
    }
    case "estimate_cost":
      return safe(clip(String(i.action ?? ""), 80));
    case "check_language":
      return safe(Array.isArray(i.files) ? i.files.join(",") : "");
    case "list_board":
      return `${Array.isArray(i.boards) ? i.boards.length : 0} companies`;
    case "add_roles":
      return `${Array.isArray(i.roles) ? i.roles.length : 0} companies`;
    default:
      return "(n/a)";
  }
}

/** The short `out=` text for one tool result (§ 1.1's table). `part` is the
 * tool UI part: `state`, `output`, `errorText`. */
export function shortOutput(tool, part) {
  if (part.state === "output-error") return safe(clip(String(part.errorText ?? "error"), 80));
  const o = part.output;
  const code = errorCode(o);
  switch (tool) {
    case "bash": {
      const exit = o && typeof o.exitCode === "number" ? o.exitCode : "?";
      const text = `${o?.stdout ?? ""}\n${o?.stderr ?? ""}`;
      const hit = text.split("\n").find((l) => /\b(FAIL|WARN)\b/.test(l));
      return safe(`exit=${exit} ${hit ? clip(hit.trim(), 80) : "clean"}`);
    }
    case "read_file":
      if (code) return code;
      return `${typeof o?.content === "string" ? o.content.length : typeof o?.text === "string" ? o.text.length : 0} chars`;
    case "write_file":
      return code ?? "written";
    case "list_files":
      return code ?? `${Array.isArray(o?.files) ? o.files.length : 0} files`;
    case "web_search":
      return code ?? `${Array.isArray(o?.results) ? o.results.length : 0} results`;
    case "estimate_cost":
      return code ?? `needsGate=${Boolean(o?.needsGate)}`;
    default:
      return code ?? "ok";
  }
}

/** The tool name of a UI part, or null when it is not a tool part. */
function toolNameOf(part) {
  if (typeof part?.type !== "string") return null;
  if (part.type === "dynamic-tool") return String(part.toolName ?? "");
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : null;
}

const done = (part) => part.state === "output-available" || part.state === "output-error";

/** The number of `step-start` parts: the UI's own count of model calls. */
export function uiStepCount(message) {
  return (message?.parts ?? []).filter((p) => p?.type === "step-start").length;
}

/**
 * A tracer for one turn. `update(message)` is called with each growing
 * snapshot of the assistant message and prints one line per tool call the
 * first time its result is there; `finish(message)` prints one line per
 * reply-only step and returns the step count.
 */
export function createTracer({ turn, emit }) {
  const seen = new Set();
  const stepOf = (parts, upTo) => {
    let s = 0;
    for (let k = 0; k <= upTo; k++) if (parts[k]?.type === "step-start") s++;
    return Math.max(s, 1);
  };
  return {
    update(message) {
      const parts = message?.parts ?? [];
      parts.forEach((part, idx) => {
        const tool = toolNameOf(part);
        if (!tool || !part.toolCallId || seen.has(part.toolCallId) || !done(part)) return;
        seen.add(part.toolCallId);
        emit(`[trace] turn=${turn} step=${stepOf(parts, idx)} tool=${tool} in=${shortInput(tool, part.input)} out=${shortOutput(tool, part)}`);
      });
    },
    finish(message) {
      const parts = message?.parts ?? [];
      const steps = new Map(); // step -> { tools, chars }
      let s = 0;
      for (const part of parts) {
        if (part?.type === "step-start") {
          s++;
          steps.set(s, { tools: 0, chars: 0 });
          continue;
        }
        const cur = steps.get(Math.max(s, 1)) ?? { tools: 0, chars: 0 };
        steps.set(Math.max(s, 1), cur);
        if (toolNameOf(part)) cur.tools++;
        else if (part?.type === "text") cur.chars += String(part.text ?? "").length;
      }
      for (const [step, v] of [...steps.entries()].sort((a, b) => a[0] - b[0])) {
        if (v.tools === 0) emit(`[trace] turn=${turn} step=${step} reply (${v.chars} chars)`);
      }
      return uiStepCount(message);
    },
  };
}
