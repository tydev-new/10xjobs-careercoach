// The real, signed-in, member chat screen (plan step 5b) — the SAME
// components step 5a built (Header, Transcript, Composer, SidePanel: "the
// diff from 5a is the transport swap plus proxy and balance wiring: no
// screen rework", design-web-agent.md § 5b exit), wired to:
//   - AgentChatTransport(coach) instead of MockChatTransport (§ 6.1)
//   - SupabaseWorkspaceStore instead of FixtureStore (§ 2)
//   - deps.balance() (ten_balance()) instead of a fixture's declared figure
//   - the ⋯ menu's real actions: export, import (empty workspace only),
//     delete my beta data, sign out (design-web-ui.md § 1.1/§ 1.7)
//   - the composer's attach -> upload("documents/<name>") before sending,
//     with -2/-3 on a clash and a plain error message on any refusal
//     (plan step 5b item 3)
import { useChat } from "@ai-sdk/react";
import type { Coach, WorkspaceStore } from "../../../../packages/agent/src/types.ts";
import { prepareConversationForSave, CONVERSATION_BYTE_CAP } from "../../../../packages/agent/src/index.ts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { statusOf } from "../agent-helpers.ts";
import { Composer } from "../components/Composer";
import { Header } from "../components/Header";
import { SidePanel } from "../components/SidePanel";
import { Transcript } from "../components/Transcript";
import { AgentChatTransport } from "../real-transport.ts";
import { exportWorkspace, importWorkspace, WorkspaceImportError, WorkspaceImportPartialError } from "../backend/workspace-export.ts";
import { uploadWithClashRenumber } from "../backend/upload-errors.ts";
import { ConversationError, type ConversationStore } from "../backend/conversation-store.ts";
import type { AppMessage, DataCardData, FileRead } from "../types.ts";
import { DeleteBetaDataConfirm } from "./DeleteBetaDataConfirm";
import { checkConversationStale } from "./conversation-stale-check.ts";
import { useVersionMonitor } from "./version-check.ts";
import { VersionNotice } from "./VersionNotice";
import { ConversationNotice } from "./ConversationNotice";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EMPTY_FIXTURES: never[] = [];
const EMPTY_MESSAGES: AppMessage[] = [];

/** § 11's own optional-prop fallback (see `conversationStore` above): a
 *  save always "succeeds" locally (never surfaces § 1.8/§ 1.9's failure
 *  copy) but nothing is ever actually persisted anywhere — only reachable
 *  when a caller mounts this component without a real ConversationStore. */
function createNoopConversationStore(): ConversationStore {
  let version: string | null = null;
  return {
    async load() {
      return null;
    },
    async save(id, msgs, olderDropped) {
      version = `noop-${Date.now()}`;
      return { chatId: id, messages: msgs, olderDropped, version, updatedAt: new Date().toISOString() };
    },
    async readVersion() {
      return version;
    },
  };
}

export interface RealChatShellProps {
  coach: Coach;
  workspace: WorkspaceStore;
  balance: () => Promise<number>;
  /** § 11.6: the restored row's own chat_id, or a freshly generated one —
   *  resolved once by RealApp.tsx's setup, before this component mounts. */
  chatId: string;
  /** § 11.6: the sanitized, reconciled messages to mount `useChat` with —
   *  `[]` for a brand-new conversation, never re-derived here (RealApp.tsx
   *  already did the load/validate/reconcile once). Optional/defaults to
   *  `[]` only so callers that predate § 11 (a harness mounting this
   *  component directly, without a conversation) keep working unchanged. */
  initialMessages?: AppMessage[];
  /** § 11.2/§ 11.5: the version this tab has now — null for a chat that
   *  has never been saved (the next save creates the row). */
  initialVersion?: string | null;
  /** § 11.4/ui § 1.9: whether the restored row already had older turns
   *  dropped by an earlier save (persists across reloads). */
  initialOlderDropped?: boolean;
  /** § 11.2 — the one save/load path for the conversation table. Optional:
   *  a caller that never supplies one (see `initialMessages`) gets an
   *  in-memory no-op store, so saving never errors and shows no spurious
   *  § 1.8/§ 1.9 failure notices. */
  conversationStore?: ConversationStore;
  supabaseUrl: string;
  accessToken: () => Promise<string>;
  onSignOut: () => void;
  /** Once ten-delete-account returns, the caller signs out and returns to
   *  sign-in (design-web-ui.md § 1.7 point 4). */
  onDeleted: () => Promise<void>;
  theme: "light" | "dark";
  onThemeToggle: () => void;
}

