// The pinned side panel (design-web-ui.md § 1.1/§ 1.2). .md as plain
// formatted text, .html in a sandboxed iframe. On phone (375px) this
// becomes a full-screen sheet, closed by a back arrow. Strings F41-F45
// (§ 5.3.1, Stage 4's label table, origin/docs/workspace-labels, PR #22 —
// not yet merged to main): "Nothing open yet.", "This file can't be
// previewed here." (F42, changed from "Binary file — no preview.": C5,
// "Binary" needs no definition, § 5.3.1), "Print / Save as PDF" (F43, now
// also the viewer's own control, not only the document card's), "Close",
// "File preview".
import { forwardRef, type ReactElement } from "react";
import { kindOf } from "../store.ts";
import type { FileRead } from "../types.ts";
import { Icon } from "../icons.tsx";
import { MarkdownView } from "./MarkdownView";

export interface SidePanelProps {
  file: FileRead | undefined;
  open: boolean;
  onClose: () => void;
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
  { file, open, onClose },
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
  return (
    <aside className={`side-panel${open ? " side-panel--open" : ""}`} aria-label="File preview">
      <div className="side-panel-header">
        <button type="button" className="side-panel-back" onClick={onClose} aria-label="Close">
          <Icon name="arrowLeft" size={18} />
        </button>
        <span className="side-panel-path">{file ? file.path : "Nothing open yet."}</span>
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
      <div className={`side-panel-body${bodyModifier(file?.path)}`} key={file?.path ?? "empty"}>
        {!file ? (
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
