// The phone's five-tab bar (design-web-ui.md § 5.5): Home · Jobs · Ten ·
// Applications · Documents, Ten centred because the composer is the one
// place to type. This reorders § 5.1's rail order for the phone only —
// the rail itself keeps § 5.1's order (Rail.tsx, unchanged). No counts on
// the phone bar (§ 5.5).
import type { ReactElement } from "react";
import { Icon, type IconName } from "../icons.tsx";
import type { Page } from "../types.ts";

const TABS: { page: Page; label: string; icon: IconName }[] = [
  { page: "home", label: "Home", icon: "house" },
  { page: "jobs", label: "Jobs", icon: "briefcase" },
  { page: "talk", label: "Ten", icon: "messageSquare" },
  { page: "applications", label: "Applications", icon: "layers" },
  { page: "documents", label: "Documents", icon: "files" },
];

export interface TabBarProps {
  page: Page;
  onNavigate: (page: Page) => void;
  needsYou: boolean;
}

export function TabBar({ page, onNavigate, needsYou }: TabBarProps): ReactElement {
  return (
    <nav className="tabbar" aria-label="Workspace">
      {TABS.map((tab) => {
        const current = page === tab.page;
        if (tab.page === "talk") {
          return (
            <button
              key={tab.page}
              type="button"
              className="tabbar-item tabbar-item--ten"
              aria-current={current ? "page" : undefined}
              // The dot itself is aria-hidden (decorative, § 5.5's own
              // "no count and no alert styling") — its accessible name
              // ("Needs your yes") is carried by the BUTTON's own label
              // instead of a visually-hidden text node, so the dot's
              // near-invisible pixels are never measured for text
              // contrast (they aren't text; design-web-ui.md § 5.6's
              // contrast rule is about legible prose, not a decorative dot).
              aria-label={needsYou ? "Ten. Needs your yes." : undefined}
              onClick={() => onNavigate(tab.page)}
            >
              <span className="tabbar-ten-tile">
                <Icon name={tab.icon} size={20} />
                {needsYou ? <span className="tabbar-needs-you" aria-hidden="true" /> : null}
              </span>
              <span className="tabbar-item-label" aria-hidden={needsYou ? "true" : undefined}>
                {tab.label}
              </span>
            </button>
          );
        }
        return (
          <button
            key={tab.page}
            type="button"
            className="tabbar-item"
            aria-current={current ? "page" : undefined}
            onClick={() => onNavigate(tab.page)}
          >
            <Icon name={tab.icon} size={20} />
            <span className="tabbar-item-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
