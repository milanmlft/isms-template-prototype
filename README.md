# ISMS template (prototype)

A white-label ISMS (Information Security Management System) template that institutions can adapt,
implemented as a **Quarto extension**.

The idea: a shared baseline of policy documents is maintained and versioned in one place, and each
institution adopting it keeps only its _differences_ from that baseline — a handful of variables,
plus explicit, attributed overrides on named sections of the text. The rendered site is composed
from the two at build time, so an institution can pull a new baseline version without losing its
local changes, and every locally-changed paragraph is traceable to the override that produced it.

<!-- prettier-ignore-start -->
> [!WARNING]
> **Prototype.** The policy text in `_extensions/isms/docs/*.qmd` is placeholder content,
> written to exercise the composition machinery. It is not derived from any institution's approved
> policy and is not fit for adoption as-is.

<!-- prettier-ignore-end -->

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
3. re-emits the front matter merged with any the override file sets, a `DO NOT EDIT BY HAND`
   banner, and the body with overrides spliced in, wrapping each block in a provenance comment;
4. records each override's governance metadata, and the section it landed in, for the register;
5. writes the result to `docs/<ID>-<slug>.qmd`, and **prunes** anything under `docs/` not in the
   current result set — so removing a document from the manifest removes its output.

It then writes `deviations.qmd`, the register of everything the institution changed.

Non-`.qmd` files in the baseline `docs/` tree — images, diagram sources, anything a document
references by relative path — are **mirrored** to the same relative position under the composed
`docs/`, so `![…](./images/x.svg)` resolves the same way from the composed document as it does from
the baseline source. There is nothing to declare: the convention is the whole rule.

The same rule applies a second time, at `_overrides/`: any non-`.qmd` file there is mirrored to the
same relative position under `docs/`, so `_overrides/images/org-chart.png` becomes
`docs/images/org-chart.png` and an override's `![…](./images/org-chart.png)` resolves once spliced
into the composed document. No new directory or config key — `_overrides/` is already the
institution's half of the source tree. A file the institution ships at a path a baseline asset
already occupies is a **hard error** naming both sources: letting either side silently win would
substitute content inside a controlled document with no `reason`/`approved-by`/`approved-date` and
no line in the deviations register. To replace a baseline diagram, override the block that
references it and point at a new filename instead — that keeps the change governed. Naming a path
the baseline _references but does not ship_ is fine; it is a fill-in-the-blank, not a collision —
but it is a silent one: no override ran to fill it in, so nothing records that the resulting figure
is institution-supplied rather than part of the baseline. See the governance limitation below.

`docs/` is therefore build output and is gitignored, as is `deviations.qmd`; the extension's sidebar
picks the documents up via `auto: "docs/*.qmd"`. Edit the override file, never `docs/`.

Composition is fail-loud. A typo in a block ID, an override that could never reach the output, an
unknown attribute, an unclosed block — all abort the render with a `file:line: message`, rather than
silently dropping content that someone has formally approved.

**Known governance limitations,** both about the gap between what the register can see and what the
composed document actually contains:

The collision check and the deviations register both operate on _paths_, not on asset _content_. An
override's `reason`/`approved-by`/`approved-date` are recorded once, against the block that
references an image; nothing re-checks or re-flags that block if the institution later replaces the
referenced file's bytes without touching the override text that names it — the same governance
metadata stays attached to different image content, and neither the register nor the render log
shows that anything changed. Treat an asset referenced from an approved override as covered by that
approval only as long as its bytes are unchanged; a content swap needs its own review, which this
pipeline does not currently prompt for.

