#!/usr/bin/env node
// The t22-feedback harness's stand-in for Ten's feedback endpoint
// (docs/design-feedback.md § 17.5). It listens on 127.0.0.1 ONLY, writes one
// JSON line per request it receives, and answers with a fixed status. The
// runner points TEN_FEEDBACK_URL at it, so a run can never write a real note.
//
//   node feedback_stub.mjs <log-file> <status> <port-file>
//
//   <log-file>   one JSON line per request: { at, method, path, headers, body }
//   <status>     the status every request is answered with: 201, 429 or 503
//                (the runner makes a "closed port" by stopping this stub and
//                keeping its port)
//   <port-file>  written once, with the port, when the stub is listening
//
// Run it in the background, record its PID at spawn (`$!`), and stop only
// that PID. No headers are logged beyond what the request carried; there is no
// key anywhere in this file.
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [logFile, statusArg, portFile] = process.argv.slice(2);
const status = Number(statusArg);
if (!logFile || !portFile || ![201, 429, 503].includes(status)) {
  console.error("usage: node feedback_stub.mjs <log-file> <201|429|503> <port-file>");
  process.exit(2);
}

const BODY = { 201: { status: "sent" }, 429: { status: "busy" }, 503: { status: "failed" } };

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    appendFileSync(
      logFile,
      JSON.stringify({
        at: Date.now(),
        method: req.method,
        path: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }) + "\n",
    );
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    if (status === 429) res.setHeader("retry-after", "3600");
    res.end(JSON.stringify(BODY[status]));
  });
});

// Port 0 asks the OS for a free one; the host is the loopback address and
// nothing else, so no other machine can reach the stub.
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
