// Jobs: the pipeline record (design-web-ui.md § 5.3, "Jobs: the pipeline
// record"; § 5.9 Stage 3b). Reads `jobs.md` fresh whenever it's shown
// (§ 5.2 rule 4) — never a copy kept between renders. A row's chosen
// detail additionally reads its own `Analysis`/`Company file` fields,
// fresh when the row is chosen and again when a turn ends while it
// shows. A file opens through the SAME viewer every other page and the
// conversation use (§ 5.2 rule 8) via `onOpenFile`. No page write, no
// page send (§ 5.2 rules 1 and 2). No window/document/localStorage/
// Node-only API.
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "../icons.tsx";
import type { FileInfo, WorkspaceStore } from "../types.ts";
import { EmptyPage } from "./EmptyPage";
import { MarkdownView } from "./MarkdownView";
import {
  applicationKeyForRow,
  competencySection,
  cultureSection,
  dealbreakersDisplay,
  datePart,
  dismissedFromLabel,
  dismissedRows,
  firstRowInPageOrder,
  firstRowOfStage,
  fitSection,
  groupJobsByStage,
  hasLinkedApplication,
  isQuickScan,
  loadFieldFile,
  loadJobsRows,
  roleLabel,
  rowKey,
  safeHref,
  scoreDisplay,
  snapshotSection,
  verdictLabel,
  type FieldFileState,
  type JobsMdRow,
} from "../workspace/jobs.ts";
import type { Section } from "../workspace/sections.ts";
import { storeIo } from "../workspace/store-io.ts";

export interface JobsPageProps {
  /** The SAME `WorkspaceStore` instance the agent uses (§ 5.2 rule 1). */
  store: WorkspaceStore;
  /** Opens a path in the pinned viewer (§ 5.2 rule 8). */
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  /** "Ask Ten about this" (§ 5.4): `<label>` is `Company — Title` for a
   *  role (P4). Never sends (§ 5.2 rule 2). */
  onAskTen: (label: string) => void;
  onOpenTalkToTen: () => void;
  /** § 5.4: "a Jobs detail's 'Open application' opens Applications with
   *  the linked entry chosen." The CONTROL shows whenever an application
   *  links to the chosen row (jobs.ts's presence check, `has === linked`,
   *  Stage 3b review) regardless of this prop; `key` is the Applications
   *  entry's own file key (`applicationKeyForRow`). Full cross-page
   *  navigation (opening Applications WITH that entry chosen) is Stage
   *  3e's own exit (§ 5.9, once 3d's Applications page exists to choose
   *  an entry in) — `undefined` (3b's own default, left unwired in
   *  Frame.tsx) means the button is present but its click is a no-op
   *  until 3e provides a handler. */
  onOpenApplication?: (key: string) => void;
  /** § 5.2 rule 4: "While a turn is running, the page shows one neutral
   *  line... reads again when a turn ends while it's showing." */
  turnRunning: boolean;
  /** § 5.4: "A Home count opens Jobs at that stage, with its first row
   *  chosen." Not wired by 3b's own Frame (Stage 3e's own exit); read
   *  once, at mount, like the landing rule (§ 5.1). */
  initialStage?: string;
}

type ListState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; rows: JobsMdRow[] };

const WORKING_LINE = "Ten is working. This page updates when it finishes."; // F35

