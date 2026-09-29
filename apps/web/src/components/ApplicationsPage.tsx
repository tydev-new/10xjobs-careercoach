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
// @ts-expect-error - plain .mjs, no type declarations (script-runner.ts's
// own posture for a skills/*/scripts/lib import).
import { load as loadJobsRows } from "../../../../skills/search/scripts/lib/jobs-md.mjs";
import { Icon } from "../icons.tsx";
import type { FileInfo, WorkspaceStore } from "../types.ts";
import { WorkspaceError } from "../types.ts";
import {
  groupApplications,
  linkedApplicationRow,
  nextFromYou,
  notesFilesOf,
  readApplicationTables,
  type ApplicationEntry,
  type ApplicationTables,
} from "../workspace/applications.ts";
import { stageSteps } from "../workspace/stage-steps.ts";
import { storeIo } from "../workspace/store-io.ts";
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

const WORKING_LINE = "Ten is working. This page updates when it finishes.";

// § 5.3 Applications: "Its stage from that row, or 'Dismissed' plus the
// note." No exact wording is given (unlike Jobs' own "Dismissed from
// <stage>", J5, which is a different field — jobs.md's `Was`, not
// shown on Applications). This coder's reading: "Dismissed" then the
// row's own `Dismissed` note, word for word, joined by ": " — reported
// to the lead as an ambiguity. Shared by the list row and the detail so
// the two never drift (rule 12).
function dismissedLabel(row: JobsRow): string {
  return row.dismiss_note ? `Dismissed: ${row.dismiss_note}` : "Dismissed";
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
  onAskTen,
}: {
  entry: ApplicationEntry;
  row: JobsRow | undefined;
  selected: boolean;
  onSelect: () => void;
  onAskTen: () => void;
}): ReactElement {
  const label = roleLabel(entry, row);
  return (
    <div className={`app-entry-row${selected ? " app-entry-row--selected" : ""}`}>
      <button type="button" className="app-entry-open" onClick={onSelect} aria-current={selected ? "true" : undefined}>
        <span className="app-entry-tile" aria-hidden="true">
          {(row ? row.company : label).charAt(0).toUpperCase()}
        </span>
        {/* Everything else stacks in ONE column (never a second column
            competing with the tile for width): at a narrow list-pane
            width (the list-plus-detail split, or the phone), a tier
            pill sitting BESIDE the label used to starve the label's own
            flex item down toward its min-width: 0 floor, wrapping it
            character by character (found live, this stage's own build:
            "Fernway Robotics" as a vertical column of single letters).
            Stacking removes the competing sibling entirely. */}
        <span className="app-entry-main">
          <span className="app-entry-label">{label}</span>
          {row ? (
            row.dismissed ? (
              <span className="app-entry-stage-pill">{dismissedLabel(row)}</span>
            ) : (
              <span className="app-entry-stage-pill">{row.stage}</span>
            )
          ) : (
            <span className="app-entry-unlinked">Not linked to a role on your job list.</span>
          )}
          {row?.fit_verdict ? (
            <span className="app-entry-tier">
              <TierPill verdict={row.fit_verdict} />
              {typeof row.fit_score === "number" ? <span className="app-entry-score">{row.fit_score}/100</span> : null}
            </span>
          ) : null}
        </span>
      </button>
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

function CoverageTable({ rows }: { rows: string[][] }): ReactElement | null {
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
            <td>{COVERAGE_STATUS_LABEL[r[1]] ?? r[1]}</td>
            <td>{COVERAGE_DECISION_LABEL[r[3]] ?? r[3]}</td>
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
          <p className="app-entry-stage-pill">{dismissedLabel(row)}</p>
        ) : row.stage ? (
          <StageStepsInline stage={row.stage} />
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
              <CoverageTable rows={detail.tables.coverage} />
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

// A thin wrapper so the detail imports the stage steps' logic the same
// way the list-pane pill and Jobs (later) will — kept local to avoid a
// second entry point into ../components/StageSteps.tsx's own props.
function StageStepsInline({ stage }: { stage: string }): ReactElement {
  return (
    <ol className="stage-steps" aria-label="Stage">
      {stageSteps(stage).map((step) => (
        <li
          key={step.label}
          className={`stage-step${step.current ? " stage-step--current" : ""}`}
          aria-current={step.current ? "step" : undefined}
        >
          <span className="stage-step-dot" aria-hidden="true" />
          <span className="stage-step-label">{step.label}</span>
        </li>
      ))}
    </ol>
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
  | { kind: "error" }
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
    try {
      const [files, rows] = await Promise.all([
        store.list("applications"),
        loadJobsRows(storeIo(store), "") as Promise<JobsRow[]>,
      ]);
      setList({ kind: "ready", entries: groupApplications(files), rows });
    } catch {
      setList({ kind: "error" });
    }
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
        if (!(err instanceof WorkspaceError && err.code === "resource_missing")) tablesError = true;
      }
    }

    let plan: PlanBoard | undefined;
    let planError = false;
    try {
      const file = await store.read("plan.md");
      plan = readPlanBoard(file.binary ? "" : file.content);
    } catch (err) {
      if (err instanceof WorkspaceError && err.code === "resource_missing") {
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
    return (
      <div className="workspace-page">
        <div className="workspace-page-inner">
          {workingLine}
          <div className="page-error-card">
            <Icon name="circleAlert" size={18} />
            <p className="page-error-message">Couldn't read your files. Try again in a moment.</p>
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
