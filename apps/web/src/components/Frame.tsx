// The workspace frame (design-web-ui.md § 5.1): one Frame wraps both
// ChatShell (mock) and RealChatShell (real) — the rail, the header, app-
// state page switching, the landing rule, and the phone tab bar. The
// conversation itself (Transcript + Composer + the viewer) is owned by
// the caller and passed in as `talkToTen`; Frame only decides WHICH page
// shows, never reads or sends anything of its own (§ 5.2 rules 1 and 2 —
// Frame's own page components receive only `messages` and `status` from
// `useChat`; never the `useChat` object itself). Stage 3a adds Documents
// (§ 5.3): `listDocuments`/`onOpenFile` are the caller's own `store.list()`
// and `handleOpen`, not `useChat`, so this still holds — Documents never
// gets `sendMessage` or any other `useChat` function.
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Header, type HeaderProps } from "./Header";
import { Rail } from "./Rail";
import { TabBar } from "./TabBar";
import { EmptyPage } from "./EmptyPage";
import { DocumentsPage } from "./DocumentsPage";
import { ApplicationsPage } from "./ApplicationsPage";
import { Home } from "./Home";
import { JobsPage } from "./JobsPage";
import { VersionNotice, type VersionNoticeMode } from "../real/VersionNotice";
import { landingPage } from "../workspace/landing.ts";
import { buildAskTenDraft } from "../workspace/ask-ten.ts";
import type { ChatRawStatus } from "../workspace/home-reader.ts";
import type { AppMessage, FileInfo, Page, Status, WorkspaceStore } from "../types.ts";

export interface FrameVersionNotice {
  mode: VersionNoticeMode;
  saveFailed: boolean;
}

