import { Bash } from "just-bash";
import { python3Command } from "../../../packages/checkers/src/just-bash-command.mjs";
import { runAll } from "./cases.mjs";
const done = document.getElementById("done");
runAll(Bash, python3Command)
  .then((r) => { done.textContent = JSON.stringify(r); done.dataset.done = "ok"; })
  .catch((e) => { done.textContent = "ERROR " + (e && e.stack || e); done.dataset.done = "err"; });
