# Kiro working record

A running log of work done with Kiro on this repo, so the context and decisions survive between
sessions.

## Goal

Grow the baseline document set by ingesting additional UCL ISMS policies (source format: plain
markdown). Build a Python ingestion script that scaffolds a source `.md` into a block-tagged
baseline `.qmd` in the form this repo expects, and keeps `manifest.yml` in sync.

## Context: how the tagging works (from reading the existing baseline)

- Each baseline doc is a Quarto `.qmd` under `_extensions/isms/docs/` with:
  - YAML front matter: `isms-id`, `title` (`"ISMS03 - Access Control Policy"`), `filename`,
    `baseline-doc-version`, `number-sections: true`, plus governance placeholders
    (`document-author: Policy Owner`, `approval.approver: Approval Body`) and a `provenance` banner.
  - `{{< include _preamble.qmd >}}` immediately after the front matter.
  - **Blocks**: column-0, line-anchored HTML comments `<!-- isms:begin id=... hint="..." -->` …
    `<!-- isms:end id=... -->`. Nestable; a nested id must be a dotted child of its parent
    (`user-access.approval-chain`). Ids are semantic kebab-case, **never positional**, because they
    are the public override API (`manifest.yml` `blocks:`).
  - Variable shortcodes (`{{< var organisation >}}`, `{{< var roles.ig_lead >}}`) instead of
    hardcoded institution specifics, backed by `_variables.yml`.
  - Section anchors `## Heading {#sec-...}` for stable cross-document links.
- `manifest.yml` registers each doc (`id`, `file`, `title`, `blocks:`). `_tests/manifest_test.ts`
  diffs the `blocks:` list against the delimiters actually in the source, both directions — this is
  the oracle for the mechanical half of ingestion.
- `quarto render` does NOT type-check; verification is `quarto run _tests/run.ts` +
  `_tests/typecheck.ts` + a render build check.

## Honest assessment of the ingestion idea

Feasible and useful for the mechanical scaffolding; it **cannot** be fully automatic. The hard parts
are governance judgement, not parsing:

- Strengths: front-matter/preamble/delimiter scaffolding is deterministic; manifest sync is a solved
  shape verifiable by the test suite; heading→block+anchor is a sane default; a standalone Python
  script has no coupling to the Deno/Quarto toolchain.
- Issues: block **ids must be semantic**, but heading slugs are often positional/vague; deciding
  **what** to block (granularity, incl. single-bullet overridable regions) is a governance call;
  variable substitution is unsafe to automate (partial matches, missed specifics) so it is only
  **flagged**; passing tests proves block/manifest agreement, NOT that ids are semantic or variables
  complete — human review stays mandatory.

Decision: build a **draft generator, not an autopilot.**

## What was built (this session)

- `_ingest/input/` — drop source `.md` files here. Gitignored (`/_ingest/input/*` with
  `!/_ingest/input/.gitkeep`) so raw source policy never lands in git.
- `_ingest/ingest.py` — stdlib-only Python 3 script. Given a source `.md`, `--id ISMSnn` and
  `--title`, it:
  - builds the front-matter shell + `{{< include _preamble.qmd >}}`;
  - wraps each heading section in `isms:begin`/`isms:end`, nesting `###` under `##` as dotted child
    ids, deriving a `{#sec-...}` anchor per heading;
  - proposes a semantic-ish block id per heading and **flags weak/positional ids** for rename;
  - **flags** institution specifics (role strings read from `_variables.yml`, plus any `--org-name`)
    as variable candidates — never rewrites them;
  - prints (or with `--update-manifest`, appends) the `manifest.yml` entry.
  - `--dry-run` prints the `.qmd` to stdout and writes nothing; refuses to overwrite an existing
    output file.
- `_ingest/README.md` — usage and the "draft not autopilot" caveats.
- `.gitignore` — ignores `_ingest/input/*` except `.gitkeep`.

