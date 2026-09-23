// Runs the SAME command.mjs / check-materials.mjs / record-verdict.mjs
// modules used by the Node tests, bundled by Vite and executed as a page
// script, to prove the ports run in the browser too (not just Node) — the
// slice's step-3 exit criterion "the ports have no Node-only or
// browser-only imports" (docs/plan-portable-skills-and-web-agent.md).
import { Bash } from "just-bash";
// @ts-expect-error - plain .mjs, no type declarations needed for this proof
import { python3Command } from "../../src/just-bash-command.mjs";

const RESUME_CLEAN = `# Alex Chen

## Summary

**Forward-Deployed & Solutions Engineering Leader**
*Turning deployment friction into product strategy.*

Built the function twice, from zero, by treating deployment friction as product
intelligence rather than support noise. Still shipping production code today.

- **8+ years leading technical teams:** yes — shipping today.

## Experience

Platform Lead — Northwind Labs.
`;

async function main() {
  const el = document.getElementById("result")!;
  const done = document.getElementById("done")!;
  try {
    // 1. check_materials.py, dispatched by file name, in-memory fs.
    const bash1 = new Bash({
      customCommands: [python3Command],
      files: { "/home/user/ws/resume.md": RESUME_CLEAN },
      cwd: "/home/user/ws",
    });
    const r1 = await bash1.exec("python3 skills/apply/scripts/check_materials.py --workspace . --resume resume.md");
    const pass1 = r1.exitCode === 0 && r1.stdout.includes("mechanical checks clean");

    // 2. record_verdict.py: a real write (jobs.md) through just-bash's
    // in-memory fs — proves the writer path (not just a reader) works in
    // the browser too.
    const bash2 = new Bash({ customCommands: [python3Command], cwd: "/home/user/ws2" });
    const r2 = await bash2.exec(
      'python3 skills/evaluate/scripts/record_verdict.py --workspace . --company "Acme" --title "Staff Engineer" --verdict strong --score 90'
    );
    const jobsCat = await bash2.exec("cat jobs.md");
    const pass2 =
      r2.exitCode === 0 &&
      r2.stdout.includes("created NEW role") &&
      jobsCat.stdout.includes("### Acme — Staff Engineer") &&
      jobsCat.stdout.includes("Verdict: strong");

    el.textContent = `check_materials: exitCode=${r1.exitCode}\n${r1.stdout}\nrecord_verdict: exitCode=${r2.exitCode}\n${r2.stdout}\njobs.md:\n${jobsCat.stdout}`;
    done.setAttribute("data-done", "true");
    done.setAttribute("data-pass", String(pass1 && pass2));
  } catch (err) {
    el.textContent = "ERROR " + String(err);
    done.setAttribute("data-done", "true");
    done.setAttribute("data-pass", "false");
  }
}

main();
