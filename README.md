# ISMS template (prototype)

A white-label ISMS template that institutions can adapt, implemented as a **Quarto extension**.

## Usage

Initialise the template with

```shell
quarto use template milanmlft/isms-template-prototype
```

and update `_variables.yml` as necessary.

## Local overrides

Where variables are not enough and the policy text itself has to change, write an override file
at `_overrides/<ISMS-ID>.qmd`. Each override targets a named block of the baseline document — the
overridable block IDs for each document are listed under `blocks:` in
`_extensions/isms/manifest.yml`:

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

`mode` may be `replace`, `before`, `after` or `delete` (a `delete` override must have an empty
body). Overridden content is recorded in the composed document with an
`<!-- isms:block id=... source=override mode=... -->` comment, so the provenance of every
paragraph can be traced back to the override that produced it.

Overrides are applied on every `quarto render`, which writes the composed documents to `docs/`.
That directory is generated output — never edit it by hand; edit the override file instead.
