// The pinned side panel (design-web-ui.md § 1.1/§ 1.2). .md as plain
// formatted text, .html in a sandboxed iframe. On phone (375px) this
// becomes a full-screen sheet, closed by a back arrow or Escape (§ 5.5),
// returning focus to whatever opened it. Strings F41-F45
// (§ 5.3.1, Stage 4's label table, origin/docs/workspace-labels, PR #22 —
// not yet merged to main): "Nothing open yet.", "This file can't be
// previewed here." (F42, changed from "Binary file — no preview.": C5,
// "Binary" needs no definition, § 5.3.1), "Print / Save as PDF" (F43, now
// also the viewer's own control, not only the document card's), "Close",
// "File preview".
import { forwardRef, useEffect, type ReactElement } from "react";
import { kindOf } from "../store.ts";
import type { FileRead } from "../types.ts";
import { Icon } from "../icons.tsx";
import { MarkdownView } from "./MarkdownView";

export interface SidePanelProps {
  file: FileRead | undefined;
  open: boolean;
  onClose: () => void;
  /** § 5.2 rule 6, "the file being viewed": a non-missing `read()`
   *  failure — never surfaced by clearing `file` back to `undefined`
   *  (that reads as the ordinary empty "Nothing open yet.", which would
   *  hide a real failure, rule 8). `path` is the file that failed, for
   *  the loud line's own `<path>`. Mutually exclusive with `file` — the
   *  caller clears one when it sets the other. */
  error?: { path: string };
  /** Re-attempts the same read (the loud error's Retry button). Required
   *  whenever `error` can be set. */
  onRetry?: () => void;
  /** § 5.5: "Back, or the Escape key, closes it and returns focus to the
   *  row or chip that opened it." The exact element that opened this
   *  file — the caller's own `event.currentTarget` from the row/chip's
   *  click handler, threaded through `onOpenFile`. R2 fix: NEVER
   *  `document.activeElement` — WebKit (iOS Safari, § 5.5's own target
   *  engine) does not focus a tapped button, so `activeElement` reads
   *  BODY after a tap and focus-return silently does nothing. A caller
   *  that doesn't supply one (a card/chip from an earlier stage) simply
   *  gets no focus-return, same as before this feature existed — never a
   *  crash (`opener?.focus()` below). */
  opener?: HTMLElement | null;
}

// No allow-scripts, ever: a candidate's own rendered HTML must never be
// able to run script. allow-same-origin is what lets the parent frame call
// this iframe's contentWindow.print() (the browser's own print-to-PDF, § 2.3);
// allow-modals is what lets that print dialog itself open. NEVER add
// allow-scripts here — a résumé's rendered HTML is candidate content, not
// code, and "no script" is the whole security boundary this panel offers.
const IFRAME_SANDBOX = "allow-same-origin allow-modals";

// N3 (fix round 2): sandbox alone doesn't stop a passive resource load
// (an <img> beacon), only scripting/navigation/forms — a CSP is what
// blocks that, so it's prepended to every .html file's own content before
// it becomes the iframe's srcdoc. `style-src 'unsafe-inline'` keeps the
// résumé's own inline <style> working; `img-src data:` allows an inlined
// data-URI image but nothing fetched over the network.
const IFRAME_CSP =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">';

function withCsp(html: string): string {
  return IFRAME_CSP + html;
}

// A résumé or cover letter reads like a document (serif, design-web-ui-
// refresh.md); plan.md reads like a checklist. Read off the path the
// agent itself wrote it to (fixtures name résumés `…-resume.md` and
// letters `…-cover-letter.md`, `docs/design-web-ui.md` § 4) — never a
// guess from the file's content.
function bodyModifier(path: string | undefined): string {
  if (!path) return "";
  const base = path.split("/").pop() ?? path;
  if (/resume|cover-letter/i.test(base)) return " side-panel-body--document";
  if (base === "plan.md") return " side-panel-body--plan";
  return "";
}

