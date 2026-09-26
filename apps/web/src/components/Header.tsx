import { useState, type ReactElement } from "react";
import { Avatar } from "./Avatar";
import { formatBalanceUsd } from "../format.ts";
import type { CoachModel } from "../backend/coach-model.ts";
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
  /** Owner ruling (2026-09-24, PRINCIPLES rule 8 — no untrue UI): the
   *  real app passes none, so "Switch to dark"/"Switch to light" never
   *  renders there (a menu item that does nothing is untrue UI). The
   *  mock/preview keeps passing its handler. */
  onThemeToggle?: () => void;
  /** Real-mode-only menu actions (design-web-ui.md § 1.1's ⋯ menu). Each
   *  item stays `disabled` (the mock preview's existing behavior,
   *  UNCHANGED) when its handler is omitted — App.tsx (the mock) never
   *  passes these; only src/real/RealChatShell.tsx does. */
  onExportWorkspace?: () => void;
  onImportWorkspace?: () => void;
  /** design-web-ui.md § 1.7 — opens the same four-step typed-yes
   *  confirmation as a spend gate, never a click-to-confirm. */
  onDeleteBetaData?: () => void;
  /** design-web-ui.md § 1.11 — opens the Buy-credit dialog. Wired from BOTH
   *  the balance chip and the ⋯ menu's "Buy credit" line (§ 17.2: "no tool,
   *  card or model output opens the dialog"); omitted (undefined) for a
   *  non-member or the mock preview, where neither ever renders as a
   *  button — the chip stays plain text and the menu item is absent
   *  outright (not merely disabled), since § 1.11 is members-only. */
  onBuyCredit?: () => void;
  /** design-web-ui.md § 1.10 — member-only, above Sign out. The app can't
   *  tell whether an account already has a password, hence one label for
   *  both cases. */
  onSetPassword?: () => void;
  onSignOut?: () => void;
  /** § 13.3: the ⋯ menu's last line, real mode only — plain text, never a
   *  button, built from `coachModel` so it can never disagree with what's
   *  actually sent. Omitted (undefined) in mock mode, where the line
   *  never renders (§ 13.5 (ix)). */
  coachModel?: CoachModel;
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
// bundle that still wants them — set by `npm run build:preview`'s own
// script (package.json: `VITE_SHOW_MOCK_CONTROLS=1 npm run build`), not
// a committed `.env` (there is none — see the README for how the default
// `npm run build` omits the flag, which is what proves they're absent
// from dist/).
//
// Fix round 1, item 8: `VITE_REAL=1` is a dev-only escape hatch — set it
// (alongside VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY/VITE_SITE_URL) to
// run the REAL app under `npm run dev`, which was otherwise impossible
// (`import.meta.env.DEV` alone always forced the mock). This is the only
// way to exercise `ten-model-proxy`'s CORS allowlist for
// `http://localhost:5173` (design-web-agent.md § 8) against a real dev
// server instead of only the production build.
export const SHOW_MOCK_CONTROLS =
  import.meta.env.VITE_REAL !== "1" &&
  (import.meta.env.DEV || import.meta.env.VITE_SHOW_MOCK_CONTROLS === "1");

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
    onExportWorkspace,
    onImportWorkspace,
    onDeleteBetaData,
    onBuyCredit,
    onSetPassword,
    onSignOut,
    coachModel,
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
            formatUsd (S2/N3, docs/reviews/proxy-change-review.md).
            design-web-ui.md § 1.11: "Opened from the balance chip or 'Buy
            credit' in the ⋯ menu" — a real <button> only when onBuyCredit
            is given (a member in the real app); plain text otherwise (mock
            preview, or before onBuyCredit is wired), never a dead click
            target (rule 8, no untrue UI). */}
        {onBuyCredit ? (
          <button type="button" className="balance-chip balance-chip--button" onClick={onBuyCredit}>
            {balanceUsd === undefined ? "—" : `$${formatBalanceUsd(balanceUsd)}`}
          </button>
        ) : (
          <span className="balance-chip">
            {balanceUsd === undefined ? "—" : `$${formatBalanceUsd(balanceUsd)}`}
          </span>
        )}
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
              <button
                type="button"
                role="menuitem"
                disabled={!onExportWorkspace}
                onClick={() => {
                  onExportWorkspace?.();
                  setMenuOpen(false);
                }}
              >
                Export workspace
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!onImportWorkspace}
                onClick={() => {
                  onImportWorkspace?.();
                  setMenuOpen(false);
                }}
              >
                Import workspace
              </button>
              {/* No per-candidate key to manage: one shared app key sits
                  behind the model proxy (design-web-agent.md § 8), so
                  "Manage your usage key" is gone (design-web-ui.md § 1.1). */}
              {/* design-web-ui.md § 1.11 — the menu's OTHER entry point into
                  the same Buy-credit dialog the chip opens; absent
                  outright (not merely disabled) when onBuyCredit isn't
                  given, same posture as the chip above. */}
              {onBuyCredit ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onBuyCredit();
                    setMenuOpen(false);
                  }}
                >
                  Buy credit
                </button>
              ) : null}
              {onThemeToggle ? (
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
              ) : null}
              {/* design-web-ui.md § 1.7: opens its own typed-yes
                  confirmation flow — never fires anything itself. */}
              <button
                type="button"
                role="menuitem"
                className="menu-item-danger"
                disabled={!onDeleteBetaData}
                onClick={() => {
                  onDeleteBetaData?.();
                  setMenuOpen(false);
                }}
              >
                Delete my beta data
              </button>
              {/* design-web-ui.md § 1.10 — "Set a new password" or "Change
                  password" would each be false for someone; this label is
                  true either way. */}
              <button
                type="button"
                role="menuitem"
                disabled={!onSetPassword}
                onClick={() => {
                  onSetPassword?.();
                  setMenuOpen(false);
                }}
              >
                Set a new password
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!onSignOut}
                onClick={() => {
                  onSignOut?.();
                  setMenuOpen(false);
                }}
              >
                Sign out
              </button>
              {/* § 13.6 (3): the Privacy link, just above the model line,
                  in real AND mock mode — plain, honest copy in the house
                  voice lives at the page itself, never restated here. */}
              <a className="menu-item-link" role="menuitem" href="/privacy.html" target="_blank" rel="noreferrer">
                Privacy
              </a>
              {/* § 13.3: plain text, not a button — never focusable as an
                  action, absent in mock mode (coachModel undefined). Built
                  from `coachModel` so it can't disagree with what's sent. */}
              {coachModel ? <div className="menu-item-model">Model: {coachModel.name}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
