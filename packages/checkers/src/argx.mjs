// A faithful-enough shared argv parser for the 7 ported CLIs' argparse
// definitions — not a general argparse port, but one engine (not seven
// hand-rolled ones) so every CLI gets the same behavior for: -h/--help
// (prints the script's captured help text, exit 0, short-circuits
// immediately wherever it appears), unambiguous prefix ("--work" ->
// "--workspace") and ambiguous-prefix errors, "--flag=value" for both
// value-taking and (as an error) boolean flags, a value-taking flag
// missing its value (including at end of argv or followed by another
// flag-looking token — "-5"-shaped tokens are exempt, matching argparse's
// negative-number carve-out), repeated flags (last one wins — argparse
// does NOT error on this unless the flag is part of a mutually exclusive
// group), int-typed flags via py-text.mjs's pyInt, choices, one
// mutually-exclusive group per parser, and the exact precedence order
// real argparse uses: a flag error encountered mid-parse (missing value,
// invalid choice, ambiguous, ignored explicit boolean value, a mutex
// conflict) fires immediately; only once the whole argv is consumed
// successfully does the parser check individual required flags, then the
// mutex group's own "one of ... is required", then finally (in the
// caller, not `parse_known_args`) unrecognized leftover arguments. Also:
// `--` (end of options — everything after it is positional, so for these
// 7 flag-only scripts it's always an unrecognized-argument extra) and
// `--help=value` (the help action is itself boolean, so an inline value
// is the same "ignored explicit argument" error a boolean flag gives,
// naming both of -h/--help's registered forms).
//
// options: [{ flag, dest, required, choices, boolean, append, type,
//             mutexGroup }]
import { pyInt } from "./py-text.mjs";

const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;

function looksLikeAFlag(tok) {
  if (tok === undefined) return false;
  if (!tok.startsWith("-") || tok === "-") return false;
  return !NEGATIVE_NUMBER.test(tok);
}

/**
 * @param {string[]} argv
 * @param {{ options: object[], mutexGroups?: {id:string, required:boolean, members:string[]}[], help: string }} spec
 */
export function parseFlags(argv, spec) {
  const { options, mutexGroups = [], help } = spec;
  const args = {};
  for (const o of options) {
    if (o.append) args[o.dest] = [];
    else if (o.boolean) args[o.dest] = false;
    else args[o.dest] = o.default !== undefined ? o.default : null;
  }

  function resolveFlag(flagPart) {
    if (flagPart === "--help") return { flag: "--help", isHelp: true };
    const exact = options.find((o) => o.flag === flagPart);
    if (exact) return exact;
    if (flagPart.length <= 2) return null; // "--" alone or shorter never abbreviates
    const matches = options.filter((o) => o.flag.startsWith(flagPart));
    const helpMatches = "--help".startsWith(flagPart) ? [{ flag: "--help", isHelp: true }] : [];
    const all = [...matches, ...helpMatches];
    if (all.length === 0) return null;
    if (all.length === 1) return all[0];
    return { ambiguous: all.map((o) => o.flag) };
  }

  const seenGroupMember = new Map(); // groupId -> option
  const extras = [];
  let afterDoubleDash = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];

    // "--" (argparse/POSIX end-of-options marker): consumed, never itself
    // an extra; EVERY token after it is positional — since none of these
    // 7 scripts declare a positional argument, that means every remaining
    // token becomes an unrecognized-argument extra, with no further flag
    // parsing (so a "--workspace" appearing after "--" is a literal
    // string, not the --workspace flag).
    if (!afterDoubleDash && tok === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (afterDoubleDash) {
      extras.push(tok);
      continue;
    }

    if (tok === "-h") return { help: true, text: help };

    let flagPart = tok;
    let inlineValue = null;
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        flagPart = tok.slice(0, eq);
        inlineValue = tok.slice(eq + 1);
      }
    } else if (!tok.startsWith("-") || tok === "-") {
      extras.push(tok);
      continue;
    } else {
      // a lone "-x" (not -h, not a recognized long flag): none of these 7
      // scripts declare another short option, so it's always an extra.
      extras.push(tok);
      continue;
    }

    const resolved = flagPart.startsWith("--") ? resolveFlag(flagPart) : null;
    if (!resolved) {
      extras.push(tok);
      continue;
    }
    if (resolved.ambiguous) {
      return { error: `ambiguous option: ${flagPart} could match ${resolved.ambiguous.join(", ")}` };
    }
    if (resolved.isHelp) {
      // "--help=foo" (or an abbreviation of it, "--hel=foo"): argparse's
      // help action is itself a boolean (nargs=0) action, so an explicit
      // inline value is the SAME "ignored explicit argument" error a
      // boolean flag gives below — except the message names BOTH of the
      // action's registered option strings ("-h/--help"), since -h and
      // --help are registered together as one action.
      if (inlineValue !== null) {
        return { error: `argument -h/--help: ignored explicit argument '${inlineValue}'` };
      }
      return { help: true, text: help };
    }

    const opt = resolved;
    if (opt.boolean) {
      if (inlineValue !== null) {
        return { error: `argument ${opt.flag}: ignored explicit argument '${inlineValue}'` };
      }
      args[opt.dest] = true;
    } else {
      let value = inlineValue;
      if (value === null) {
        const next = argv[i + 1];
        if (looksLikeAFlag(next) || next === undefined) {
          return { error: `argument ${opt.flag}: expected one argument` };
        }
        value = next;
        i++;
      }
      if (opt.choices && !opt.choices.includes(value)) {
        return { error: `argument ${opt.flag}: invalid choice: '${value}' (choose from ${opt.choices.join(", ")})` };
      }
      if (opt.type === "int") {
        const n = pyInt(value);
        if (n === null) return { error: `argument ${opt.flag}: invalid int value: '${value}'` };
        value = n;
      }
      if (opt.append) args[opt.dest].push(value);
      else args[opt.dest] = value;
    }

    if (opt.mutexGroup) {
      const prev = seenGroupMember.get(opt.mutexGroup);
      if (prev && prev.flag !== opt.flag) {
        return { error: `argument ${opt.flag}: not allowed with argument ${prev.flag}` };
      }
      seenGroupMember.set(opt.mutexGroup, opt);
    }
  }

  const missing = options.filter((o) => o.required && (args[o.dest] === null || args[o.dest] === undefined)).map((o) => o.flag);
  if (missing.length) {
    return { error: `the following arguments are required: ${missing.join(", ")}` };
  }
  for (const g of mutexGroups) {
    if (g.required && !seenGroupMember.has(g.id)) {
      return { error: `one of the arguments ${g.members.join(" ")} is required` };
    }
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

// -h/--help: the exact captured text (see src/help-text.mjs), to stdout, exit 0.
export function argHelp(helpText) {
  return { stdout: helpText, stderr: "", exitCode: 0 };
}
