#!/usr/bin/env node
// Two jobs for score_t22.py, both using the skill's own lib rather than a
// second copy of it in Python (docs/design-feedback.md § 7, § 13):
//
//   echo '<json body>' | node render_feedback.mjs   the rendering of a recorded
//                                                   request body, or "INVALID"
//   node render_feedback.mjs --fixed                the fixed lines FB1..FB10 as JSON
//
// "INVALID" means the body is not exactly the eight keys of § 6, in order.
import { FB, PAYLOAD_KEYS, renderFeedback } from "../../skills/feedback/scripts/lib/feedback.mjs";

if (process.argv.includes("--fixed")) {
  process.stdout.write(JSON.stringify(FB) + "\n");
} else {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    const body = JSON.parse(text);
    const keys = Object.keys(body);
    if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((k, i) => keys[i] === k)) {
      process.stdout.write("INVALID\n");
    } else {
      process.stdout.write(renderFeedback(body) + "\n");
    }
  } catch {
    process.stdout.write("INVALID\n");
  }
}
