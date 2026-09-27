// design-web-ui.md § 5.6, "Dialog": focus is trapped while the dialog is
// open and returns to the opener on close. Shared by all three of this
// app's confirmation dialogs — the one place this lives, so a change to
// the rule changes it everywhere at once.
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Attach the returned ref to the dialog's outer (role="dialog") element.
 *  While mounted: Escape calls `onClose`; Tab/Shift+Tab cycle only among
 *  the dialog's own focusable elements. On unmount: focus returns to
 *  whatever had it when the dialog opened (the opener). */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    // A dialog opened from a ⋯-menu item (Delete my beta data, Set a new
    // password) unmounts that menu in the SAME commit — the menu item
    // that had focus is gone before this effect ever runs, so the
    // browser has already moved focus to <body> (or, if the dialog's own
    // first field carries `autoFocus`, to that field — either way, not a
    // real "opener"). The one thing still in the DOM either way is the
    // menu's own trigger button; that's the right place to return focus
    // to (a dialog opened directly, like Buy credit's balance chip,
    // never hits this fallback — its opener is still focused and still
    // mounted when this effect runs).
    const container = ref.current;
    const activeAtMount = document.activeElement as HTMLElement | null;
    const activeIsOutsideDialog = activeAtMount && activeAtMount !== document.body && !container?.contains(activeAtMount);
    const opener = activeIsOutsideDialog ? activeAtMount : document.querySelector<HTMLElement>(".menu-trigger");
    const focusables = () => Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    if (container && !container.contains(document.activeElement)) {
      (focusables()[0] ?? container).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (!container.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // StrictMode (dev) runs this whole effect mount -> cleanup -> mount
      // again, synchronously, before anything paints — a real DOM
      // .focus() call in the THROWAWAY cleanup would move focus away
      // from the true opener before the second mount ever captures it.
      // Deferring one microtask and checking `ref.current` (repopulated
      // by the second mount before this runs) tells throwaway from real.
      queueMicrotask(() => {
        if (!ref.current) opener?.focus?.();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  return ref;
}
