# ISMS template (prototype)

A white-label ISMS (Information Security Management System) template that institutions can adapt,
implemented as a **Quarto extension**.

The idea: a shared baseline of policy documents is maintained and versioned in one place, and each
institution adopting it keeps only its _differences_ from that baseline — a handful of variables,
plus explicit, attributed overrides on named sections of the text. The rendered site is composed
from the two at build time, so an institution can pull a new baseline version without losing its
local changes, and every locally-changed paragraph is traceable to the override that produced it.

> [!WARNING]
> **Prototype.** The policy text in `_extensions/isms/docs/*.qmd` is placeholder content,
> written to exercise the composition machinery. It is not derived from any institution's approved
> policy and is not fit for adoption as-is.

## Requirements

- [Quarto](https://quarto.org) >= 1.8. Nothing else — the composition CLI is Deno TypeScript run
  through `quarto run`, using the Deno that ships with Quarto.

## Quick start

```shell
quarto use template milanmlft/isms-template-prototype
cd <your-project>
# edit _variables.yml
quarto preview
```

That gives you a project containing:

```
_quarto.yml            # project config; `type: isms` pulls in the extension
_variables.yml         # institution values: name, roles, environment, review periods
index.qmd              # your ISMS landing page
_overrides/            # institution-local policy changes, one file per document
_extensions/isms/      # the vendored baseline (see below) — do not edit
docs/                  # GENERATED composed documents — do not edit
```

Useful commands:

```shell
quarto render                              # compose + build the site into _site/
quarto preview                             # live-reloading dev server
quarto run _extensions/isms/cli/isms.ts    # compose only, without rendering
```

## Versioning

Pin to a specific version by running

```bash
quarto add milanmlft/isms-template-prototype@v0.1.0
```

Update using `quarto update`

```bash
# Update to a specific version
quarto update milanmlft/isms-template-prototype@v0.2.0

# Update to latest version
quarto update milanmlft/isms-template-prototype
```

## The two layers

Almost everything about this repo follows from one distinction:

|                         | Owned by                 | Lives in            | Contains                                                                |
| ----------------------- | ------------------------ | ------------------- | ----------------------------------------------------------------------- |
| **Baseline**            | the template maintainers | `_extensions/isms/` | `manifest.yml`, authored policy sources in `docs/`, the composition CLI |
| **Institution project** | the adopting institution | repo root           | `_quarto.yml`, `_variables.yml`, `index.qmd`, `_overrides/`             |

`_extensions/isms/` is the artefact that gets vendored into a downstream project by
`quarto use template`, and is replaced wholesale when the baseline is upgraded. Anything an
institution wants to keep must live outside it.

This repo is both: it holds the baseline _and_ doubles as the baseline's own demo and test project,
so `quarto preview` here shows what an adopter would see.

## How composition works

`_extension.yml` registers `cli/isms.ts` as a Quarto `project.pre-render` hook, so composition runs
on every render. For each document in `manifest.yml` the CLI:

1. parses the baseline `.qmd` into a tree of named blocks (`lib/blocks.ts`);
2. loads `_overrides/<ID>.qmd` if it exists, and validates every override against that tree;
3. re-emits front matter, a `DO NOT EDIT BY HAND` banner, and the body with overrides spliced in,
   wrapping each block in a provenance comment;
4. writes the result to `docs/<ID>-<slug>.qmd`, and **prunes** any `docs/*.qmd` not in the current
   result set — so removing a document from the manifest removes its output.

`docs/` is therefore build output and is gitignored; the extension's sidebar picks it up via
`auto: "docs/*.qmd"`. Edit the override file, never `docs/`.

Composition is fail-loud. A typo in a block ID, an override that could never reach the output, an
unknown attribute, an unclosed block — all abort the render with a `file:line: message`, rather than
silently dropping content that someone has formally approved.

## Customising: variables

The first line of defence is `_variables.yml`, referenced from policy text as Quarto variable
shortcodes. Baseline documents never hardcode institution specifics:

```yaml
organisation: "My Organisation"
environment_abbr: TRE
environment_name: Trusted Research Environment
isms_name: Research Data Information Security Management System
review:
  access_review_period: 12 months
roles:
  asset_owner: Information Asset Owner
  environment_owner: TRE Environment Owner
  governance_body: Operational Management Group
  ig_lead: Head of Research Data Governance
  service_owner: Service Owner
```

Used in the text as `{{< var organisation >}}`, `{{< var roles.ig_lead >}}`,
`{{< var review.access_review_period >}}`, and so on.

## Customising: local overrides

Where variables are not enough and the policy text itself has to change, write an override file at
`_overrides/<ISMS-ID>.qmd`. One optional file per baseline document, keyed on the ID rather than the
title so that retitling a baseline document does not orphan its overrides. **Absence is the normal
case** — a document with no override file is adopted verbatim.

Each override targets a named block of the baseline document. The overridable block IDs for each
document are listed under `blocks:` in `_extensions/isms/manifest.yml`.

```markdown
---
document: ISMS03
---

<!-- isms:override id=user-access.approval-chain mode=replace
     reason="Local governance requires two-person approval."
     approved-by="Operational Management Group" approved-date=2026-07-14 -->

- New users or changes to user access shall be approved by **both**:
  - The {{< var roles.asset_owner >}} for the project or study, and
  - The {{< var roles.ig_lead >}}

<!-- isms:end id=user-access.approval-chain -->
```

### Modes

| `mode`              | Effect                                                                            |
| ------------------- | --------------------------------------------------------------------------------- |
| `replace` (default) | the block's body — including any nested blocks — is replaced by the override body |
| `before`            | override body is inserted immediately before the baseline body                    |
| `after`             | override body is inserted immediately after the baseline body                     |
| `delete`            | the block is removed; the body must be empty                                      |

### Attributes

`id` and `mode` drive the splice. `reason`, `approved-by`, and `approved-date` are governance
metadata: they record _why_ the institution deviates and who signed it off. They are parsed and
validated today, and are the input to the planned deviations register.

### Provenance

Every block in a composed document is wrapped in a marker comment; overridden blocks gain
`source=override mode=<mode>`:

```markdown
<!-- isms:block id=user-access.approval-chain source=override mode=replace -->

...
<!-- /isms:block id=user-access.approval-chain -->
```

These are markdown comments and so are invisible in the rendered output.

## Authoring baseline documents

For maintainers of the baseline itself.

### Block grammar

Blocks are named text ranges delimited by line-anchored HTML comments — chosen because they are
invisible in every output format.

```markdown
<!-- isms:begin id=user-access hint="Describe the approval route for new access." -->

...content...
<!-- isms:begin id=user-access.approval-chain -->

...nested content...
<!-- isms:end id=user-access.approval-chain -->
<!-- isms:end id=user-access -->
```

Rules the parser enforces:

- Delimiters start at **column 0** with exactly `<!-- isms:...`. A non-anchored `isms:` marker is an
  error, not a silent no-op. Fenced code blocks are skipped, so examples like the one above are safe
  in prose. Attributes may wrap across lines; nothing may follow `-->`.
- IDs are semantic kebab-case, dot-separated for nesting. A nested block's ID must be a dotted child
  of its parent's.
- Attribute sets are closed per delimiter kind (`ATTRS_BEGIN` / `ATTRS_OVERRIDE` / `ATTRS_END` in
  `lib/blocks.ts`) but include names not yet used, so a newer baseline still parses under an older
  CLI. Add a new attribute name to the set _before_ using it in a baseline document.
- **Text outside any block is emitted verbatim and is not overridable.** This is a free governance
  primitive: to make something unchangeable, leave it unblocked.

### Conventions

- Never hardcode institution specifics; use variable shortcodes (see above).
- Front matter: `isms-id`, `title` (`"ISMS03 - Access Control Policy"`), `baseline-doc-version`,
  `number-sections: true`.
- Give sections explicit `{#sec-...}` anchors so cross-document links stay stable.
- Register every new document in `manifest.yml` — the manifest, not the filesystem, decides what is
  composed.

### manifest.yml is a public API

```yaml
baseline_version: 0.1.0
documents:
  - id: ISMS03
    file: docs/ISMS03-access-control-policy.qmd
    title: Access Control Policy
    blocks: [overview, scope, user-access, user-access.approval-chain, ...]
```

The `blocks:` list enumerates the IDs downstream overrides may target by name. **Removing or
renaming one is a MAJOR release for the baseline**, because it breaks institutions' override files.
Note that these lists are currently declarative only — nothing yet validates them against the
delimiters actually present in the source documents.

## Project layout

```
_extensions/isms/
  _extension.yml       # Quarto contributions: project type, format, pre-render hook
  manifest.yml         # document registry + published block-ID surface
  docs/*.qmd           # authored baseline policy sources
  cli/
    isms.ts            # entry point for quarto run and used as pre-render hook: compose, write changed files, prune stale ones
    lib/project.ts     # loadProject() — reads the manifest
    lib/compose.ts     # per-document composition, override loading and validation
    lib/blocks.ts      # block grammar: parse, emit, normalise, hash
_overrides/*.qmd       # institution-local overrides (tracked in version control)
docs/*.qmd             # composed output (generated, gitignored)
```

## Status and roadmap

Working today: variables, the block grammar, all four override modes, override validation,
provenance markers, composed-document pruning.

Not yet built:

- **The deviations register.** A `deviations.qmd` collecting every `reason` / `approved-by` /
  `approved-date` into one auditable table. Stubbed out in `_extension.yml`.
- **Front-matter overrides**, and appending institution-only sections outside the baseline block
  set.
- **Manifest/source cross-validation** of the `blocks:` lists.
