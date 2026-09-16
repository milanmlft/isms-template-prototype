# The test suite

```shell
quarto run _tests/run.ts                            # the tests
quarto run _tests/run.ts --filter "adopted: no"     # any `deno test` flag is forwarded
quarto run _tests/typecheck.ts                      # type-check isms.ts (see below)
```

Run from the project root. Both need the `quarto` binary and the Deno it bundles, and neither works
inside a musl/Alpine sandbox — see the sandbox note in `CLAUDE.md`.

**No test depends on a render having happened.** Each builds its own throwaway ISMS project in a
temporary directory, or reads tracked source files, so the suite is meaningful from a fresh clone
and its result never depends on whether `docs/` happens to be up to date.

## Why `quarto run` hosts a `deno test` subprocess

`quarto run` shells out to `deno run`, which discards `Deno.test()` registrations silently — no
warning, exit 0. `deno test` also type-checks by default, and `quarto render` never does: its
`deno run` passes neither `--check` nor `--no-check`. That gap is not theoretical — two `TS2339`
errors reading a deleted `UnadoptedDoc.line` once composed the literal string `_isms.yml:undefined`
into the deviations register, which is the entire audit record for an un-adopted document, and every
tool stayed green.

**`typecheck.ts` covers exactly one module**, and it is the one the suite cannot see. Because the
tests import everything under `lib/`, running them type-checks all of it. Nothing imports `isms.ts`
— it ends in a top-level `Deno.exit(await run())`, so `cli_test.ts` drives it as a subprocess —
which leaves it the only module where a type error is invisible to both the suite and the renderer.
Measured: a deliberate type error in `lib/` turns the suite red; the same error in `isms.ts` leaves
it green, and only `typecheck.ts` catches it.

So `_tests/run.ts` is itself a `quarto run` script that re-spawns the same binary in `test` mode. It
finds that binary and Quarto's import map from its own environment — `Deno.execPath()` and
`$DENO_DIR/../run_import_map.json`, which is how `quarto.js` computes it — rather than from a
hardcoded install path, so a Quarto upgrade that moves the layout is followed for free.

Two consequences worth knowing:

- Tests compile against exactly the `@std` versions `quarto run` executes. An authored `deno.json`
  would pin them independently and diverge silently on the next Quarto upgrade.
- `--cached-only` is passed deliberately. Every `stdlib/*` specifier is pre-seeded in the cache
  Quarto ships, so a stray remote import becomes a loud failure rather than a silently acquired
  dependency. That is also why `support/assert.ts` is hand-rolled: `jsr:@std/assert` is **not** in
  that cache, and importing it would break the README's "Quarto >= 1.8. Nothing else".

## The files

| File                 | What it asks                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `blocks_test.ts`     | Does the block grammar enforce its rules and refuse what it says it refuses? |
| `compose_test.ts`    | The override contract, the front-matter merge table, the asset walk.         |
| `adoption_test.ts`   | Every `_isms.yml` validation path.                                           |
| `deviations_test.ts` | What the register reports, and where its deep links land.                    |
| `cli_test.ts`        | `isms.ts` as a subprocess: write-only-on-change, prune, exit codes.          |
| `manifest_test.ts`   | Do `manifest.yml`'s `blocks:` lists match the real delimiters?               |

`run.ts` hands `_tests/` to `deno test` and lets its own discovery find `*_test.ts`, so a new file
needs no edit anywhere.

All but `manifest_test.ts` build throwaway projects in temp dirs — `compose()` is read-only and
takes its root from the `Project` it is handed, so a complete fixture is three files and a full
compose runs in about 15 ms with no Quarto process. The whole suite is around 2 s.

`manifest_test.ts` is the one exception: it reads this repo's own tracked sources rather than a
fixture. It earns that because `blocks:` is the published override API — every adopter writes
`_overrides/<ID>.qmd` against those ids — and nothing else validates it, least of all `compose()`,
which never reads the lists at all.

## House rules for new tests

- **Assert the guidance, not the prose.** Match on identifiers, lists and numbers — never on
  sentences. Where `CLAUDE.md` promises something specific (the override error "lists the IDs that
  do", the `adopted: no` YAML hint), assert that promise. An error's wording must stay free to
  improve without turning the suite red.
- **Name the rule, not the mechanism.** "an override on a block the baseline does not have is
  refused, listing the ids that do exist", never "test throw 444".
- **The fixture builder is a dumb file writer.** It must never synthesise a manifest from the docs
  it is handed, nor compute a composed filename's slug. The moment it does either it is a second
  composer with its own bugs, and a test can pass because both sides are wrong in the same way.
- **Re-use the CLI's own modules.** `support/invariants.ts` imports `BLOCK_OPEN_RE` and
  `BLOCK_CLOSE_RE` from `blocks.ts` rather than re-spelling them. The pass this suite replaced did
  re-spell them, and its copy stopped at the id — which is why the `source=override mode=<mode>`
  provenance payload `emit()` writes went unverified for as long as it did.
- **Do not widen production exports for a test.** `anchorFor`, `mergeFrontMatter` and `metaLine`
  stay private and are reached through `collectDeviations`, `renderRegister` and `compose()`. If a
  rule proves genuinely unreachable that way, raise it rather than changing the API.
- **Un-adopting needs two documents.** Un-adopting the only document in a fixture's manifest trips
  the "nothing left to publish" guard, which then becomes the error under test in every case.

## What this does not cover

- **Anything about composed output on disk, or the rendered site.** Nothing here notices that
  `docs/` was hand-edited under its `DO NOT EDIT BY HAND` banner, never re-rendered after a baseline
  change, or left holding a document that outlived its manifest entry — nor that `_site/` is still
  serving a page for a document this ISMS has not adopted. That is the deliberate cost of keeping
  every test independent of whether a render happened; `quarto render` is a build check in CI, not
  an assertion.
- **Six of the 53 `throw` sites**, all bare `throw err;` re-throws of non-`NotFound` filesystem
  errors (`compose.ts` ×4, `adoption.ts` ×1, `isms.ts` ×1). Reaching them needs fault injection — a
  path that exists but cannot be read — which is not portable across CI runners. A green suite is
  not a claim of total coverage.
- **Whether the policy text is correct or approved.** Nothing here reads the words.
- **`approved-date` formats**, which are free text by design, so mixed and unsortable formats pass.
- **The values a front-matter override sets**, which are merged as written and never type-checked.
- **Whether an un-adoption's stated reason is true** — that the process it names exists, or covers
  the ground the baseline document covered. The register records that claim; it does not verify it.
- **Visual rendering**, and **a clean-room `quarto use template` install** into an empty directory,
  which is the only way the vendored-artefact path gets exercised.
