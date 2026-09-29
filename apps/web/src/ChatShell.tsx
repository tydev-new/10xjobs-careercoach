import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { latestGateStatuses, statusOf } from "./agent-helpers.ts";
import { Composer } from "./components/Composer";
import { Frame } from "./components/Frame";
import { SidePanel } from "./components/SidePanel";
import { Transcript } from "./components/Transcript";
import type { FixtureEntry } from "./fixtures";
import { MockChatTransport } from "./mock-transport.ts";
import { FixtureStore } from "./store.ts";
import type { AppMessage, DataCardData, DataErrorData, FileRead } from "./types.ts";
import { WorkspaceError } from "./types.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** S2 (docs/reviews/proxy-change-review.md): the chip reads `deps.balance()`
 *  (C § 8), not the latest `cost` card — those were two sources for one
 *  number. In this mock there's no live ledger, so `balance()` (called by
 *  ChatShell below, never derived reactively from `messages` on every
 *  render) has exactly two honest sources, in order:
 *  1. an `over_balance` refusal already on screen means the real balance
 *     is not above 0 right now (design-web-agent.md § 8's own proxy
 *     check) — so the chip shows $0.00, whatever any earlier estimate
 *     said (design-web-ui.md § 2.5/§ 2.7);
 *  2. otherwise the store's own declared balance (its mock stand-in for
 *     the ledger, § 2's `store.balance()`) — never an invented number (L1).
 *  `undefined` means unknown, and the chip renders "—". */
async function readBalance(
  messages: AppMessage[],
  store: FixtureStore
): Promise<number | undefined> {
  const hasOverBalance = messages.some((message) =>
    (message.parts as Array<Record<string, unknown>>).some(
      (part) => part.type === "data-error" && (part.data as DataErrorData).code === "over_balance"
    )
  );
  if (hasOverBalance) return 0;
  return store.balance();
}

