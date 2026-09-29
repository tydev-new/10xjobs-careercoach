// Tester-owned: docs/design-web-agent.md § 5 / docs/design-js-only.md
// § 3.5 dispatch contract, via the shipping just-bash "node" command
// (renamed from "python3" at J2 — mechanical rename only, same shape and
// assertions). Run: node --test tests/checkers-parity/dispatch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..", "..", "packages", "checkers");
const SKILLS = join(HERE, "..", "..", "skills");
const { Bash } = await import(pathToFileURL(join(PKG, "node_modules", "just-bash", "dist", "bundle", "index.js")).href);
const { nodeCommand } = await import(pathToFileURL(join(PKG, "src", "just-bash-command.mjs")).href);

const RESUME = "# A\n\n## Summary\n\nok.\n\n## Experience\n\n- did it\n";
const mk = () => new Bash({ customCommands: [nodeCommand], files: { "/w/r.md": RESUME }, cwd: "/w" });
const ARGS = "--workspace . --resume r.md";

test("the three prefixes the lead named reach check_materials with identical output", async () => {
  const outs = [];
  for (const p of ["anything/check_materials.mjs", "./scripts/check_materials.mjs", "../../apply/scripts/check_materials.mjs", "check_materials.mjs", "/abs/deep/check_materials.mjs"]) {
    const r = await mk().exec(`node ${p} ${ARGS}`);
    assert.equal(r.exitCode, 0, `${p}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /automatic checks clean/);
    outs.push(r.stdout);
  }
  assert.equal(new Set(outs).size, 1);
});

test("every ported name routes (none falls through to 127)", async () => {
  for (const n of ["check_materials", "check_files", "proposal_block", "record_verdict", "update_job", "check_closeout", "render_resume"]) {
    const r = await mk().exec(`node x/${n}.mjs`);
    assert.notEqual(r.exitCode, 127, n);
    assert.equal(r.exitCode, 2, `${n} without args should be argparse exit 2: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^usage: ${n}\\.mjs`), n); // § 5.5's own commit renames the usage banner text too
  }
});

test("unknown, -e/-p/--eval, bare, and look-alikes exit 127 with the contract's message", async () => {
  const cases = [
    ["node scripts/check_messages.mjs --workspace .", "check_messages.mjs"],
    ["node ../jobs-md.mjs", "jobs-md.mjs"],
    ["node scripts/check_materials.mjs.bak", "check_materials.mjs.bak"],
    ["node scripts/Check_Materials.mjs", "Check_Materials.mjs"],
    ["node -e 'print(1)'", "-e"],
    ["node -p 1", "-p"],
    ["node --eval 1", "--eval"],
  ];
  for (const [cmd, name] of cases) {
    const r = await mk().exec(cmd);
    assert.equal(r.exitCode, 127, cmd);
    assert.equal(r.stderr, `not available in the web app: ${name}\n`, cmd);
    assert.equal(r.stdout, "", cmd);
  }
  const bare = await mk().exec("node");
  assert.equal(bare.exitCode, 127);
  assert.match(bare.stderr, /^not available in the web app: /);
});

test("OBSERVATION: an interpreter flag before the script (node -u x.mjs) is 127, not routed", async () => {
  const r = await mk().exec(`node -u scripts/check_materials.mjs ${ARGS}`);
  assert.equal(r.exitCode, 127);
});

test("routes inside pipelines, && chains and subshells too", async () => {
  const r = await mk().exec(`cd /w && (node scripts/check_materials.mjs ${ARGS} | tail -1)`);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /automatic checks clean/);
});

test("ports carry no node:* / window / document / localStorage / process / Buffer (static)", () => {
  const allowNode = new Set(["io-node.mjs"]); // the Node fs adapter, never imported by dispatch
  const libFiles = [];
  for (const skill of readdirSync(SKILLS)) {
    const libDir = join(SKILLS, skill, "scripts", "lib");
    try {
      for (const f of readdirSync(libDir).filter((f) => f.endsWith(".mjs"))) libFiles.push(join(libDir, f));
    } catch {
      // this skill has no scripts/lib/ — fine
    }
  }
  for (const path of libFiles) {
    const f = path.split("/").pop();
    const code = readFileSync(path, "utf-8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    if (!allowNode.has(f)) assert.doesNotMatch(code, /from\s+["']node:|import\(\s*["']node:|\brequire\(|\bprocess\.|\bBuffer\b|__dirname/, path);
    assert.doesNotMatch(code, /\b(window|document|localStorage|sessionStorage|navigator)\s*(\.|\[)|typeof\s+(window|document)/, path);
  }
  const dispatch = readFileSync(join(PKG, "src", "dispatch.mjs"), "utf-8");
  assert.doesNotMatch(dispatch, /io-node/);
});
