import { useState, type ReactElement } from "react";
import { Avatar } from "./Avatar";
import { formatBalanceUsd } from "../format.ts";
import type { FixtureEntry } from "../fixtures";
import type { Status } from "../types";

export interface HeaderProps {
  status: Status;
  /** Only ever a number a part or the store provided; undefined renders
   *  "—" (L1 — never an invented balance). */
  balanceUsd: number | undefined;
  fixtures: FixtureEntry[];
  currentFixtureId: string;
  onFixtureChange: (id: string) => void;
  autoplay: boolean;
  onAutoplayToggle: () => void;
  theme: "light" | "dark";
  onThemeToggle: () => void;
}

const STATE_LABEL: Record<Status["state"], string> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  "needs-you": "needs you",
  done: "done",
};

// The fixture picker and Autoplay are dev/preview-only controls (H2): a
// real deployed build must not ship a way to switch fixtures or auto-type
// a candidate's replies. `import.meta.env.DEV` covers `npm run dev`;
// `VITE_SHOW_MOCK_CONTROLS` is the explicit preview flag for a *built*
// bundle that still wants them (this whole app is a preview tool, so the
// default build sets it — see apps/web/.env and the README for how to
// build without it, which is what proves they're absent from dist/).
export const SHOW_MOCK_CONTROLS =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_MOCK_CONTROLS === "1";

export function Header(props: HeaderProps): ReactElement {
  const {
    status,
    balanceUsd,
    fixtures,
    currentFixtureId,
    onFixtureChange,
    autoplay,
    onAutoplayToggle,
    theme,
    onThemeToggle,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header-left">
        <Avatar status={status} />
        <span className="app-header-title">
          Ten <span className="app-header-status">· {STATE_LABEL[status.state]}</span>
        </span>
        {status.action ? <span className="app-header-action">{status.action}</span> : null}
      </div>
      <div className="app-header-right">
        {SHOW_MOCK_CONTROLS ? (
          <label className="fixture-picker" title="Dev-only: choose which fixture to replay">
            <span className="fixture-picker-label">Preview: fixture</span>
            <select
              value={currentFixtureId}
              onChange={(e) => onFixtureChange(e.target.value)}
            >
              {fixtures.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {SHOW_MOCK_CONTROLS ? (
          <button
            type="button"
            className={`pill-button${autoplay ? " pill-button--active" : ""}`}
            onClick={onAutoplayToggle}
          >
            Autoplay
          </button>
        ) : null}
        {/* deps.balance() (design-web-agent.md § 8) rounds DOWN to the
            cent and never shows below $0.00 — formatBalanceUsd, not
            formatUsd (S2/N3, docs/reviews/proxy-change-review.md). */}
        <span className="balance-chip">
          {balanceUsd === undefined ? "—" : `$${formatBalanceUsd(balanceUsd)}`}
        </span>
        <div className="menu">
          <button
            type="button"
            className="menu-trigger"
            aria-label="Menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="menu-panel" role="menu">
              <button type="button" role="menuitem" disabled>
                Export workspace
              </button>
              {/* No per-candidate key to manage: one shared app key sits
                  behind the model proxy (design-web-agent.md § 8), so
                  "Manage your usage key" is gone (design-web-ui.md § 1.1).
                  "Delete my beta data" (design-web-ui.md § 1.7) is its own
                  confirmation flow, out of scope for this pass — disabled
                  here rather than added half-built. */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onThemeToggle();
                  setMenuOpen(false);
                }}
              >
                {theme === "light" ? "Switch to dark" : "Switch to light"}
              </button>
              <button type="button" role="menuitem" disabled>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
