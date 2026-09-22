// Runs the SAME command.mjs / check-closeout.mjs modules used by the Node
// tests, bundled by Vite and executed as a page script, to prove the port
// runs in the browser too (not just Node).
import { Bash } from "just-bash";
// @ts-expect-error - plain .mjs, no type declarations needed for the spike
import { python3Command } from "./command.mjs";

const PLAN =
  "Goal: x by 2026-10-01\nBudget: 60 min/day\n\n## Board\nWaiting on you\n" +
  "- the comp floor — criteria.md § Compensation\n" +
  "- warm-path pick: which of the three mutuals to Flo\n" +
  "To do\n- review the Corvid letter (10 min)\n";

async function main() {
  const el = document.getElementById("result")!;
  const done = document.getElementById("done")!;
  try {
    const bash = new Bash({
      customCommands: [python3Command],
      files: { "/home/user/ws/plan.md": PLAN },
      cwd: "/home/user/ws",
    });
    const r = await bash.exec(
      'python3 skills/coach/scripts/check_closeout.py --workspace . --stage applying --asked "which mutual to Flo" --asked "your comp floor"'
    );
    el.textContent = `exitCode=${r.exitCode}\n${r.stdout}`;
    done.setAttribute("data-done", "true");
    done.setAttribute("data-pass", String(r.exitCode === 0 && r.stdout.includes("close-out clean")));
  } catch (err) {
    el.textContent = "ERROR " + String(err);
    done.setAttribute("data-done", "true");
    done.setAttribute("data-pass", "false");
  }
}

main();