function extractText(message: AppMessage): string {
  const p = message.parts.find((part) => part.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return p?.text ?? "";
}

export interface ChatShellProps {
  entry: FixtureEntry;
  fixtures: FixtureEntry[];
  onFixtureChange: (id: string) => void;
  theme: "light" | "dark";
  onThemeToggle: () => void;
}

export function ChatShell({
  entry,
  fixtures,
  onFixtureChange,
  theme,
  onThemeToggle,
}: ChatShellProps): ReactElement {
  const { fixture, id } = entry;
  const transport = useMemo(() => new MockChatTransport(fixture), [fixture]);
  const store = useMemo(() => new FixtureStore(fixture), [fixture]);
  // Stage 3a: a STABLE function identity per `store` — Documents' own
  // effect is keyed on this prop (§ 5.2 rule 4, "reads when it's shown"),
  // so a NEW closure every render would re-list on every keystroke
  // elsewhere in ChatShell, not just when Documents is actually shown.
  const listDocuments = useCallback(() => store.list(), [store]);

  const chat = useChat<AppMessage>({ id, transport, messages: [] });
  const { messages, sendMessage, status } = chat;

  const [composerValue, setComposerValue] = useState("");
  const [autoplay, setAutoplay] = useState(false);
  const [storeEmpty, setStoreEmpty] = useState(false);
  const [openRef, setOpenRef] = useState<string | undefined>(undefined);
  const [openFile, setOpenFile] = useState<FileRead | undefined>(undefined);
  // § 5.2 rule 6, "the file being viewed": a non-missing read() failure —
  // B1 (Stage 3a review). Bumped `openAttempt` re-runs the read effect
  // below (Retry), without a second copy of its logic.
  const [openError, setOpenError] = useState<{ path: string } | undefined>(undefined);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [panelOpenOnPhone, setPanelOpenOnPhone] = useState(false);
  const [balanceUsd, setBalanceUsd] = useState<number | undefined>(undefined);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const currentStatus = statusOf(messages, status);

  // balance() is read at the moments design-web-agent.md § 8 names for the
  // real deps.balance(): once on mount/fixture change, at the end of each
  // turn, and on window focus — never recomputed on every render off
  // `messages` (S2). See readBalance's own comment above.
  const refreshBalance = useCallback(() => {
    void readBalance(messagesRef.current, store).then(setBalanceUsd);
  }, [store]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    if (status === "ready" || status === "error") refreshBalance();
  }, [status, refreshBalance]);

  useEffect(() => {
    window.addEventListener("focus", refreshBalance);
    return () => window.removeEventListener("focus", refreshBalance);
  }, [refreshBalance]);

  // The side panel opens the file the last-emitted card with a ref points
  // at (design-web-ui.md § 1.1). Never reads the fixture directly — only
  // the tool-result stream decides which ref, and the store resolves it.
  useEffect(() => {
    let lastRef: string | undefined;
    for (const message of messages) {
      for (const part of message.parts as Array<Record<string, unknown>>) {
        if (part.type === "data-card") {
          const data = part.data as DataCardData;
          if (data.ref) lastRef = data.ref;
          else if (data.card === "plan") lastRef = "plan.md";
        }
      }
    }
    if (lastRef) setOpenRef(lastRef);
  }, [messages]);

  // N4: the first-run greeting shows only when the STORE is empty
  // (list() returns nothing) and no messages exist yet — not merely an
  // empty chat on a fixture whose workspace already has files (e.g.
  // gate-moment.json's `files: {}` is mid-conversation, not "brand new";
  // checker-failure.json has files and must never claim otherwise).
  useEffect(() => {
    let cancelled = false;
    store.list().then((files) => {
      if (!cancelled) setStoreEmpty(files.length === 0);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  // Resolve openRef through the store (§ 2's async read) whenever it
  // changes — the UI never reads a fixture's `files` directly.
  // B1 (Stage 3a review, § 5.2 rule 6): a `resource_missing` read shows
  // the viewer's ordinary empty state (openFile/openError both clear —
  // "missing is empty"); any OTHER failure is loud (openError set,
  // openFile stays clear — never silently falls back to "Nothing open
  // yet.", which used to happen here for every failure alike).
  useEffect(() => {
    let cancelled = false;
    if (!openRef) {
      setOpenFile(undefined);
      setOpenError(undefined);
      return;
    }
    store
      .read(openRef)
      .then((f) => {
        if (cancelled) return;
        setOpenFile(f);
        setOpenError(undefined);
      })
      .catch((err) => {
        if (cancelled) return;
        setOpenFile(undefined);
        setOpenError(err instanceof WorkspaceError && err.code === "resource_missing" ? undefined : { path: openRef });
      });
    return () => {
      cancelled = true;
    };
  }, [openRef, store, openAttempt]);

  const handleOpen = (ref: string) => {
    setOpenRef(ref);
    setPanelOpenOnPhone(true);
  };

  const retryOpenFile = () => setOpenAttempt((n) => n + 1);

  const handlePrint = (htmlPath: string) => {
    handleOpen(htmlPath);
    // The browser's own print-to-PDF (design-web-ui.md § 2.3) — no page
    // count is claimed (UNVERIFIED).
    setTimeout(() => iframeRef.current?.contentWindow?.print(), 200);
  };

  const send = (text: string) => {
    void sendMessage({ text, metadata: { origin: "typed" } });
  };

  // Autoplay: types the fixture's own user messages for you, one at a
  // time, waiting for the previous turn to finish. It must never be able
  // to approve a gate (rule 7 — no automated "yes"): the moment a turn
  // leaves a gate pending, autoplay stops outright rather than typing the
  // fixture's own next scripted line (which, for a gate fixture, may be
  // exactly "yes").
  useEffect(() => {
    if (!autoplay) return;
    let cancelled = false;
    async function run() {
      const userTexts = fixture.messages.filter((m) => m.role === "user").map(extractText);
      for (const text of userTexts) {
        if (cancelled) break;

        const pendingBefore = [...latestGateStatuses(messagesRef.current).values()].some(
          (v) => v.status === "pending"
        );
        if (pendingBefore) break; // never type into an open gate

        for (let i = 1; i <= text.length; i++) {
          if (cancelled) return;
          setComposerValue(text.slice(0, i));
          await sleep(12);
        }
        await sleep(200);
        if (cancelled) return;
        setComposerValue("");
        await sendMessage({ text, metadata: { origin: "typed" } });
        while (
          !cancelled &&
          (statusRef.current === "submitted" || statusRef.current === "streaming")
        ) {
          await sleep(50);
        }
        await sleep(250);

        const pendingAfter = [...latestGateStatuses(messagesRef.current).values()].some(
          (v) => v.status === "pending"
        );
        if (pendingAfter) break; // stop at the open gate; a human types yes
      }
      if (!cancelled) setAutoplay(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay]);

  const isFirstRun = messages.length === 0 && storeEmpty;

  return (
    <Frame
      messages={messages}
      status={currentStatus}
      onFocusComposer={() => composerRef.current?.focus()}
      balanceUsd={balanceUsd}
      fixtures={fixtures}
      currentFixtureId={id}
      onFixtureChange={onFixtureChange}
      autoplay={autoplay}
      onAutoplayToggle={() => setAutoplay((v) => !v)}
      theme={theme}
      onThemeToggle={onThemeToggle}
      viewerOpen={openFile !== undefined || openError !== undefined}
      listDocuments={listDocuments}
      onOpenFile={handleOpen}
      composerValue={composerValue}
      onComposerDraft={setComposerValue}
      talkToTen={
        <>
          {isFirstRun ? (
            <div className="empty-state">
              <p>
                Ten: I don't have anything of yours yet. Drop in a résumé, or tell me the job
                you're going for, and I'll start your workspace.
              </p>
            </div>
          ) : (
            <Transcript messages={messages} onOpen={handleOpen} onPrint={handlePrint} />
          )}
          <Composer
            ref={composerRef}
            value={composerValue}
            onChange={setComposerValue}
            onSend={send}
            disabled={status === "submitted" || status === "streaming" || autoplay}
          />
        </>
      }
      sidePanel={
        <SidePanel
          ref={iframeRef}
          file={openFile}
          error={openError}
          onRetry={retryOpenFile}
          open={panelOpenOnPhone}
          onClose={() => setPanelOpenOnPhone(false)}
        />
      }
    />
  );
}
