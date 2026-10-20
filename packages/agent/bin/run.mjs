#!/usr/bin/env node
// A small headless runner for packages/agent — for step B2 later (the
// B1-simplified skills re-checked on other OpenRouter models) and for
// dogfooding the coach loop outside a browser.
//
//   node bin/run.mjs --workspace <dir> --skills <dir> --model <model-id> \
//     --prompt "<text>" [--chat-id <id>] [--key-env OPENROUTER_API_KEY] \
//     [--balance <usd>] [--trace] [--max-usd <n>]
//   node bin/run.mjs --workspace <dir> --skills <dir> --model <model-id> \
//     --turns <file.json> [--fixtures <dir>] [--trace] [--max-usd <n>] ...
//
// Exit codes: 0 the turn finished (a reply, or a pause at the spend
// gate — its `[gate]` line is on stderr); 1 refused (no key) or the run
// crashed; 2 usage error (bad arguments, --model off the allowlist, a
// --turns workspace that is not a fresh temp folder);
// 3 the turn ended on an error (each one logged as an `[error]` line on
// stderr; the reply on stdout is whatever came before it, often empty);
// 4 the run was stopped because its reported cost passed --max-usd.
// Once a turn starts, stderr carries exactly one `[cost]` line, the turn's
// spend: `[cost] usd=<x> steps=<n>`, or `[cost] unknown ...` when the
// provider reported none.
//
// Step counter (docs/design-fewer-steps.md § 1.1), for measuring how many
// model calls ("steps") a reply takes:
//   --trace          one stderr line per tool call, and one per reply-only step:
//                      [trace] turn=<t> step=<s> tool=<name> in=<short> out=<short>
//                      [trace] turn=<t> step=<s> reply (<n> chars)
//                    Paths and lengths only, never file contents. Every line is
//                    masked: the key's value, and anything shaped like sk-<16+ key
//                    characters>, prints as [redacted]. After each turn it checks
//                    that the UI's step count equals the number of step costs
//                    recorded, and prints `[trace] WARN steps ui=<a> cost=<b>` if not.
//   --turns <file>   (instead of --prompt) a JSON list of turns, each
//                    { "text": "..." } or { "text": "...", "attach": "<file>" }, run
//                    in ONE process with one coach and one chat id. Each turn sends
//                    the whole history (the earlier user messages and the final
//                    assistant message of each turn) plus the new message; the coach
//                    cuts it to its window itself, as on the site. An attach is
//                    read from --fixtures <dir> (default: the turns file's own
//                    folder) and uploaded to documents/<name> first, then sent as
//                    the same `file` part the site's composer sends. A turn that
//                    stops at a spend gate is logged ([gate]); the next turn is sent
//                    as written (the runner never types yes). Replies print on
//                    stdout under "=== turn <t> ===".
//                    Refused (exit 2, before any request) unless --workspace is
//                    inside the system temp folder (symlinks resolved) and holds no
//                    file but CLAUDE.md: the driver stages nothing else.
//                    Stderr gets `[cost] turn=<t> usd=<x> steps=<n>` after each turn,
//                    then the usual `[cost] usd=<total> steps=<total>` line last.
//   --max-usd <n>    stop the run when its reported cost passes n dollars (default 1
//                    with --turns, none with --prompt): a `[stop] ...` line, exit 4.
//
// Refuses to run without an EXPLICIT key env var: the name is always
// named on the command line (--key-env, default OPENROUTER_API_KEY) and
// that named variable must actually be set — no silent fallback, no
// hardcoded key, and the key's VALUE is never printed (only the env var
// NAME appears in any message).
//
// Model request: the same per-model options ten-model-proxy sends
// upstream (upstreamModelOptions in supabase/functions/ten-model-proxy/
// core.ts — the proxy's own buildUpstreamBody uses it): the no-data-kept
// provider filter (+ require_parameters for DeepSeek), cache_control for
// Claude only, max_tokens at the proxy's cap. --model must be one of the
// proxy's allowed ids (MODEL_IDS); anything else is refused, since
// production would refuse it (400 model_not_allowed) and a headless run
// of it would measure nothing the site can send.
//
// Scripts: the REAL ScriptRunner the web app uses (just-bash + the
// skills' ported checkers, apps/web/src/backend/script-runner.ts, wired
// in bin/headless-deps.mjs), so a skill's `node scripts/check_*.mjs ...`
// runs here exactly as in the browser — its output (and any jobs.md
// write-back) reaches the model the same way. A still-unported script
// exits 127 "not available in the web app: <name>", same as the web app.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { readUIMessageStream } from "ai";

