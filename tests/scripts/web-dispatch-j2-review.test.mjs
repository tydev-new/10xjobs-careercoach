// Tester-owned (JS-only J2 review), from docs/design-js-only.md § 3.5 and
// § 6 J2's tester check: "on the web, `python3 scripts/check_files.py` exits
// 127 with the line that names `node scripts/check_files.mjs`, and
// `node -e "…"` exits 127". Driven through the exact commands the web script
// runner registers (apps/web/src/backend/script-runner.ts imports
// nodeCommand and python3Command), with both registered together, as there.
//
//   node --test tests/scripts/web-dispatch-j2-review.test.mjs (tests/run.py runs tests/scripts/)
import test from "node:test";
import assert from "node:assert/strict";
import { Bash } from "../../packages/checkers/node_modules/just-bash/dist/bundle/index.js";
import { nodeCommand, python3Command } from "../../packages/checkers/src/just-bash-command.mjs";

const sh = () => new Bash({ customCommands: [nodeCommand, python3Command], cwd: "/home/user/ws", files: { "/home/user/ws/.keep": "" } });
const POINTER = (p) => `python3 is not available here. Run the same check with node: node ${p}\n`;
const UNKNOWN = (name) => new RegExp(`not available in the web app: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

test("§ 6 J2 tester check: python3 scripts/check_files.py exits 127 with the line naming node scripts/check_files.mjs", async () => {
  const r = await sh().exec("python3 scripts/check_files.py --workspace .");
  assert.equal(r.exitCode, 127);
  assert.equal(r.stderr, POINTER("scripts/check_files.mjs"));
  assert.equal(r.stdout, "");
});

test("§ 6 J2 tester check: node -e \"…\" exits 127 (and -p, --eval, and no argument)", async () => {
  for (const cmd of [`node -e "require('fs').writeFileSync('x','y')"`, `node -p "1+1"`, `node --eval "1"`, "node"]) {
    const r = await sh().exec(cmd);
    assert.equal(r.exitCode, 127, cmd);
    assert.match(r.stderr, /not available in the web app/, cmd);
  }
});

test("§ 3.5: every one of the seven .py names points to its .mjs, keeping the caller's prefix", async () => {
  for (const [py, mjs] of [
    ["scripts/check_materials.py", "scripts/check_materials.mjs"],
    ["../apply/scripts/proposal_block.py", "../apply/scripts/proposal_block.mjs"],
    ["skills/apply/scripts/render_resume.py", "skills/apply/scripts/render_resume.mjs"],
    ["scripts/record_verdict.py", "scripts/record_verdict.mjs"],
    ["scripts/update_job.py", "scripts/update_job.mjs"],
    ["../profile/scripts/check_files.py", "../profile/scripts/check_files.mjs"],
    ["scripts/check_closeout.py", "scripts/check_closeout.mjs"],
  ]) {
    const r = await sh().exec(`python3 ${py} --workspace .`);
    assert.equal(r.exitCode, 127, py);
    assert.equal(r.stderr, POINTER(mjs), py);
  }
});

test("§ 3.5: anything else after python3 gets the unknown-script message, never a node pointer", async () => {
  for (const [cmd, name] of [
    ["python3 scripts/check_messages.py --workspace .", "check_messages.py"],   // J3: not in MVP_SKILLS
    ["python3 scripts/jobs_md.py", "jobs_md.py"],                               // a library, not a command
    ["python3 scripts/migrate_jobs_db.py", "migrate_jobs_db.py"],               // retired (D4)
    ["python3 scripts/search_ats.py --workspace .", "search_ats.py"],           // S4
    ["python3 -c 'print(1)'", "-c"],
  ]) {
    const r = await sh().exec(cmd);
    assert.equal(r.exitCode, 127, cmd);
    assert.match(r.stderr, UNKNOWN(name), cmd);
    assert.doesNotMatch(r.stderr, /Run the same check with node/, cmd);
  }
});

test("§ 3.5: node on an unknown script, a library, a J3 script, or an extension-less name exits 127", async () => {
  for (const [cmd, name] of [
    ["node scripts/check_files --workspace .", "check_files"],                        // no extension
    ["node scripts/lib/check-files.mjs --workspace .", "check-files.mjs"],            // the lib, not the command
    ["node ../search/scripts/lib/jobs-md.mjs", "jobs-md.mjs"],
    ["node scripts/check_knowledge.mjs --workspace .", "check_knowledge.mjs"],        // J3
    ["node scripts/check_stories.mjs --workspace .", "check_stories.mjs"],            // J3
    ["node scripts/check_files.py --workspace .", "check_files.py"],                  // wrong runtime's name
  ]) {
    const r = await sh().exec(cmd);
    assert.equal(r.exitCode, 127, cmd);
    assert.match(r.stderr, UNKNOWN(name), cmd);
  }
});
