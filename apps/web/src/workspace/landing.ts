// The landing rule (design-web-ui.md § 5.1, "Where the app opens"):
//
//   Talk to Ten when the restored conversation has a pending gate (rule 7
//   beats everything) or when no conversation is saved yet (first run,
//   § 1.5: the only next step is to talk). Otherwise Home.
//
// Pure — no window/document/localStorage (this runs the same in the
// browser and could run on a server), so it's a plain function of the
// messages Frame is mounted with, computed once (Frame's own useState
// initializer), never re-run as messages change during the session (a
// gate opening on Jobs must show the rail marker, § 5.1's "gate while
// you're elsewhere" — it must NOT navigate the candidate away from
// wherever they are, so this function is only ever called at mount).
import { latestGateStatuses } from "../agent-helpers.ts";
import type { AppMessage, Page } from "../types.ts";

export function landingPage(messages: AppMessage[]): Page {
  const hasPendingGate = [...latestGateStatuses(messages).values()].some(
    (v) => v.status === "pending",
  );
  if (hasPendingGate) return "talk";
  if (messages.length === 0) return "talk";
  return "home";
}