export interface FrameProps extends Omit<HeaderProps, "pageTitle"> {
  messages: AppMessage[];
  status: Status;
  /** The RAW `useChat().status` ("submitted" | "streaming" | "ready" |
   *  "error") — Home's own reader needs this (design-web-ui.md § 5.3,
   *  "Ten's last reply") to tell a turn that's still running apart from
   *  one that just ended in error, which the derived avatar `status`
   *  above can't (both collapse to "done"). § 5.2 rule 1: Home receives
   *  only `messages` and this — never the `useChat` object itself. */
  chatStatus: ChatRawStatus;
  /** The same `WorkspaceStore` instance the agent uses (C § 2) — Home
   *  reads `plan.md`/`jobs.md` through it, fresh every time it's shown
   *  (§ 5.2 rules 1 and 4). Pages never write; this is a read-only use of
   *  the store's own `read`/`list`. */
  store: WorkspaceStore;
  /** True when the shell knows no conversation is saved yet (§ 5.3 Home
   *  Empty; § 5.3.1 P3): Home's empty-state button then reads "Talk to
   *  Ten" instead of Continue with Ten. Only the real shell sets it — it
   *  restores the saved conversation (C § 11). The mock shell has no
   *  conversation store, so "saved" means nothing there; it leaves this
   *  unset and Home keeps H3 (what stage2-review pins on the mock). */
  noConversationSaved?: boolean;
  /** Opens a chip's file in the pinned viewer — the same mechanism a
   *  card's `ref` already uses (§ 1.1); Frame forwards it to whichever
   *  page needs it (today, only Home's plan items). `opener` is the chip
   *  or link clicked, so Back/Escape return focus to it (§ 5.5). */
  onOpenRef: (ref: string, opener?: HTMLElement) => void;
  /** The Talk to Ten page's own content — Transcript, Composer, the
   *  empty-first-run line: unchanged from today, just now shown or hidden
   *  by Frame instead of being the only page there is. Always mounted
   *  (§ 5.1, "The conversation stays mounted") — Frame only hides it with
   *  CSS when another page is chosen, it never unmounts it. */
  talkToTen: ReactNode;
  /** The pinned viewer (SidePanel) — a sibling of the page area on every
   *  page (§ 5.2 rule 8, one viewer); Stage 2's other pages have nothing
   *  to open yet, so it only ever shows something when Talk to Ten (or a
   *  card `ref`) opened it. */
  sidePanel: ReactNode;
  /** § 5.6 "Page layouts (Stage 2)", the viewer bullet: "on Home it
   *  appears only while a file is open" — true whenever the caller's own
   *  `openFile` state (whatever last set the pinned viewer's content) is
   *  set, regardless of which page opened it. Every other page always
   *  shows the pinned viewer, `undefined` reading as "Nothing open yet."
   *  (unaffected by this flag; ChatShell/RealChatShell already own that). */
  viewerOpen: boolean;
  /** § 1.8/§ 5.1: "the new-version check runs in the frame, so its notice
   *  shows on every page." The Talk to Ten page keeps rendering its OWN
   *  copy directly above the composer (unchanged, C § 10) — this prop
   *  only feeds the copy Frame shows above every OTHER page, from the
   *  same state, never a UI-only re-derivation of it. `undefined` (the
   *  mock never passes this) means no notice anywhere. */
  versionNotice?: FrameVersionNotice;
  /** Focuses the composer once Frame switches TO Talk to Ten (§ 5.4,
   *  "Continue with Ten... composer focused"). Optional: a caller with no
   *  composer ref (none today) simply navigates without focusing. */
  onFocusComposer?: () => void;
  /** Stage 3a, Documents (§ 5.3): `store.list()` — the SAME WorkspaceStore
   *  instance the agent uses (§ 5.2 rule 1), threaded down from the
   *  caller (ChatShell / RealChatShell already hold it for the composer's
   *  upload and the side panel's reads). */
  listDocuments: () => Promise<FileInfo[]>;
  /** Opens a path in the pinned viewer (§ 5.2 rule 8) — the caller's own
   *  `handleOpen`, the exact function Talk to Ten's chips and cards call.
   *  `opener` (R2 fix, § 5.5) is the clicked/tapped element itself, for
   *  the viewer's focus-return on close — never guessed from
   *  `document.activeElement`, which WebKit leaves at BODY after a tap. */
  onOpenFile: (path: string, opener?: HTMLElement) => void;
  /** The composer's current text and its setter (§ 5.4, "Ask Ten about
   *  this... only when the composer is empty; unsent text is never
   *  overwritten"). Frame decides whether to write the draft; it never
   *  reads or clears this on its own otherwise. */
  composerValue: string;
  onComposerDraft: (text: string) => void;
}

const PAGE_TITLE: Record<Page, string> = {
  home: "Home",
  talk: "Talk to Ten",
  jobs: "Jobs",
  applications: "Applications",
  documents: "Documents",
};

