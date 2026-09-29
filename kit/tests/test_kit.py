"""The kit's guarded copy: PRINCIPLES-core.md is PRINCIPLES.md Part 2
verbatim. docs/design-js-only.md § 2.1 (J2): the checker-core guarded copy
(kit/shapecheck.py, this file's former test_shapecheck_matches_the_host_checker)
is gone — the kit now VENDORS skills/profile/scripts/lib/shapecheck.mjs
directly (kit/README.md "Adopting it"), so there is no second copy to keep
byte-identical."""
import os
HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..", "..")

def test_principles_core_is_part_two_verbatim():
    p = open(os.path.join(ROOT, "PRINCIPLES.md"), encoding="utf-8").read()
    i = p.index("## Part 2 — How we build it"); j = p.index("\n---\n", i)
    core = open(os.path.join(ROOT, "kit", "PRINCIPLES-core.md"), encoding="utf-8").read()
    assert p[i:j].strip() in core
