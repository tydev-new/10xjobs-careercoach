// The workspace frame (design-web-ui.md § 5.1): one Frame wraps both
// ChatShell (mock) and RealChatShell (real) — the rail, the header, app-
// state page switching, the landing rule, and the phone tab bar. The
// conversation itself (Transcript + Composer + the viewer) is owned by
// the caller and passed in as `talkToTen`; Frame only decides WHICH page
// shows, never reads or sends anything of its own (§ 5.2 rules 1 and 2 —
// Frame's own page components receive only `messages` and `status`).
import { useState, type ReactElement, type ReactNode } from "react";
import { Header, type HeaderProps } from "./Header";
import { Rail } from "./Rail";
import { TabBar } from "./TabBar";
import { EmptyPage } from "./EmptyPage";
import { VersionNotice, type VersionNoticeMode } from "../real/VersionNotice";
import { landingPage } from "../workspace/landing.ts";
import type { AppMessage, Page, Status } from "../types.ts";

export interface FrameVersionNotice {
  mode: VersionNoticeMode;
  saveFailed: boolean;
}

export interface FrameProps extends Omit<HeaderProps, "pageTitle"> {
  messages: AppMessage[];
  status: Status;
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
}

const PAGE_TITLE: Record<Page, string> = {
  home: "Home",
  talk: "Talk to Ten",
  jobs: "Jobs",
  applications: "Applications",
  documents: "Documents",
};

export function Frame(props: FrameProps): ReactElement {
  const { messages, status, talkToTen, sidePanel, versionNotice, onFocusComposer, ...headerProps } = props;
  // The landing rule runs ONCE, at mount, off the messages Frame is
  // mounted with (design-web-ui.md § 5.1, "Where the app opens") — never
  // re-run as messages change during the session: a gate opening while
  // Jobs is showing must never navigate the candidate away on its own
  // (§ 5.1, "A gate while you're elsewhere").
  const [page, setPage] = useState<Page>(() => landingPage(messages));
  const needsYou = status.state === "needs-you";

  const navigate = (next: Page): void => {
    setPage(next);
    if (next === "talk") onFocusComposer?.();
  };
  const openTalkToTen = (): void => navigate("talk");

  return (
    <div className="frame">
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
            <EmptyPage
              icon="house"
              first="Nothing here yet."
              rest="Ten writes your plan and your pipeline as you work together."
              cta="continue"
              onOpenTalkToTen={openTalkToTen}
            />
          ) : page === "jobs" ? (
            <EmptyPage
              icon="briefcase"
              first="No roles yet."
              rest="Paste a job link or a posting's text into the conversation and Ten will evaluate it."
              cta="talk"
              onOpenTalkToTen={openTalkToTen}
            />
          ) : page === "applications" ? (
            <EmptyPage
              icon="layers"
              first="No applications yet."
              rest="When you decide to apply for a role, Ten drafts the materials and they show here."
              cta="talk"
              onOpenTalkToTen={openTalkToTen}
            />
          ) : page === "documents" ? (
            <EmptyPage
              icon="files"
              first="No files yet."
              rest="Drop your résumé into the conversation to start."
              cta="talk"
              onOpenTalkToTen={openTalkToTen}
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
      {sidePanel}
    </div>
  );
}
