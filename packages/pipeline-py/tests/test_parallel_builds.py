"""Several builds (and DB writers) at once give the same files as one-at-a-time builds, and no DB write is lost."""
import concurrent.futures as cf, sqlite3, subprocess, sys

from tests import helpers as T

NAMES = ["ic-acme-robotics", "ic-contoso-labs", "eng-fabrikam"]
COMPANIES = {"ic-acme-robotics": "Acme Robotics", "ic-contoso-labs": "Contoso Labs", "eng-fabrikam": "Fabrikam"}


def specs(home):
    out = []
    for n in NAMES:
        base = "eng-manager" if n.startswith("eng") else "ic-builder"
        out.append(T.spec_package(home, n, base=base, company=COMPANIES[n], edits=[] if base == "eng-manager" else None,
                                  scope_line="eng" if base == "eng-manager" else "ic"))
    return out


def write(home, p, rid):
    return subprocess.run([sys.executable, str(T.CLI), "build-package", str(p), "--write", "--run-id", rid],
                          capture_output=True, text=True, env=T.env_for(home), cwd=str(home), timeout=300)


def test_parallel_equals_serial(tmp_path):
    serial, par = T.make_home(tmp_path / "serial"), T.make_home(tmp_path / "parallel")
    sp, pp = specs(serial), specs(par)
    for p in sp:
        r = write(serial, p, "serial"); assert r.returncode == 0, r.stdout + r.stderr
    with cf.ThreadPoolExecutor(len(pp)) as ex:
        rs = list(ex.map(lambda p: write(par, p, "parallel"), pp))
    assert all(r.returncode == 0 for r in rs), [r.stdout + r.stderr for r in rs]
    for a, b in zip(sp, pp):
        for f in ("resume-native.md", "cover.txt", "resume.pdf", "cover.pdf"):
            assert (a / f).read_bytes() == (b / f).read_bytes(), f"{a.name}/{f} differs between serial and parallel builds"
    c = sqlite3.connect(par / "jobs.db")
    assert c.execute("SELECT COUNT(*) FROM package_runs WHERE source='build_package'").fetchone()[0] == len(NAMES)


def test_parallel_db_writers_lose_nothing(home):
    def add(i):
        return T.cli(home, "upsert", "--company", f"Example Co {i}", "--title", "Senior Platform Engineer", "--source", "test",
                     "--url", f"https://jobs.example.com/{i}", "--lane", "IC builder")
    with cf.ThreadPoolExecutor(6) as ex:
        rs = list(ex.map(add, range(12)))
    assert all(r.returncode == 0 for r in rs), [r.stderr for r in rs if r.returncode]
    c = sqlite3.connect(home / "jobs.db")
    assert c.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 12
