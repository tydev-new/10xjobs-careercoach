import { candidate, files, interview, jobs, planItems, profileSections, skills } from "../fixtures";
import { getWorkspaceAction, parseItemRef, visibleMessageFor } from "../../shared/active-context.mjs";
import { normalizeSnapshot } from "./contract";

const resources = files.map((file) => ({ ...file, ref: file.path, editable: true }));
const content = new Map(resources.map((resource) => [resource.ref, resource.content]));
let activeSelection = null;

const initialSnapshot = normalizeSnapshot({
  mode: "fixture",
  workspaceName: "Fixture preview",
  resources,
  candidate,
  interview,
  jobs,
  planItems,
  profileSections,
  skills,
});

export const fixtureWorkspaceProvider = {
  initialSnapshot,
  async getSnapshot() { return initialSnapshot; },
  async readResource(ref) {
    if (!content.has(ref)) throw new Error("Fixture resource does not exist.");
    return { ref, content: content.get(ref), version: String(content.get(ref).length), binary: false };
  },
  async updateResource(ref, nextContent) {
    content.set(ref, nextContent);
    return { ref, content: nextContent, version: String(nextContent.length), binary: false };
  },
  async uploadResource() { throw new Error("Uploads are available in local workspace mode."); },
  async setActiveSelection({ itemRef, action }) {
    const parsed = parseItemRef(itemRef);
    const selected = parsed.kind === "resource" ? initialSnapshot.resources.find((item) => item.contextRef === itemRef)
      : parsed.kind === "job" ? initialSnapshot.jobs.find((item) => item.contextRef === itemRef)
        : parsed.kind === "plan" ? initialSnapshot.planItems.find((item) => item.contextRef === itemRef)
          : initialSnapshot.skills.find((item) => item.contextRef === itemRef);
    if (!selected) throw new Error("Fixture item does not exist.");
    const workspaceAction = getWorkspaceAction(action);
    if (!workspaceAction.kinds.includes(parsed.kind)) throw new Error("Action does not match this item.");
    const label = parsed.kind === "job" ? `${selected.company} — ${selected.role}` : selected.name || selected.task;
    activeSelection = { itemRef, action };
    return { ...activeSelection, label, visibleMessage: visibleMessageFor(label, action) };
  },
};
