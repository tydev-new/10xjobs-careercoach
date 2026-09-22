import { assertVisibleMessageMatches, createItemRef, visibleMessageFor, workspaceActions } from "../../shared/active-context.mjs";

export { assertVisibleMessageMatches, createItemRef, visibleMessageFor, workspaceActions };

export function normalizeSnapshot(snapshot) {
  return {
    mode: snapshot.mode || "fixture",
    workspaceName: snapshot.workspaceName || "Career workspace",
    resources: (snapshot.resources || []).map((resource) => ({
      ...resource,
      ref: resource.ref || resource.path,
      path: resource.path || resource.ref,
      contextRef: resource.contextRef || createItemRef("resource", resource.ref || resource.path),
    })),
    jobs: (snapshot.jobs || []).map((job) => ({ ...job, contextRef: job.contextRef || createItemRef("job", `${job.company} — ${job.role}`) })),
    planItems: (snapshot.planItems || []).map((item, index) => ({ ...item, contextRef: item.contextRef || createItemRef("plan", item.id || String(index + 1)) })),
    candidate: snapshot.candidate || { name: "Local candidate", initials: "LC", headline: "Career profile", location: "", direction: "" },
    profileSections: snapshot.profileSections || [],
    skills: (snapshot.skills || []).map((skill) => ({ ...skill, contextRef: skill.contextRef || createItemRef("skill", skill.name) })),
    interview: snapshot.interview || null,
  };
}

export function assertWorkspaceProvider(provider) {
  for (const method of ["getSnapshot", "readResource", "updateResource", "uploadResource", "setActiveSelection"]) {
    if (typeof provider?.[method] !== "function") throw new TypeError(`Workspace provider is missing ${method}().`);
  }
  return provider;
}