function ReadError({ path, onRetry }: { path: string; onRetry: () => void }): ReactElement {
  return (
    <div className="page-error-card job-read-error">
      <Icon name="circleAlert" size={18} />
      <p className="page-error-message">Couldn't read {path}. Try again in a moment.</p>
      <button type="button" className="btn btn--sec" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// § 5.6 "Cards — Tier pills": words carry the meaning, color only marks
// the category; Strong Fit alone gets the check icon (§ 2.1's own table,
// shared with the verdict card — P5-P8, J1).
function TierPill({ fitVerdict }: { fitVerdict: string | null | undefined }): ReactElement {
  const label = verdictLabel(fitVerdict);
  const known = fitVerdict === "strong" || fitVerdict === "investable_stretch" || fitVerdict === "long_shot" || fitVerdict === "weak";
  return (
    <span className={known ? `tier-pill tier-pill--${fitVerdict}` : "tier-pill"}>
      {fitVerdict === "strong" ? <Icon name="check" size={13} /> : null}
      {label}
    </span>
  );
}

function QuickScanBadge({ reason }: { reason: string | null | undefined }): ReactElement | null {
  return isQuickScan(reason) ? <span className="badge badge--quick-scan">Quick scan</span> : null; // P9
}

/** § 5.2 rule 7: a `URL:` field always shows — a safe `https://`/`http://`
 *  value becomes a link (new tab, `rel="noopener noreferrer"`); anything
 *  else (a `javascript:`/`data:` URL, or any other scheme) shows as
 *  plain text, never hidden (Stage 3b review, B3: "Never hide it"). */
function PostingLink({ url, label }: { url: string | null | undefined; label?: string }): ReactElement | null {
  if (!url) return null;
  const href = safeHref(url);
  if (!href) return <span className="job-url job-url--unsafe">{url}</span>;
  return (
    <a className="job-url" href={href} target="_blank" rel="noopener noreferrer">
      {label ?? href}
      <Icon name="externalLink" size={13} />
    </a>
  );
}

/** § 5.3: "Location · the date part of Posted · Added <date> · Updated
 *  <date>" — only the parts whose field is actually present (Posted is
 *  very often unset). */
function RowMeta({ row }: { row: JobsMdRow }): ReactElement {
  const parts: string[] = [];
  if (row.location) parts.push(row.location);
  const posted = datePart(row.posted_at);
  if (posted) parts.push(`Posted ${posted}`); // J4
  const added = datePart(row.seen_at);
  if (added) parts.push(`Added ${added}`); // H12
  const updated = datePart(row.updated_at);
  if (updated) parts.push(`Updated ${updated}`); // H13
  return <div className="job-row-meta">{parts.join(" · ")}</div>;
}

function RowControls({
  row,
  onOpenFile,
  onAskTen,
}: {
  row: JobsMdRow;
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  onAskTen: (label: string) => void;
}): ReactElement {
  return (
    <div className="job-row-controls">
      {row.analysis_file ? (
        <button
          type="button"
          className="btn btn--sec"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFile(row.analysis_file as string, e.currentTarget);
          }}
        >
          Open analysis
        </button>
      ) : (
        <span className="job-no-analysis">No analysis file linked</span> // J6/J7
      )}
      <button
        type="button"
        className="btn btn--ghost"
        onClick={(e) => {
          e.stopPropagation();
          onAskTen(roleLabel(row));
        }}
      >
        Ask Ten about this
      </button>
    </div>
  );
}

function JobRow({
  row,
  selected,
  onSelect,
  onOpenFile,
  onAskTen,
}: {
  row: JobsMdRow;
  selected: boolean;
  onSelect: () => void;
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  onAskTen: (label: string) => void;
}): ReactElement {
  const dealbreakers = dealbreakersDisplay(row);
  return (
    <div className={`job-row${selected ? " job-row--selected" : ""}`}>
      <div className="job-row-head">
        {/* Stage 3b review: a <button> is phrasing content only — no
            block-level descendants (div/p). Its accessible name is the
            row's own concise label (company and title, P4); the rest of
            the row's content sits OUTSIDE it, as this row's own plain
            (non-interactive) siblings. */}
        <button type="button" className="job-row-select" aria-current={selected ? "true" : undefined} onClick={onSelect}>
          {roleLabel(row)}
        </button>
        {scoreDisplay(row.fit_score) ? <span className="job-row-score">{scoreDisplay(row.fit_score)}</span> : null}
      </div>
      <RowMeta row={row} />
      <div className="job-row-tier">
        <TierPill fitVerdict={row.fit_verdict} />
        <QuickScanBadge reason={row.fit_reason} />
      </div>
      {row.fit_reason ? <p className="job-row-reason">{row.fit_reason}</p> : null}
      {dealbreakers !== undefined ? <p className="job-row-dealbreakers">Dealbreakers: {dealbreakers}</p> : null}
      {row.dismissed ? (
        <div className="job-row-dismissed">
          <p className="job-row-dismissed-from">{dismissedFromLabel(row)}</p>
          {row.dismiss_note ? <p className="job-row-dismissed-note">{row.dismiss_note}</p> : null}
        </div>
      ) : null}
      <PostingLink url={row.url} />
      <RowControls row={row} onOpenFile={onOpenFile} onAskTen={onAskTen} />
    </div>
  );
}

