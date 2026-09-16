#!/usr/bin/env -S quarto run
//
// Type-check `isms.ts`.
//
//   quarto run _tests/typecheck.ts
//
// This covers exactly one module, and it is the one module the test suite cannot see. `deno test`
// type-checks by default, so `quarto run _tests/run.ts` already checks every file under `lib/` —
// the tests import them. But nothing imports `isms.ts`: it ends in a top-level
// `Deno.exit(await run())`, so `cli_test.ts` drives it as a subprocess instead. A type error there
// is invisible to the suite (measured: the suite stays green) and invisible to `quarto render`,
// whose `deno run` passes neither `--check` nor `--no-check`.
//
// That gap is not hypothetical. Two `TS2339` errors reading a deleted `UnadoptedDoc.line` once
// composed the literal string `_isms.yml:undefined` into the deviations register — the entire audit
// record for an un-adopted document — with every tool green.
//
import { DENO_BASE_FLAGS, quartoImportMap } from "./support/quarto.ts";

const cmd = new Deno.Command(Deno.execPath(), {
  args: [
    "check",
    "--import-map",
    quartoImportMap(),
    // No `--cached-only` here, unlike the test runner: `deno check` does not accept it. Resolution
    // is offline regardless, because DENO_DIR points at the cache Quarto ships with every
    // `stdlib/*` specifier already in it. `--no-remote` is NOT the substitute — those specifiers
    // are themselves remote (`jsr:/@std/...`), cached rather than local, so it would refuse them.
    ...DENO_BASE_FLAGS,
    "_extensions/isms/cli/isms.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
});
Deno.exit((await cmd.output()).code);
