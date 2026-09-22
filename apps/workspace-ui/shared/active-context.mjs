export const workspaceActions = Object.freeze({
  reviewResource: { id: "review_resource", label: "Review", kinds: ["resource"] },
  reviewResume: { id: "review_resume", label: "Review resume", kinds: ["resource"] },
  reviewJob: { id: "review_job", label: "Review job", kinds: ["job"] },
  prepareInterview: { id: "prepare_interview", label: "Prepare interview", kinds: ["job", "resource"] },
  editSkill: { id: "edit_skill", label: "Review and edit skill", kinds: ["skill"] },
  workPlan: { id: "work_plan", label: "Work plan item", kinds: ["plan"] },
});

const actionsById = new Map(Object.values(workspaceActions).map((action) => [action.id, action]));
const prefixes = new Set(["resource", "job", "plan", "skill"]);

export class ActiveContextError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createItemRef(kind, key) {
  if (!prefixes.has(kind) || !key) throw new ActiveContextError("invalid_item_ref", "Active item reference is invalid.");
  return `${kind}:${encodeURIComponent(key)}`;
}

export function parseItemRef(itemRef) {
  const separator = typeof itemRef === "string" ? itemRef.indexOf(":") : -1;
  if (separator < 1) throw new ActiveContextError("invalid_item_ref", "Active item reference is invalid.");
  const kind = itemRef.slice(0, separator);
  let key;
  try { key = decodeURIComponent(itemRef.slice(separator + 1)); }
  catch { throw new ActiveContextError("invalid_item_ref", "Active item reference is invalid."); }
  if (!prefixes.has(kind) || !key) throw new ActiveContextError("invalid_item_ref", "Active item reference is invalid.");
  return { kind, key };
}

export function getWorkspaceAction(actionId) {
  const action = actionsById.get(actionId);
  if (!action) throw new ActiveContextError("invalid_action", "Requested CareerCoach action is not supported.");
  return action;
}

export function visibleMessageFor(label, actionId) {
  getWorkspaceAction(actionId);
  const lead = {
    review_resource: "Review file",
    review_resume: "Review resume",
    review_job: "Review job",
    prepare_interview: "Prepare interview",
    edit_skill: "Review and edit skill",
    work_plan: "Work plan item",
  }[actionId];
  return `${lead}: ${label} using CareerCoach.`;
}

export function assertVisibleMessageMatches(message, context) {
  const expected = visibleMessageFor(context.selection.label, context.selection.action.id);
  if (message.trim() !== expected) {
    throw new ActiveContextError("context_mismatch", "The visible request does not match the active CareerCoach selection. Launch the action again.", 409);
  }
  return true;
}
