# Spike 1 — AI SDK + OpenRouter provider in the browser

**Code:** `spikes/1-browser-loop/` · **Date:** 2026-09-22, reworked same day
after `docs/reviews/step1-review.md` B11 · **Node:** v25.6.0, npm 11.8.0

**Versions:** `ai@7.0.111`, `@openrouter/ai-sdk-provider@3.1.0`, `vite@8.3.0`,
`playwright@1.63.0`. No `OPENROUTER_API_KEY` in this environment
(`echo ${OPENROUTER_API_KEY:+yes}` → empty, re-checked after rework).

## Rework note (B11)

The first pass of this spike used `generateText` (non-streaming) for the
tool loop and never issued or intercepted a real HTTP request — B11 was
right that this doesn't meet the plan's own criterion (plan:83-85: "it
**streams**, calls tools in a loop, and a **cache read shows up on turn
2**"). This version adds a genuinely streaming loop and a genuinely
issued (fetch-intercepted) HTTP request, reads all keys at runtime, and
uses the current Claude Sonnet slug. The turn-2 cache read stays BLOCKED —
it needs a real key, which this environment does not have.

## Pass criteria and results

| # | Criterion | Result |
|---|---|---|
| 1 | STREAMING — tool loop via `streamText` + a streaming mock model, real Chromium, chunks arrive in order (asserted from the DOM) | **PASS** |
| 2 | REQUEST BUILT — fetch intercepted, OpenRouter provider actually issues an HTTP request for a Claude model + one tool; URL, method, JSON body (model/messages/tools/stream:true), and a runtime-sourced Authorization header all asserted; canned streamed response, no key needed | **PASS** |
| 3 | KEY NOT BAKED — key read at runtime, not build time; `dist/` grepped for secret values and the build-time env mechanism | **PASS** |
| 4 | Model id is a current Claude Sonnet slug | **PASS** — `anthropic/claude-sonnet-5`, verified 2026-09-22 |
| 5 | Multi-step tool loop, entirely in the page (original criterion, kept) | **PASS** |
| 6 | Real streamed call + a Claude model + a tool + cache read on turn 2, IF a key exists | **BLOCKED** — no `OPENROUTER_API_KEY` in this environment |
| 7 | Verified in a real headless browser (Playwright), results read from the DOM | **PASS** |

## Commands and real output

Build (no node polyfills configured in `vite.config.ts` — a Node-only
import anywhere in the OpenRouter provider chain would fail this step):

```
$ npx vite build
✓ 115 modules transformed.
dist/index.html                  0.56 kB │ gzip:   0.30 kB
dist/assets/index-DVSpF8Lj.js  465.53 kB │ gzip: 123.10 kB
✓ built in 133ms
```

Playwright verification (`node verify.mjs` — loads `dist/` via a plain
static file server; a fresh random key is generated in this Node process
and injected into the page with `page.addInitScript`, which runs before
any bundled script):

```
DOM #done: {
  text: 'done mock=true stream=true provider=true request=true real=blocked',
  mockPass: 'true', streamPass: 'true', providerPass: 'true',
  requestPass: 'true', real: 'blocked'
}
DOM #result-mock: PASS {"steps":3,"toolCallsExecuted":["lookupOrder(A100)","notifyCustomer(Your order A100 shipped, ETA 2026-09-25)"],"finalText":"Done — order A100 is shipped and the customer was notified."}
DOM #result-stream: PASS {"order":["start","start-step","text-start","text-delta:Order A100 ","text-delta:is shipped, ","text-delta:ETA 2026-09-25.","text-end","finish-step","finish"],"finalText":"Order A100 is shipped, ETA 2026-09-25."}
DOM #result-provider: PASS provider+model constructed, modelId=anthropic/claude-sonnet-5
DOM #result-request: PASS {"checks":{"url":true,"method":true,"model":true,"messages":true,"hasTool":true,"stream":true,"authFromRuntime":true},"url":"https://openrouter.ai/api/v1/chat/completions","method":"POST","body":{"model":"anthropic/claude-sonnet-5","messages":[{"role":"user","content":"call the echo tool with 'A100'"}],"tools":[{"type":"function","function":{"name":"echoTool","description":"Echo a string back","parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}}],"tool_choice":"auto","stream":true}}
DOM #result-real: BLOCKED needs OPENROUTER_API_KEY (none supplied at runtime)
KEY NOT BAKED grep: clean — no secret value and no build-time env mechanism
found in dist/ (the library's own OPENROUTER_API_KEY env-var-NAME
fallback string is present, which is expected and holds no value)
VERIFY PASS
```

`npx playwright install chromium` worked in this environment, so the
`npm run preview` fallback wasn't needed (still wired up as a script).

### On the "KEY NOT BAKED" grep

The first grep attempt flagged the literal substring `OPENROUTER_API_KEY`
in `dist/`. Inspecting the match showed it's `@openrouter/ai-sdk-provider`'s
own Node-side fallback lookup (`loadApiKey({..., environmentVariableName:
"OPENROUTER_API_KEY", ...})`) — the env var's *name*, used as a label, with
no value attached; the browser has no `process.env` to read it from
anyway. The check now looks for (a) this run's actual secret *values* and
(b) the build-time mechanism that would bake a value in
(`VITE_OPENROUTER_API_KEY`, `import.meta.env`) — both confirmed absent.
`import.meta.env` and `VITE_OPENROUTER_API_KEY` do not appear anywhere in
`dist/` (`grep -c` → 0 for both), confirming the build-time read
(`main.ts`'s previous `import.meta.env.VITE_OPENROUTER_API_KEY`) is gone;
`src/runtime-key.ts` now reads `window.__OPENROUTER_RUNTIME_KEY__` /
`window.__OPENROUTER_REAL_KEY__`, set only by the test harness (or, in a
real deployment, by whatever page code the candidate's own key flows
through after sign-in) after the bundle has already loaded.

## Surprises

- **`LanguageModelV4FinishReason` is `{ unified, raw }`, not a bare
  string**, in `ai@7.0.111` — see "Surprises" from the first pass; this
  cost the most debugging time and affects both the generate and stream
  paths (`{type:"finish", finishReason:{unified,raw}, ...}` in stream
  chunks too).
- `MockLanguageModelV4.doStream` + `simulateReadableStream` (from `ai`,
  not `ai/test`) is exactly the "stream simulation helper for tests" the
  v7 docs describe — feeding it an array of `LanguageModelV4StreamPart`
  chunks (`text-start` → `text-delta`* → `text-end` → `finish`) reproduces
  a real provider's stream shape closely enough that `streamText`'s
  `fullStream` iterator sees the same part sequence a real model would
  produce (plus SDK-inserted `start`/`start-step`/`finish-step` wrapper
  parts).
- Building the canned OpenRouter response required matching its **real**
  OpenAI-compatible SSE wire format (`data: {"choices":[{"delta":
  {"content":"..."}}]}`, terminated by `data: [DONE]`) — reverse-checked
  against `OpenRouterStreamChatCompletionChunkSchema` in the installed
  package's `dist/index.js`, not guessed. Once that shape was right, the
  provider's own real streaming parser ran unmodified against the canned
  body — nothing about the provider was mocked, only the network.
- The intercepted request confirmed the exact wire contract: `POST
  https://openrouter.ai/api/v1/chat/completions`, JSON body
  `{model, messages, tools: [{type:"function", function:{name,
  description, parameters}}], tool_choice:"auto", stream:true}`, header
  `Authorization: Bearer <the runtime key>`. This is the shape
  `packages/agent`'s tool definitions need to target.
- The OpenRouter provider constructed and (once intercepted) issued its
  request with zero Node polyfills in the Vite bundle — no `crypto`,
  `buffer`, or `stream` shims pulled in.

## Model id

**PASS, not UNVERIFIED.** `anthropic/claude-sonnet-5` was confirmed
2026-09-22 via two independent fetches of `openrouter.ai/anthropic/claude-sonnet-5`,
both returning the same literal API slug (`"anthropic/claude-sonnet-5"`);
a WebSearch cross-check also lists it as OpenRouter's current top-listed
Claude Sonnet ("Claude Sonnet 5 (Latest) ... released on June 30, 2026").
`claude-3.5-sonnet`, used in the first pass, is stale by several
generations (4, 4.5, 4.6, 5 all postdate it on OpenRouter's own listing).

## What's still out of scope for this rework

- The turn-2 cache-read sub-criterion is **still BLOCKED** — needs a real
  `OPENROUTER_API_KEY`. `runRealCallIfKeyed()` already reads the key from
  `getRuntimeRealKey()` (runtime, not build-time) and needs no further
  code change to run for real; `verify.mjs` already forwards
  `process.env.OPENROUTER_API_KEY` into the page at runtime if present.
- The `web_search` annotation check the contract doc (`design-web-agent.md`
  C:540-541) asks for is a contract/design concern, not one of the plan's
  own step-1 spike-1 criteria (plan:83-85) — left to the architect's
  contract rework, not touched here.
- The AI SDK's UI-message-stream layer (`toUIMessageStream`/`UIMessageChunk`),
  which `packages/agent` § 6 will sit on top of, is exercised only
  indirectly (`fullStream` is one layer below it). Proving the UI-message
  conversion itself is step 4/5a work, not a spike-1 criterion.

## What it means for the design

- The loop-in-the-browser architecture (plan decision #2) holds under a
  stronger bar than the first pass proved: streaming, tool calls, and an
  actually-issued request with the right wire shape all work with zero
  Node polyfills.
- `packages/agent`'s test suite (step 4) should reuse this spike's canned
  SSE builder (`src/canned-sse.ts`) as the seed for a shared streaming-mock
  helper, and must pin the `{unified, raw}` finish-reason shape in any
  fixtures it writes.
- **Runtime-key pattern**: `packages/agent`'s `Deps` (per `design-web-agent.md`)
  should take the OpenRouter key as an injected value, never read it via
  a bundler env substitution — this spike's `getRuntimeInterceptKey`/
  `getRuntimeRealKey` split (dummy-for-tests vs real-for-live) is a
  concrete pattern step 4 can copy directly.
- Sub-criterion 6 (real call + cache read) is the one piece of spike 1
  that cannot be closed without a key. Everything else B11 flagged is now
  closed.

## Note on spike 2 (per the review's S12/dispatch flag)

The reviewer's S12 finding (`docs/reviews/step1-review.md`) is about
`spikes/2-just-bash/`, not this spike, and spike 2's code is out of this
rework's scope (`spikes/1-browser-loop/` and `docs/spikes/` only). Noting
it here for the record: `spikes/2-just-bash/src/command.mjs` dispatches on
the **exact literal path** `skills/coach/scripts/check_closeout.py`
(`PORTED_SCRIPT_PATH`), not on the script's **file name**
(`check_closeout.py`) regardless of the relative prefix used to reach it.
The contract's dispatch rule (`design-web-agent.md` C:333-337, per the
review) is file-name-based because skills call scripts with varying
relative forms (`scripts/…`, `../profile/scripts/…`). Spike 2 as built
proves the dispatch *mechanism* and in-memory FS sharing, not the
file-name-matching rule the contract specifies — see
`docs/spikes/spike-2-just-bash-commands.md` for the added note; a fix (if
O doesn't explicitly accept path-based dispatch) is a small change to
`command.mjs`'s match condition, left to whoever owns spike 2 or step 3.
