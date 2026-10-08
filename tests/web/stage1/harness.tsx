// Tester-owned harness (not product code) for workspace Stage 1
// (docs/design-web-ui.md § 5.6 "Component states", § 5.9 Stage 1).
//
// It mounts the REAL member-mode pieces the mock preview never shows, the
// way RealChatShell mounts them (a conditional render next to the Header):
//
//   ?scene=shell  the real Header with every member handler (the ⋯ menu's
//                 member items, the balance chip as a Buy-credit button),
//                 opening BuyCreditDialog / DeleteBetaDataConfirm /
//                 SetPasswordDialog. `&balance=0` renders the $0.00 chip.
//                 No network: paypalClientId is "" (the SDK effect returns
//                 early), the access token never resolves (so a delete never
//                 reaches fetch), and the auth stub's updateUser never
//                 resolves (so "save" stays in its loading state).
//   ?scene=kit    the shared § 5.6 shapes Stage 1 defines for reuse (.btn
//                 variants, toast, skeleton, badges, brand mark, wordmark).
import { StrictMode, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { Header } from "../../../apps/web/src/components/Header.tsx";
import { BrandMark, Wordmark } from "../../../apps/web/src/components/BrandMark.tsx";
import { Icon } from "../../../apps/web/src/icons.tsx";
import { BuyCreditDialog } from "../../../apps/web/src/real/BuyCreditDialog.tsx";
import { DeleteBetaDataConfirm } from "../../../apps/web/src/real/DeleteBetaDataConfirm.tsx";
import { SetPasswordDialog } from "../../../apps/web/src/real/SetPasswordDialog.tsx";
import { CLAUDE_COACH_MODEL } from "../../../apps/web/src/backend/coach-model.ts";
import type { AuthClientLike } from "../../../apps/web/src/backend/auth.ts";
import "../../../apps/web/src/styles.css";

const NEVER = <T,>() => new Promise<T>(() => {});
const stubClient: AuthClientLike = {
  auth: {
    signInWithPassword: () => NEVER(),
    signUp: () => NEVER(),
    signOut: () => NEVER(),
    getSession: () => NEVER(),
    resetPasswordForEmail: () => NEVER(),
    updateUser: () => NEVER(),
    reauthenticate: () => NEVER(),
  },
  rpc: () => NEVER(),
};

const params = new URLSearchParams(location.search);

function Shell(): ReactElement {
  const [dialog, setDialog] = useState<"buy" | "delete" | "password" | null>(null);
  const balance = params.get("balance") === "0" ? 0 : 4.2;
  // `&rerender=1`: the shell re-renders every 250ms while mounted, as
  // RealChatShell does while a dialog is open (a balance refresh, a save
  // status, a version check). Each dialog gets a NEW inline onClose on
  // every render, exactly as RealChatShell.tsx passes them.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (params.get("rerender") !== "1") return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="app-root" data-theme="light">
      <div className="app-shell">
        <div className="main-pane">
          <Header
            status={{ state: "idle" }}
            balanceUsd={balance}
            fixtures={[]}
            currentFixtureId=""
            onFixtureChange={() => {}}
            autoplay={false}
            onAutoplayToggle={() => {}}
            theme="light"
            onExportWorkspace={() => {}}
            onImportWorkspace={() => {}}
            onDeleteBetaData={() => setDialog("delete")}
            onBuyCredit={() => setDialog("buy")}
            onSetPassword={() => setDialog("password")}
            onSignOut={() => {}}
            coachModel={CLAUDE_COACH_MODEL}
          />
          <main style={{ padding: 16 }}>
            <p>Stage 1 harness shell.</p>
          </main>
        </div>
      </div>
      {dialog === "buy" ? (
        <BuyCreditDialog
          supabaseUrl="http://127.0.0.1:9"
          accessToken={() => NEVER()}
          paypalClientId=""
          onClose={() => setDialog(null)}
          onCredited={() => {}}
        />
      ) : null}
      {dialog === "delete" ? (
        <DeleteBetaDataConfirm
          supabaseUrl="http://127.0.0.1:9"
          accessToken={() => NEVER()}
          onClose={() => setDialog(null)}
          onDeleted={() => NEVER()}
        />
      ) : null}
      {dialog === "password" ? (
        <SetPasswordDialog client={stubClient} email="member@example.com" onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function Kit(): ReactElement {
  return (
    <div className="app-root" data-theme="light" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div data-kit="buttons" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn--pri">Primary</button>
        <button type="button" className="btn btn--sec">Secondary</button>
        <button type="button" className="btn btn--ghost">Ghost</button>
        <button type="button" className="btn btn--pri" disabled>Primary off</button>
        <button type="button" className="btn btn--sec" disabled>Secondary off</button>
        <button type="button" className="btn btn--ghost" disabled>Ghost off</button>
      </div>
      <div data-kit="badges" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span className="badge badge--quick-scan">quick-scan</span>
        <span className="badge badge--pass">pass</span>
        <span className="badge badge--fail">FAIL</span>
        <span className="badge badge--pending">pending</span>
        <span className="badge badge--approved">approved</span>
      </div>
      <div data-kit="skeleton" className="skeleton" style={{ height: 64, width: 320 }} />
      <div data-kit="marks" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <BrandMark />
        <Wordmark size={30} />
      </div>
      <div className="toast" role="status">
        <Icon name="circleCheck" size={18} />
        <span>$10.00 credited.</span>
        <button type="button" aria-label="Dismiss">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode>{params.get("scene") === "kit" ? <Kit /> : <Shell />}</StrictMode>);