import { createCoach } from "../src/coach.ts";
import { buildHeadlessDeps } from "./headless-deps.mjs";
import { MODEL_IDS, upstreamModelOptions } from "../../../supabase/functions/ten-model-proxy/core.ts";
import { createTracer, makeMask } from "./trace.mjs";

const USAGE =
  "usage: node bin/run.mjs --workspace <dir> --skills <dir> --model <model-id> (--prompt \"<text>\" | --turns <file.json> [--fixtures <dir>]) [--trace] [--max-usd <n>] [--chat-id <id>] [--key-env NAME] [--balance <usd>]";

function parseArgs(argv) {
  const args = { keyEnv: "OPENROUTER_API_KEY", chatId: "run-" + Date.now(), balance: 5, trace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") args.workspace = argv[++i];
    else if (a === "--skills") args.skills = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--prompt") args.prompt = argv[++i];
    else if (a === "--chat-id") args.chatId = argv[++i];
    else if (a === "--key-env") args.keyEnv = argv[++i];
    else if (a === "--balance") args.balance = Number(argv[++i]);
    else if (a === "--trace") args.trace = true;
    else if (a === "--turns") args.turns = argv[++i];
    else if (a === "--fixtures") args.fixtures = argv[++i];
    else if (a === "--max-usd") args.maxUsd = Number(argv[++i]);
    else {
      throw new Error(`unrecognized argument: ${a}`);
    }
  }
  for (const required of ["workspace", "skills", "model"]) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  if (Boolean(args.prompt) === Boolean(args.turns)) {
    throw new Error("exactly one of --prompt and --turns is required");
  }
  if (args.maxUsd !== undefined && !(args.maxUsd > 0)) throw new Error("--max-usd must be a positive number");
  if (args.turns && args.maxUsd === undefined) args.maxUsd = 1;
  if (!MODEL_IDS.includes(args.model)) {
    throw new Error(`--model must be one of the site's allowed models (${MODEL_IDS.join(", ")}); got ${args.model}`);
  }
  return args;
}

const TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];

/** `--turns` runs only in a fresh folder inside the system temp folder that
 * holds nothing but CLAUDE.md (the site's starting state). Throws with the
 * reason. Paths are compared after symlinks are resolved, so a link out of
 * the temp folder, or /var vs /private/var on macOS, cannot fool it. */
export function assertFreshTempWorkspace(workspace, tmpRoot = os.tmpdir()) {
  let ws;
  let tmp;
  try {
    ws = fs.realpathSync(path.resolve(workspace));
    tmp = fs.realpathSync(tmpRoot);
  } catch {
    throw new Error(`--turns needs an existing --workspace folder; ${workspace} is not one`);
  }
  const rel = path.relative(tmp, ws);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`--turns refuses a workspace outside the system temp folder (${tmp}); ${workspace} is not inside it`);
  }
  // TMPDIR moves os.tmpdir(), so "inside the temp folder" alone could be made to
  // mean any folder. The real path must also sit under one of the system's own
  // temp roots, and never under the person's home.
  const roots = TEMP_ROOTS.flatMap((r) => {
    try {
      return [fs.realpathSync(r)];
    } catch {
      return [];
    }
  });
  const under = (base) => {
    const r = path.relative(base, ws);
    return r !== "" && !r.startsWith("..") && !path.isAbsolute(r);
  };
  if (!roots.some(under)) {
    throw new Error(`--turns refuses a workspace that is not under the system temp roots (${TEMP_ROOTS.join(", ")}); ${workspace} is not`);
  }
  let home = null;
  try {
    home = fs.realpathSync(os.homedir());
  } catch {
    // no readable home to compare with
  }
  if (home && home !== "/" && under(home)) {
    throw new Error(`--turns refuses a workspace under your home folder; ${workspace} is`);
  }
  if (!fs.statSync(ws).isDirectory()) throw new Error(`--turns needs a folder; ${workspace} is not one`);
  const stray = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath + "/");
      else if (relPath !== "CLAUDE.md") stray.push(relPath);
    }
  };
  walk(ws, "");
  if (stray.length > 0) {
    throw new Error(`--turns refuses a workspace that already holds files other than CLAUDE.md (found ${stray.length}, e.g. ${stray[0]})`);
  }
}

function loadTurns(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("--turns file must be a non-empty JSON list");
  for (const t of raw) {
    if (!t || typeof t.text !== "string" || t.text === "") throw new Error("every turn needs a non-empty \"text\"");
    if (t.attach !== undefined && typeof t.attach !== "string") throw new Error("\"attach\" must be a file name");
  }
  return raw;
}

