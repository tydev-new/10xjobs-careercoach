// All seven ported CLIs, run through the shipping dispatch (just-bash +
// python3Command) over an in-memory fs. Imported by the browser page AND by
// verify.mjs in Node, so the two runtimes execute byte-identical inputs.
const SKILL = "# s\n\n## State\n\n**`profile.md` — who.**\n- `## Snapshot` — x\n- `## Experience` — y\n- `## Other notes` — optional\n";
const PLAN = "Goal: x\n\n## Board\nWaiting on you\n- the comp floor — criteria.md\n- café visit\nTo do\n- review\n";
const APP = "## Coverage\n\n| requirement | status | evidence | decision |\n|---|---|---|---|\n| Python | have | x | answered |\n| Rust | gap | none — 東京 | open |\n\n## Selection\n\n| # | role | bullet | in/out | source | words | why |\n|---|---|---|---|---|---|---|\n| 1 | Acme | café launch | out | base | 12 | weak |\n";
export const SEED = {
  "/sk/profile/SKILL.md": SKILL,
  // design-web-agent.md § 4: "the bundle mounted read-only at `skills/`"
  "/ws/skills/profile/SKILL.md": SKILL,
  "/ws/profile.md": "# P\n## Snapshot\n## Expérience\n",
  "/ws/plan.md": PLAN,
  "/ws/base-resume.md": "# B\n\n## Experience\n- Wrote SQL pipelines for the café team.\n",
  "/ws/applications/acme-resume.md": "# Zoë\n\n## Summary\n\nok 🚀.\n\n## Experience\n\n- Wrote SQL pipelines for the café team.\n- invented\n",
  "/ws/applications/acme-cover-letter.md": "# L\n\nHi there —\n\nbody.\n",
  "/ws/applications/acme.md": APP,
  "/ws/jobs.md": "# Pipeline\n\n## To Review\n\n### Café Labs — Staff Engineer\n- URL: https://c\n\n",
};
export const COMMANDS = [
  "python3 scripts/check_materials.py --workspace . --resume applications/acme-resume.md --letter applications/acme-cover-letter.md",
  "python3 scripts/proposal_block.py --workspace . --application applications/acme.md",
  "python3 scripts/render_resume.py --md applications/acme-resume.md --html out.html && cat out.html",
  "python3 ../evaluate/scripts/record_verdict.py --workspace . --company 'Montréal Co' --title 'PM 𠀀' --verdict weak --score 3",
  "python3 ../search/scripts/update_job.py --workspace . --company Café --title Staff --dismiss --reason 'trop loin'",
  "cat jobs.md",
  "python3 ../../profile/scripts/check_files.py --workspace . --skills /sk",
  "python3 anything/check_closeout.py --workspace . --stage applying --asked 'your comp floor'",
  "python3 scripts/check_messages.py --workspace .",
  // Re-verify of fix round 1: the skill prose's own call (no --skills), with
  // the bundle at the design's mount. Must find the schema in BOTH runtimes.
  "python3 ../profile/scripts/check_files.py --workspace .",
  // Same call after also copying the skill to /skills: shows whether the
  // default depends on where the runtime's module URL happens to sit.
  "mkdir -p /skills/profile && cp /ws/skills/profile/SKILL.md /skills/profile/ && python3 ../profile/scripts/check_files.py --workspace .",
];
export async function runAll(Bash, python3Command) {
  const bash = new Bash({ customCommands: [python3Command], files: SEED, cwd: "/ws" });
  const out = [];
  for (const cmd of COMMANDS) {
    const r = await bash.exec(cmd);
    out.push({ cmd, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr });
  }
  return out;
}
