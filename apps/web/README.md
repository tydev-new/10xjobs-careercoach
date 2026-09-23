# apps/web — mock preview UI

**This is a mock preview, not wired to any model.** It replays the fixture
conversations in `fixtures/*.json` through a `MockChatTransport` (the AI
SDK's own `ChatTransport` interface) so the owner can see the layout, the
avatar states, the cards, and the gate protocol before any real agent is
wired in (`docs/plan-portable-skills-and-web-agent.md` step 5a). No network
call is made, no API key is read, and no real candidate data is used —
every fixture is an invented persona.

## Run it

```bash
cd apps/web
npm install
npm run dev
```

Opens on **http://localhost:5173**. Pick a fixture from the "Preview:
fixture" dropdown in the header, then either type the fixture's own
messages yourself or click **Autoplay** to have it type them for you.
Autoplay stops on its own the moment a gate opens — it never types the
fixture's own "yes" for you (rule 7); type `yes` yourself to approve the
spend gate — there is no approve button.

The fixture picker and Autoplay button are **dev/preview-only controls**:
visible under `npm run dev` (`import.meta.env.DEV`) and under
`npm run build:preview` (sets `VITE_SHOW_MOCK_CONTROLS=1`), **absent from
the default `npm run build`** — see `src/components/Header.tsx`'s
`SHOW_MOCK_CONTROLS`. There is no committed `.env`; the flag is opt-in per
build, not a repo default.

## Other scripts

```bash
npm run build         # tsc --noEmit + vite build -> dist/ — the real
                       # production bundle: no fixture picker, no Autoplay
npm run build:preview # same, with VITE_SHOW_MOCK_CONTROLS=1 — for trying
                       # the mock controls against a built (not dev) bundle
npm run preview        # serves dist/ on http://localhost:4173
npm test               # node --test — this package's own unit tests (pure
                        # helpers + the mock transport), no DOM, no browser
npm run verify:screens [dir]
                       # Playwright: plays mvp-journey and gate-moment end
                       # to end against a built preview server, asserts the
                       # cards render, the gate has no button, and the
                       # "Print / Save as PDF" iframe blocks an injected
                       # <script>; saves screenshots to [dir] (arg) or
                       # $SCREENSHOT_DIR or the gitignored
                       # apps/web/.local/screenshots/ by default
```

### The independent tester's suite (`tests/web/`)

Owned by the tester, not this package — don't edit it. Run from the repo
root:

```bash
node --test tests/web/*.test.ts          # pure helpers, mock transport,
                                          # fixture/card-table conformance
(cd apps/web && VITE_SHOW_MOCK_CONTROLS=1 npx vite build --outDir /tmp/web-e2e \
  && npx vite preview --outDir /tmp/web-e2e --port 4311 --strictPort) &
node tests/web/e2e.mjs http://localhost:4311/
```

`python3 tests/run.py` (repo root) also runs `node --test tests/web/*.test.ts`
as one more unit in its own pass/fail count — skipping loudly (a printed
`SKIPPED` line, not silence) if `node` isn't on `PATH`. It does not run
`tests/web/e2e.mjs` (a Playwright script, not a `node --test` suite — run
it separately, as above, against a built preview server).

## What's here

- `src/agent-helpers.ts` — `matchGateReply`, `statusOf`, `parsePlanTodo`,
  pure functions per `docs/design-web-agent.md` § 3/§ 6.1/§ 6.2.
  `parsePlanTodo` accepts a "To do" heading with a trailing count
  ("To do (2)"), normalizes CRLF, and its `ref` is the first backticked
  span that contains "/" or ends in a file extension (never just the
  first backticked span — a line can quote a non-path word first). No
  window/document/localStorage/Node-only API.
- `src/mock-transport.ts` — `MockChatTransport`, § 6.1's "Mock replay" in
  full:
  - Outside a pending gate: content-addressed replay (a reply's text is
    looked up against the fixture's own remaining user messages, not a
    position counter that can drift) — a match replays that scripted turn.
  - At a pending gate: a reply that equals the fixture's own **next**
    scripted user message (not a free search) replays that scripted turn
    verbatim (e.g. `gate-moment.json`'s `m3` replays `m4`'s richer
    non-approval content, never a canned line); a typed exact "yes" jumps
    to the turn after the fixture's own scripted "yes" (found by
    searching, so it's correct no matter how many off-script replies came
    first); a decline word (no/don't/cancel/stop) declines; anything else
    gets the one fixed pending line and does not move the read position.
  - A gate's status leaves "pending" **exactly once**: once a gate has
    resolved, a later reply is never allowed to replay that gate's own
    resolution turn again (which would silently re-emit a status) — it's
    treated as an ordinary off-script message about that resolved gate
    instead, built only from the gate's own already-on-screen `label`.
- `src/store.ts` — `FixtureStore`, a `WorkspaceStore` (`docs/design-web-agent.md`
  § 2: async `read` -> `FileRead`, `list`, `write`, `upload`) backed by a
  fixture's `files`. The UI never reads a fixture's `files` directly — only
  through this store. Also exposes a mock-preview-only
  `startingBalanceUsd()`: the fixture's own explicit `meta.startingBalanceUsd`
  if it has one, else `undefined` ("unknown" — the header chip shows "—").
  A workspace having **no files does not mean $0** (`gate-moment.json` has
  `files: {}` mid-conversation, not a new account) — only an explicit
  `meta.startingBalanceUsd` (currently just `empty-first-run.json`, `0`)
  ever produces a number here.
- `src/format.ts` — `formatUsd`: at least 2 decimals, never rounds one off
  (keeps whichever is longer — 2, or the number's own).
- `src/ChatShell.tsx`, `src/App.tsx` — wiring: `useChat` +
  `MockChatTransport`, the fixture picker, Autoplay, theme toggle.
  The first-run greeting shows only when the **store** is empty
  (`store.list()` returns nothing) *and* no messages exist yet — not
  merely an empty chat on a fixture whose workspace already has files.
- `src/components/` — Header/Avatar, Transcript, ToolRun (the collapsed
  "ran …" line), Cards (verdict/plan/document/checker/cost — verdict
  labels are `eval.md`'s own tier names; the cost card shows
  `estimate_cost`'s numbers via `formatUsd`, never widened or rounded
  down), GateCard, ErrorPart (each line states only what happened or what
  the candidate can do — never a promise of what the agent itself will do
  next), Composer, SidePanel ("Print / Save as PDF" opens the sandboxed
  iframe and calls its own `print()`; sandboxed
  `allow-same-origin allow-modals`, deliberately **no** `allow-scripts` —
  see the code comment in `SidePanel.tsx` — and every `.html` file's own
  content gets a Content-Security-Policy `<meta>` prepended,
  `default-src 'none'; style-src 'unsafe-inline'; img-src data:`, so a
  hostile `<img src="https://...">` beacon can't be fetched either),
  MarkdownView (a small dependency-free renderer for `.md` in the panel).
- `fixtures/*.json` — not owned by this slice; see
  `docs/design-web-ui.md` § 4 and `docs/design-web-agent.md` § 6.1. Only
  edit made here: `empty-first-run.json`'s `meta` gained
  `"startingBalanceUsd": 0`, matching what its own `description` already
  said in prose ("the $0 starting balance").

## Known gaps / open questions for the lead

- **N3's hostile-`<img>` beacon: genuinely blocked, but Playwright's
  `request` event still fires for it.** Confirmed directly (see below):
  the CSP `<meta>` does block the fetch — Chromium logs `"Loading the
  image '...' violates ... img-src data:. The action has been blocked."`
  and the request finishes as `requestfailed` with `errorText: "csp"` —
  but Chromium's DevTools Network domain reports `Network.requestWillBeSent`
  (which is what Playwright's `page.on("request")` surfaces, and what
  `tests/web/e2e.mjs`'s "makes no external request" check is built on)
  *before* CSP intervenes, for every resource load, blocked or not.
  There's no sandbox/CSP combination that stops that specific DevTools
  event from firing — it isn't a signal CSP is designed to suppress.
  Everything else in that test passes (no script executes, no
  `postMessage`, no navigation, no popup, still one page). Proof, run
  against a plain `sandbox="allow-same-origin allow-modals"` iframe with
  the same CSP `<meta>` this package uses:
  ```
  requests: [ 'https://tracker.example.invalid/pixel3.png' ]
  failed: [ [ 'https://tracker.example.invalid/pixel3.png', 'csp' ] ]
  console: [ `Loading the image 'https://tracker.example.invalid/pixel3.png' violates
    the following Content Security Policy directive: "img-src data:". The action has
    been blocked.` ]
  ```
  Suggest the test check `requestfailed` with a `csp`-shaped
  `errorText`/blocked-reason instead of the plain absence of a `request`
  event.
- **PDF page count.** Per `docs/design-web-ui.md` § 2.3, no page count is
  ever shown (UNVERIFIED in the browser print layout).
- **Composer `/` skill picker and attach button** are visually present
  (per the wireframe) but inert — the design doc marks the skill picker
  optional ("plain language always works", rule 18), and there's no real
  upload target in a mock preview.
