import { createHostHandoff } from "../shared/host-adapters.mjs";

export async function copyHostHandoff(hostId, visibleMessage, clipboard = globalThis.navigator?.clipboard) {
  const handoff = createHostHandoff(hostId, visibleMessage);
  if (!clipboard?.writeText) throw new Error("Clipboard access is unavailable. Select and copy the visible request instead.");
  await clipboard.writeText(handoff.message);
  return handoff;
}
