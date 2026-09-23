# Spike 1 — AI SDK + OpenRouter provider in the browser

**Code:** `spikes/1-browser-loop/` · **Date:** 2026-09-22, reworked three
times — `docs/reviews/step1-review.md` B11, `docs/reviews/step1-rereview.md`
S6/NIT-6, and the 2026-09-23 live-cache fix · **Node:** v25.6.0, npm 11.8.0

**Versions:** `ai@7.0.111`, `@openrouter/ai-sdk-provider@3.1.0`, `vite@8.3.0`,
`playwright@1.63.0`. `OPENROUTER_API_KEY` was **available** for the
2026-09-23 pass (loaded from the repo's git-ignored `.env.local`, never
printed — every command below pipes through
`sed -E 's/sk-or-[A-Za-z0-9_-]+/sk-or-<masked>/g'`, and `verify.mjs` itself
masks any such pattern before logging). All earlier passes ran with no key
in the environment.

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
3. **S6 rework:** closed both remaining keyless gaps — the no-data-kept
   provider filter now appears in the intercepted request body, and the
   loop's result is run through the AI SDK's own
   `toUIMessageStream`/`createUIMessageStream` conversion with the
   resulting message's parts asserted against the contract's § 6.1
   kinds.
4. **Live-cache rework (this pass, 2026-09-23):** the live call now
   passed, but the cache criterion initially failed — both turns showed
   `cacheReadTokens: 0` at 989 input tokens. Two real bugs, both fixed:
   the system prompt was far under Anthropic's ~1,024-token cache
   minimum, and no `cache_control` breakpoint was ever set on the
   request. See "The two real bugs" below.

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
| 8a | Real streamed call + a Claude model + a tool | **PASS** (2026-09-23, real key) |
| 8b | Cache read on turn 2 | **PASS** (2026-09-23) — `cacheReadTokens: 13364` on turn 2; see "Live cache — real output" below |
| 9 | Verified in a real headless browser (Playwright), results read from the DOM | **PASS** |

**Live-call budget:** at most 4 live calls were allowed for this pass,
including any retry. **2 were used** (turn 1 + turn 2, one pair, on the
first attempt — no retry and no ZDR-comparison diagnostic were needed,
because caching worked on the first try with the no-data-kept filter
already on). 2 remained unused.

## Commands and real output — keyless pass (zero live calls)

