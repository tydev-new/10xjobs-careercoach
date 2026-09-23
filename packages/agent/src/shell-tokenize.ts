// One shell-argv tokenizer, shared by every part of the package that has
// to read a `bash` tool's `command` string as argv (L8, fix round 2: the
// card builder and the fake ScriptRunner had drifted onto two different
// hand-rolled regexes, and neither handled single-quoted values). Matches
// just-bash/POSIX shell word-splitting closely enough for the MVP's own
// commands: unquoted runs split on whitespace; `'...'` and `"..."` spans
// are taken literally (no escapes, no variable expansion — this package
// never needs either); a token may mix quoted and unquoted spans
// (`--reasons "a"'b'` -> `ab`), same as a real shell.
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    while (i < n && /\s/.test(command[i])) i++;
    if (i >= n) break;
    let token = "";
    let sawAny = false;
    while (i < n && !/\s/.test(command[i])) {
      sawAny = true;
      const c = command[i];
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        while (i < n && command[i] !== quote) {
          token += command[i];
          i++;
        }
        i++; // skip the closing quote (or run off the end of an unterminated string)
      } else {
        token += c;
        i++;
      }
    }
    if (sawAny) tokens.push(token);
  }
  return tokens;
}

/** `--flag value` pairs out of a command's argv, the way `argparse`-style
 *  scripts read them — quoted values (either quote style, or mixed)
 *  arrive as one already-unquoted token via tokenizeCommand. */
export function parseFlagsFromCommand(command: string): Record<string, string> {
  const argv = tokenizeCommand(command);
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return flags;
}
