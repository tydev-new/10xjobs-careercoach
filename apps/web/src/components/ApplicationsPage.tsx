// Applications (design-web-ui.md § 5.3 "Applications: the materials per
// role"; § 5.9 Stage 3d). Reads `store.list("applications")` and
// `jobs.md` (through the read-only store-io.ts adapter and the jobs_md
// port's own `load()`, the same reuse Home's pipeline counts and Jobs
// already use) fresh whenever it mounts, and again when a turn ends
// while it's showing (§ 5.2 rule 4) — for the chosen entry, its notes
// file and `plan.md` too (the restore ruling's own words: "a detail
// view's files too... read when the row or entry is chosen and again
// when a turn ends while it shows"). No window/document/localStorage/
// Node-only API.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { PlanBoard } from "../../../../packages/agent/src/plan-board.ts";
import { readPlanBoard } from "../../../../packages/agent/src/plan-board.ts";
import { load as loadJobsRows } from "../../../../skills/search/scripts/lib/jobs-md.mjs";
import { Icon } from "../icons.tsx";
import type { FileInfo, WorkspaceStore } from "../types.ts";
import {
  groupApplications,
  linkedApplicationRow,
  nextFromYou,
  notesFilesOf,
  readApplicationTables,
  type ApplicationEntry,
  type ApplicationTables,
} from "../workspace/applications.ts";
import { StageSteps } from "./StageSteps";
import { isMissingError, storeIo } from "../workspace/store-io.ts";
import { PlanItem } from "./PlanItem";
import { EmptyPage } from "./EmptyPage";
import { TierPill } from "./Cards.tsx";
import { UnreadableLines } from "./UnreadableLines";

// The jobs_md port's own row shape (skills/search/scripts/lib/jobs-md.mjs
// `load()`) — the fields this page reads from it. Optional/nullable
// exactly where the port leaves an absent field unset (design-web-ui.md
// § 5.3 Jobs: "no verdict shows 'Not evaluated yet'"; "no Score, no
// number").
export interface JobsRow {
  company: string;
  title: string;
  stage: string | null;
  dismissed: boolean;
  fit_verdict?: string | null;
  fit_score?: number | null;
  fit_reason?: string | null;
  dealbreakers?: string | null;
  analysis_file?: string | null;
  company_file?: string | null;
  seen_at?: string | null;
  updated_at?: string | null;
  evaluated_at?: string | null;
  was_stage?: string | null;
  dismiss_note?: string | null;
}

// § 5.3.1 AP9-AP11 (coverage status) and AP18-AP20 (coverage decision) —
// static label tables keyed by the file's own exact words (§ 5.2 rule 3
// allows this: "static label tables keyed by a file's exact words").
const COVERAGE_STATUS_LABEL: Record<string, string> = {
  have: "Covered",
  "shown-but-unnamed": "Shown, not in their words",
  gap: "Gap",
};
const COVERAGE_DECISION_LABEL: Record<string, string> = {
  open: "Not answered yet",
  answered: "Answered",
  skipped: "Skipped",
};

// Object.hasOwn, never a plain index + `?? key` fallback: a status or
// decision word that happens to spell an inherited Object.prototype
// property (`constructor`, `toString`, `hasOwnProperty`, `__proto__`)
// would read back that PROPERTY (a function, or the prototype itself),
// which `?? key` never catches (the lookup isn't `undefined`) — React
// then crashes trying to render a function as a child (found live, this
// review's own build). "Any other value as written" must hold for every
// string the file can carry, JS-object accidents included.
function labelFor(table: Record<string, string>, key: string): string {
  return Object.hasOwn(table, key) ? table[key] : key;
}

const WORKING_LINE = "Ten is working. This page updates when it finishes.";

// § 5.3 Applications: "Its stage from that row, or 'Dismissed' plus the
// note." "Dismissed" (P16, § 5.3.1) is the one word the pill everywhere
// else (Home's count cell, a Jobs group) already uses — the pill here
// stays that short word, never the note glued into it (a review finding:
// a long note inside the fixed-height pill overflowed it). The note is
// its own plain line, word for word, below the pill — the same split
// Jobs' own dismissed row already uses for its `Was`/`Dismissed` fields
// (§ 5.3 Jobs: "adds its Dismissed note word for word"). Shared by the
// list row and the detail so the two never drift (rule 12).
function DismissedStatus({ row }: { row: JobsRow }): ReactElement {
  return (
    <>
      <span className="app-entry-stage-pill">Dismissed</span>
      {row.dismiss_note ? <span className="app-entry-note">{row.dismiss_note}</span> : null}
    </>
  );
}