export function RealChatShell({
  coach,
  workspace,
  balance,
  chatId,
  initialMessages = EMPTY_MESSAGES,
  initialVersion = null,
  initialOlderDropped = false,
  conversationStore,
  supabaseUrl,
  accessToken,
  onSignOut,
  onDeleted,
  theme,
  onThemeToggle,
}: RealChatShellProps): ReactElement {
  const store = useMemo(() => conversationStore ?? createNoopConversationStore(), [conversationStore]);
  const transport = useMemo(() => new AgentChatTransport(coach, chatId), [coach, chatId]);
  // § 11 — every ended turn is saved once, in onFinish, "however it ended"
  // (isAbort/isDisconnect/isError all included — the same array either
  // way; a currently-running turn that never reaches onFinish, e.g. a
  // closed tab, is § 11.4's own "known limit").
  const chat = useChat<AppMessage>({
    id: chatId,
    transport,
    messages: initialMessages,
    onFinish: ({ messages: finished }) => {
      void saveConversationRef.current(finished);
    },
  });
  const { messages, sendMessage, status } = chat;

  // § 11.2/§ 11.5 — this tab's own save state. Refs (not state) carry the
  // values every save/pre-send-check reads SYNCHRONOUSLY between renders
  // (a save that started before a re-render must still see the version the
  // PREVIOUS save just produced, not a stale render's closed-over value).
  const conversationVersionRef = useRef<string | null>(initialVersion);
  const olderDroppedRef = useRef(initialOlderDropped);
  const [olderDropped, setOlderDropped] = useState(initialOlderDropped);
  // ui § 1.9's three above-the-composer lines: at most one shown at a time
  // (freshest first — a stale-blocked send is the most actionable).
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [staleBlockedOnce, setStaleBlockedOnce] = useState(false);

  // Fix round 2, item 2: every save CHAINS off the one before it — never
  // two `store.save()` calls in flight at once for this tab. Without this,
  // two overlapping saves both read `conversationVersionRef.current`
  // before EITHER wrote its result back, so the second would CAS-conflict
  // against the first's own (successful) write — a false "another tab"
  // conflict against itself. `saveChainRef` also lets the pre-send check
  // (below) wait for an in-flight save to actually land before comparing
  // versions, for the same reason.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const saveConversation = useCallback(
    (msgs: AppMessage[]): Promise<void> => {
      const run = async () => {
        const { messages: prepared, droppedAnyTurn } = prepareConversationForSave(msgs, CONVERSATION_BYTE_CAP);
        const nextOlderDropped = olderDroppedRef.current || droppedAnyTurn;
        try {
          const saved = await store.save(chatId, prepared, nextOlderDropped, conversationVersionRef.current);
          conversationVersionRef.current = saved.version;
          olderDroppedRef.current = saved.olderDropped;
          if (saved.olderDropped) setOlderDropped(true);
          setSaveFailed(false);
          setSaveConflict(false);
        } catch (err) {
          if (err instanceof ConversationError && err.code === "version_conflict") {
            // § 11.5's backstop: another tab/device saved first. This tab
            // never overwrites or merges — it just reports the conflict;
            // the pre-send check (below) already blocks its NEXT send.
            console.error("[Ten] conversation save conflict:", err.code);
            setSaveConflict(true);
          } else {
            console.error("[Ten] conversation save failed:", err);
            setSaveFailed(true);
          }
        }
      };
      // Chained, never raced: the next save (whatever msgs it was called
      // with) starts only once the previous one is fully settled — so it
      // reads conversationVersionRef.current as THAT save's own resulting
      // version, not a stale pre-save value. `run` never itself rejects
      // (every failure is caught above), so a plain `.then` is enough.
      const chained = saveChainRef.current.then(run);
      saveChainRef.current = chained;
      return chained;
    },
    [chatId, store],
  );
  // Read inside onFinish via a ref so useChat's own onFinish identity
  // (captured once, at the id/transport-keyed remount) always calls the
  // LATEST saveConversation closure (chatId/conversationStore are stable
  // per mount here, but this avoids relying on that).
  const saveConversationRef = useRef(saveConversation);
  saveConversationRef.current = saveConversation;

  const [composerValue, setComposerValue] = useState("");
  // Fix round 2, ruling 1: a successful attach is held here (not injected
  // into composerValue) until the next send().
  const [pendingAttachment, setPendingAttachment] = useState<{ path: string; mediaType: string; filename: string } | undefined>(undefined);
  const [storeEmpty, setStoreEmpty] = useState(false);
  const [openRef, setOpenRef] = useState<string | undefined>(undefined);
  const [openFile, setOpenFile] = useState<FileRead | undefined>(undefined);
  const [panelOpenOnPhone, setPanelOpenOnPhone] = useState(false);
  const [balanceUsd, setBalanceUsd] = useState<number | undefined>(undefined);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [importError, setImportError] = useState<string | undefined>(undefined);
  // § 10 / ui § 1.8 — a newer deployed build. `sendBlockedOnce` switches the
  // notice's copy the moment a send is actually blocked (§ 10.3); it only
  // ever flips true once newerVersionKnown is already true, so it never
  // shows ahead of newerVersionKnown itself.
  const { newerVersionKnown, checkBeforeSend } = useVersionMonitor();
  const [sendBlockedOnce, setSendBlockedOnce] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const currentStatus = statusOf(messages, status);

  // deps.balance() is read "at turn end and on window focus" (§ 8), same
  // moments as the mock's readBalance — plus once on mount.
  const refreshBalance = useCallback(() => {
    void balance()
      .then(setBalanceUsd)
      .catch(() => setBalanceUsd(undefined));
  }, [balance]);

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

  // The side panel opens the file the last-emitted card's ref points at
  // (design-web-ui.md § 1.1) — identical logic to ChatShell.tsx.
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

  // First-run detection (design-web-ui.md § 1.5): the STORE is empty (an
  // account with only the app-created root CLAUDE.md counts as empty —
  // RealApp.tsx creates that once, before this component ever mounts) and
  // no messages exist yet.
  useEffect(() => {
    let cancelled = false;
    workspace.list().then((files) => {
      const onlyClaudeMd = files.length === 1 && files[0].path === "CLAUDE.md";
      if (!cancelled) setStoreEmpty(files.length === 0 || onlyClaudeMd);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, messages.length]);

  useEffect(() => {
    let cancelled = false;
    if (!openRef) {
      setOpenFile(undefined);
      return;
    }
    workspace
      .read(openRef)
      .then((f) => {
        if (!cancelled) setOpenFile(f as FileRead);
      })
      .catch(() => {
        if (!cancelled) setOpenFile(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [openRef, workspace]);

  const handleOpen = (ref: string) => {
    setOpenRef(ref);
    setPanelOpenOnPhone(true);
  };

  const handlePrint = (htmlPath: string) => {
    handleOpen(htmlPath);
    setTimeout(() => iframeRef.current?.contentWindow?.print(), 200);
  };

  const doSendMessage = (t: string) => {
    // Fix round 2, ruling 1: a pending attach rides as a real § 2
    // `file` part (url "workspace:<path>") — no pre-filled composer
    // text. The Transcript already renders an `.attachment-chip`
    // for any `file` part on a sent message (Transcript.tsx);
    // packages/agent's coach.ts (stripWorkspaceFileParts) turns it
    // into "The candidate attached `<path>`." for the model, word
    // for word (confirmed unchanged — this is the tester's own
    // e2e's exact expected text).
    const files = pendingAttachment
      ? [{ type: "file" as const, mediaType: pendingAttachment.mediaType, filename: pendingAttachment.filename, url: `workspace:${pendingAttachment.path}` }]
      : undefined;
    void sendMessage({ text: t, files, metadata: { origin: "typed" } });
    setPendingAttachment(undefined);
  };

  const send = async (text: string) => {
    // design-web-agent.md § 10.3 and § 11.5: every send (a gate `yes`
    // included) checks TWICE before it goes anywhere — the deploy check
    // (§ 10.3, unchanged) and, "beside" it, the stale-conversation check
    // (§ 11.5: "before every send... it reads the row's version"). Either
    // one blocks the send the same way: no sendMessage/transport call, no
    // proxy request, text restored word for word, the composer disabled
    // meanwhile (same as `checkingVersion` always did).
    setCheckingVersion(true);
    try {
      const newerVersion = await checkBeforeSend();
      if (newerVersion) {
        setComposerValue(text);
        setSendBlockedOnce(true);
        return;
      }
      // Fix round 2, item 2: wait for THIS tab's own in-flight save (if
      // any) to land before reading the row's version — otherwise a send
      // that races an in-flight save of THIS tab's own turn would read the
      // row mid-write and see a version conversationVersionRef.current
      // hasn't caught up to yet, misreading itself as "another tab moved
      // on". Bounded by the same save chain onFinish already uses, so this
      // is never more than that one save's own latency.
      await saveChainRef.current;
      const stale = await checkConversationStale({
        readVersion: (opts) => store.readVersion(opts),
        currentVersion: () => conversationVersionRef.current,
      });
      if (stale) {
        setComposerValue(text);
        setStaleBlockedOnce(true);
        return;
      }
      setStaleBlockedOnce(false);
      doSendMessage(text);
    } finally {
      setCheckingVersion(false);
    }
  };

  // Upload wiring (plan step 5b item 3): the composer's attach ->
  // upload("documents/<name>") BEFORE sending, held as `pendingAttachment`
  // until the next send() attaches it as a real file part (ruling 1).
  const handleAttach = async (file: File) => {
    setAttaching(true);
    setAttachError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const outcome = await uploadWithClashRenumber(workspace, file.name, bytes);
      if (!outcome.ok) {
        setAttachError(outcome.message);
        return;
      }
      const mediaType = file.name.toLowerCase().endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";
      const filename = outcome.path!.split("/").pop() ?? outcome.path!;
      setPendingAttachment({ path: outcome.path!, mediaType, filename });
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Couldn't upload that file. Try again.");
    } finally {
      setAttaching(false);
    }
  };

  const handleExport = async () => {
    // § 11.7: "Export adds .ten/conversation.json (the saved array) when a
    // row exists." Read fresh (never the possibly-ahead-of-the-row live
    // `messages` state) so the export matches exactly what a restore would
    // load; "with no row the export is unchanged" (never saved yet).
    const saved = await store.load();
    const zip = await exportWorkspace(workspace, saved ? JSON.stringify(saved.messages) : undefined);
    const blob = new Blob([zip as unknown as ArrayBuffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ten-workspace.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await importWorkspace(workspace, bytes);
      setStoreEmpty(false);
    } catch (err) {
      if (err instanceof WorkspaceImportError) {
        setImportError(`Import refused: ${err.errors.map((e2) => `${e2.path} — ${e2.reason}`).join("; ")}`);
      } else if (err instanceof WorkspaceImportPartialError) {
        setImportError(`Import stopped partway (${err.written.length} file(s) written): ${err.message}`);
      } else {
        setImportError(err instanceof Error ? err.message : "Import failed.");
      }
    }
  };

  const isFirstRun = messages.length === 0 && storeEmpty;
  // § 10.3 / ui § 1.8: "a turn is running" — the same moments the composer
  // is already disabled for (existing `disabled={status === ...}` below).
  const turnRunning = status === "submitted" || status === "streaming";

  return (
    <div className="app-shell">
      <div className="main-pane">
        <Header
          status={currentStatus}
          balanceUsd={balanceUsd}
          fixtures={EMPTY_FIXTURES}
          currentFixtureId=""
          onFixtureChange={() => {}}
          autoplay={false}
          onAutoplayToggle={() => {}}
          theme={theme}
          onThemeToggle={onThemeToggle}
          onExportWorkspace={() => void handleExport()}
          onImportWorkspace={() => importInputRef.current?.click()}
          onDeleteBetaData={() => setShowDeleteConfirm(true)}
          onSignOut={onSignOut}
        />
        <input ref={importInputRef} type="file" accept=".zip" hidden onChange={(e) => void handleImportFile(e)} />
        {importError ? <p className="import-error">{importError}</p> : null}
        {isFirstRun ? (
          <div className="empty-state">
            <p>
              Ten: I don't have anything of yours yet. Drop in a résumé, or tell me the job
              you're going for, and I'll start your workspace.
            </p>
          </div>
        ) : (
          <>
            {/* ui § 1.9: "at the top of the restored transcript" — shown
                once older turns have ever been dropped for this row, and
                stays shown (it describes the WHOLE restored history, not
                just this load). */}
            {olderDropped ? <ConversationNotice kind="older-dropped" /> : null}
            <Transcript messages={messages} onOpen={handleOpen} onPrint={handlePrint} />
          </>
        )}
        {/* ui § 1.8: one line above the composer, hidden while a turn is
            running (the agent runs in THIS tab, so reload mid-turn would
            stop the run), not dismissible, no error styling. The ending
            swaps (§ 1.8 amended) when THIS tab's own latest save didn't
            land — either a plain failure OR a version conflict (fix round
            2, item 1: a conflict is still "wasn't saved", never "saved"). */}
        {newerVersionKnown && !turnRunning ? (
          <VersionNotice mode={sendBlockedOnce ? "blocked" : "newer"} saveFailed={saveFailed || saveConflict} />
        ) : null}
        {/* ui § 1.9 — the conversation-specific lines, one at a time
            (freshest first): a just-blocked stale send, else a save
            conflict from this turn's onFinish, else a plain save failure —
            each suppressed only while the § 1.8 notice above is ALREADY
            showing the same "wasn't saved" fact, so the two never stack. */}
        {staleBlockedOnce ? (
          <ConversationNotice kind="stale-blocked" />
        ) : saveConflict && !(newerVersionKnown && !turnRunning) ? (
          <ConversationNotice kind="save-conflict" />
        ) : saveFailed && !saveConflict && !(newerVersionKnown && !turnRunning) ? (
          <ConversationNotice kind="save-failed" />
        ) : null}
        <Composer
          value={composerValue}
          onChange={setComposerValue}
          onSend={(text) => void send(text)}
          disabled={turnRunning || checkingVersion}
          onAttach={(file) => void handleAttach(file)}
          attaching={attaching}
          attachError={attachError}
        />
      </div>
      <SidePanel
        ref={iframeRef}
        file={openFile}
        open={panelOpenOnPhone}
        onClose={() => setPanelOpenOnPhone(false)}
      />
      {showDeleteConfirm ? (
        <DeleteBetaDataConfirm
          supabaseUrl={supabaseUrl}
          accessToken={accessToken}
          onClose={() => setShowDeleteConfirm(false)}
          onDeleted={onDeleted}
        />
      ) : null}
    </div>
  );
}