function JobsList({
  groups,
  dismissed,
  selectedKey,
  onSelect,
  onOpenFile,
  onAskTen,
}: {
  groups: { stage: string; rows: JobsMdRow[] }[];
  dismissed: JobsMdRow[];
  selectedKey: string | undefined;
  onSelect: (row: JobsMdRow) => void;
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  onAskTen: (label: string) => void;
}): ReactElement {
  return (
    <div className="jobs-list-pane">
      {groups.map((group) => (
        <section className="job-group" key={group.stage} aria-label={group.stage}>
          <h2 className="job-group-head">
            <span>{group.stage}</span>
            <span className="job-group-count">{group.rows.length}</span>
          </h2>
          <div className="job-group-rows">
            {group.rows.map((row) => (
              <JobRow
                key={rowKey(row)}
                row={row}
                selected={rowKey(row) === selectedKey}
                onSelect={() => onSelect(row)}
                onOpenFile={onOpenFile}
                onAskTen={onAskTen}
              />
            ))}
          </div>
        </section>
      ))}
      {dismissed.length > 0 ? (
        <details className="job-group job-group--dismissed">
          <summary className="job-group-head">
            <Icon name="chevronDown" size={16} />
            <span>Dismissed</span>
            <span className="job-group-count">{dismissed.length}</span>
          </summary>
          <div className="job-group-rows">
            {dismissed.map((row) => (
              <JobRow
                key={rowKey(row)}
                row={row}
                selected={rowKey(row) === selectedKey}
                onSelect={() => onSelect(row)}
                onOpenFile={onOpenFile}
                onAskTen={onAskTen}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------
// The detail (restore ruling). Reads the chosen row's Analysis/Company
// file fresh when the row changes and again when a turn ends while it
// shows (§ 5.2 rule 4's restore-ruling note: "this covers a detail
// view's files too").
// ---------------------------------------------------------------------

/** § 5.3: "Each section body goes through `MarkdownView`, word for word"
 *  (§ 5.2 rule 8, the one viewer's own renderer — never a second,
 *  hand-rolled splitter, Stage 3b review B2). */
function FieldSection({ label, section }: { label: string; section: Section | undefined }): ReactElement | null {
  if (!section) return null;
  return (
    <div className="job-detail-section">
      <h3>{label}</h3>
      <MarkdownView content={section.body} />
    </div>
  );
}

function FieldFileBlock({
  state,
  onRetry,
  sections,
}: {
  state: FieldFileState;
  onRetry: () => void;
  sections: (sections: Section[]) => ReactNode;
}): ReactElement | null {
  if (state.kind === "absent") return null; // no field on the row at all
  if (state.kind === "missing") {
    // § 5.3: "A field that names a file which doesn't exist shows one
    // line in that part's place." (J13)
    return <p className="job-field-missing">{state.path} isn't in your workspace.</p>;
  }
  if (state.kind === "error") {
    return <ReadError path={state.path} onRetry={onRetry} />;
  }
  return <>{sections(state.sections)}</>;
}

function JobsDetail({
  row,
  store,
  onOpenFile,
  onAskTen,
  onOpenApplication,
  applicationFiles,
  turnRunning,
  onBack,
}: {
  row: JobsMdRow | undefined;
  store: WorkspaceStore;
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  onAskTen: (label: string) => void;
  onOpenApplication?: (key: string) => void;
  applicationFiles: FileInfo[];
  turnRunning: boolean;
  onBack: () => void;
}): ReactElement | null {
  const [analysis, setAnalysis] = useState<FieldFileState>({ kind: "absent" });
  const [company, setCompany] = useState<FieldFileState>({ kind: "absent" });
  const [attempt, setAttempt] = useState(0);
  const key = row ? rowKey(row) : undefined;
  // Stage 3b review, B5: a request token, bumped on every row change (and
  // every retry). A read that resolves after a NEWER request has started
  // is a stale read — its result is dropped, never applied over the row
  // that's showing now (a slow analysis read for row A must never land
  // under row B's header once B has been chosen).
  const requestIdRef = useRef(0);

  const loadFiles = async (r: JobsMdRow) => {
    const id = ++requestIdRef.current;
    const [a, c] = await Promise.all([loadFieldFile(store, r.analysis_file), loadFieldFile(store, r.company_file)]);
    if (requestIdRef.current !== id) return; // a later row/retry started; drop this one
    setAnalysis(a);
    setCompany(c);
  };

  useEffect(() => {
    if (row) void loadFiles(row);
    else {
      requestIdRef.current++; // cancel any read still in flight for the previous row
      setAnalysis({ kind: "absent" });
      setCompany({ kind: "absent" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const wasRunningRef = useRef(turnRunning);
  useEffect(() => {
    if (wasRunningRef.current && !turnRunning && row) void loadFiles(row);
    wasRunningRef.current = turnRunning;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnRunning]);

  if (!row) return null;

  const dealbreakers = dealbreakersDisplay(row);
  const applicationKey = applicationKeyForRow(row);
  const showOpenApplication = applicationKey !== undefined && hasLinkedApplication(applicationFiles, applicationKey);

  return (
    <div className="jobs-detail-pane">
      <button type="button" className="job-back-button" onClick={onBack}>
        <Icon name="arrowLeft" size={16} />
        Back to Jobs {/* J16 */}
      </button>

      <div className="job-detail-head">
        <h2>{roleLabel(row)}</h2>
        {row.location ? <p className="job-detail-location">{row.location}</p> : null}
        <div className="job-detail-dates">
          {datePart(row.seen_at) ? <span>Added {datePart(row.seen_at)}</span> : null}
          {datePart(row.updated_at) ? <span>Updated {datePart(row.updated_at)}</span> : null}
          {datePart(row.evaluated_at) ? <span>Evaluated {datePart(row.evaluated_at)}</span> : null}
        </div>
      </div>

      {row.dismissed ? (
        <div className="job-detail-dismissed">
          <p className="job-row-dismissed-from">{dismissedFromLabel(row)}</p>
          {row.dismiss_note ? <p className="job-row-dismissed-note">{row.dismiss_note}</p> : null}
        </div>
      ) : null}

      <div className="job-detail-verdict">
        <TierPill fitVerdict={row.fit_verdict} />
        {scoreDisplay(row.fit_score) ? <span className="job-detail-score">{scoreDisplay(row.fit_score)}</span> : null}
        <QuickScanBadge reason={row.fit_reason} />
        {row.fit_reason ? <p className="job-detail-reason">{row.fit_reason}</p> : null}
        {dealbreakers !== undefined ? <p className="job-detail-dealbreakers">Dealbreakers: {dealbreakers}</p> : null}
      </div>

      {row.url ? (
        <div className="job-detail-posting">
          <span className="job-detail-field-label">Posting</span>
          <PostingLink url={row.url} />
        </div>
      ) : null}

      {/* `key={key}`: forces a fresh subtree per row (React's own
          "resetting state with a key" pattern). Without it, two rows
          whose section bodies are BOTH plain bullet lists render
          structurally-identical MarkdownView output (one <ul>, no other
          block type ever flushes early) — found live: Fernway's "How you
          fit" list stayed mounted alongside Solstice's own after
          choosing Fernway then Solstice, because both keyed their sole
          child "end" and React reused the DOM node in a way that left a
          stray sibling instead of a clean replace. Never rely on content
          shape to imply identity; the ROW is the identity here. */}
      <FieldFileBlock
        key={`${key}-analysis`}
        state={analysis}
        onRetry={() => setAttempt((n) => n + 1)}
        sections={(sections) => (
          <>
            <FieldSection label="What the posting asks for" section={competencySection(sections)} />
            <FieldSection label="How you fit" section={fitSection(sections)} />
          </>
        )}
      />

      <FieldFileBlock
        key={`${key}-company`}
        state={company}
        onRetry={() => setAttempt((n) => n + 1)}
        sections={(sections) => (
          <>
            <FieldSection label={`About ${row.company}`} section={snapshotSection(sections)} />
            <FieldSection label="Culture and hiring signals" section={cultureSection(sections)} />
          </>
        )}
      />

      <div className="job-detail-controls">
        {row.analysis_file ? (
          <button
            type="button"
            className="btn btn--sec"
            onClick={(e) => onOpenFile(row.analysis_file as string, e.currentTarget)}
          >
            Open analysis
          </button>
        ) : (
          <span className="job-no-analysis">No analysis file linked</span>
        )}
        {row.company_file ? (
          <button
            type="button"
            className="btn btn--sec"
            onClick={(e) => onOpenFile(row.company_file as string, e.currentTarget)}
          >
            Open company notes
          </button>
        ) : null}
        {/* § 5.3 detail item 6: shows only on a row an application links
            to (jobs.ts's presence check, Stage 3b review). Clicking it
            is a no-op until Stage 3e wires `onOpenApplication` to 3d's
            Applications page WITH the entry chosen. */}
        {showOpenApplication ? (
          <button
            type="button"
            className="btn btn--sec"
            onClick={() => applicationKey && onOpenApplication?.(applicationKey)}
          >
            Open application
          </button>
        ) : null}
        <button type="button" className="btn btn--ghost" onClick={() => onAskTen(roleLabel(row))}>
          Ask Ten about this
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// JobsPage — the data-fetching container.
// ---------------------------------------------------------------------

export function JobsPage({
  store,
  onOpenFile,
  onAskTen,
  onOpenTalkToTen,
  onOpenApplication,
  turnRunning,
  initialStage,
}: JobsPageProps): ReactElement {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [phoneShowingDetail, setPhoneShowingDetail] = useState(false);
  const [applicationFiles, setApplicationFiles] = useState<FileInfo[]>([]);
  const initialStageRef = useRef(initialStage);
  // `.workspace-page` is the one scroll container (§ 5.6's shared list
  // pane); choosing a row far down the list must not leave the DETAIL
  // pane scrolled to wherever the row happened to sit (the browser keeps
  // a numeric scrollTop across the list<->detail swap, which the phone's
  // CSS-only swap, § 5.3 restore ruling, otherwise leaves pointing at
  // arbitrary detail content instead of its own header/back control).
  const pageRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const rows = await loadJobsRows(storeIo(store));
      setState({ kind: "ready", rows });
    } catch {
      setState({ kind: "error" });
    }
    try {
      setApplicationFiles(await store.list("applications"));
    } catch {
      setApplicationFiles([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const wasRunningRef = useRef(turnRunning);
  useEffect(() => {
    if (wasRunningRef.current && !turnRunning) void load();
    wasRunningRef.current = turnRunning;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnRunning]);

  // § 5.3, restore ruling: "the first row in page order is chosen, or
  // the first row of the stage a Home count opened; with no rows there
  // is no detail." Only defaults the SELECTION when nothing is selected
  // yet, or the previously selected row no longer exists in a fresh read
  // (a re-verdict never drops a row, but this keeps the page honest if
  // one ever is).
  useEffect(() => {
    if (state.kind !== "ready") return;
    const stillThere = selectedKey && state.rows.some((r) => rowKey(r) === selectedKey);
    if (stillThere) return;
    const stage = initialStageRef.current;
    const fallback = (stage ? firstRowOfStage(state.rows, stage) : undefined) ?? firstRowInPageOrder(state.rows);
    setSelectedKey(fallback ? rowKey(fallback) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (pageRef.current) pageRef.current.scrollTop = 0;
  }, [selectedKey]);

  const workingLine = turnRunning ? (
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
    // § 5.2 rule 6 (F40): the loud line names the file, "jobs.md" — never
    // a generic "your files" (Stage 3b review, B4).
    return (
      <div className="workspace-page">
        <div className="workspace-page-inner">
          {workingLine}
          <div className="page-error-card">
            <Icon name="circleAlert" size={18} />
            <p className="page-error-message">Couldn't read jobs.md. Try again in a moment.</p>
            <button type="button" className="btn btn--sec" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const groups = groupJobsByStage(state.rows);
  const dismissed = dismissedRows(state.rows);

  if (state.rows.length === 0) {
    return (
      <EmptyPage
        icon="briefcase"
        first="No roles yet." // J17
        rest="Paste a job link or a posting's text into the conversation." // J18
        cta="talk"
        onOpenTalkToTen={onOpenTalkToTen}
      />
    );
  }

  const selectedRow = state.rows.find((r) => rowKey(r) === selectedKey);

  return (
    <div className="workspace-page" ref={pageRef}>
      <div className={`workspace-page-inner jobs-page${phoneShowingDetail ? " jobs-page--detail" : ""}`}>
        {workingLine}
        <div className="jobs-page-panes">
          <JobsList
            groups={groups}
            dismissed={dismissed}
            selectedKey={selectedKey}
            onSelect={(row) => {
              setSelectedKey(rowKey(row));
              setPhoneShowingDetail(true);
            }}
            onOpenFile={onOpenFile}
            onAskTen={onAskTen}
          />
          <JobsDetail
            row={selectedRow}
            store={store}
            onOpenFile={onOpenFile}
            onAskTen={onAskTen}
            onOpenApplication={onOpenApplication}
            applicationFiles={applicationFiles}
            turnRunning={turnRunning}
            onBack={() => setPhoneShowingDetail(false)}
          />
        </div>
      </div>
    </div>
  );
}
