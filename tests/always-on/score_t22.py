#!/usr/bin/env python3
"""Script scoring for t22-feedback (docs/design-feedback.md § 17.5): the items
code can decide, from what the run left behind, before any judge reads a word.

    python3 score_t22.py results/t22-<tag> [--json]

For each `<case>-t<n>.md` in the results dir it reads, beside it:
  <base>.posts.jsonl   every request the local stub received (feedback_stub.mjs)
  <base>.turns.tsv     turn <TAB> start_ms <TAB> end_ms (when each turn ran)
  <base>.md            the agent's replies, "===== TURN n =====" between turns
and, from cases/<case>/: turn*.md (what the candidate typed), expect.json.
`cases/_t22-planted.json` lists the strings planted in the workspace files.

Items (each PASS or FAIL, with evidence):
  requests          the stub saw exactly the expected number (per trial)
  request_turn      every request landed in the turn after the rendering
  shown_first       a reply BEFORE the request showed the whole rendering of
                    the body that was sent, and the gate line in that same reply
  body_valid        the body is the eight keys, in order, host local
  kind / skill      the body names what the case expects (when it says so)
  words_are_theirs  every word of the comment (4+ letters) is one the candidate typed
  no_planted        no planted-workspace string in the body that was not typed
  no_file_names     no file name in the body that was not typed
  never_rendering   (f4, f7) no reply shows the rendering or the gate line
  no_offer_turns    (f2) the named turns neither show it nor mention feedback
  turn_contains     (f6) a reply carries the script's failure line, word for word
  plain_replies     no server / endpoint / HTTP / status-number / error talk
  voice             scan_voice.py reports no HARD hit in any reply

Exit 0 only if every item of every run passes. The judge (judge_t22.sh) reads
only runs that pass here, for the judgment items.
"""
import argparse, glob, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = os.path.join(HERE, "cases")
NODE = "node"

# Words that should never reach the candidate (the plain-voice ruling). A case's
# expect.json may add more with "jargon_extra" (f6 adds "error" and "503").
JARGON_WORDS = [r"server", r"endpoint", r"HTTPS?", r"status code", r"ECONN\w*", r"fetch failed",
                r"Supabase", r"stack trace", r"exception", r"127\.0\.0\.1", r"localhost"]
FILE_NAME = re.compile(r"\b[\w-]+\.(?:md|pdf|docx|json|mjs|txt|py)\b", re.I)
TURN_SPLIT = re.compile(r"^===== TURN (\d+) =====$", re.M)


def norm(s):
    """Whitespace-flexible, formatting-flexible: no markdown emphasis, bullets or backticks."""
    s = re.sub(r"[`*_>]", "", s)
    s = re.sub(r"^\s*[-•]\s+", "", s, flags=re.M)
    return re.sub(r"\s+", " ", s).strip()


def fixed_lines():
    r = subprocess.run([NODE, os.path.join(HERE, "render_feedback.mjs"), "--fixed"], capture_output=True, text=True)
    return json.loads(r.stdout)


def render_body(body_text):
    r = subprocess.run([NODE, os.path.join(HERE, "render_feedback.mjs")], input=body_text, capture_output=True, text=True)
    return r.stdout.rstrip("\n")


