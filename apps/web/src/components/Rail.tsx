// The left rail (design-web-ui.md § 5.1, "The rail"; § 5.6, "Rail item").
// Five places, in this order, plus the brand mark. Rail counts are Stage
// 3e's own exit (§ 5.9) — this stage has none, so no number ever shows
// here yet (never a stale or guessed one, rule 12).
import type { ReactElement } from "react";
import { Icon, type IconName } from "../icons.tsx";
import { Wordmark } from "./BrandMark";
import type { Page } from "../types.ts";

const ITEMS: { page: Page; label: string; icon: IconName }[] = [
  { page: "home", label: "Home", icon: "house" },
  { page: "talk", label: "Talk to Ten", icon: "messageSquare" },
  { page: "jobs", label: "Jobs", icon: "briefcase" },
  { page: "applications", label: "Applications", icon: "layers" },
  { page: "documents", label: "Documents", icon: "files" },
];

export interface RailProps {
  page: Page;
  onNavigate: (page: Page) => void;
  /** § 5.1, "A gate while you're elsewhere": a plain, non-alarm marker on
   *  Talk to Ten only, while a gate is pending. Never shown anywhere else
   *  in the rail (no summary line, § 5.6 "No rail summary line"). */
  needsYou: boolean;
}

export function Rail({ page, onNavigate, needsYou }: RailProps): ReactElement {
  return (
    <nav className="rail" aria-label="Workspace">
      <div className="rail-brand" aria-hidden="true">
        <Wordmark size={28} />
      </div>
      {ITEMS.map((item) => (
        <button
          key={item.page}
          type="button"
          className="rail-item"
          aria-current={page === item.page ? "page" : undefined}
          onClick={() => onNavigate(item.page)}
        >
          <Icon name={item.icon} size={18} />
          <span className="rail-item-label">{item.label}</span>
          {item.page === "talk" && needsYou ? (
            <span className="rail-needs-you">
              <span className="rail-needs-you-dot" aria-hidden="true" />
              Needs your yes
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
