#!/usr/bin/env -S quarto run
//
// The test suite's entry point. Run from the project root:
//
//   quarto run _tests/run.ts
//   quarto run _tests/run.ts --filter "adopted: no"     # any `deno test` flag is forwarded
//
// `quarto run` cannot host the tests itself: it shells out to `deno run`, which discards
// `Deno.test()` registrations silently — no warning, exit 0. So this script, which IS run by
// `quarto run`, re-spawns the same Deno binary in `test` mode, on the toolchain
// `support/quarto.ts` locates. See `_tests/README.md` for why it is derived rather than configured.
//
// Dev tooling, not part of the baseline: `_tests/` is excluded from the template in
// `.quartoignore`, and underscore-prefixed so Quarto's `**/_*` glob never renders it as a page.
//
import { DENO_BASE_FLAGS, quartoImportMap } from "./support/quarto.ts";

// `_tests/` is handed to `deno test` as a relative path below, and manifest_test.ts resolves the
// baseline relative to the working directory — so running from anywhere else would report a
// missing baseline rather than the real mistake.
try {
  Deno.statSync("_quarto.yml");
} catch {
  console.error(`run this from the project root (no _quarto.yml in ${Deno.cwd()})`);
  Deno.exit(2);
}

const cmd = new Deno.Command(Deno.execPath(), {
  args: [
    "test",
    "--import-map",
    quartoImportMap(),
    // Every `stdlib/*` specifier is already in the cache Quarto ships. Refusing the network makes a
    // stray remote import a loud failure rather than a silently acquired dependency.
    "--cached-only",
    ...DENO_BASE_FLAGS,
    "--allow-read",
    // Fixtures are built in temp dirs, and cli_test.ts runs the real CLI against them.
    "--allow-write",
    "--allow-env",
    "--allow-run=" + Deno.execPath(),
    // Deno's own discovery picks up `*_test.ts` here, so a new test file needs no edit to this one
    // — and `run.ts`, `typecheck.ts` and `support/` are skipped because they do not match.
    "_tests/",
    ...Deno.args,
  ],
  stdout: "inherit",
  stderr: "inherit",
});
Deno.exit((await cmd.output()).code);
