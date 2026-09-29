// Home: the state of the search (design-web-ui.md § 5.3). `HomeView` is
// the PURE component the restore ruling names ("Home's view is a pure
// component") — it takes only what the readers returned as props, never
// touches the store or `useChat` itself, so 3f's sign-in preview can
// render the exact same view from `signin-preview.json`'s props. `Home`
// (below) is the small data-fetching wrapper: it reads plan.md and
// jobs.md through the store every time it's shown, and again when a turn
// ends while it's showing (§ 5.2 rule 4) — no copy kept (rule 12).
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { PlanBoardSection } from "../../../../packages/agent/src/plan-board.ts";
import { readPlanBoard } from "../../../../packages/agent/src/plan-board.ts";
import { Icon } from "../icons.tsx";
import type { AppMessage, WorkspaceStore } from "../types.ts";
import { WorkspaceError } from "../types.ts";
import {
  lastReply as readLastReply,
  minutesSum as readMinutesSum,
  type ChatRawStatus,
  type LastReply,
  type MinutesSum,
} from "../workspace/home-reader.ts";
import { pipelineCounts, type PipelineCounts } from "../workspace/pipeline.ts";
import { storeIo } from "../workspace/store-io.ts";
import { PlanItem } from "./PlanItem";
import { UnreadableLines } from "./UnreadableLines";

export interface HomeViewProps {
  goalLine?: string;
  budgetLine?: string;
  pipeline?: PipelineCounts;
  pipelineReadError: boolean;
  planReadError: boolean;
  waitingOnYou?: PlanBoardSection;
  toDo?: PlanBoardSection;
  minutes?: MinutesSum;
  lastReply?: LastReply;
  working: boolean;
  /** design-web-ui.md § 5.3.1 (docs/workspace-labels, tip 091e094): the
   *  EMPTY state's button is P3 "Talk to Ten" while no conversation is
   *  saved yet (landing.ts's own "no conversation is saved" test,
   *  `messages.length === 0`), H3 "Continue with Ten" once one is —
   *  even though plan.md/jobs.md are still both empty either way. */
  hasConversation: boolean;
  onOpenRef: (ref: string) => void;
  onContinueWithTen: () => void;
  onOpenTalkToTen: () => void;
  onOpenJobs: () => void;
  onRetryPlan: () => void;
  onRetryPipeline: () => void;
}

function sectionEmpty(section: PlanBoardSection | undefined): boolean {
  return !section || (section.items.length === 0 && section.unreadable.length === 0);
}