The fill-in-the-blank case above has the same gap from the other side. An institution can supply a
file at a path the baseline references but does not ship — deliberately not a collision — but no
override ran to put it there, so there is no `reason`/`approved-by`/`approved-date` and no line in
the deviations register. The composed document silently contains institution-supplied content that
the register reports as adopted verbatim.

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
metadata: they record _why_ the institution deviates and who signed it off. They are the input to
the [deviations register](#the-deviations-register).

All three are optional and their values are not validated. An override missing one still composes —
it may be mid-approval — but the CLI warns with a `file:line`, and the register prints
`(not recorded)` rather than a dash, so a gap reads as a gap. Bear in mind that a `reason` is
published prose: it is rendered on the register and indexed by the site search.

### Front matter

The override file's own front matter is your front matter. Every key except the reserved
`document:` is merged into the composed document's, and `docs/_preamble.qmd` prints most of them
at the top of the page — so this is how you replace the baseline's placeholder
`document-author: Policy Owner` and `approver: Approval Body` with the real thing.

```yaml
---
document: ISMS03
document-author: Head of Research Data Governance
classification: internal
review:
  reviewer: Information Security Team
  date: 01/09/2026
approval:
  approver: Operational Management Group
---
```

Mappings merge key by key, so the `review.period` you did not mention keeps its baseline value.
Anything else — a scalar, a list, an explicit `null` — replaces the baseline value outright.

Four keys are refused, and the render stops with a `file:line`:

| Key                    | Why                                                                     |
| ---------------------- | ----------------------------------------------------------------------- |
| `isms-id`              | it is the ID your overrides are keyed on                                |
| `baseline-doc-version` | it records which baseline release the document was composed from        |
| `filename`             | it names the composed file, which the manifest decides                  |
| `author`               | Quarto renders it as a second byline — set `document-author` instead    |

A key that is not in the baseline front matter is allowed but warns, because the likeliest cause
is a typo in one that is. An unquoted `2026-07-14` is a date to YAML, not a string; it is
normalised back to `2026-07-14` rather than published as a UTC timestamp.

Front-matter changes are **not** deviations and get no row in the register: replacing a
placeholder author with a real name is adopting the baseline, not departing from it. A file
carrying only front-matter keys leaves its document listed as adopted verbatim.

### The deviations register

`deviations.qmd` is generated at the project root on every render, and lists every override in the
project: which document and block it targets, what kind of change it makes, the governance metadata,
and the institution's local text. It is the only place a `mode=delete` is visible at all — a deleted
block leaves nothing in the composed document but a comment — so the register quotes the baseline
text that was removed.

Each row links into the composed document at the section the change landed in. The anchor is
resolved from the composed output rather than from the baseline, because a replace or a delete can
take away the very heading a baseline-derived link would have pointed at; where an override leaves
nothing to link to, the row links to the document instead.

A project with no override files still gets a register, saying so. "Adopted verbatim" is evidence; a
missing page is not.

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
  `document-author` (not `author` — Quarto special-cases that key and renders its own title-block
  byline in addition to the one `docs/_preamble.qmd` already renders), `number-sections: true`.
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
  docs/images/         # non-.qmd files here are mirrored into the composed docs/, whether referenced or not
  cli/
    isms.ts            # entry point for quarto run and used as pre-render hook: compose, write changed files, copy changed assets, prune stale ones
    lib/project.ts     # loadProject() — reads the manifest
    lib/compose.ts     # per-document composition, override loading and validation
    lib/blocks.ts      # block grammar: parse and emit
    lib/deviations.ts  # the deviations register: anchor resolution and rendering
_overrides/*.qmd       # institution-local overrides (tracked in version control)
_overrides/**          # any other file here (not just under images/, at any depth) is an asset, mirrored into docs/ the same way
docs/*.qmd             # composed output (generated, gitignored)
docs/images/           # mirrored assets, baseline and institution alike (generated, gitignored)
deviations.qmd         # the deviations register (generated, gitignored)
```

## Status and roadmap

Working today: variables, the block grammar, all four override modes, front-matter overrides,
override validation, provenance markers, asset mirroring, composed-output pruning, the deviations
register.

Not yet built:

- **Validation of `approved-date`.** The attribute is free text, so `14/07/2026` and `2026-07-14`
  can coexist in one register, unsortable.
- **Appending institution-only sections** outside the baseline block set.
- **Manifest/source cross-validation** of the `blocks:` lists.