/** Every byte this process writes to stderr passes through the mask, once,
 * installed before anything can print: the SDK's error dump (a provider's
 * `responseBody`, `data.error.message`), the `[error] code: message` line, a
 * stack trace, a usage error. A provider that echoes the bearer token in an
 * error answer therefore cannot put the key in a log. An uncaught error is
 * written through the same wrapper, then the process exits 1. */
function installMaskedStderr() {
  const at = process.argv.indexOf("--key-env");
  const name = at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : "OPENROUTER_API_KEY";
  const mask = makeMask([process.env[name]]);
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) =>
    write(typeof chunk === "string" ? mask(chunk) : chunk instanceof Uint8Array ? mask(Buffer.from(chunk).toString("utf8")) : chunk, ...rest);
  for (const event of ["uncaughtException", "unhandledRejection"]) {
    process.on(event, (err) => {
      process.stderr.write(`run.mjs failed: ${err?.stack ?? err}\n`);
      process.exit(1);
    });
  }
}

async function main() {
  installMaskedStderr();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.turns) assertFreshTempWorkspace(args.workspace);
  } catch (err) {
    console.error(`usage error: ${err.message}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  let turns = null;
  if (args.turns) {
    try {
      turns = loadTurns(args.turns);
    } catch (err) {
      console.error(`usage error: ${err.message}`);
      process.exitCode = 2;
      return;
    }
  }

  // Refuse to run without an EXPLICIT key env var — never a default,
  // never a hardcoded key, and the value is never logged.
  const apiKey = process.env[args.keyEnv];
  if (!apiKey) {
    console.error(`refusing to run: the ${args.keyEnv} environment variable is not set.`);
    console.error(`set it, or point --key-env at whichever variable holds your OpenRouter key.`);
    process.exitCode = 1;
    return;
  }

  const deps = await buildHeadlessDeps({
    workspaceDir: args.workspace,
    skillsDir: args.skills,
    balance: args.balance,
  });

  const openrouter = createOpenRouter({ apiKey });
  // What ten-model-proxy sends upstream for this model (see header).
  const upstream = upstreamModelOptions(args.model);
  const model = openrouter.chat(args.model, {
    provider: upstream.provider,
    maxTokens: upstream.maxTokens,
    ...(upstream.cacheControl ? { cache_control: upstream.cacheControl } : {}),
  });

  // The turn's spend, from the coach's OWN per-step cost recorder
  // (coach.ts recordStepCost: providerMetadata.openrouter.usage.cost, one
  // call per recorded step) — printed once at the end as one fixed line:
  //   [cost] usd=<sum> steps=<n>                      every step reported a cost
  //   [cost] unknown steps=<n> reported=<k> usd=<sum>  any step reported none
  const stepCosts = [];
  let turnCosts = [];
  const abort = new AbortController();
  let overBudget = false;
  const coach = createCoach({
    ...deps,
    model,
    onStepCost: (s) => {
      stepCosts.push(s.reportedUsd);
      turnCosts.push(s.reportedUsd);
      if (args.maxUsd !== undefined && sumOf(stepCosts) > args.maxUsd && !overBudget) {
        overBudget = true;
        abort.abort();
      }
    },
  });
  const mask = makeMask([apiKey]);
  const emitTrace = args.trace ? (line) => console.error(mask(line)) : null;

  try {
    if (turns) {
      await runTurns(coach, deps, args, turns, { stepCosts, newTurn: () => (turnCosts = []), turnCosts: () => turnCosts, emitTrace, signal: abort.signal, overBudget: () => overBudget });
    } else {
      const history = [{ id: "u1", role: "user", parts: [{ type: "text", text: args.prompt }], metadata: { origin: "typed" } }];
      const turn = await streamTurn(coach, args.chatId, history, { turn: 1, emitTrace, signal: abort.signal });
      reportTurn(turn);
      checkSteps(1, turn.uiSteps, turnCosts.length, emitTrace);
      process.stdout.write(turn.text + "\n");
      if (overBudget) stopLine(args, stepCosts);
    }
  } finally {
    console.error(costLine(stepCosts));
  }
}

function sumOf(costs) {
  return costs.filter((c) => typeof c === "number").reduce((a, b) => a + b, 0);
}

function stopLine(args, stepCosts) {
  console.error(`[stop] the run's reported cost passed $${args.maxUsd.toFixed(2)} (so far $${sumOf(stepCosts).toFixed(4)}); stopping. Raise --max-usd only on purpose.`);
  process.exitCode = 4;
}

function costLine(stepCosts, turn) {
  const reported = stepCosts.filter((c) => typeof c === "number");
  const usd = reported.reduce((a, b) => a + b, 0).toFixed(6);
  const label = turn === undefined ? "" : ` turn=${turn}`;
  if (stepCosts.length > 0 && reported.length === stepCosts.length) {
    return `[cost]${label} usd=${usd} steps=${stepCosts.length}`;
  }
  return `[cost]${label === "" ? "" : label} unknown steps=${stepCosts.length} reported=${reported.length} usd=${usd}`;
}

/** § 1.1: the UI's step count must equal the costs recorded for the turn. */
function checkSteps(turn, ui, cost, emitTrace) {
  if (emitTrace && ui !== cost) emitTrace(`[trace] WARN steps ui=${ui} cost=${cost}`);
}

function reportTurn(turn) {
  // gate/error parts logged from the final snapshot only, each once.
  // A turn that ended on an error (any data-error part, e.g. a provider
  // failure or the step cap) exits 3 — never 0, so a caller can't
  // read an errored turn as a finished one. A gate is a legitimate end of
  // a turn (the model asked for a yes) and keeps exit 0.
  let errored = false;
  for (const part of turn.lastMessage?.parts ?? []) {
    if (part.type === "data-gate") {
      console.error(`[gate] ${part.data.gateLine}`);
    } else if (part.type === "data-error") {
      errored = true;
      console.error(`[error] ${part.data.code}: ${part.data.message}`);
    }
  }
  if (errored && !process.exitCode) process.exitCode = 3;
}

async function runTurns(coach, deps, args, turns, ctx) {
  const fixtures = path.resolve(args.fixtures ?? path.dirname(path.resolve(args.turns)));
  const history = [];
  for (let t = 1; t <= turns.length; t++) {
    const spec = turns[t - 1];
    ctx.newTurn();
    const parts = [{ type: "text", text: spec.text }];
    if (spec.attach) {
      // The site's attach path: upload to documents/<name>, then the same
      // `file` part the composer sends (RealChatShell doSendMessage).
      const name = path.basename(spec.attach);
      const bytes = new Uint8Array(fs.readFileSync(path.join(fixtures, spec.attach)));
      await deps.workspace.upload(`documents/${name}`, bytes);
      parts.push({
        type: "file",
        mediaType: name.toLowerCase().endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf",
        filename: name,
        url: `workspace:documents/${name}`,
      });
    }
    history.push({ id: `u${t}`, role: "user", parts, metadata: { origin: "typed" } });
    const turn = await streamTurn(coach, args.chatId, history, { turn: t, emitTrace: ctx.emitTrace, signal: ctx.signal });
    reportTurn(turn);
    const costs = ctx.turnCosts();
    checkSteps(t, turn.uiSteps, costs.length, ctx.emitTrace);
    console.error(costLine(costs, t));
    process.stdout.write(`=== turn ${t} ===\n${turn.text}\n`);
    if (ctx.overBudget()) {
      stopLine(args, ctx.stepCosts);
      return;
    }
    if (turn.lastMessage) history.push(turn.lastMessage);
  }
}

async function streamTurn(coach, chatId, messages, { turn, emitTrace, signal }) {
  const stream = coach.stream({ chatId, messages, abortSignal: signal });
  const tracer = emitTrace ? createTracer({ turn, emit: emitTrace }) : null;

  // M10 (fix round 1): readUIMessageStream yields a GROWING snapshot of
  // the message on every chunk — printing straight from each snapshot
  // prints the same growing text over and over. Diagnostics (stderr) are
  // logged once per part id/toolCallId as they first appear; the reply
  // TEXT itself is printed exactly once, from the FINAL snapshot, after
  // the stream ends.
  const loggedToolIds = new Set();
  const loggedCardIds = new Set();
  let lastMessage = null;
  for await (const message of readUIMessageStream({ stream })) {
    lastMessage = message;
    tracer?.update(message);
    for (const part of message.parts ?? []) {
      if (part.type?.startsWith("tool-") && part.toolCallId && !loggedToolIds.has(part.toolCallId) && (part.state === "output-available" || part.state === "output-error")) {
        loggedToolIds.add(part.toolCallId);
        console.error(`[ran] ${part.type.slice("tool-".length)} (${part.state})`);
      } else if (part.type === "data-card") {
        const key = `${part.data.card}:${part.data.ref ?? ""}:${JSON.stringify(part.data.props)}`;
        if (!loggedCardIds.has(key)) {
          loggedCardIds.add(key);
          console.error(`[card] ${part.data.card}${part.data.ref ? " ref=" + part.data.ref : ""}`);
        }
      }
    }
  }
  const uiSteps = tracer ? tracer.finish(lastMessage) : 0;

  const text = (lastMessage?.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
  return { lastMessage, text, uiSteps };
}

main().catch((err) => {
  console.error("run.mjs failed:", err?.message ?? err);
  process.exitCode = 1;
});
