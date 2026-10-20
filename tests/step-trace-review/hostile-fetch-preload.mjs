// A `node --import` preload for the step-trace review (tester, 2026-10-20). It
// replaces fetch with a scripted OpenRouter stand-in that can also misbehave,
// and it refuses every socket that is not loopback, so a run can never reach a
// real model even if fetch were captured before this ran.
//
//   RV_SCRIPT  JSON list; request n gets item n (the last item repeats):
//     { "tools": [{ "name", "args" }], "cost": 0.1 }   a tool-call step
//     { "text": "...", "cost": 0.1 }                  a reply step (no tools)
//     { "status": 401, "body": "... {AUTH} ..." }       an error answer; {AUTH} becomes
//                                                     the Authorization header it got
//     { "throw": "message {AUTH}" }                     fetch rejects (a network error)
//     { "hang": true }                                  never answers (until aborted)
//     { "nocost": true, "text": "..." }                 a reply with no usage.cost
//     { "crash": true }                                 an uncaught error 10 ms later (the process dies)
//   RV_LOG     JSONL: one line per request { n, url, headers, body }
import net from "node:net";
import { appendFileSync, readFileSync } from "node:fs";

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === "object" && args[0] !== null ? args[0] : { port: args[0], host: args[1] };
  const host = o.host ?? "localhost";
  if (!o.path && !["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error(`review preload: refused a socket to ${host}`);
  }
  return origConnect.apply(this, args);
};

if (process.env.RV_SCRIPT) {
  const script = JSON.parse(readFileSync(process.env.RV_SCRIPT, "utf8"));
  const sse = (o) => "data: " + JSON.stringify(o) + "\n\n";
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const h = new Headers(init.headers || {});
    const headers = {};
    h.forEach((v, k) => (headers[k] = v));
    const item = script[Math.min(n, script.length - 1)];
    n++;
    appendFileSync(process.env.RV_LOG, JSON.stringify({ n, url: String(url), headers, body: String(init.body || "") }) + "\n");
    const auth = h.get("authorization") ?? "";
    if (item.throw) throw new TypeError(String(item.throw).replaceAll("{AUTH}", auth));
    if (item.crash) {
      setTimeout(() => {
        throw new Error("rv crash: an uncaught error in the runner");
      }, 10);
      return new Promise(() => {});
    }
    if (item.hang) {
      // a timer keeps the event loop alive, as a real open socket would (a bare pending promise does not)
      const keep = setInterval(() => {}, 1000);
      return new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          clearInterval(keep);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    if (item.status) {
      return new Response(String(item.body ?? "").replaceAll("{AUTH}", auth), { status: item.status, headers: { "content-type": "application/json" } });
    }
    const id = `gen-rv-${n}`;
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, ...(typeof item.cost === "number" && !item.nocost ? { cost: item.cost } : {}) };
    const chunks = [sse({ id, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })];
    if (item.tools?.length) {
      item.tools.forEach((t, i) => {
        chunks.push(sse({ id, model: "m", choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: `call_${n}_${i}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) } }] }, finish_reason: null }] }));
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
