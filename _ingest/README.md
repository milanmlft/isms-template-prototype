# ISMS document ingestion

Tooling to turn a plain-markdown UCL ISMS policy into a **draft** baseline `.qmd` in the
block-tagged form this repo expects, and to keep `manifest.yml` in sync.

> [!IMPORTANT]
> This is a **draft generator, not an autopilot.** It produces a first draft that always needs
> human review before it is committed. The decisions that matter most — which regions are
> overridable, what a block's semantic ID should be, and which phrases are institution specifics
> that belong in `_variables.yml` — are governance decisions the script can only *propose*.

## Layout

```
_ingest/
  ingest.py          # the script
  input/             # drop source .md files here (gitignored; only .gitkeep is tracked)
  README.md          # this file
```

`_ingest/input/` is gitignored so raw source policy never lands in version control by accident.
The script writes draft `.qmd` files into `_extensions/isms/docs/` (tracked baseline sources) only
when you ask it to, and prints a `manifest.yml` snippet for you to paste in.

## Usage

The script is plain Python 3 (standard library only — no pip install):

```shell
# 1. Drop a source file, e.g. _ingest/input/ISMS05-risk-management.md

# 2. Dry run: see the proposed .qmd and manifest snippet WITHOUT writing anything
python _ingest/ingest.py _ingest/input/ISMS05-risk-management.md --id ISMS05 --dry-run

# 3. Write the draft into the baseline docs/ once you are happy with the ID plan
python _ingest/ingest.py _ingest/input/ISMS05-risk-management.md --id ISMS05 --title "Risk Management Policy"

# 4. Update manifest.yml (append the document + its blocks:)
python _ingest/ingest.py _ingest/input/ISMS05-risk-management.md --id ISMS05 --title "Risk Management Policy" --update-manifest
```

## What the script does, and what it deliberately leaves to you

Does (mechanical, deterministic):

- **preserves the source `.md`'s own front matter verbatim** — its values (author, version,
  classification, `review.*`, `approval.*`, `sources`) are what `docs/_preamble.qmd` renders, so the
  source value is accepted unless an override later provides different data;
- **adds only the pipeline keys the source is missing** (`isms-id`, `title`, `filename`,
  `baseline-doc-version`, `number-sections`), and **warns** on each one it synthesises — a source
  value always wins over the default;
- inserts `{{< include _preamble.qmd >}}`;
- wraps each heading section in `isms:begin`/`isms:end` delimiters, nesting `###` under `##`;
- derives a `{#sec-...}` anchor for each heading;
- proposes a semantic block ID from each heading slug;
- extracts the block list and prints (or writes) the `manifest.yml` entry;
- writes the generated `.qmd` **LF-only** regardless of platform, so it matches the line endings the
  block parser and CI expect (see the note below);
- **flags** phrases that look like institution specifics (org names via `--org-name`, known role
  strings from `_variables.yml`) on stderr, rather than silently rewriting them.

Deliberately does NOT do (governance / judgement — left for your review):

- decide the *right* granularity of blocks (it blocks per heading; the single-bullet overridable
  regions like `user-access.approval-chain` are yours to add by hand);
- guarantee IDs are semantic — a heading like "General" slugifies to a weak ID. Rename before you
  commit; IDs are the public override API and renaming later is a MAJOR release;
- rewrite institution specifics into `{{< var ... >}}` automatically — it only flags candidates;
- invent governance metadata (author, approver, dates, real `sources`).

## Verify before committing

```shell
quarto run _tests/run.ts          # full suite; includes manifest/block agreement
quarto run _tests/typecheck.ts    # type-checks the CLI
quarto render                      # build check
```

`_tests/manifest_test.ts` is the oracle for the mechanical half: it diffs the `blocks:` you
committed against the delimiters actually in the source, both directions. If it passes, the block
list is in sync — it does **not** tell you the IDs are semantic or the variables complete. That is
the review.

> [!NOTE]
> **Line endings on Windows.** The block parser splits on `\n` and expects LF sources; the tracked
> baseline docs are LF in the repo. On a Windows checkout with git `core.autocrlf` set, the tracked
> `.qmd` files may appear as CRLF locally, which makes `_tests/run.ts` fail on the *unmodified*
> baseline docs (a `column 0` delimiter error) before it ever reaches your new document. This is an
> environment issue, not a defect in your ingested file. The suite is meant to run on LF sources (CI
> / a host toolchain). This script always writes LF, so its output is correct regardless.