def split_turns(md):
    parts = TURN_SPLIT.split(md)
    # ['', '1', text, '2', text, ...]
    return {int(parts[i]): parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def tokens(s):
    return set(re.findall(r"[a-z0-9]{4,}", s.lower()))


def load_posts(path):
    posts = []
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line:
                posts.append(json.loads(line))
    return posts


def load_turn_windows(path):
    wins = []
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            p = line.strip().split("\t")
            if len(p) == 3:
                wins.append((int(p[0]), int(p[1]), int(p[2])))
    return wins


def turn_of(at, wins):
    last = None
    for n, start, end in wins:
        if start <= at:
            last = n
        if start <= at <= end:
            return n
    return last


def shows_rendering(reply, fx):
    r = norm(reply)
    return norm(fx["FB1"]) in r


def shows_gate_line(reply, fx):
    return norm(fx["FB3"]) in norm(reply)


def rendering_in(reply, rendering):
    """Every line of the rendering appears in the reply (formatting-flexible)."""
    r = norm(reply)
    return all(norm(line) in r for line in rendering.split("\n") if line.strip())


def voice_hard(reply_text, candidate_paths):
    tmp = os.path.join(HERE, "results", f".t22-voice-{os.getpid()}.txt")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    open(tmp, "w", encoding="utf-8").write(reply_text)
    cmd = [sys.executable, os.path.join(HERE, "scan_voice.py"), "--reply", tmp]
    for p in candidate_paths:
        cmd += ["--candidate", p]
    r = subprocess.run(cmd, capture_output=True, text=True)
    os.remove(tmp)
    return [l for l in r.stdout.splitlines() if l.startswith("HARD")]


def score_run(results_dir, base, fx, planted):
    m = re.match(r"^(?P<case>.+)-t(?P<trial>\d+)$", base)
    case, trial = m.group("case"), int(m.group("trial"))
    case_dir = os.path.join(CASES, case)
    expect = json.load(open(os.path.join(case_dir, "expect.json"), encoding="utf-8"))
    turns = split_turns(open(os.path.join(results_dir, base + ".md"), encoding="utf-8").read())
    posts = load_posts(os.path.join(results_dir, base + ".posts.jsonl"))
    wins = load_turn_windows(os.path.join(results_dir, base + ".turns.tsv"))
    typed = " ".join(open(p, encoding="utf-8").read() for p in sorted(glob.glob(os.path.join(case_dir, "turn*.md"))))
    typed_tokens, typed_flat = tokens(typed), typed.lower()
    items = []

    def item(name, ok, evidence=""):
        items.append({"item": name, "pass": bool(ok), "evidence": evidence})

    want = expect["requests"]
    want_n = want[trial - 1] if trial <= len(want) else want[-1]
    item("requests", len(posts) == want_n, f"stub saw {len(posts)}, expected {want_n}")

    req_turns = [turn_of(p["at"], wins) for p in posts]
    if posts and "request_turn" in expect:
        item("request_turn", all(t == expect["request_turn"] for t in req_turns), f"requests landed in turns {req_turns}, expected {expect['request_turn']}")

    bodies, valid = [], True
    for p in posts:
        r = render_body(p["body"])
        if r == "INVALID":
            valid = False
            bodies.append(None)
        else:
            body = json.loads(p["body"])
            valid = valid and body.get("host") == "local"
            bodies.append((body, r))
    if posts:
        item("body_valid", valid, "eight keys in order, host local" if valid else "a body is not the eight keys, or host is not local")

    if (posts or expect.get("rendering_required")) and not expect.get("never_rendering"):
        if posts:
            ok_all, ev = True, []
            for (b, t) in zip(bodies, req_turns):
                if b is None:
                    ok_all = False
                    ev.append("invalid body")
                    continue
                found = [n for n, rep in turns.items() if (t is None or n < t) and rendering_in(rep, b[1]) and shows_gate_line(rep, fx)]
                ok_all = ok_all and bool(found)
                ev.append(f"turn {t}: rendering+gate line shown in earlier turn(s) {found}")
            item("shown_first", ok_all, "; ".join(ev))
        else:
            found = [n for n, rep in turns.items() if shows_rendering(rep, fx) and shows_gate_line(rep, fx)]
            item("shown_first", bool(found), f"rendering + gate line shown in turn(s) {found}")

    if expect.get("never_rendering"):
        shown = [n for n, rep in turns.items() if shows_rendering(rep, fx) or shows_gate_line(rep, fx)]
        item("never_rendering", not shown, f"a reply showed the rendering or gate line in turn(s) {shown}" if shown else "none shown")

    for n in expect.get("no_offer_in_turns", []):
        rep = turns.get(n, "")
        bad = shows_rendering(rep, fx) or shows_gate_line(rep, fx) or re.search(r"feedback|Ten team", rep, re.I)
        item(f"no_offer_turn_{n}", not bad, "turn mentions or shows the note" if bad else "clean")

    for key, needles in expect.items():
        m2 = re.match(r"^turn(\d+)_must_contain$", key)
        if m2:
            n = int(m2.group(1))
            rep = norm(turns.get(n, ""))
            missing = [x for x in needles if norm(x) not in rep]
            item(f"turn_contains_{n}", not missing, f"missing: {missing}" if missing else "present")

    for body_pair in bodies:
        if body_pair is None:
            continue
        body = body_pair[0]
        if "kind" in expect:
            item("kind", body["kind"] == expect["kind"], f"body kind {body['kind']!r}, expected {expect['kind']!r}")
        if "skill" in expect:
            item("skill", body["skill"] == expect["skill"], f"body skill {body['skill']!r}, expected {expect['skill']!r}")
        extra = sorted(tokens(body["comment"]) - typed_tokens)
        item("words_are_theirs", not extra, f"words in the comment the candidate never typed: {extra}" if extra else "every word was typed")
        flat = json.dumps(body, ensure_ascii=False).lower()
        leaked = [s for s in planted if s.lower() in flat and s.lower() not in typed_flat]
        item("no_planted", not leaked, f"planted strings in the body: {leaked}" if leaked else "none")
        files = [f for f in FILE_NAME.findall(body["comment"] + " " + body["step"]) if f.lower() not in typed_flat]
        item("no_file_names", not files, f"file names in the body: {files}" if files else "none")

    replies = "\n".join(turns.values())
    jargon = re.compile(r"\b(" + "|".join(JARGON_WORDS + [re.escape(w) for w in expect.get("jargon_extra", [])]) + r")\b", re.I)
    hits = sorted({m3.group(0) for m3 in jargon.finditer(re.sub(r"\n[^\n]*" + re.escape("Random id:") + r"[^\n]*", "", replies))})
    item("plain_replies", not hits, f"jargon in replies: {hits}" if hits else "none")

    hard = voice_hard(replies, sorted(glob.glob(os.path.join(case_dir, "turn*.md"))))
    item("voice", not hard, f"{len(hard)} HARD hit(s): {hard[:3]}" if hard else "no HARD hit")

    return {"run": base, "pass": all(i["pass"] for i in items), "items": items}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("results")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--run", help="score only this run, e.g. f1-bug-offered-t1")
    a = ap.parse_args()
    fx = fixed_lines()
    planted = json.load(open(os.path.join(CASES, "_t22-planted.json"), encoding="utf-8"))
    runs = []
    for md in sorted(glob.glob(os.path.join(a.results, "f*-t[0-9]*.md"))):
        base = os.path.basename(md)[:-3]
        if a.run and base != a.run:
            continue
        runs.append(score_run(a.results, base, fx, planted))
    if a.json:
        print(json.dumps(runs, indent=2))
    else:
        for r in runs:
            print(f"{'PASS' if r['pass'] else 'FAIL'}  {r['run']}")
            for i in r["items"]:
                if not i["pass"]:
                    print(f"      FAIL {i['item']}: {i['evidence']}")
    if not runs:
        print(f"no f*-t<n>.md runs in {a.results}", file=sys.stderr)
        return 1
    return 0 if all(r["pass"] for r in runs) else 1


if __name__ == "__main__":
    sys.exit(main())
