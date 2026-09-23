import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { latestGateStatuses, statusOf } from "./agent-helpers.ts";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { SidePanel } from "./components/SidePanel";
import { Transcript } from "./components/Transcript";
import type { FixtureEntry } from "./fixtures";
import { MockChatTransport } from "./mock-transport.ts";
import { FixtureStore } from "./store.ts";
import type { AppMessage, CostCardProps, DataCardData, FileRead } from "./types.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The candidate's balance: only ever a number a streamed part or the
 *  store itself provides (L1) — never an invented figure. `undefined`
 *  means unknown, and the chip renders "—". */
function currentBalance(messages: AppMessage[], startingBalance: number | undefined): number | undefined {
  let balance: number | undefined;
  for (const message of messages) {
    for (const part of message.parts as Array<Record<string, unknown>>) {
      if (part.type === "data-card") {
        const data = part.data as DataCardData;
        if (data.card === "cost") balance = (data.props as CostCardProps).balanceUsd;
      }
    }
  }
  return balance ?? startingBalance;
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

  const chat = useChat<AppMessage>({ id, transport, messages: [] });
  const { messages, sendMessage, status } = chat;

  const [composerValue, setComposerValue] = useState("");
  const [autoplay, setAutoplay] = useState(false);
  const [storeEmpty, setStoreEmpty] = useState(false);
  const [openRef, setOpenRef] = useState<string | undefined>(undefined);
  const [openFile, setOpenFile] = useState<FileRead | undefined>(undefined);
  const [panelOpenOnPhone, setPanelOpenOnPhone] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const currentStatus = statusOf(messages, status);
  const balanceUsd = currentBalance(messages, store.startingBalanceUsd());

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
  useEffect(() => {
    let cancelled = false;
    if (!openRef) {
      setOpenFile(undefined);
      return;
    }
    store
      .read(openRef)
      .then((f) => {
        if (!cancelled) setOpenFile(f);
      })
      .catch(() => {
        if (!cancelled) setOpenFile(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [openRef, store]);

  const handleOpen = (ref: string) => {
    setOpenRef(ref);
    setPanelOpenOnPhone(true);
  };

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
    <div className="app-shell">
      <div className="main-pane">
        <Header
          status={currentStatus}
          balanceUsd={balanceUsd}
          fixtures={fixtures}
          currentFixtureId={id}
          onFixtureChange={onFixtureChange}
          autoplay={autoplay}
          onAutoplayToggle={() => setAutoplay((v) => !v)}
          theme={theme}
          onThemeToggle={onThemeToggle}
        />
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
          value={composerValue}
          onChange={setComposerValue}
          onSend={send}
          disabled={status === "submitted" || status === "streaming" || autoplay}
        />
      </div>
      <SidePanel
        ref={iframeRef}
        file={openFile}
        open={panelOpenOnPhone}
        onClose={() => setPanelOpenOnPhone(false)}
      />
    </div>
  );
}