export const SidePanel = forwardRef<HTMLIFrameElement, SidePanelProps>(function SidePanel(
  { file, open, onClose, error, onRetry, opener },
  iframeRef
): ReactElement {
  const kind = file ? kindOf(file.path) : undefined;
  // § 5.3.1 F43 ("Viewer (every page) | print button on an .html file |
  // `Print / Save as PDF`"): the viewer itself carries this control now,
  // not only the transcript's document card (Cards.tsx's own "Print /
  // Save as PDF" is unchanged, still the card's receipt of a turn's
  // render — C § 6.2). Whichever page opened this .html file (a card's
  // ref, a Jobs/Applications/Documents row), the SAME browser print (the
  // sandbox's own allow-modals, § 2.3) is one click away here. `iframeRef`
  // is always the RefObject every caller passes (`useRef`, never a
  // callback ref) — guarded anyway since `forwardRef`'s type allows one.
  const printFile = (): void => {
    if (iframeRef && typeof iframeRef !== "function") iframeRef.current?.contentWindow?.print();
  };

  // § 5.5: "Back, or the Escape key, closes it and returns focus to the
  // row or chip that opened it." `opener` (above) is the caller's own
  // captured element — this component only ever reads it, never
  // captures anything itself (R2 fix: document.activeElement, tried in
  // round 1, reads BODY after a WebKit tap).
  const closeAndRestoreFocus = (): void => {
    onClose();
    opener?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // § 5.6 "Stacking": "Escape closes the top-most first: dialog,
      // then menu, then sheet." R2 fix: this listener used to close the
      // sheet unconditionally, so with the ⋯ menu (or a dialog) open
      // ABOVE it, one Escape closed both at once. A dialog's own
      // listener (use-dialog-focus.ts) runs in the CAPTURE phase and
      // stopPropagation()s, so it already never reaches here — this
      // check is for the ⋯ menu, which has no dialog beneath it and
      // doesn't stop propagation (Header.tsx's own comment). Checked
      // fresh at keydown time, never cached: by the time this listener
      // runs (a plain bubble-phase document listener, ahead of the
      // menu's own window-level one), the menu/dialog's DOM is still
      // exactly as it was when the key was pressed.
      if (document.querySelector('[role="dialog"], .menu-panel')) return;
      closeAndRestoreFocus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opener]);

  return (
    <aside className={`side-panel${open ? " side-panel--open" : ""}`} aria-label="File preview">
      <div className="side-panel-header">
        <button type="button" className="side-panel-back" onClick={closeAndRestoreFocus} aria-label="Close">
          {/* Both glyphs render; CSS shows one: the back arrow on the
              phone sheet and the drawer, the ✕ on Home's own viewer at
              desktop (§ 5.6: "on Home it appears only while a file is
              open, with a ✕"; § 5.3.1 F46). */}
          <Icon name="arrowLeft" size={18} className="side-panel-back-arrow" />
          <Icon name="x" size={18} className="side-panel-back-x" />
        </button>
        <span className="side-panel-path">{file ? file.path : error ? error.path : "Nothing open yet."}</span>
        {file && !file.binary && kind === "html" ? (
          <button type="button" className="btn btn--ghost side-panel-print" onClick={printFile}>
            Print / Save as PDF
          </button>
        ) : null}
      </div>
      {/* Keyed by path: switching files must fully remount this subtree,
          never diff one file's blocks against a differently-shaped file's
          (observed as stray leftover nodes when React reused DOM across
          two unrelated .md structures with coincidentally-matching
          positional keys). */}
      <div className={`side-panel-body${bodyModifier(file?.path)}`} key={file?.path ?? error?.path ?? "empty"}>
        {error ? (
          <div className="page-error-card">
            <Icon name="circleAlert" size={18} />
            <p className="page-error-message">Couldn't read {error.path}. Try again in a moment.</p>
            <button type="button" className="btn btn--sec" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : !file ? (
          <p className="side-panel-empty">Nothing open yet.</p>
        ) : file.binary ? (
          <p className="side-panel-empty">This file can't be previewed here.</p>
        ) : kind === "html" ? (
          <iframe
            ref={iframeRef}
            className="side-panel-iframe"
            title={file.path}
            sandbox={IFRAME_SANDBOX}
            srcDoc={withCsp(file.content)}
          />
        ) : kind === "markdown" ? (
          <MarkdownView content={file.content} />
        ) : (
          <pre className="side-panel-raw">{file.content}</pre>
        )}
      </div>
    </aside>
  );
});
