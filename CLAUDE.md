# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A white-label ISMS (Information Security Management System) template, implemented as a Quarto
extension. Institutions adopt it with `quarto use template milanmlft/isms-template-prototype`,
then customise `_variables.yml`. Prototype status: the policy text in
`_extensions/isms/docs/*.qmd` is placeholder content written to exercise composition, not
approved policy.

## Commands

```shell
quarto render                              # compose + build the site into _site/
quarto preview                             # live-reloading dev server
quarto run _extensions/isms/cli/isms.ts    # run composition only, without rendering
```

There is no test suite, linter, or build step beyond Quarto. The CLI is Deno TypeScript run
through `quarto run` — the bare `stdlib/...` import specifiers are resolved by Quarto's own
import map, so `deno run` on these files will fail.

## Architecture

Two layers live in one repo, and the distinction drives almost every decision:

- **The baseline** (`_extensions/isms/`) — the shared, versioned artefact. Contains
  `manifest.yml`, the authored policy sources under `docs/`, and the composition CLI. This
  directory is what gets vendored into a downstream institution's project.
- **The institution project** (repo root) — `_quarto.yml`, `_variables.yml`, `index.qmd`, and
  `_overrides/`. In this repo it doubles as the template's own demo/test project.

### Composition pipeline

`_extension.yml` registers `cli/isms.ts` as a Quarto `project.pre-render` hook, so composition
runs automatically on every render:

1. `lib/project.ts` — `loadProject()` reads `_extensions/isms/manifest.yml`.
2. `lib/compose.ts` — for each manifest document, parse the baseline `.qmd`, load and validate
   `_overrides/<ID>.qmd` if present, apply the overrides, re-emit front matter + a
   `DO NOT EDIT BY HAND` banner + body.
3. `cli/isms.ts` — writes results to `<root>/docs/<ID>-<slug>.qmd` (only when content changed),
   then **prunes** `docs/*.qmd` files not in the current result set, so un-adopting a document
   removes its output.

`docs/` at the repo root is therefore generated output (currently untracked and not in
`.gitignore`). Never hand-edit it. The extension's sidebar picks it up via `auto: "docs/*.qmd"`.

### manifest.yml is a public API

The `blocks:` list under each document enumerates the block IDs downstream overrides may target
by name. Removing or renaming one is a MAJOR release for the baseline. Note the manifest's
`blocks:` lists are currently declarative only — nothing validates them against the actual
delimiters in the source documents.

### Block grammar (`lib/blocks.ts`)

Blocks are named text ranges delimited by line-anchored HTML comments, chosen because they are
invisible in every output format and harmless if they reach Pandoc, so a baseline document still
renders standalone:

```markdown
<!-- isms:begin id=user-access hint="..." -->
...content...
<!-- isms:begin id=user-access.approval-chain -->
...nested content...
<!-- isms:end id=user-access.approval-chain -->
<!-- isms:end id=user-access -->
```

Rules the parser enforces, and the reasoning behind them:

- Delimiters must start at **column 0** with exactly `<!-- isms:...`; a non-anchored `isms:`
  marker is an error rather than silently ignored. Fenced code blocks are skipped.
- IDs are semantic kebab-case, dot-separated for nesting (`user-access.approval-chain`) —
  **never positional** like `s05`, because IDs are the override contract and must survive
  reordering. A nested block's ID must be a dotted child of its parent's.
- Attribute sets are closed per delimiter kind (`ATTRS_BEGIN` / `ATTRS_OVERRIDE` / `ATTRS_END`),
  but include names not yet used, so a newer baseline still parses under an older CLI. Add new
  attribute names to these sets before using them in baseline docs.
- **Text outside any block is emitted verbatim and is not overridable.** This is deliberate: to
  make something unchangeable, leave it unblocked.

### Overrides

An institution overrides baseline content by writing `_overrides/<ISMS-ID>.qmd` — one optional
file per baseline document, keyed on the ID rather than the title so retitling a baseline
document does not orphan its overrides. Absence is the normal case: no file means the document is
adopted verbatim. The directory is underscore-prefixed so Quarto treats it as project material
and never renders the override sources as pages of the site; **do not** add a `project.render`
list to exclude it, as a negation-only render list breaks the sidebar's `auto:` glob.

Each file uses the same block grammar with `isms:override`, `mode=replace|before|after|delete`,
plus `reason` / `approved-by` / `approved-date` governance attributes, and an optional
`document:` front-matter key that is cross-checked against the ID in the filename.
`loadOverrides()` in `compose.ts` rejects two things outright, because both would otherwise be
silent no-ops on content someone has formally approved:

- an override targeting a block ID that does not exist in the baseline document (the error lists
  the IDs that do);
- an override nested inside a block that is itself replaced or deleted, whose content could never
  reach the output.

`emit()` emits overridden content verbatim and marks its provenance with the `isms:block` comment
it already wraps every block in, which gains `source=override mode=<mode>`. There is deliberately
**no visual styling** of local content. A `::: {.isms-local}` fenced div was tried and removed: it
cannot be applied to indented content (fence at column 0 splits the surrounding list into three
sibling structures; fence indented into a list continuation makes Pandoc emit the `:::` as literal
text), and the indented blocks are precisely the ones worth marking. A marker that silently skips
them is worse than none — a reader who learns to trust it reads unmarked local content as
baseline. Restoring a visual chip means a Lua filter that consumes the marker comments post-parse
and attaches a class to the following AST node, sidestepping markdown indentation entirely.

Not yet built: overriding front matter, appending institution-only sections outside the baseline
block set, and the deviations register (`deviations.qmd`, still commented out in
`_extension.yml`) that would collect every `reason` / `approved-by` into one auditable table.

`normalise()` + `contentHash()` exist for upstream-drift detection and are intentionally
Pandoc-free and cheap: a Quarto or Pandoc upgrade must never trigger a false drift storm across
every institution at once. They absorb whitespace churn only — a typo fix is a semantic change
and should demand review. Not yet called from the compose path.

## Authoring baseline policy documents

- Never hardcode institution specifics. Use `{{< var organisation >}}`,
  `{{< var environment_name >}}`, `{{< var roles.ig_lead >}}` etc., backed by `_variables.yml`.
- Front matter conventions in existing docs: `isms-id`, `title` (`"ISMS03 - Access Control
  Policy"`), `baseline-doc-version`, `number-sections: true`.
- Sections carry explicit `{#sec-...}` anchors so cross-document links stay stable.
- Register every new document in `manifest.yml` (`id`, `file`, `title`, `blocks`) — the manifest,
  not the filesystem, decides what is composed.
