// A workspace page's EMPTY state (design-web-ui.md § 5.3's own text per
// page; § 5.6, "Empty state"): a rail-icon tile, the first sentence in
// --type-empty, the rest in --type-body-sm, and one button that only ever
// opens Talk to Ten (§ 5.2 rule 2 — a page never sends). Stage 2 renders
// every page other than Talk to Ten through this component; a page's real
// contents (Stages 3a-3f) replace it once that page has a reader.
import type { ReactElement } from "react";
import { Icon, type IconName } from "../icons.tsx";

export interface EmptyPageProps {
  icon: IconName;
  /** § 5.3's own words, split at the first sentence (only the TYPE
   *  differs — same words, never reworded, § 5.6 "Empty state"). */
  first: string;
  rest?: string;
  /** Home's button is "Continue with Ten" (lime, lg); every other page's
   *  is "Talk to Ten" (sec, md) — both only ever open Talk to Ten. */
  cta: "continue" | "talk";
  onOpenTalkToTen: () => void;
}

export function EmptyPage({ icon, first, rest, cta, onOpenTalkToTen }: EmptyPageProps): ReactElement {
  return (
    <div className="page-empty">
      <div className="page-empty-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </div>
      <p className="page-empty-title">{first}</p>
      {rest ? <p className="page-empty-body">{rest}</p> : null}
      <button
        type="button"
        className={cta === "continue" ? "btn btn--lime" : "btn btn--sec"}
        onClick={onOpenTalkToTen}
      >
        {cta === "continue" ? "Continue with Ten" : "Talk to Ten"}
      </button>
    </div>
  );
}
