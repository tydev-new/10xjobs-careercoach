#!/usr/bin/env python3
"""Update a pipeline role in jobs.md: move stage, dismiss, or restore.
The ONE structured write for user actions arriving via chat.

Fails loudly on 0 or 2+ matches — an ambiguous request never silently edits
the wrong role. (Ported from the retired board skill, 2026-08-14; storage is
now the readable jobs.md record.)

  python3 update_job.py --workspace . --company Cursor --title "Forward Deployed" --stage Applied
  python3 update_job.py --workspace . --company Anthropic --title "Continuous Deployment" --dismiss --reason "internal CI/CD, not FDE"
  python3 update_job.py --workspace . --company Anthropic --title "..." --restore
"""
import argparse, sys
import jobs_md as jm


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--workspace", required=True)
    p.add_argument("--company", required=True)
    p.add_argument("--title", required=True, help="full or partial — must match exactly one role")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--stage", choices=jm.STAGES)
    g.add_argument("--dismiss", action="store_true")
    g.add_argument("--restore", action="store_true")
    p.add_argument("--reason", help="dismiss reason (with --dismiss)")
    a = p.parse_args()

    rows = jm.load(a.workspace)
    hits = jm.find(rows, a.company, a.title)
    if len(hits) != 1:
        which = ("no roles" if not hits else
                 f"{len(hits)} roles: " + "; ".join(r["title"] for r in hits))
        print(f"error: --company/--title matched {which} — be more specific", file=sys.stderr)
        return 2
    r = hits[0]
    r["updated_at"] = jm.now_iso()
    if a.stage:
        r["stage"], r["dismissed"] = a.stage, False
        action = f"stage -> {a.stage}"
    elif a.dismiss:
        r["dismissed"] = True
        if a.reason:
            r["dismiss_reason"] = a.reason
        action = "dismissed" + (f" ({a.reason})" if a.reason else "")
    else:
        r["dismissed"] = False
        action = "restored"
    jm.save(a.workspace, rows)
    print(f"updated: {r['company']} — {r['title']} — {action}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