Build (no node polyfills configured in `vite.config.ts` — a Node-only
import anywhere in the OpenRouter provider chain would fail this step;
this build also proves the four real skill-prose files load at build time
via Vite's `?raw` import):

```
$ rm -rf dist && npx vite build
✓ 119 modules transformed.
dist/index.html                  0.65 kB │ gzip:   0.31 kB
dist/assets/index-D3rM_HRl.js  487.50 kB │ gzip: 132.34 kB
✓ built in 146ms
```

Playwright verification with **no key** (`unset OPENROUTER_API_KEY; node
verify.mjs`) — every keyless criterion, plus the zero-cost prompt-size
sanity check (no network call), before any live call is attempted:

```
DOM #done: {"text":"done mock=true stream=true provider=true request=true uiStream=true real=blocked","mockPass":"true","streamPass":"true","providerPass":"true","requestPass":"true","uiStreamPass":"true","realStatus":"blocked","realCacheReadTurn2":""}
DOM #result-prompt-size: PASS chars=17081 estimatedTokens=4270 (target ~4000-5000, chars/4 estimate)
DOM #result-real: BLOCKED needs OPENROUTER_API_KEY (none supplied at runtime)
KEY NOT BAKED grep: clean — no secret value and no build-time env mechanism found in dist/ (the library's own OPENROUTER_API_KEY env-var-NAME fallback string is present, which is expected and holds no value)
VERIFY PASS
Live cache criterion (informational — not part of VERIFY PASS/FAIL, since it legitimately BLOCKs without a key): status=blocked cacheReadTurn2=
```

`npx playwright install chromium` worked in this environment, so the
`npm run preview` fallback wasn't needed (still wired up as a script).

## Live cache — real output (2026-09-23, real key, masked)

Ran once, with the owner's key loaded from `.env.local` and piped through
the mask (`spikes/1-browser-loop$ (set -a; . ../../.env.local; set +a;
node verify.mjs) 2>&1 | sed -E
's/sk-or-[A-Za-z0-9_-]+/sk-or-<masked>/g'`). The pair (turn 1 + turn 2)
passed on the **first attempt** — 2 of the 4-call budget used, 2 unused,
no retry and no ZDR-off diagnostic needed:

```
DOM #done: {"text":"done mock=true stream=true provider=true request=true uiStream=true real=pass-with-cache", ... "realStatus":"pass-with-cache","realCacheReadTurn2":"13364"}
DOM #result-real: PASS {
  "providerFilter": {"data_collection":"deny","zdr":true},
  "systemPromptEstimatedTokens": 4270,
  "turn1": {"inputTokens":13221,"outputTokens":92,"cacheReadTokens":6571,"cacheWriteTokens":6646,"costUsd":0.0018757},
  "turn2": {"inputTokens":13515,"outputTokens":92,"cacheReadTokens":13364,"cacheWriteTokens":147,"costUsd":0.0019051}
}
KEY NOT BAKED grep: clean — no secret value and no build-time env mechanism found in dist/
VERIFY PASS
Live cache criterion: status=pass-with-cache cacheReadTurn2=13364
```

**Reading it:**
- **Turn 2's `cacheReadTokens: 13364` is the pass** — turn 2 read back
  more than the entire turn-1 prefix (system prompt + tool definitions +
  turn 1's own exchange), at a fraction of turn 1's `cacheWriteTokens: 6646`
  cost for that same content the first time.
- **Turn 1 also shows `cacheReadTokens: 6571`, not 0.** This loop is a
  multi-step tool call (per criterion #7): the model first emits a
  tool-call step, the tool executes, and a second step (tool result →
  final text) follows, both inside the ONE `streamText()` call that is
  "turn 1". `usage` sums both steps. The system prompt + tool schema
  written to cache by the FIRST step is read back by the SECOND step
  milliseconds later, inside the same turn — an artifact of the tool loop,
  not a second live "turn". This is consistent with the plan's own
  criterion wording ("a cache read shows up on **turn 2**"): turn 2 is
  the one that matters, and its read includes turn 1's entire prefix,
  confirming the breakpoint survived across the two separate
  `streamText()` calls, not just within one.
- **Cost:** turn 1 $0.0018757, turn 2 $0.0019051 (from
  `providerMetadata.openrouter.usage.cost`, OpenRouter's own accounting,
  exposed and captured — not required by the criterion but recorded per
  the rework's ask).
- **ZDR did NOT block caching** — an important product finding. The
  `provider: { data_collection: "deny", zdr: true }` filter (item 3 of the
  previous rework) was active on BOTH turns, and prompt caching still
  worked. The concern that a Zero-Data-Retention endpoint might not
  persist a cache write turned out not to apply here, at least for
  `anthropic/claude-sonnet-5` through OpenRouter, on this date. Because
  it worked on the first attempt, the 2 reserved diagnostic calls
  (rerunning the same pair with `zdr` dropped, via `SPIKE1_NO_ZDR=1 node
  verify.mjs`, wired up in `verify.mjs`/`main.ts` but not spent) were not
  used — there was no failure left to isolate.

## The two real bugs (why the first live run failed)

1. **Prompt too small.** The first live pass's whole request (system +
   tools + one short user turn) totaled 989 tokens — under Anthropic's
   ~1,024-token minimum for a cacheable block. Fixed: `SYSTEM_PROMPT` in
   `src/main.ts` now concatenates four REAL skill-prose files (no
   candidate data — these are repo source, not workspace content), loaded
   at build time via Vite's `?raw` import:
   `skills/coach/SKILL.md`, `skills/coach/references/gate-grammar.md`,
   `skills/coach/references/eval.md`, and
   `skills/profile/templates/workspace-CLAUDE.md` (the template the web
   app writes into a new workspace at sign-up, per `design-web-agent.md`
   § 7) — 17,081 characters, an estimated 4,270 tokens (chars/4, a
   standard rough estimate; no tokenizer is bundled for this spike),
   checked with a **zero-cost, no-network** sanity function
   (`runSystemPromptSizeCheck()`) before any live call is attempted.
2. **No cache breakpoint, and the wrong usage field.** Nothing in the
   first pass set a `cache_control` directive, so Anthropic had no
   breakpoint to write to regardless of prompt size. Fixed:
   `openrouter.chat(MODEL_ID, { provider, cache_control: { type:
   "ephemeral" } })` — see "The cache mechanism" below. Separately, the
   first pass's cache check read `usage.cachedInputTokens`, a field that
   does not exist on the AI SDK's `LanguageModelUsage` type (confirmed
   against `node_modules/ai/dist/index.d.ts`); the real field is
   `usage.inputTokenDetails.cacheReadTokens`. Even with a genuine cache
   hit, the old code would have logged `undefined`.

## The cache mechanism that works

`@openrouter/ai-sdk-provider`'s own types
(`node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts`) document a
**top-level** `cache_control` field on `OpenRouterChatSettings`, sibling
to `provider`:

```ts
/**
 * Enable Anthropic automatic prompt caching by setting a top-level
 * cache_control directive on the request body. When set to
 * `{ type: 'ephemeral' }`, Anthropic will automatically cache eligible
 * content in your prompts. Only works with Anthropic models through
 * OpenRouter.
 */
cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
```

Passed as `openrouter.chat(modelId, { provider, cache_control: { type:
"ephemeral" } })`. Confirmed with a **keyless** dry run (dummy key,
intercepted `fetch`, zero cost) that it serializes verbatim into the
request body as a top-level sibling of `messages`:

```
{"model":"anthropic/claude-sonnet-5","messages":[...],"provider":{"data_collection":"deny","zdr":true},"cache_control":{"type":"ephemeral"},"stream":true}
```

No per-message or per-content-block `cache_control` marker was needed —
the single top-level directive was enough for both the within-turn-1
(step 1 → step 2) and the turn-1 → turn-2 cache reads above. `usage`'s
real field path for reading the result:
`usage.inputTokenDetails.{cacheReadTokens,cacheWriteTokens}` (also
provider-facing pass-through under `providerMetadata.openrouter.usage`,
along with `.cost`).

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

- Item #8 (real call + cache read) is now **PASS**, closed this pass.
- The `web_search` annotation check (§ 1's `web_search` tool note) is the
  one remaining item grouped with the BLOCKED items in the contract's own
  "Step-1 spikes" status note. It needs its own live call and tool
  configuration (OpenRouter's `plugins: [{id:"web"}]` or the
  `openrouter:web_search` server tool — the contract itself marks this
  choice `UNVERIFIED`) and was intentionally NOT exercised in this pass to
  stay inside the 4-call budget for the cache fix specifically. It is a
  separate, small follow-up: one more live call, no code already blocks
  it.

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
  (superseded 2026-09-23 by design-web-agent.md § 8: no key reaches the
  browser; the model goes through `ten-model-proxy` with the session JWT)
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
- **Cache pattern**: `packages/agent`'s entry point should pass
  `cache_control: { type: "ephemeral" }` alongside the provider filter on
  every `openrouter.chat(...)` call whenever the system prompt (Tier 0 +
  Tier 1 + tool descriptions, § 7, target ~3,300 words) clears Anthropic's
  ~1,024-token floor — which it will in the real app, since the real
  system prompt is close to what this spike's 4,270-token test prompt
  approximates. Read `usage.inputTokenDetails.cacheReadTokens` /
  `.cacheWriteTokens`, not `usage.cachedInputTokens` (doesn't exist) or
  any Anthropic-SDK-shaped path (this is OpenRouter, not Anthropic
  directly). **Confirmed: the no-data-kept provider filter (`zdr: true`)
  does not prevent Anthropic prompt caching through OpenRouter** — a real
  product-relevant finding, not assumed, measured.
- Every item flagged across all three reviews is now closed. Only the
  `web_search` annotation check (noted above) remains, and it is small
  and independent.

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
