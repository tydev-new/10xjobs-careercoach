import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { ActiveContextError, getWorkspaceAction, visibleMessageFor } from "../shared/active-context.mjs";

function identityKey(identity) {
  return createHash("sha256").update(`${identity.subject}\0${identity.workspaceId}`).digest("hex");
}

function requireIdentity(identity) {
  if (!identity?.authenticated || !identity.subject || !identity.workspaceId) {
    throw new ActiveContextError("workspace_identity_missing", "An authenticated workspace connection is required.", 401);
  }
  return identity;
}

export async function createLocalWorkspaceIdentity(root) {
  const canonicalRoot = await realpath(path.resolve(root)).catch(() => { throw new ActiveContextError("workspace_identity_missing", "Configured workspace does not exist.", 404); });
  return {
    authenticated: true,
    subject: `local:${userInfo().uid}`,
    workspaceId: createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 24),
    assurance: "local_process",
  };
}

export function createFileActiveSelectionStore(directory = path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "10xjobs-careercoach", "active-context")) {
  const fileFor = (identity) => path.join(directory, `${identityKey(requireIdentity(identity))}.json`);
  return {
    async replace(identity, selection) {
      const record = {
        schemaVersion: 1,
        workspaceId: requireIdentity(identity).workspaceId,
        itemRef: selection.itemRef,
        action: selection.action,
      };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const destination = fileFor(identity);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, destination);
      return record;
    },
    async get(identity) {
      const data = await readFile(fileFor(identity), "utf8").catch((error) => {
        if (error.code === "ENOENT") throw new ActiveContextError("active_selection_missing", "Launch an action from CareerCoach before asking the agent.", 404);
        throw error;
      });
      const record = JSON.parse(data);
      if (record.workspaceId !== identity.workspaceId) throw new ActiveContextError("workspace_identity_mismatch", "Active selection belongs to a different workspace.", 403);
      return record;
    },
  };
}

export function createActiveContextService({ identity, workspace, store }) {
  requireIdentity(identity);
  return {
    async setActiveSelection({ itemRef, action: actionId }) {
      const action = getWorkspaceAction(actionId);
      const resolved = await workspace.resolveContextItem(itemRef);
      if (!action.kinds.includes(resolved.kind)) throw new ActiveContextError("action_item_mismatch", "This action is not available for the selected item.", 409);
      await store.replace(identity, { itemRef, action: action.id });
      return {
        itemRef,
        action: action.id,
        label: resolved.label,
        visibleMessage: visibleMessageFor(resolved.label, action.id),
      };
    },
    async getActiveContext() {
      const selection = await store.get(identity);
      const action = getWorkspaceAction(selection.action);
      const resolved = await workspace.resolveContextItem(selection.itemRef);
      if (!action.kinds.includes(resolved.kind)) throw new ActiveContextError("action_item_mismatch", "The active action no longer matches its item.", 409);
      return {
        schemaVersion: 1,
        workspace: { id: identity.workspaceId },
        selection: {
          itemRef: selection.itemRef,
          kind: resolved.kind,
          label: resolved.label,
          action: { id: action.id, label: action.label },
        },
        item: resolved.item,
        sources: resolved.sources,
      };
    },
  };
}