## Front-matter handling (per user direction)

Source `.md` files carry their OWN YAML front matter (`--- ... ---`) with the real document values
(author, version, classification, review.*, approval.*, sources). `docs/_preamble.qmd` renders those
via `{{< meta ... >}}`. The rule: **the source value is accepted unless an override provides data.**

So the script PRESERVES the source front matter verbatim and only ADDS the pipeline keys the source
omitted, warning ("add and warn") on each synthesised key:

- Presentation keys (document-author, version, classification, review.*, approval.*, sources) — the
  document's content, read by the preamble. Never touched.
- Pipeline keys (`isms-id`, `title`, `filename`, `baseline-doc-version`, `number-sections`) — needed
  by the machinery. Added only if missing; a present source value always wins. `--title` is a
  fallback used only when the source has no `title:`. No `provenance` banner is injected (these are
  real docs, not prototype placeholders).

`top_level_keys()` is a light column-0 line scan (not a full YAML parse) that detects PRESENCE of the
pipeline keys — enough for add-or-skip, and keeps nested `review:`/`approval:` structures untouched.

## CRLF finding (important, environment-level)

Running `quarto run _tests/run.ts` on this Windows checkout FAILS on the pristine, unmodified tracked
baseline docs (ISMS02/03/08), with `isms delimiter must start at column 0`. Root cause: the working
copy stores the `.qmd` files with CRLF (`\r\n`) line endings — almost certainly git `core.autocrlf`
on checkout — and the block parser (`lib/blocks.ts`) splits on `\n`, leaving a trailing `\r` that
breaks its column-0 delimiter matching. This is a pre-existing Windows/CRLF incompatibility in the
baseline tooling, NOT introduced by the ingestion work; CLAUDE.md notes the suite is meant to run on
glibc/Linux (CI, or a host quarto), where the sources are LF. Several compose/deviations tests also
fail here on Windows path-separator differences (`docs\logo.png` vs `docs/logo.png`).

Consequence for ingestion: the script now writes generated `.qmd` files **LF-only**
(`write_text(..., newline="\n")`) regardless of platform, so its output matches the LF the parser and
CI expect rather than inheriting Windows CRLF. `append_to_manifest()` appends using the file's
EXISTING line ending (append-only, no wholesale rewrite) to avoid a spurious full-file diff on a CRLF
checkout.

To actually run the suite green on this machine you would need the sources as LF (e.g. `git config
core.autocrlf input` + re-checkout, or a `.gitattributes` marking `*.qmd`/`*.ts` as `text eol=lf`).
Not done here — out of scope for the ingestion task and a repo-wide decision for the maintainers.

## Verification done this session

- Script dry-run and real-write exercised against a sample with its own front matter: source keys
  preserved verbatim, four missing pipeline keys added and warned, weak id (`...general`) flagged,
  `UCL` flagged as a variable candidate, nested blocks and `{#sec-...}` anchors emitted correctly,
  manifest snippet matches the emitted delimiters.
- Confirmed generated file is LF-only (0 CRLF) after the `newline="\n"` fix.
- Confirmed `.gitignore`: `_ingest/input/ISMS99-sample.md` is ignored, `.gitkeep` is tracked.
- Cleaned up: removed the generated ISMS99 `.qmd` and the ISMS99 manifest entry; tree restored.
- Stderr REVIEW headers use ASCII `-` (not em-dash) to avoid Windows console encoding noise.

## Doc drift noticed (not fixed)

`CLAUDE.md` references CI at `.github/workflows/isms.yml`, but the actual workflow file is
`.github/workflows/test.yml`.

## Next steps

- User will bring over UCL source `.md` files into `_ingest/input/`.
- Run the script per file (dry-run first), review proposed block ids + variable flags, then write.
- Add any new role/variable keys the UCL docs need to `_variables.yml`.
- Verify with `quarto run _tests/run.ts` and `quarto run _tests/typecheck.ts` before committing.
