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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { statusOf } from "../agent-helpers.ts";
import { Composer } from "../components/Composer";
import { Header } from "../components/Header";
import { SidePanel } from "../components/SidePanel";
import { Transcript } from "../components/Transcript";
import { AgentChatTransport } from "../real-transport.ts";
import { exportWorkspace, importWorkspace, WorkspaceImportError, WorkspaceImportPartialError } from "../backend/workspace-export.ts";
import { uploadWithClashRenumber } from "../backend/upload-errors.ts";
import type { AppMessage, DataCardData, FileRead } from "../types.ts";
import { DeleteBetaDataConfirm } from "./DeleteBetaDataConfirm";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EMPTY_FIXTURES: never[] = [];

export interface RealChatShellProps {
  coach: Coach;
  workspace: WorkspaceStore;
  balance: () => Promise<number>;
  chatId: string;
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
  supabaseUrl,
  accessToken,
  onSignOut,
  onDeleted,
  theme,
  onThemeToggle,
}: RealChatShellProps): ReactElement {
  const transport = useMemo(() => new AgentChatTransport(coach, chatId), [coach, chatId]);
  const chat = useChat<AppMessage>({ id: chatId, transport, messages: [] });
  const { messages, sendMessage, status } = chat;

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

  const send = (text: string) => {
    // Fix round 2, ruling 1: a pending attach rides as a real § 2 `file`
    // part (url "workspace:<path>") — no pre-filled composer text. The
    // Transcript already renders an `.attachment-chip` for any `file`
    // part on a sent message (Transcript.tsx); packages/agent's coach.ts
    // (stripWorkspaceFileParts) turns it into "The candidate attached
    // `<path>`." for the model, word for word (confirmed unchanged —
    // this is the tester's own e2e's exact expected text).
    const files = pendingAttachment
      ? [{ type: "file" as const, mediaType: pendingAttachment.mediaType, filename: pendingAttachment.filename, url: `workspace:${pendingAttachment.path}` }]
      : undefined;
    void sendMessage({ text, files, metadata: { origin: "typed" } });
    setPendingAttachment(undefined);
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
    const zip = await exportWorkspace(workspace);
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
          <Transcript messages={messages} onOpen={handleOpen} onPrint={handlePrint} />
        )}
        <Composer
          value={composerValue}
          onChange={setComposerValue}
          onSend={send}
          disabled={status === "submitted" || status === "streaming"}
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
