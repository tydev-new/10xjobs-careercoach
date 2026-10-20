// A `node --import` preload that replaces fetch with a scripted OpenRouter
// stand-in, so bin/run.mjs can be driven end to end with NO model and NO
// network (the tests/agent/bin-run.test.ts pattern, extended to answer with
// tool calls and then text). Used by step-trace.test.ts and by
// tests/test_step_trace_driver.py.
//
//   ST_SCRIPT   path to a JSON list; request n gets item n (the last item
//               repeats). An item is
//                 { "text": "...", "tools": [{ "name": "list_files", "args": {...} }], "cost": 0.001 }
//               `tools` makes a tool-call step (finish_reason tool_calls);
//               without it the step is a plain reply. `cost` is the usage.cost
//               the provider reports for the step (omitted when absent).
//               An item may instead be { "status": 401, "body": "... {AUTH} ..." },
//               an error answer in which {AUTH} is the Authorization header received.
//   ST_LOG      path to a JSONL file: one line per request, { n, url, auth,
//               body, ws } where ws is the workspace's file list AT REQUEST TIME
//               (read from the --workspace argument), so a test can see what
//               the run had staged when each step was asked for.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// `node --test` also runs every file under test/ as a test; without a script this file does nothing.
if (process.env.ST_SCRIPT) {
const script = JSON.parse(readFileSync(process.env.ST_SCRIPT, "utf8"));
const sse = (o) => "data: " + JSON.stringify(o) + "\n\n";
const wsIdx = process.argv.indexOf("--workspace");
const ws = wsIdx >= 0 ? process.argv[wsIdx + 1] : null;
const walk = (d, p = "") =>
  readdirSync(d).sort().flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n), p + n + "/") : [p + n]));
let n = 0;

globalThis.fetch = async (url, init = {}) => {
  const h = new Headers(init.headers || {});
  const item = script[Math.min(n, script.length - 1)];
  n++;
  // ST_PROBE (optional): a path whose BSD file flags (`ls -ldO`) are recorded at
  // request time, so a test can see a locked vault AT THE MOMENT a step is asked for.
  let probe = null;
  if (process.env.ST_PROBE) {
    try {
      probe = execFileSync("ls", ["-ldO", process.env.ST_PROBE], { encoding: "utf8" }).trim();
    } catch {
      probe = "(unreadable)";
    }
  }
  appendFileSync(
    process.env.ST_LOG,
    JSON.stringify({ n, url: String(url), auth: h.get("authorization"), body: String(init.body || ""), ws: ws && existsSync(ws) ? walk(ws) : null, probe }) + "\n",
  );
  // { "status": 401, "body": "... {AUTH} ..." }: an error answer; {AUTH} becomes the
  // Authorization header it was sent, so a test can see a provider that echoes the key.
  if (item.status) {
    return new Response(String(item.body ?? "").replaceAll("{AUTH}", h.get("authorization") ?? ""), {
      status: item.status,
      headers: { "content-type": "application/json" },
    });
  }
  const id = `gen-st-${n}`;
  const usage = {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    ...(typeof item.cost === "number" ? { cost: item.cost } : {}),
  };
  const chunks = [sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })];
  if (item.tools?.length) {
    item.tools.forEach((t, i) => {
      chunks.push(
        sse({
          id,
          model: "m",
          choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${n}_${i}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) } }] }, finish_reason: null }],
        }),
      );
    });
    chunks.push(sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }));
  } else {
    chunks.push(sse({ id, model: "m", choices: [{ index: 0, delta: { content: item.text ?? "ok" }, finish_reason: null }] }));
    chunks.push(sse({ id, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
  }
  chunks.push(sse({ id, model: "m", choices: [], usage }));
  chunks.push("data: [DONE]\n\n");
  return new Response(chunks.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
};
}
