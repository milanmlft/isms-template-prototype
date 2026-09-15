#!/usr/bin/env -S quarto run
//
// Type-check the composition CLI.
//
//   quarto run _tests/typecheck.ts
//
// Nothing else does. Quarto's `run` handler passes neither `--check` nor `--no-check`, and Deno
// does not type-check `deno run` by default, so the CLI's types are enforced nowhere during a
// normal render. That is not theoretical: two `TS2339` errors reading a deleted
// `UnadoptedDoc.line` once composed the literal string `_isms.yml:undefined` into the deviations
// register — the entire audit record for an un-adopted document — and every tool stayed green.
//
// `isms.ts` is checked as a PATH rather than through the test suite, because it cannot be
// imported: it ends in a top-level `Deno.exit(await run())`, which would kill whatever imported it.
// Checking the entry point pulls in every module it reaches, so this covers lib/ too.
//
import { join } from "stdlib/path";

const denoDir = Deno.env.get("DENO_DIR");
if (denoDir === undefined) {
  console.error("run this through `quarto run _tests/typecheck.ts` — DENO_DIR is set by Quarto,");
  console.error("and the import map that resolves the CLI's bare `stdlib/...` specifiers is found");
  console.error("relative to it.");
  Deno.exit(2);
}

const cmd = new Deno.Command(Deno.execPath(), {
  args: [
    "check",
    "--import-map",
    join(denoDir, "..", "run_import_map.json"),
    // No `--cached-only` here, unlike the test runner: `deno check` does not accept it. Resolution
    // is offline regardless, because DENO_DIR points at the cache Quarto ships with every
    // `stdlib/*` specifier already in it. `--no-remote` is NOT the substitute — those specifiers
    // are themselves remote (`jsr:/@std/...`), cached rather than local, so it would refuse them.
    "--no-config",
    "--no-lock",
    "_extensions/isms/cli/isms.ts",
  ],
  stdout: "inherit",
  stderr: "inherit",
});
Deno.exit((await cmd.output()).code);
