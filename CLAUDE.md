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
- **The institution project** (repo root) — `_quarto.yml`, `_variables.yml`, `index.qmd`. In
  this repo it doubles as the template's own demo/test project.

### Composition pipeline

`_extension.yml` registers `cli/isms.ts` as a Quarto `project.pre-render` hook, so composition
runs automatically on every render:

1. `lib/project.ts` — `loadProject()` reads `_extensions/isms/manifest.yml`.
2. `lib/compose.ts` — for each manifest document, parse the baseline `.qmd`, apply overrides,
   re-emit front matter + a `DO NOT EDIT BY HAND` banner + body.
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

### Overrides (parsed, not yet wired up)

`parseOverrides()` handles institution override files — same grammar with `isms:override`,
`mode=replace|before|after|delete`, plus `reason` / `approved-by` / `approved-date` governance
attributes. `compose.ts` still has `// TODO: overrides` and passes an empty ops map, so no
override file is read yet. `emit()` is complete: it wraps overridden content in a
`::: {.isms-local}` fenced div for visual provenance, **except** when the content is indented — a
fenced div cannot wrap a list item without breaking the surrounding list, so indented overrides
are emitted untouched.

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
