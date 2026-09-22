# Spike 1 — AI SDK + OpenRouter provider in the browser

**Code:** `spikes/1-browser-loop/` · **Date:** 2026-09-22, reworked twice
same day after `docs/reviews/step1-review.md` B11 and
`docs/reviews/step1-rereview.md` S6/NIT-6 · **Node:** v25.6.0, npm 11.8.0

**Versions:** `ai@7.0.111`, `@openrouter/ai-sdk-provider@3.1.0`, `vite@8.3.0`,
`playwright@1.63.0`. No `OPENROUTER_API_KEY` in this environment
(`echo ${OPENROUTER_API_KEY:+yes}` → empty, re-checked after every rework).

Line-number citations to `docs/design-web-agent.md` below are avoided in
favor of section names (`§ 6.1`, `§ 8`, "Step-1 spikes") — NIT-6 in the
re-review flagged that two such citations here had already gone stale as
the contract doc was edited. Section names move less.

## Rework history

1. **First pass:** mock, non-streaming tool loop (`generateText`);
   provider constructed but no request issued; key read at build time;
   stale model id (`claude-3.5-sonnet`).
2. **B11 rework:** added a real streaming loop (`streamText` + a
   streaming mock model), an actually-issued and intercepted HTTP
   request, runtime-only key reads, and the current model id
   (`anthropic/claude-sonnet-5`). Left open per S6: the request had no
   provider routing filter, and the UI message stream conversion
   (`toUIMessageStream`) was never exercised.
3. **S6 rework (this pass):** closed both remaining keyless gaps —
   the no-data-kept provider filter now appears in the intercepted
   request body, and the loop's result is run through the AI SDK's own
   `toUIMessageStream`/`createUIMessageStream` conversion with the
   resulting message's parts asserted against the contract's § 6.1
   kinds.

## Pass criteria and results

| # | Criterion | Result |
|---|---|---|
| 1 | STREAMING — tool loop via `streamText` + a streaming mock model, real Chromium, chunks arrive in order (asserted from the DOM) | **PASS** |
| 2 | REQUEST BUILT — fetch intercepted, OpenRouter provider actually issues an HTTP request for a Claude model + one tool; URL, method, JSON body (model/messages/tools/stream:true), and a runtime-sourced Authorization header all asserted; canned streamed response, no key needed | **PASS** |
| 3 | PROVIDER FILTER — the intercepted request body carries the contract's no-data-kept routing constraints, using the exact field names from the installed `@openrouter/ai-sdk-provider` types | **PASS** |
| 4 | UI MESSAGE STREAM — the loop's result converted via `toUIMessageStream`/`createUIMessageStream`, reconstructed message parts match the contract's § 6.1 kinds (`text`, `tool-<name>`, one code-written `data-card`) | **PASS** |
| 5 | KEY NOT BAKED — key read at runtime, not build time; `dist/` grepped for secret values and the build-time env mechanism | **PASS** |
| 6 | Model id is a current Claude Sonnet slug | **PASS** — `anthropic/claude-sonnet-5`, verified 2026-09-22 |
| 7 | Multi-step tool loop, entirely in the page (original criterion, kept) | **PASS** |
| 8 | Real streamed call + a Claude model + a tool + cache read on turn 2, IF a key exists | **BLOCKED** — no `OPENROUTER_API_KEY` in this environment |
| 9 | Verified in a real headless browser (Playwright), results read from the DOM | **PASS** |

## Commands and real output (this pass, S6 rework)

Build (no node polyfills configured in `vite.config.ts` — a Node-only
import anywhere in the OpenRouter provider chain would fail this step):

```
$ rm -rf dist && npx vite build
✓ 115 modules transformed.
dist/index.html                  0.60 kB │ gzip:   0.31 kB
dist/assets/index-CJvgHyC5.js  468.90 kB │ gzip: 124.12 kB
✓ built in 171ms
```

Playwright verification (`node verify.mjs` — loads `dist/` via a plain
static file server; a fresh random key is generated in this Node process
and injected into the page with `page.addInitScript`, which runs before
any bundled script):

