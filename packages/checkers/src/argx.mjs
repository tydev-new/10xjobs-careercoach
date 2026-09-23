// A tiny, purpose-built argv parser — NOT a general argparse port. It exists
// to reproduce, byte for byte, the handful of stderr shapes Python's
// argparse prints for the option sets these seven checkers actually declare
// (missing required, invalid choice, unrecognized arguments). The usage
// banner argparse prints is static per script (the option list never
// changes at runtime), so each port supplies it as a literal string
// captured once from the real `python3 <script>.py` (see
// packages/checkers/README.md "argparse parity" for how these were
// captured and how to re-capture them if a script's flags ever change).
//
// options: [{ flag, dest, required, choices, boolean, append, type }]
//   flag     "--workspace"
//   dest     "workspace" — key in the returned args object
//   required boolean
//   choices  string[] | undefined
//   boolean  true for store_true flags (no value consumed)
//   append   true for flags collected into an array (argparse action="append")
//   type     "int" | undefined — validated the way argparse's type=int does
export function parseFlags(argv, { options }) {
  const byFlag = new Map(options.map((o) => [o.flag, o]));
  const args = {};
  for (const o of options) {
    if (o.append) args[o.dest] = [];
    else if (o.boolean) args[o.dest] = false;
    else args[o.dest] = o.default !== undefined ? o.default : null;
  }
  const extras = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    let flag = tok;
    let inlineValue = null;
    const eq = tok.indexOf("=");
    if (tok.startsWith("--") && eq !== -1) {
      flag = tok.slice(0, eq);
      inlineValue = tok.slice(eq + 1);
    }
    const opt = byFlag.get(flag);
    if (!opt) {
      extras.push(tok);
      continue;
    }
    if (opt.boolean) {
      args[opt.dest] = true;
      continue;
    }
    let value = inlineValue;
    if (value === null) value = argv[++i];
    if (opt.choices && !opt.choices.includes(value)) {
      return { error: `argument ${opt.flag}: invalid choice: '${value}' (choose from ${opt.choices.join(", ")})` };
    }
    if (opt.type === "int") {
      if (!/^[+-]?\d+$/.test(String(value))) {
        return { error: `argument ${opt.flag}: invalid int value: '${value}'` };
      }
      value = parseInt(value, 10);
    }
    if (opt.append) args[opt.dest].push(value);
    else args[opt.dest] = value;
  }
  const missing = options.filter((o) => o.required && (args[o.dest] === null || args[o.dest] === undefined)).map((o) => o.flag);
  if (missing.length) {
    return { error: `the following arguments are required: ${missing.join(", ")}` };
  }
  if (extras.length) {
    return { error: `unrecognized arguments: ${extras.join(" ")}` };
  }
  return { args };
}

// Formats a parse failure exactly like argparse's ArgumentParser.error():
// the usage banner, then "<prog>: error: <message>", both to stderr, exit 2.
export function argError(prog, usage, message) {
  return { stdout: "", stderr: `${usage}${prog}: error: ${message}\n`, exitCode: 2 };
}
