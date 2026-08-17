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

# Verification pass (there is no test suite). See the isms-verify skill for how to read failures.
quarto render && quarto run .pi/skills/isms-verify/scripts/check.ts --site
```

There is no test suite, linter, or build step beyond Quarto. The CLI is Deno TypeScript run
through `quarto run` — the bare `stdlib/...` import specifiers are resolved by Quarto's own
import map, so `deno run` on these files will fail.

### Sandboxed sessions (gondolin)

A session started with `pi -e ~/.pi/agent/opt-extensions/gondolin` routes `read`/`write`/`edit`/
`bash`/`grep`/`find`/`ls` and `!` commands into an Alpine micro-VM, with this directory mounted at
`/workspace`; writes there pass through to the host.

The guest has **no `quarto`, and cannot practically get one**: gondolin publishes only musl (Alpine)
images, while every Quarto build — including the Deno it bundles, which is what runs the CLI — is
glibc, and Alpine packages no `quarto`. So **every command in the block above runs on the host**, in
a separate terminal. Host `quarto preview` does pick up guest-side edits, because `/workspace`
writes through.

`git` is absent from the guest too. `apk add git` works (the guest has network), but the VM is
recreated per session and only `/workspace` survives, and the host `~/.gitconfig` is not mounted, so
a commit needs its identity re-set each time. Treat `git` as a host command as well.

What this does and does not buy: the guest cannot see host files outside this directory, but the
example extension sets no `allowedHosts`, so outbound network from the guest is unrestricted.

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
3. `lib/deviations.ts` — collects every override's governance metadata plus the anchor it landed
   on, and renders `deviations.qmd`.
4. `cli/isms.ts` — writes results to `<root>/docs/<ID>-<slug>.qmd` (only when content changed),
   then **prunes** `docs/*.qmd` files not in the current result set, so un-adopting a document
   removes its output.

`docs/` at the repo root and `deviations.qmd` are therefore generated output, both gitignored.
Never hand-edit them. The extension's sidebar picks the documents up via `auto: "docs/*.qmd"`.

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
block set, and validation of `approved-date` (free text today, so date formats can be mixed and
unsortable within one register).

### The deviations register (`lib/deviations.ts`)

Generated at the **project root**, not in `docs/`: it is a report about the controlled documents,
not one of them, and the sidebar's `auto: "docs/*.qmd"` glob would file it under "Controlled
documents". That puts it outside `writeAll`'s prune scope, which is safe only because the page is
generated unconditionally — including the empty "adopted verbatim" state, which also keeps the
static navbar `href` from dangling.

Deep-link anchors are resolved by re-reading the **composed output**, not the baseline block tree.
A baseline-derived anchor can name a heading a `replace` or `delete` just took away; that link
resolves to nothing, the browser stays at the top of the page, and the reader concludes they
mis-scrolled. A confidently wrong link in an audit artefact is worse than no link.

The scan is **bounded by the block ranges `emit()` already writes**. Nothing in the grammar
requires a block to open with a heading, so an unbounded upward scan would attribute the previous
sibling section's heading to a block that starts with prose. The rule: first anchor inside the
block's own range before its first nested child; else the last anchor inside a dotted ancestor's
range above the block; else no fragment. Only explicit `{#...}` anchors count — Quarto's generated
slug for a heading containing `{{< var organisation >}}` is not predictable from source.

Because this module re-parses `emit()`'s markers, a block with an override and no marker range
**throws** rather than silently dropping the link. If the marker format changes, both sides must.

Quoted text in the detail sections is dedented (overrides are authored at the indent they splice
into, and Pandoc would read a deep indent as a code block), has bare `#sec-...` links rebased onto
the composed document, and has its headings demoted and stripped of explicit anchors so a quote
cannot pose as a section of the register or steal the policy's id.

The page deliberately carries **no generation timestamp**: `writeAll` writes only when content
differs, so a clock value would mean git churn and a changed Quarto input on every render.

## Authoring baseline policy documents

- Never hardcode institution specifics. Use `{{< var organisation >}}`,
  `{{< var environment_name >}}`, `{{< var roles.ig_lead >}}` etc., backed by `_variables.yml`.
- Front matter conventions in existing docs: `isms-id`, `title` (`"ISMS03 - Access Control
  Policy"`), `baseline-doc-version`, `number-sections: true`.
- Sections carry explicit `{#sec-...}` anchors so cross-document links stay stable.
- Register every new document in `manifest.yml` (`id`, `file`, `title`, `blocks`) — the manifest,
  not the filesystem, decides what is composed.