```
DOM #done: {
  text: 'done mock=true stream=true provider=true request=true uiStream=true real=blocked',
  mockPass: 'true', streamPass: 'true', providerPass: 'true',
  requestPass: 'true', uiStreamPass: 'true', real: 'blocked'
}
DOM #result-mock: PASS {"steps":3,"toolCallsExecuted":["lookupOrder(A100)","notifyCustomer(Your order A100 shipped, ETA 2026-09-25)"],"finalText":"Done — order A100 is shipped and the customer was notified."}
DOM #result-stream: PASS {"order":["start","start-step","text-start","text-delta:Order A100 ","text-delta:is shipped, ","text-delta:ETA 2026-09-25.","text-end","finish-step","finish"],"finalText":"Order A100 is shipped, ETA 2026-09-25."}
DOM #result-provider: PASS provider+model constructed, modelId=anthropic/claude-sonnet-5
DOM #result-request: PASS {"checks":{"url":true,"method":true,"model":true,"messages":true,"hasTool":true,"stream":true,"authFromRuntime":true,"providerDataCollectionDeny":true,"providerZdr":true},"url":"https://openrouter.ai/api/v1/chat/completions","method":"POST","body":{"model":"anthropic/claude-sonnet-5","messages":[{"role":"user","content":"call the echo tool with 'A100'"}],"provider":{"data_collection":"deny","zdr":true},"tools":[{"type":"function","function":{"name":"echoTool","description":"Echo a string back","parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}}],"tool_choice":"auto","stream":true}}
DOM #result-ui-stream: PASS {"checks":{"hasText":true,"hasToolPart":true,"hasDataCard":true,"dataCardFromCode":true,"modelNeverEmittedCard":true},"partTypes":["data-card","step-start","text","tool-echoTool"]}
DOM #result-real: BLOCKED needs OPENROUTER_API_KEY (none supplied at runtime)
KEY NOT BAKED grep: clean — no secret value and no build-time env mechanism
found in dist/ (the library's own OPENROUTER_API_KEY env-var-NAME
fallback string is present, which is expected and holds no value)
VERIFY PASS
```

`npx playwright install chromium` worked in this environment, so the
`npm run preview` fallback wasn't needed (still wired up as a script).

## Item 3 — the provider filter