function roleLabel(entry: ApplicationEntry, row: JobsRow | undefined): string {
  if (row) return `${row.company} — ${row.title}`;
  const notes = notesFilesOf(entry);
  return (notes[0] ?? entry.files[0]).path;
}

function ReadError({ path, onRetry }: { path: string; onRetry: () => void }): ReactElement {
  return (
    <div className="page-error-card app-inline-error">
      <Icon name="circleAlert" size={18} />
      <p className="page-error-message">Couldn't read {path}. Try again in a moment.</p>
      <button type="button" className="btn btn--sec" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// The list pane
// ---------------------------------------------------------------------

function EntryRow({
  entry,
  row,
  selected,
  onSelect,
  onOpenFile,
  onAskTen,
}: {
  entry: ApplicationEntry;
  row: JobsRow | undefined;
  selected: boolean;
  onSelect: () => void;
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  onAskTen: () => void;
}): ReactElement {
  const label = roleLabel(entry, row);
  return (
    <div className={`app-entry-row${selected ? " app-entry-row--selected" : ""}`}>
      {/* The header: the initial tile, the role label, the stage pill
          (or "Not linked..."). § 5.3/§ 5.6 name no tier pill or score on
          the LIST entry (only Jobs' own row and this page's DETAIL show
          them, § 5.3 Applications detail part 1) — a review finding.
          `choose()`-style tests click this row's FIRST button, so it
          stays first in the markup, before the file rows below. */}
      <button type="button" className="app-entry-open" onClick={onSelect} aria-current={selected ? "true" : undefined}>
        <span className="app-entry-tile" aria-hidden="true">
          {(row ? row.company : label).charAt(0).toUpperCase()}
        </span>
        <span className="app-entry-main">
          <span className="app-entry-label">{label}</span>
          {row ? (
            row.dismissed ? (
              <DismissedStatus row={row} />
            ) : (
              <span className="app-entry-stage-pill">{row.stage}</span>
            )
          ) : (
            <span className="app-entry-unlinked">Not linked to a role on your job list.</span>
          )}
        </span>
      </button>
      {/* § 5.3 "Its files, each opening the viewer"; § 5.6 "Then its
          files as document rows, then Ask Ten about this" — on the LIST
          entry itself, not only the chosen entry's detail (a review
          finding: this page previously only showed files once a row was
          selected). Reuses Documents' own doc-row shape (rule 12: one
          file-row look everywhere a page lists files). */}
      <div className="app-entry-files">
        {entry.files.map((f) => (
          <div className="doc-row" key={f.path}>
            <button type="button" className="doc-row-open" onClick={(e) => onOpenFile(f.path, e.currentTarget)}>
              <Icon name="fileText" size={14} />
              <span className="doc-row-path">{f.path}</span>
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--ghost app-entry-ask" onClick={onAskTen}>
        Ask Ten about this
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// The detail pane
// ---------------------------------------------------------------------

interface DetailState {
  kind: "loading" | "ready" | "error";
  tables?: ApplicationTables;
  tablesError?: boolean;
  twoNotesFiles?: [string, string];
  plan?: PlanBoard;
  planError?: boolean;
}

function CoverageTable({ rows, statuses }: { rows: string[][]; statuses: string[] }): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <table className="app-coverage-table">
      <thead>
        <tr>
          <th>Asked for</th>
          <th>Your evidence</th>
          <th>Status</th>
          <th>Question to you</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r[0]}</td>
            <td>{r[2]}</td>
            {/* docs/workspace-review-drift, C § 19 (lead ruling
                2026-09-29): the status column KEYS on `statuses[i]` —
                run()'s own once-normalised status — never the raw cell,
                so `**gap**`/`` `gap` ``/`Gap` all match the same table
                row the reply used. But "a value outside the table shows
                as its cell is written" (C § 19; § 5.3 "any other value
                as written") — `**Partly**` normalises to `partly`, which
                is outside the table too, but the SHOWN text is the raw
                cell `**Partly**`, not the normalised `partly`: the
                fallback is `r[1]`, not `statuses[i]`. */}
            <td>{Object.hasOwn(COVERAGE_STATUS_LABEL, statuses[i]) ? COVERAGE_STATUS_LABEL[statuses[i]] : r[1]}</td>
            <td>{labelFor(COVERAGE_DECISION_LABEL, r[3])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CutList({ rows }: { rows: string[][] }): ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <ol className="app-cut-list">
      {rows.map((r, i) => (
        <li key={i}>
          <p className="app-cut-from">From {r[1]}</p>
          <p className="app-cut-bullet">{r[2]}</p>
          <p className="app-cut-why">{r[6]}</p>
        </li>
      ))}
    </ol>
  );
}

function ApplicationDetail({
  entry,
  row,
  detail,
  onOpenFile,
  onOpenJobsRow,
  onAskTen,
  onRetryTables,
  onRetryPlan,
  onBack,
}: {
  entry: ApplicationEntry;
  row: JobsRow | undefined;
  detail: DetailState;
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  onOpenJobsRow: (analysisPath: string) => void;
  onAskTen: (path: string) => void;
  onRetryTables: () => void;
  onRetryPlan: () => void;
  onBack: () => void;
}): ReactElement {
  const label = roleLabel(entry, row);
  const items = detail.plan ? nextFromYou(detail.plan, entry, row?.analysis_file) : [];

  return (
    <div className="app-detail">
      <button type="button" className="btn btn--ghost app-detail-back" onClick={onBack}>
        <Icon name="arrowLeft" size={16} />
        Back to Applications
      </button>

      {/* 1. The header */}
      <div className="app-detail-header">
        <h2 className="app-detail-title">{label}</h2>
        {row ? (
          <>
            {row.fit_verdict ? (
              <div className="app-detail-tier">
                <TierPill verdict={row.fit_verdict} />
                {typeof row.fit_score === "number" ? <span className="app-entry-score">{row.fit_score}/100</span> : null}
              </div>
            ) : null}
            {row.analysis_file ? (
              <button type="button" className="btn btn--sec" onClick={() => onOpenJobsRow(row.analysis_file as string)}>
                Role details
              </button>
            ) : null}
          </>
        ) : (
          <p className="app-entry-unlinked">Not linked to a role on your job list.</p>
        )}
      </div>

      {/* 2. Where it stands */}
      {row ? (
        row.dismissed ? (
          <div className="app-detail-dismissed">
            <DismissedStatus row={row} />
          </div>
        ) : row.stage ? (
          <StageSteps stage={row.stage} />
        ) : null
      ) : null}

      {/* 3. Its files */}
      <div className="app-detail-files">
        {entry.files.map((f) => (
          <div className="doc-row" key={f.path}>
            <button type="button" className="doc-row-open" onClick={(e) => onOpenFile(f.path, e.currentTarget)}>
              <Icon name="fileText" size={16} />
              <span className="doc-row-path">{f.path}</span>
            </button>
          </div>
        ))}
      </div>

      {/* 4. Next, from you */}
      {items.length > 0 ? (
        <div className="app-detail-section">
          <h3>Next, from you</h3>
          <ul className="plan-item-list">
            {items.map((item, i) => (
              <PlanItem key={i} item={item} onOpenRef={onOpenFile} />
            ))}
          </ul>
        </div>
      ) : detail.planError ? (
        <ReadError path="plan.md" onRetry={onRetryPlan} />
      ) : null}

      {/* 5 & 6: the notes file's tables */}
      {detail.twoNotesFiles ? (
        <p className="app-two-notes-files">
          This role has two notes files, {detail.twoNotesFiles[0]} and {detail.twoNotesFiles[1]}, so this page shows
          neither's tables. Ask Ten which one to keep.
        </p>
      ) : detail.tablesError ? (
        <ReadError path={(notesFilesOf(entry)[0] ?? entry.files[0]).path} onRetry={onRetryTables} />
      ) : detail.tables ? (
        <>
          {detail.tables.coverage && detail.tables.coverage.length > 0 ? (
            <div className="app-detail-section">
              <h3>What the posting asks for, and your evidence</h3>
              <CoverageTable rows={detail.tables.coverage} statuses={detail.tables.statuses ?? []} />
            </div>
          ) : null}
          {detail.tables.cuts && detail.tables.cuts.length > 0 ? (
            <div className="app-detail-section">
              <h3>What Ten cut, weakest fit first</h3>
              <CutList rows={detail.tables.cuts} />
            </div>
          ) : null}
          {detail.tables.unreadable.length > 0 ? (
            <UnreadableLines
              path={(notesFilesOf(entry)[0] ?? entry.files[0]).path}
              lines={detail.tables.unreadable.map((r) => r.join(" | "))}
              onOpenRef={onOpenFile}
            />
          ) : null}
        </>
      ) : null}

      <button type="button" className="btn btn--ghost" onClick={() => onAskTen(label)}>
        Ask Ten about this
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// ApplicationsPage — the data-fetching container
// ---------------------------------------------------------------------

export interface ApplicationsPageProps {
  store: WorkspaceStore;
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  onAskTen: (path: string) => void;
  onOpenTalkToTen: () => void;
  /** "an application's 'Role details' opens Jobs with the linked row
   *  chosen" (§ 5.4). The Jobs page (Stage 3b) doesn't exist in this
   *  build yet, so there's nothing that reads this selection today —
   *  Frame.tsx's own `chosenJobsAnalysisPath` state (added by this
   *  stage) just remembers it, ready for 3b to consume. */
  onOpenJobsRow: (analysisPath: string) => void;
  turnRunning: boolean;
  /** Set from outside (Home's "Open", a future Jobs detail's "Open
   *  application" — neither exists in this build yet): opens Applications
   *  with this entry's key already chosen. `undefined` means "no
   *  external choice" — "the first entry in page order is chosen." */
  selectedKey?: string;
}

type ListState =
  | { kind: "loading" }
  // `path`: set when `jobs.md` specifically failed to read (F40 names it);
  // absent when `store.list("applications")` itself failed (no single
  // path to name, the generic "your files" line, unchanged).
  | { kind: "error"; path?: string }
  | { kind: "ready"; entries: ApplicationEntry[]; rows: JobsRow[] };

export function ApplicationsPage({
  store,
  onOpenFile,
  onAskTen,
  onOpenTalkToTen,
  onOpenJobsRow,
  turnRunning,
  selectedKey,
}: ApplicationsPageProps): ReactElement {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [listAttempt, setListAttempt] = useState(0);
  const [chosenKey, setChosenKey] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<DetailState>({ kind: "loading" });
  const [detailAttemptTables, setDetailAttemptTables] = useState(0);
  const [detailAttemptPlan, setDetailAttemptPlan] = useState(0);

  const loadList = useCallback(async () => {
    setList((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    let files: FileInfo[];
    try {
      files = await store.list("applications");
    } catch {
      // No single path names a directory listing — the same generic
      // line Documents' own list() failure uses.
      setList({ kind: "error" });
      return;
    }
    let rows: JobsRow[];
    try {
      // The port's own `load()` calls `io.exists("jobs.md")` first
      // (store-io.ts's `isMissingError`, now shared with Home) — a
      // genuinely MISSING jobs.md returns [] here without throwing
      // (§ 5.2 rule 6, "missing is empty"); anything this catch DOES
      // see is jobs.md unreadable for a real reason, named below (F40).
      rows = (await loadJobsRows(storeIo(store), "")) as JobsRow[];
    } catch {
      setList({ kind: "error", path: "jobs.md" });
      return;
    }
    setList({ kind: "ready", entries: groupApplications(files), rows });
  }, [store]);

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList, listAttempt]);

  const wasRunningRef = useRef(turnRunning);
  useEffect(() => {
    if (wasRunningRef.current && !turnRunning) setListAttempt((n) => n + 1);
    wasRunningRef.current = turnRunning;
  }, [turnRunning]);

  // "When Applications opens, the first entry in page order is chosen,
  // or the entry that Home's card or a Jobs detail opened" — an external
  // `selectedKey` always wins the moment it names an entry that exists;
  // otherwise the first entry in `entries`' own order.
  const lastExternalKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (list.kind !== "ready") return;
    if (selectedKey !== undefined && selectedKey !== lastExternalKey.current) {
      lastExternalKey.current = selectedKey;
      if (list.entries.some((e) => e.key === selectedKey)) {
        setChosenKey(selectedKey);
        return;
      }
    }
    if (chosenKey === undefined || !list.entries.some((e) => e.key === chosenKey)) {
      setChosenKey(list.entries[0]?.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, selectedKey]);

  const chosenEntry =
    list.kind === "ready" ? list.entries.find((e) => e.key === chosenKey) : undefined;
  const chosenRow =
    list.kind === "ready" && chosenEntry ? linkedApplicationRow(chosenEntry, list.rows) : undefined;

  const loadDetail = useCallback(async () => {
    if (!chosenEntry) return;
    setDetail({ kind: "loading" });
    const notes = notesFilesOf(chosenEntry);
    let tables: ApplicationTables | undefined;
    let tablesError = false;
    let twoNotesFiles: [string, string] | undefined;
    if (notes.length === 2) {
      const sorted = [...notes].sort((a, b) => (a.path < b.path ? -1 : 1));
      twoNotesFiles = [sorted[0].path, sorted[1].path];
    } else if (notes.length === 1) {
      try {
        const file = await store.read(notes[0].path);
        tables = readApplicationTables(file.binary ? "" : file.content);
      } catch (err) {
        if (!isMissingError(err)) tablesError = true;
      }
    }

    let plan: PlanBoard | undefined;
    let planError = false;
    try {
      const file = await store.read("plan.md");
      plan = readPlanBoard(file.binary ? "" : file.content);
    } catch (err) {
      if (isMissingError(err)) {
        plan = { sections: [] };
      } else {
        planError = true;
      }
    }

    setDetail({ kind: "ready", tables, tablesError, twoNotesFiles, plan, planError });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, chosenEntry?.key]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, detailAttemptTables, detailAttemptPlan]);

  const detailWasRunningRef = useRef(turnRunning);
  useEffect(() => {
    if (detailWasRunningRef.current && !turnRunning) {
      setDetailAttemptTables((n) => n + 1);
    }
    detailWasRunningRef.current = turnRunning;
  }, [turnRunning]);

  const [phoneDetailOpen, setPhoneDetailOpen] = useState(false);

  const select = (key: string): void => {
    setChosenKey(key);
    setPhoneDetailOpen(true);
  };

  const workingLine = turnRunning ? (
    <div className="page-working-line" role="status">
      <Icon name="loaderCircle" size={14} className="spin" />
      {WORKING_LINE}
    </div>
  ) : null;

  if (list.kind === "loading") {
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

  if (list.kind === "error") {
    // § 5.3.1 F40: "jobs.md" names the one path that actually failed
    // (jobs.md unreadable for a real reason, never missing — § 5.2 rule
    // 6, isMissingError already turned "missing" into an empty rows
    // list before this state is ever reached). `store.list()` itself
    // failing names no single path — Documents' own generic line.
    const message = list.path ? `Couldn't read ${list.path}. Try again in a moment.` : "Couldn't read your files. Try again in a moment.";
    return (
      <div className="workspace-page">
        <div className="workspace-page-inner">
          {workingLine}
          <div className="page-error-card">
            <Icon name="circleAlert" size={18} />
            <p className="page-error-message">{message}</p>
            <button type="button" className="btn btn--sec" onClick={() => setListAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (list.entries.length === 0) {
    return (
      <EmptyPage
        icon="layers"
        first="No applications yet."
        rest="Ask Ten to draft a résumé and letter for a role, and they show here."
        cta="talk"
        onOpenTalkToTen={onOpenTalkToTen}
      />
    );
  }

  return (
    <div className={`workspace-page applications-page${phoneDetailOpen ? " applications-page--detail-open" : ""}`}>
      <div className="applications-list">
        {workingLine}
        {list.entries.map((entry) => (
          <EntryRow
            key={entry.key}
            entry={entry}
            row={linkedApplicationRow(entry, list.rows)}
            selected={entry.key === chosenKey}
            onSelect={() => select(entry.key)}
            onOpenFile={onOpenFile}
            onAskTen={() => onAskTen(roleLabel(entry, linkedApplicationRow(entry, list.rows)))}
          />
        ))}
      </div>
      <div className="applications-detail-pane">
        {chosenEntry ? (
          <ApplicationDetail
            entry={chosenEntry}
            row={chosenRow}
            detail={detail}
            onOpenFile={onOpenFile}
            onOpenJobsRow={onOpenJobsRow}
            onAskTen={onAskTen}
            onRetryTables={() => setDetailAttemptTables((n) => n + 1)}
            onRetryPlan={() => setDetailAttemptPlan((n) => n + 1)}
            onBack={() => setPhoneDetailOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