function ReadError({ path, onRetry }: { path: string; onRetry: () => void }): ReactElement {
  return (
    <div className="home-read-error">
      <Icon name="circleAlert" size={18} />
      <p>Couldn't read {path}. Try again in a moment.</p>
      <button type="button" className="btn btn--sec" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function PlanColumn({
  icon,
  title,
  section,
  minutes,
  onOpenRef,
}: {
  icon: "user" | "listTodo";
  title: string;
  section: PlanBoardSection | undefined;
  minutes?: MinutesSum;
  onOpenRef: (ref: string) => void;
}): ReactElement {
  return (
    <div className="home-plan-column">
      <div className="home-plan-column-head">
        <Icon name={icon} size={16} />
        <h3>{title}</h3>
        {minutes ? (
          <span className="home-minutes-sum">
            {minutes.n} of your {minutes.m} min a day
          </span>
        ) : null}
      </div>
      {sectionEmpty(section) && (!section || section.unreadable.length === 0) ? (
        <p className="home-plan-empty">Nothing here right now.</p>
      ) : (
        <>
          {section && section.items.length > 0 ? (
            <ul className="plan-item-list">
              {section.items.map((item, i) => (
                <PlanItem key={i} item={item} onOpenRef={onOpenRef} />
              ))}
            </ul>
          ) : null}
          {section && section.unreadable.length > 0 ? (
            <UnreadableLines path="plan.md" lines={section.unreadable} onOpenRef={onOpenRef} />
          ) : null}
        </>
      )}
    </div>
  );
}

export function HomeView(props: HomeViewProps): ReactElement {
  const {
    goalLine,
    budgetLine,
    pipeline,
    pipelineReadError,
    planReadError,
    waitingOnYou,
    toDo,
    minutes,
    lastReply,
    working,
    hasConversation,
    onOpenRef,
    onContinueWithTen,
    onOpenTalkToTen,
    onOpenJobs,
    onRetryPlan,
    onRetryPipeline,
  } = props;

  const planEmpty = !goalLine && !budgetLine && sectionEmpty(waitingOnYou) && sectionEmpty(toDo);
  const pipelineEmpty = !pipeline || (pipeline.stages.every((s) => s.count === 0) && pipeline.dismissed === 0);
  const isEmpty = !planReadError && !pipelineReadError && planEmpty && pipelineEmpty;

  // design-web-ui.md § 5.3.1 (docs/workspace-labels, C10): the band's own
  // label is H1 ("Ten · last reply") when a reply shows, H4 ("Talk to
  // Ten") when none does — Continue with Ten (H3) always sits in the same
  // band either way (§ 5.6 restore text: "Ten's last reply in the --hero
  // band ... Continue with Ten").
  const band = (
    <div className="home-continue-band">
      <div className="home-continue-content">
        <div className="home-continue-label">
          <Icon name="messageSquare" size={20} />
          <span>{lastReply ? "Ten · last reply" : "Talk to Ten"}</span>
        </div>
        {lastReply ? (
          <>
            <p className="home-last-reply-quote">{lastReply.quote}</p>
            {lastReply.activityLines.map((line, i) => (
              <div className="home-activity-line" key={i}>
                {line}
              </div>
            ))}
          </>
        ) : null}
      </div>
      <button type="button" className="btn btn--lime" onClick={onContinueWithTen}>
        Continue with Ten
        <Icon name="arrowRight" size={16} />
      </button>
    </div>
  );

  const workingLine = working ? (
    <div className="home-working">
      <Icon name="loaderCircle" size={15} className="spin" />
      <span>Ten is working. This page updates when it finishes.</span>
    </div>
  ) : null;

  if (isEmpty) {
    // "Ten's last reply still shows above it when one qualifies" (§ 5.3
    // Home, Empty) — the SAME band as the non-empty layout, so H1/H4 and
    // the quote never have a second rendering to drift from the first
    // (rule 12); the plain empty-state message and its own button sit
    // under it (§ 5.6 "Empty state").
    return (
      <div className="page-home">
        {workingLine}
        {lastReply ? band : null}
        <div className="page-empty">
          <div className="page-empty-icon" aria-hidden="true">
            <Icon name="house" size={26} />
          </div>
          <p className="page-empty-title">Nothing here yet.</p>
          <p className="page-empty-body">Talk to Ten to start your plan and your job list; they show here.</p>
          {hasConversation ? (
            <button type="button" className="btn btn--lime" onClick={onContinueWithTen}>
              Continue with Ten
            </button>
          ) : (
            <button type="button" className="btn btn--sec" onClick={onOpenTalkToTen}>
              Talk to Ten
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page-home">
      {planReadError ? (
        <ReadError path="plan.md" onRetry={onRetryPlan} />
      ) : (
        <>
          {goalLine ? <p className="home-goal">{goalLine}</p> : null}
          {budgetLine ? <p className="home-budget">{budgetLine}</p> : null}
        </>
      )}

      {workingLine}

      {pipelineReadError ? (
        <ReadError path="jobs.md" onRetry={onRetryPipeline} />
      ) : pipeline ? (
        <div className="home-pipeline" role="group" aria-label="Your job list">
          {pipeline.stages.map((s) => (
            <button type="button" key={s.label} className="home-pipeline-cell" onClick={onOpenJobs}>
              <span className="home-pipeline-label">{s.label}</span>
              <span className={`home-pipeline-count${s.count === 0 ? " home-pipeline-count--zero" : ""}`}>
                {s.count}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="home-pipeline-cell home-pipeline-cell--dismissed"
            onClick={onOpenJobs}
          >
            <span className="home-pipeline-label">Dismissed</span>
            <span className={`home-pipeline-count${pipeline.dismissed === 0 ? " home-pipeline-count--zero" : ""}`}>
              {pipeline.dismissed}
            </span>
          </button>
        </div>
      ) : null}

      {!planReadError ? (
        <div className="home-plan-columns">
          <PlanColumn icon="user" title="Waiting on you" section={waitingOnYou} onOpenRef={onOpenRef} />
          <PlanColumn icon="listTodo" title="To do" section={toDo} minutes={minutes} onOpenRef={onOpenRef} />
        </div>
      ) : null}

      {band}
    </div>
  );
}

// ---------------------------------------------------------------------
// Home — the data-fetching container. Reads plan.md and jobs.md through
// the store on mount and on every re-mount, and again whenever the frame
// tells it a turn just ended (`chatStatus` flipping to "ready"/"error");
// nothing is cached beyond the current render (§ 5.2 rule 4). Missing is
// empty (`resource_missing`); any other failure is the loud § 5.2 rule 6
// error, kept separate per section so one file's trouble never hides the
// other's content.
export function Home({
  store,
  messages,
  chatStatus,
  onOpenRef,
  onContinueWithTen,
  onOpenTalkToTen,
  onOpenJobs,
}: {
  store: WorkspaceStore;
  messages: AppMessage[];
  chatStatus: ChatRawStatus;
  onOpenRef: (ref: string) => void;
  onContinueWithTen: () => void;
  onOpenTalkToTen: () => void;
  onOpenJobs: () => void;
}): ReactElement {
  const [planState, setPlanState] = useState<{ goalLine?: string; budgetLine?: string; waitingOnYou?: PlanBoardSection; toDo?: PlanBoardSection; error: boolean }>({ error: false });
  const [pipelineState, setPipelineState] = useState<{ counts?: PipelineCounts; error: boolean }>({ error: false });
  const [planRetryToken, setPlanRetryToken] = useState(0);
  const [pipelineRetryToken, setPipelineRetryToken] = useState(0);

  const loadPlan = useCallback(async () => {
    try {
      const file = await store.read("plan.md");
      const board = readPlanBoard(file.binary ? "" : file.content);
      setPlanState({
        goalLine: board.goalLine,
        budgetLine: board.budgetLine,
        waitingOnYou: board.sections.find((s) => s.label === "Waiting on you"),
        toDo: board.sections.find((s) => s.label === "To do"),
        error: false,
      });
    } catch (err) {
      if (err instanceof WorkspaceError && err.code === "resource_missing") {
        setPlanState({ error: false });
      } else {
        setPlanState({ error: true });
      }
    }
  }, [store]);

  const loadPipeline = useCallback(async () => {
    try {
      const counts = await pipelineCounts(storeIo(store));
      setPipelineState({ counts, error: false });
    } catch {
      setPipelineState({ error: true });
    }
  }, [store]);

  // § 5.2 rule 4: fresh on every show (this effect, on mount), and again
  // when a turn ends while Home is showing (the next effect, below).
  useEffect(() => {
    void loadPlan();
  }, [loadPlan, planRetryToken]);
  useEffect(() => {
    void loadPipeline();
  }, [loadPipeline, pipelineRetryToken]);
  // "Again when a turn ends" — never on the FIRST render too: chatStatus
  // is already "ready" the moment Home mounts on a restored conversation
  // (no turn is running), so without this guard this effect fired
  // alongside the two mount-reads above and read plan.md/jobs.md twice on
  // every show (found live: stage3a-review's store-read spy, expecting
  // exactly the files a page actually needed, caught the doubled reads).
  // A ref (not state) so the guard itself never re-triggers a render.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (chatStatus === "ready" || chatStatus === "error") {
      void loadPlan();
      void loadPipeline();
    }
  }, [chatStatus, loadPlan, loadPipeline]);

  const working = chatStatus === "submitted" || chatStatus === "streaming";
  const lastReply = readLastReply(messages, chatStatus);
  const minutes = readMinutesSum(planState.toDo, planState.budgetLine);

  return (
    <HomeView
      goalLine={planState.goalLine}
      budgetLine={planState.budgetLine}
      waitingOnYou={planState.waitingOnYou}
      toDo={planState.toDo}
      planReadError={planState.error}
      pipeline={pipelineState.counts}
      pipelineReadError={pipelineState.error}
      minutes={minutes}
      lastReply={lastReply}
      working={working}
      hasConversation={messages.length > 0}
      onOpenRef={onOpenRef}
      onContinueWithTen={onContinueWithTen}
      onOpenTalkToTen={onOpenTalkToTen}
      onOpenJobs={onOpenJobs}
      onRetryPlan={() => setPlanRetryToken((v) => v + 1)}
      onRetryPipeline={() => setPipelineRetryToken((v) => v + 1)}
    />
  );
}
