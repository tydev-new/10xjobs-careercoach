# Install

Install dependencies in a private virtual environment. Do not vendor them into this tree, and do not install them inside a checkout you plan to publish.

## System tools

- Python 3.10 or newer
- Poppler, providing `pdfinfo` and `pdftotext` (Debian/Ubuntu package `poppler-utils`)

## Python packages

From the kit root:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r setup/requirements.txt
```

`.venv/` is gitignored. The pins are the versions recorded with this export. Installing them and running `bash setup/run_offline_tests.sh` is the offline check. It does not certify live job-board, model, mail, or browser-submit integrations. See [TESTING.md](TESTING.md).

## Private copy

```sh
python3 setup/bootstrap.py /absolute/path/to/new-private-kit
python3 setup/relocate.py /absolute/path/to/new-private-kit
export JOBBI_ROOT=/absolute/path/to/new-private-kit
export JOBSEARCH_WORKSPACE="$JOBBI_ROOT/workspace/job-search"
```

The destination must be a new directory outside this tree. Bootstrap checks this tree against `DISTRIBUTION.json`, copies those files, and initializes an empty original-schema database. It refuses symlinks, unexpected files, and a source profile that is not marked synthetic.

## Onboarding

Only in the private copy:

```sh
python3 "$JOBBI_ROOT/setup/onboarding_status.py"
```

Then edit the files listed in [CONFIGURATION.md](CONFIGURATION.md). The status script lists settings that are still null, empty, or synthetic. It does not fill them in, does not approve claims, and does not authorize an application or an email.

## Offline tests

```sh
bash setup/run_offline_tests.sh
```

The script scans this tree, checks that bootstrap still rejects a contaminated copy and still creates an empty database, builds a disposable copy, and runs the application and sourcing pytest suites there. Generated PDFs and databases stay in the temp directory.
