// design-web-ui.md § 1.5 (amended 2026-10-02) and § 5.3.1 O1: one neutral line
// in the notice place (§ 1.8, § 5.1), on the page load where the welcome
// credit was granted, until the first message is sent. Nothing stores it
// (rule 12): RealChatShell holds it in memory only, so a reload shows the
// balance chip alone. It states the amount (the claim's own `usd`, two
// decimals) and where to see what's left, and promises no spend gate: at
// $1.00 none ever opens (C § 20.5). Neutral styling, like the other notices
// (rule 8). The words are welcome-copy.ts's `welcomeLine`.
import type { ReactElement } from "react";
import { welcomeLine } from "./welcome-copy.ts";

export function WelcomeNotice({ usd }: { usd: number }): ReactElement {
  return (
    <div className="welcome-notice" role="status">
      <p className="welcome-notice-text">{welcomeLine(usd)}</p>
    </div>
  );
}
