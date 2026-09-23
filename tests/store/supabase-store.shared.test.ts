// The SAME shared WorkspaceStore suite packages/agent runs against its
// in-memory and local-folder stores (packages/agent/test/workspace-store.shared.ts),
// run here against SupabaseWorkspaceStore over the PGlite stand-in that
// executes the APPLIED migration. One backend per store; seeds go in as
// rows (text) exactly as ten_ws_write would store them.
//
// One adaptation, stated: the suite seeds "skills/apply/SKILL.md". On
// Supabase a skills/ row cannot exist at all (constraint
// ten_ws_files_not_skills; skills are bundled, not stored). To keep that
// test meaningful (the write must still be refused), seeds containing a
// skills/ path get a backend with only that backstop constraint dropped;
// ten_ws_write's own not_editable check is untouched.
import { runWorkspaceStoreSuite } from "../../packages/agent/test/workspace-store.shared.ts";
import { createSupabaseWorkspaceStore } from "../../apps/web/src/backend/supabase-workspace-store.ts";
import { ANON, SUPABASE_URL, createBackend } from "./pglite-backend.ts";

runWorkspaceStoreSuite("supabase (PGlite + applied migration)", async (seed = {}) => {
  const needsSkills = Object.keys(seed).some((p) => p.toLowerCase().startsWith("skills/"));
  const be = await createBackend({ dropSkillsConstraint: needsSkills });
  const uid = await be.newUser({ member: true });
  await be.seedText(uid, seed);
  return createSupabaseWorkspaceStore({
    url: SUPABASE_URL,
    anonKey: ANON,
    userId: uid,
    accessToken: async () => `jwt:${uid}`,
    fetchImpl: be.fetchImpl,
  });
});
