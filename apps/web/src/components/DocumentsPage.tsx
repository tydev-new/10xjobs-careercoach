// Documents (design-web-ui.md § 5.3, "Documents: every file"; § 5.6
// "Documents" under Page layouts; § 5.9 Stage 3a — "No reader"). Reads
// `store.list()` fresh whenever it mounts (Frame only mounts this
// component while Documents is the shown page, § 5.2 rule 4's "reads its
// files when it's shown") — never a copy kept between renders. A file
// opens through the SAME viewer every other page and the conversation use
// (§ 5.2 rule 8) via `onOpenFile`, owned by the caller (ChatShell /
// RealChatShell). No window/document/localStorage/Node-only API.
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "../icons.tsx";
import { EmptyPage } from "./EmptyPage";
import { datePart, groupDocuments, splitPathForDisplay } from "../workspace/documents.ts";
import type { FileInfo } from "../types.ts";

export interface DocumentsPageProps {
  /** `store.list()` (C § 2) — the SAME store instance the agent uses
   *  (§ 5.2 rule 1). Documents never calls `read()`, `write()` or
   *  `upload()` itself; opening a file is `onOpenFile`, below. */
  list: () => Promise<FileInfo[]>;
  /** Opens the path in the pinned viewer (§ 5.2 rule 8) — the exact same
   *  handler Talk to Ten's chips and cards use. */
  onOpenFile: (path: string) => void;
  /** "Ask Ten about this" (§ 5.4) on a file: puts `About <path>: ` in the
   *  composer (only when it's empty) and opens Talk to Ten. Never sends
   *  (§ 5.2 rule 2). */
  onAskTen: (path: string) => void;
  onOpenTalkToTen: () => void;
  /** § 5.2 rule 4: "While a turn is running, the page shows one neutral
   *  line... A page reads its files when it's shown and again when a
   *  turn ends while it's showing." True while Frame's own avatar state
   *  is thinking/working — the same signal the header already shows,
   *  never a second source (rule 12). */
  turnRunning: boolean;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; files: FileInfo[] };

// § 5.2 rule 4's own words, F34 (§ 5.3.1).
const WORKING_LINE = "Ten is working. This page updates when it finishes.";

export function DocumentsPage({ list, onOpenFile, onAskTen, onOpenTalkToTen, turnRunning }: DocumentsPageProps): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Bumped by Retry (below) AND by a turn ending while this page shows,
  // to force a fresh `list()` call without a second copy of the effect's
  // own logic.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    list()
      .then((files) => {
        if (!cancelled) setState({ kind: "ready", files });
      })
      .catch(() => {
        // § 5.2 rule 6: any read failure other than "missing" is loud,
        // never the empty state.
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, attempt]);

  // § 5.2 rule 4, second half: "again when a turn ends while it's
  // showing." Fires once per FALLING edge of `turnRunning` (true -> false)
  // — never on the rising edge, and never merely because this component
  // re-rendered for some other reason.
  const wasRunningRef = useRef(turnRunning);
  useEffect(() => {
    if (wasRunningRef.current && !turnRunning) setAttempt((n) => n + 1);
    wasRunningRef.current = turnRunning;
  }, [turnRunning]);

  const workingLine: ReactNode = turnRunning ? (
    <div className="page-working-line" role="status">
      <Icon name="loaderCircle" size={14} className="spin" />
      {WORKING_LINE}
    </div>
  ) : null;

  if (state.kind === "loading") {
    return (
      <div className="workspace-page">
        <div className="workspace-page-inner">
          {workingLine}
          <div className="page-list-skeletons" aria-hidden="true">
            <div className="skeleton page-list-skeleton-row" />
            <div className="skeleton page-list-skeleton-row" />
            <div className="skeleton page-list-skeleton-row" />
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="workspace-page">
        <div className="workspace-page-inner">
          {workingLine}
          <div className="page-error-card">
            <Icon name="circleAlert" size={18} />
            <p className="page-error-message">Couldn't read your files. Try again in a moment.</p>
            <button type="button" className="btn btn--sec" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const groups = groupDocuments(state.files);

  // § 5.3 Documents, "Empty": "the list is empty" — after `leads.md` is
  // dropped, `groupDocuments` returns no groups at all exactly when there
  // is nothing left to show (rule 6: missing is empty, never loud).
  // (The working line is not shown here: a workspace with literally no
  // files while a turn is running is not part of 3a's own exit list, and
  // EmptyPage's own centered layout has no room for a second element
  // above it without its own CSS rework — scope note, not a silent
  // drop.)
  if (groups.length === 0) {
    return (
      <EmptyPage
        icon="files"
        first="No files yet."
        rest="Drop your résumé into the conversation to start."
        cta="talk"
        onOpenTalkToTen={onOpenTalkToTen}
      />
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-page-inner documents-page">
        {workingLine}
        {groups.map((group) => (
          <section className="doc-group" key={group.key || "top-level"} aria-label={group.label}>
            <h2 className="doc-group-head">
              <span>{group.label}</span>
              <span className="doc-group-count">{group.files.length}</span>
            </h2>
            <div className="doc-group-card">
              {group.files.map((file) => {
                const { prefix, leaf } = splitPathForDisplay(file.path);
                return (
                  <div className="doc-row" key={file.path}>
                    <button
                      type="button"
                      className="doc-row-open"
                      onClick={() => onOpenFile(file.path)}
                    >
                      <Icon name="fileText" size={16} />
                      <span className="doc-row-path">
                        {prefix ? <span className="doc-row-prefix">{prefix}</span> : null}
                        {leaf}
                      </span>
                    </button>
                    <span className="doc-row-date">{datePart(file.updatedAt)}</span>
                    <button
                      type="button"
                      className="btn btn--ghost doc-row-ask"
                      onClick={() => onAskTen(file.path)}
                    >
                      Ask Ten about this
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
