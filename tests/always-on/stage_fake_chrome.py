#!/usr/bin/env python3
"""Stage a NEUTRAL, comment-free copy of fixtures/fake-chrome into a
runner's sandboxed $FAKEHOME (arm-A t10 fix round, 2026-09-27).

Measured miss: the fixture's own docstring says "harness-owned stand-in for
headless Chrome" — an agent under test that reads $RENDER_RESUME_CHROME and
then `cat`s the file BY PATH (a real arm-A t10 trial did exactly this) reads
that prose and tells the "candidate" it is running inside a sandbox. That
changes the very behaviour the harness measures. Hiding the path alone does
not fix this (an agent can still read whatever RENDER_RESUME_CHROME points
at); the fix is to give it nothing worth reading: a byte-for-byte identical
LOGIC copy with every comment and the module docstring removed, staged
under a neutral name (chrome-headless — the same name a real Chromium
install's own headless binary might use) inside the sandbox HOME, never the
real fixtures/ directory. The repo fixture keeps its full documentation;
only the per-trial COPY handed to the agent-under-test is stripped.

    python3 stage_fake_chrome.py <src.py> <dst.py>

Strips:
  - the module docstring (the first statement, if it is a bare string
    expression — located via ast, never a naive text search, so a string
    literal INSIDE the real code, e.g. an f-string that happens to start a
    line, can never be mistaken for it)
  - every comment token (tokenize.COMMENT), including trailing inline
    comments — EXCEPT a line-1 shebang (`#!...`), which is preserved so the
    copy stays independently executable.
Never touched: function/control-flow structure, string literals that are
part of the CODE (error messages, env var names), indentation of any
surviving line relative to its neighbors — untokenize() reconstructs from
the exact recorded (row, col) of every kept token, so the logic's behavior
is byte-for-byte identical minus prose.
"""
import ast
import io
import os
import sys
import tokenize


def strip_docstring(src: str) -> str:
    """Blank out the module docstring's lines (position located via ast,
    not a text search) — kept as blank lines, not deleted outright, so
    every token AFTER it keeps its original line number (untokenize()
    reconstructs from exact source positions)."""
    tree = ast.parse(src)
    body = tree.body
    if (body and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)):
        node = body[0]
        lines = src.splitlines(keepends=True)
        for i in range(node.lineno - 1, node.end_lineno):
            lines[i] = "\n"
        return "".join(lines)
    return src


def strip_comments(src: str) -> str:
    """Drop every COMMENT token except a literal line-1 shebang."""
    kept = []
    tok_gen = tokenize.generate_tokens(io.StringIO(src).readline)
    for tok in tok_gen:
        if tok.type == tokenize.COMMENT and not tok.line.startswith("#!"):
            continue
        kept.append(tok)
    return tokenize.untokenize(kept)


def strip(src: str) -> str:
    return strip_comments(strip_docstring(src))


def main(argv):
    if len(argv) != 2:
        print("usage: stage_fake_chrome.py <src.py> <dst.py>", file=sys.stderr)
        return 2
    src_path, dst_path = argv
    with open(src_path, encoding="utf-8") as f:
        src = f.read()
    out = strip(src)
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(out)
    os.chmod(dst_path, 0o755)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
