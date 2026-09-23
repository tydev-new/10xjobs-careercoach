#!/usr/bin/env node
// A small headless runner for packages/agent — for step B2 later (the
// B1-simplified skills re-checked on other OpenRouter models) and for
// dogfooding the coach loop outside a browser.
//
//   node bin/run.mjs --workspace <dir> --skills <dir> --model <model-id> \
//     --prompt "<text>" [--chat-id <id>] [--key-env OPENROUTER_API_KEY] \
//     [--balance <usd>]
//
// Refuses to run without an EXPLICIT key env var: the name is always
// named on the command line (--key-env, default OPENROUTER_API_KEY) and
// that named variable must actually be set — no silent fallback, no
// hardcoded key, and the key's VALUE is never printed (only the env var
// NAME appears in any message).
//
// STUBBED pending packages/checkers (a parallel worktree porting the
// real checker scripts to JS): `scripts` is a FakeScriptRunner with no
// canned scripts, so every `python3 ...` command a skill tries will exit
// 127 "not available in the web app: <name>" until the real
// ScriptRunner lands and this line is swapped for it.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { readUIMessageStream } from "ai";
import path from "node:path";

import { createCoach } from "../src/coach.ts";
import { createInMemoryGate } from "../src/gate.ts";
import { createFakeScriptRunner } from "../src/tools/fake-script-runner.ts";
import { createLocalFolderWorkspaceStore } from "../src/workspace/local-folder-store.ts";
import { buildSkillBundleFromDisk } from "../src/skills/skill-bundle-fs.ts";

function parseArgs(argv) {
  const args = { keyEnv: "OPENROUTER_API_KEY", chatId: "run-" + Date.now(), balance: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") args.workspace = argv[++i];
    else if (a === "--skills") args.skills = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--prompt") args.prompt = argv[++i];
    else if (a === "--chat-id") args.chatId = argv[++i];
    else if (a === "--key-env") args.keyEnv = argv[++i];
    else if (a === "--balance") args.balance = Number(argv[++i]);
    else {
      throw new Error(`unrecognized argument: ${a}`);
    }
  }
  for (const required of ["workspace", "skills", "model", "prompt"]) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

/** A provider filter matching the spike-1-proven no-data-kept routing
 *  (docs/spikes/spike-1-browser-loop.md, "Item 3"). */
const NO_DATA_KEPT_PROVIDER_FILTER = { data_collection: "deny", zdr: true };

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`usage error: ${err.message}`);
    console.error(
      "usage: node bin/run.mjs --workspace <dir> --skills <dir> --model <model-id> --prompt \"<text>\" [--chat-id <id>] [--key-env NAME] [--balance <usd>]",
    );
    process.exitCode = 2;
    return;
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

  const workspaceDir = path.resolve(args.workspace);
  const skillsDir = path.resolve(args.skills);

  const [workspace, skills] = await Promise.all([
    Promise.resolve(createLocalFolderWorkspaceStore(workspaceDir)),
    buildSkillBundleFromDisk(skillsDir),
  ]);

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter.chat(args.model, {
    provider: NO_DATA_KEPT_PROVIDER_FILTER,
    cache_control: { type: "ephemeral" },
  });

  const coach = createCoach({
    model,
    workspace,
    skills,
    gate: createInMemoryGate(),
    balance: async () => args.balance,
    fetch: globalThis.fetch,
    clock: { now: () => new Date() },
    scripts: createFakeScriptRunner([]), // STUBBED — see file header.
    logger: {
      info: (e) => console.error("[agent:info]", JSON.stringify(e)),
      warn: (e) => console.error("[agent:warn]", JSON.stringify(e)),
      error: (e) => console.error("[agent:error]", JSON.stringify(e)),
    },
  });

  const stream = coach.stream({
    chatId: args.chatId,
    messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: args.prompt }], metadata: { origin: "typed" } }],
  });

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
  // gate/error parts logged from the final snapshot only, each once.
  for (const part of lastMessage?.parts ?? []) {
    if (part.type === "data-gate") {
      console.error(`[gate] ${part.data.gateLine}`);
    } else if (part.type === "data-error") {
      console.error(`[error] ${part.data.code}: ${part.data.message}`);
    }
  }

  const text = (lastMessage?.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
  process.stdout.write(text);
  process.stdout.write("\n");
}

main().catch((err) => {
  console.error("run.mjs failed:", err?.message ?? err);
  process.exitCode = 1;
});