export function Frame(props: FrameProps): ReactElement {
  const {
    messages,
    status,
    chatStatus,
    store,
    noConversationSaved,
    onOpenRef,
    talkToTen,
    sidePanel,
    viewerOpen,
    versionNotice,
    onFocusComposer,
    listDocuments,
    onOpenFile,
    composerValue,
    onComposerDraft,
    ...headerProps
  } = props;
  // The landing rule runs ONCE, at mount, off the messages Frame is
  // mounted with (design-web-ui.md § 5.1, "Where the app opens") — never
  // re-run as messages change during the session: a gate opening while
  // Jobs is showing must never navigate the candidate away on its own
  // (§ 5.1, "A gate while you're elsewhere").
  const [page, setPage] = useState<Page>(() => landingPage(messages));
  const needsYou = status.state === "needs-you";

  // § 5.4 names composer-focus for exactly ONE control — Home's own
  // "Continue with Ten" ("opens Talk to Ten, composer focused, no
  // draft"). The other empty pages' plain "Talk to Ten" button, and
  // plain rail/tab-bar navigation, are never named there, so neither
  // focuses it: reaching Talk to Ten that way must not hide the tab bar
  // it was just tapped from (`:has(.composer:focus-within)`, § 5.5) —
  // measured regression: the NEXT tab in line became unreachable (a
  // still-focused composer hiding the bar) the moment any of these
  // opened Talk to Ten.
  const focusOnArrivalRef = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const navigate = (next: Page, focusOnArrival = false): void => {
    focusOnArrivalRef.current = focusOnArrival;
    setPage(next);
  };
  const openTalkToTen = (): void => navigate("talk", false);
  const continueWithTen = (): void => navigate("talk", true);

  // "Ask Ten about this" (§ 5.4): puts `About <path>: ` in the composer
  // ONLY when it's empty ("unsent text is never overwritten"), then opens
  // Talk to Ten — same as the plain rail/tab-bar navigation above, this
  // never focuses the composer (§ 5.4 names composer-focus for Continue
  // with Ten alone). Never sends (§ 5.2 rule 2).
  // N6 (Stage 3a review): "empty" means the empty STRING, never
  // `.trim() === ""` — a composer holding only spaces is still unsent
  // text a candidate typed and would lose (§ 1.8's own rule: "unsent
  // text is something a candidate can lose"), so it must never be
  // silently replaced by a draft either.
  const askTenAbout = (path: string): void => {
    if (composerValue === "") onComposerDraft(buildAskTenDraft(path));
    openTalkToTen();
  };

  // § 5.4 "Pages to pages": "an application's 'Role details' opens Jobs
  // with the linked row chosen." Stage 3b (Jobs, in parallel) hasn't
  // landed in this build yet — Jobs still renders as EmptyPage below, so
  // nothing consumes `chosenJobsAnalysisPath` today. This is the minimal
  // forward wiring 3b needs: the state that remembers which row to
  // select once Jobs has a detail to select it in. Reported to the lead.
  const [chosenJobsAnalysisPath, setChosenJobsAnalysisPath] = useState<string | undefined>(undefined);
  const openJobsRow = (analysisPath: string): void => {
    setChosenJobsAnalysisPath(analysisPath);
    navigate("jobs");
  };

  // The focus call itself must run AFTER Talk to Ten's own
  // `frame-page--hidden` class is removed and the browser has painted it,
  // or `.focus()` targets an element that is still `display: none` and
  // silently no-ops (reviewer finding — calling onFocusComposer inline
  // inside navigate() raced the re-render). An effect keyed on `page`,
  // deferred one animation frame, runs after React's commit and the
  // resulting paint — but only when focusOnArrivalRef says this specific
  // arrival asked for it (never the very first mount either, even when
  // the landing rule opens on Talk to Ten, § 5.1 — that ref starts false).
  //
  // § 5.4 (amended): "At a frame width of 760px or less it opens Talk to
  // Ten WITHOUT focusing the composer" — iOS Safari won't raise the
  // keyboard for a focus the script sets after a page change, so a phone
  // candidate would see the tab bar hidden (`:has(.composer:focus-
  // within)`, § 5.5) with no keyboard up and no visible way off the
  // page. Measured against the FRAME's own width (`.frame`'s
  // clientWidth, read fresh at the moment of arrival, inside the same
  // rAF the focus call itself waits for) — this is the container query's
  // own condition (§ 5.6 "Breakpoint": `@container frame (max-width:
  // 760px)`), never `window.innerWidth`, which can differ from the
  // frame's own inline-size (a mid-width drawer layout, an embedded
  // frame, ...).
  useEffect(() => {
    if (page !== "talk" || !focusOnArrivalRef.current) return;
    focusOnArrivalRef.current = false;
    const id = requestAnimationFrame(() => {
      if ((frameRef.current?.clientWidth ?? Infinity) <= 760) return;
      onFocusComposer?.();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="frame" ref={frameRef}>
      <Rail page={page} onNavigate={navigate} needsYou={needsYou} />
      <div className="frame-main">
        <Header {...headerProps} status={status} pageTitle={PAGE_TITLE[page]} />
        <div
          className={`frame-page${page === "talk" ? " frame-page--hidden" : ""}`}
          data-page={page}
        >
          {page !== "talk" && versionNotice ? (
            <VersionNotice mode={versionNotice.mode} saveFailed={versionNotice.saveFailed} />
          ) : null}
          {page === "home" ? (
            // Home's own empty state matches § 5.3.1 H17/H18 word for word
            // (design-web-ui.md § 5.3, restore ruling) — same text 3a's
            // placeholder used here before Stage 3c replaced this page.
            <Home
              store={store}
              messages={messages}
              chatStatus={chatStatus}
              onOpenRef={onOpenRef}
              onContinueWithTen={continueWithTen}
              onOpenTalkToTen={openTalkToTen}
              noConversationSaved={noConversationSaved === true}
              onOpenJobs={() => navigate("jobs")}
            />
          ) : page === "jobs" ? (
            // Stage 3b (design-web-ui.md § 5.3, "Jobs: the pipeline
            // record"; § 5.9). J17/J18's empty state lives inside
            // JobsPage itself now; NOT J19 (lead ruling, 2026-09-28) —
            // that waits for design-web-search.md § 9 S5.
            <JobsPage
              store={store}
              onOpenFile={onOpenFile}
              onAskTen={askTenAbout}
              onOpenTalkToTen={openTalkToTen}
              // "Open application" (§ 5.4) stays unwired here (Stage 3b
              // review, lead ruling): the control is hidden until Stage
              // 3e can wire it to 3d's Applications page WITH the entry
              // chosen — a page that only opens Applications, with no
              // entry, would be a half-built link (rule 8).
              turnRunning={status.state === "thinking" || status.state === "working"}
            />
          ) : page === "applications" ? (
            // § 5.9 Stage 3d.
            <ApplicationsPage
              store={store}
              onOpenFile={onOpenFile}
              onAskTen={askTenAbout}
              onOpenTalkToTen={openTalkToTen}
              onOpenJobsRow={openJobsRow}
              turnRunning={status.state === "thinking" || status.state === "working"}
            />
          ) : page === "documents" ? (
            <DocumentsPage
              list={listDocuments}
              onOpenFile={onOpenFile}
              onAskTen={askTenAbout}
              onOpenTalkToTen={openTalkToTen}
              // § 5.2 rule 4: "While a turn is running, the page shows
              // one neutral line" — the same signal the header's own
              // avatar shows (thinking/working), not a second source.
              turnRunning={status.state === "thinking" || status.state === "working"}
            />
          ) : null}
        </div>
        {/* Talk to Ten stays mounted at all times (§ 5.1) — hidden with a
            CSS class, never unmounted or the `hidden` attribute (which an
            author `display` rule of equal specificity can silently lose
            to), so a running turn and the transcript's scroll position
            both survive a page change and back. */}
        <div className={`frame-page frame-page--talk${page !== "talk" ? " frame-page--hidden" : ""}`}>
          {talkToTen}
        </div>
        {/* The tab bar is a row of frame-main's OWN column layout, not of
            .frame's (a container query can toggle a DESCENDANT's display,
            § 5.5, but not the query container's own flex-direction — a
            browser constraint, confirmed live: changing container-type
            inline-size means .frame can't restyle its own box from
            inside its own @container rule). .frame stays a row (rail |
            frame-main | viewer) at every width; only frame-main's
            children ever restack. */}
        <TabBar page={page} onNavigate={navigate} needsYou={needsYou} />
      </div>
      {/* § 5.6 "Page layouts (Stage 2)", the viewer bullet: pinned on
          Talk to Ten/Jobs/Applications/Documents always; on Home only
          while a file is open. The panel itself stays mounted (its own
          iframe/print state, § 2.3) — hidden with a class, the same
          posture as Talk to Ten's own page above, never conditionally
          unmounted. */}
      <div className={`viewer-slot${page === "home" ? " viewer-slot--home" : ""}${page === "home" && !viewerOpen ? " viewer-slot--hidden" : ""}`}>
        {sidePanel}
      </div>
    </div>
  );
}
