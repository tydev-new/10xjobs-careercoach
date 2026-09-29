// Uncaught-exception parity (lead ruling, fix round 1): several of these
// scripts crash UNCAUGHT in Python for specific inputs the scripts never
// guard against — a missing --md/--application file (render_resume.py,
// proposal_block.py: no os.path.exists check before open()), a directory
// where check_materials.py expects a résumé/letter file (os.path.exists()
// is true for a directory too, so it clears the "file not found" branch
// and then open() raises IsADirectoryError), or check_files.py's
// check_strays() calling os.listdir() on a workspace that doesn't exist or
// isn't a directory. Python's default top-level exception handler prints
// stdout as far as it got (already flushed), then a traceback to stderr,
// then exits 1.
//
// The lead's ruling: exit-code parity plus a stderr whose FIRST LINE is
// exactly "Traceback (most recent call last):" is sufficient — the
// remaining traceback lines (file paths, the Python frame names) may
// differ. This is NOT told to the tester's harness; it already only
// compares the first stderr line for exactly this reason.
export function crashToTraceback(stdoutSoFar, error) {
  const detail = error && error.stack ? error.stack : String(error);
  return {
    stdout: stdoutSoFar,
    stderr: `Traceback (most recent call last):\n${detail}\n`,
    exitCode: 1,
  };
}
