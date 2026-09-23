// Tester-owned: design-web-agent.md § 5 dispatch contract, via the shipping
// just-bash python3 command. Run: node --test tests/checkers-parity/dispatch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..", "..", "packages", "checkers");
const { Bash } = await import(pathToFileURL(join(PKG, "node_modules", "just-bash", "dist", "bundle", "index.js")).href);
const { python3Command } = await import(pathToFileURL(join(PKG, "src", "just-bash-command.mjs")).href);

const RESUME = "# A\n\n## Summary\n\nok.\n\n## Experience\n\n- did it\n";
const mk = () => new Bash({ customCommands: [python3Command], files: { "/w/r.md": RESUME }, cwd: "/w" });
const ARGS = "--workspace . --resume r.md";

test("the three prefixes the lead named reach check_materials with identical output", async () => {
  const outs = [];
  for (const p of ["anything/check_materials.py", "./scripts/check_materials.py", "../../apply/scripts/check_materials.py", "check_materials.py", "/abs/deep/check_materials.py"]) {
    const r = await mk().exec(`python3 ${p} ${ARGS}`);
    assert.equal(r.exitCode, 0, `${p}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /mechanical checks clean/);
    outs.push(r.stdout);
  }
  assert.equal(new Set(outs).size, 1);
});

test("every ported name routes (none falls through to 127)", async () => {
  for (const n of ["check_materials", "check_files", "proposal_block", "record_verdict", "update_job", "check_closeout", "render_resume"]) {
    const r = await mk().exec(`python3 x/${n}.py`);
    assert.notEqual(r.exitCode, 127, n);
    assert.equal(r.exitCode, 2, `${n} without args should be argparse exit 2: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`^usage: ${n}\\.py`), n);
  }
});

test("unknown, -c, bare, and look-alikes exit 127 with the contract's message", async () => {
  const cases = [
    ["python3 scripts/check_messages.py --workspace .", "check_messages.py"],
    ["python3 ../jobs_md.py", "jobs_md.py"],
    ["python3 scripts/check_materials.py.bak", "check_materials.py.bak"],
    ["python3 scripts/Check_Materials.py", "Check_Materials.py"],
    ["python3 -c 'print(1)'", "-c"],
  ];
  for (const [cmd, name] of cases) {
    const r = await mk().exec(cmd);
    assert.equal(r.exitCode, 127, cmd);
    assert.equal(r.stderr, `not available in the web app: ${name}\n`, cmd);
    assert.equal(r.stdout, "", cmd);
  }
  const bare = await mk().exec("python3");
  assert.equal(bare.exitCode, 127);
  assert.match(bare.stderr, /^not available in the web app: /);
});

test("OBSERVATION: an interpreter flag before the script (python3 -u x.py) is 127, not routed", async () => {
  const r = await mk().exec(`python3 -u scripts/check_materials.py ${ARGS}`);
  assert.equal(r.exitCode, 127);
});

test("routes inside pipelines, && chains and subshells too", async () => {
  const r = await mk().exec(`cd /w && (python3 scripts/check_materials.py ${ARGS} | tail -1)`);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /mechanical checks clean/);
});

test("ports carry no node:* / window / document / localStorage / process / Buffer (static)", () => {
  const SRC = join(PKG, "src");
  const allowNode = new Set(["io-node.mjs"]); // the Node fs adapter, never imported by dispatch
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".mjs"))) {
    const code = readFileSync(join(SRC, f), "utf-8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    if (!allowNode.has(f)) assert.doesNotMatch(code, /from\s+["']node:|import\(\s*["']node:|\brequire\(|\bprocess\.|\bBuffer\b|__dirname/, f);
    assert.doesNotMatch(code, /\b(window|document|localStorage|sessionStorage|navigator)\s*(\.|\[)|typeof\s+(window|document)/, f);
  }
  const dispatch = readFileSync(join(SRC, "dispatch.mjs"), "utf-8");
  assert.doesNotMatch(dispatch, /io-node/);
});