`docs/design-web-agent.md` names it as the "spike-4 provider filter" (§ 1)
and "no-data-kept" (the plan's Risks section) but doesn't itself spell out
the OpenRouter field names — those come from the installed
`@openrouter/ai-sdk-provider`'s own types
(`node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts`):

```ts
provider?: {
  data_collection?: DataCollection; // 'deny' | 'allow' | (string & {})
  zdr?: boolean;                    // restrict routing to only Zero Data Retention endpoints
  // ...
}
```

Passed as `openrouter.chat(modelId, { provider: { data_collection: "deny", zdr: true } })`,
confirmed (direct Node probe, before wiring into the page) to serialize
verbatim into the outgoing JSON body's top-level `provider` object:

```
{"model":"anthropic/claude-sonnet-5","messages":[{"role":"user","content":"hi"}],"provider":{"data_collection":"deny","zdr":true},"stream":true}
```

`spikes/1-browser-loop/src/main.ts`'s `runRequestBuilt()` now builds the
model with this filter and asserts `body.provider.data_collection ===
"deny"` and `body.provider.zdr === true` on the intercepted request — see
`DOM #result-request` above (`providerDataCollectionDeny: true,
providerZdr: true`).

## Item 4 — the UI message stream

The loop's `streamText` result is converted with the SDK's own
`toUIMessageStream()`, merged into a `createUIMessageStream()` writer,
alongside one `data-card` part written directly by `writer.write(...)` —
i.e. by code, never by the model (the contract's § 6.2 rule: "the model
never writes a card"). The resulting chunk stream is reconstructed back
into a `UIMessage` with `readUIMessageStream()`, and the final message's
`parts` are checked against the contract's § 6.1 kinds:

- `text` — present (from the model's own text chunks)
- `tool-<name>` — present as `tool-echoTool` (the SDK's own naming: the
  tool's key in the `tools` map, prefixed `tool-`)
- `data-card` — present, and its `data.card`/`data.ref` match exactly what
  the `writer.write()` call passed, not anything the mock model's own
  chunk script contained (`modelChunks` in `main.ts` has no `data-card`
  entry — checked directly, see `modelNeverEmittedCard` in the result
  above)

`spikes/1-browser-loop/src/main.ts`'s `runUiMessageStream()` is the new
function; `#result-ui-stream`'s `partTypes` in the output above is the
literal reconstructed part-type list: `["data-card","step-start","text","tool-echoTool"]`
(`step-start` is the SDK's own wrapper part, not one of the contract's
three kinds, and is not asserted against).

### On the "KEY NOT BAKED" grep

The first grep attempt (B11 rework) flagged the literal substring
`OPENROUTER_API_KEY` in `dist/`. Inspecting the match showed it's
`@openrouter/ai-sdk-provider`'s own Node-side fallback lookup
(`loadApiKey({..., environmentVariableName: "OPENROUTER_API_KEY", ...})`)
— the env var's *name*, used as a label, with no value attached; the
browser has no `process.env` to read it from anyway. The check now looks
for (a) this run's actual secret *values* and (b) the build-time
mechanism that would bake a value in (`VITE_OPENROUTER_API_KEY`,
`import.meta.env`) — both confirmed absent. `src/runtime-key.ts` reads
`window.__OPENROUTER_RUNTIME_KEY__` / `window.__OPENROUTER_REAL_KEY__`,
set only by the test harness (or, in a real deployment, by whatever page
code the candidate's own key flows through after sign-in) after the
bundle has already loaded.

## Surprises

- **`LanguageModelV4FinishReason` is `{ unified, raw }`, not a bare
  string**, in `ai@7.0.111`. This cost the most debugging time and
  affects both the generate and stream paths (`{type:"finish",
  finishReason:{unified,raw}, ...}` in stream chunks too).
- `MockLanguageModelV4.doStream` + `simulateReadableStream` (from `ai`,
  not `ai/test`) is exactly the "stream simulation helper for tests" the
  v7 docs describe — feeding it an array of `LanguageModelV4StreamPart`
  chunks (`text-start` → `text-delta`* → `text-end` → `finish`, or
  `tool-input-start` → `tool-input-delta`* → `tool-input-end` →
  `tool-call` → `finish` for a tool call) reproduces a real provider's
  stream shape closely enough that both `streamText`'s `fullStream`
  iterator and `toUIMessageStream` see the same part sequence a real
  model would produce.
- Building the canned OpenRouter response required matching its **real**
  OpenAI-compatible SSE wire format (`data: {"choices":[{"delta":
  {"content":"..."}}]}`, terminated by `data: [DONE]`) — reverse-checked
  against `OpenRouterStreamChatCompletionChunkSchema` in the installed
  package's `dist/index.js`, not guessed. Once that shape was right, the
  provider's own real streaming parser ran unmodified against the canned
  body — nothing about the provider was mocked, only the network.
- The intercepted request confirmed the exact wire contract: `POST
  https://openrouter.ai/api/v1/chat/completions`, JSON body
  `{model, messages, provider, tools: [{type:"function",
  function:{name, description, parameters}}], tool_choice:"auto",
  stream:true}`. This is the shape `packages/agent`'s tool and model
  setup need to target.
- `toUIMessageStream` needs no extra work to carry tool-call parts
  through correctly — the same `tools` map passed to `streamText` handed
  again to `toUIMessageStream({ stream, tools })` is enough for it to
  resolve `tool-input-*` chunks into the named `tool-<name>` UI part.
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

## What's still out of scope

- The turn-2 cache-read sub-criterion (#8) is **still BLOCKED** — needs a
  real `OPENROUTER_API_KEY`. `runRealCallIfKeyed()` already reads the key
  from `getRuntimeRealKey()` (runtime, not build-time) and needs no
  further code change to run for real; `verify.mjs` already forwards
  `process.env.OPENROUTER_API_KEY` into the page at runtime if present.
- The `web_search` annotation check (§ 1's `web_search` tool note) needs a
  real streamed call, same as #8 — it is explicitly grouped with the
  BLOCKED items in the contract's own "Step-1 spikes" status note, not a
  keyless gap.

## What it means for the design

- The loop-in-the-browser architecture (plan decision #2) holds under a
  stronger bar than the first pass proved: streaming, tool calls, a
  provider-filtered and actually-issued request with the right wire
  shape, and the UI-message-stream conversion the contract's chat
  transport (§ 6) depends on all work with zero Node polyfills.
- `packages/agent`'s test suite (step 4) should reuse this spike's canned
  SSE builder (`src/canned-sse.ts`) as the seed for a shared streaming-mock
  helper, and must pin the `{unified, raw}` finish-reason shape in any
  fixtures it writes.
- **Runtime-key pattern**: `packages/agent`'s `Deps` (per `design-web-agent.md`)
  should take the OpenRouter key as an injected value, never read it via
  a bundler env substitution — this spike's `getRuntimeInterceptKey`/
  `getRuntimeRealKey` split (dummy-for-tests vs real-for-live) is a
  concrete pattern step 4 can copy directly.
- **Provider-filter pattern**: the entry point that builds `deps.model`
  (§ 1) should pass `{ provider: { data_collection: "deny", zdr: true } }`
  to `openrouter.chat(...)` exactly as this spike does — confirmed to
  land in the request body under those exact field names.
- **Card-source pattern**: `createUIMessageStream` + `writer.merge(toUIMessageStream(...))`
  + a separate `writer.write({type:"data-card", ...})` call is a working,
  provable shape for § 6.2's "the model never writes a card" rule — step
  4's real card builder (the table in § 6.2) can sit exactly where this
  spike's `writer.write()` call is, run from tool results rather than a
  hand-written fixture.
- Item #8 (real call + cache read) is the one piece of spike 1 that
  cannot be closed without a key. Everything else flagged across both
  reviews is now closed.

## Note on spike 2 (per the review's S12/dispatch flag)

Unchanged from the previous rework — noted here for the record, not
re-verified this pass. `spikes/2-just-bash/src/command.mjs` dispatches on
the **exact literal path** `skills/coach/scripts/check_closeout.py`
(`PORTED_SCRIPT_PATH`), not on the script's **file name**
(`check_closeout.py`) regardless of the relative prefix used to reach it.
The contract's dispatch rule (`design-web-agent.md` "Staged loading",
step 3 note: "file-name dispatch") is file-name-based because skills call
scripts with varying relative forms (`scripts/…`, `../profile/scripts/…`).
Spike 2 as built proves the dispatch *mechanism* and in-memory FS sharing,
not the file-name-matching rule the contract specifies — see
`docs/spikes/spike-2-just-bash-commands.md` for the added note; a fix (if
O doesn't explicitly accept path-based dispatch) is a small change to
`command.mjs`'s match condition, left to whoever owns spike 2 or step 3.
