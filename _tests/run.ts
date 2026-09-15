#!/usr/bin/env -S quarto run
//
// The test suite's entry point. Run from the project root:
//
//   quarto run _tests/run.ts            # unit + fixture tiers; no render needed
//   quarto run _tests/run.ts --tree     # ... plus this repo's composed output on disk
//   quarto run _tests/run.ts --site     # ... plus this repo's rendered _site/
//
// `quarto run` cannot host the tests itself. It shells out to `deno run`, which discards
// `Deno.test()` registrations silently — no warning, exit 0 — and never type-checks. Both matter:
// the missing type check is how two TS2339 errors once composed the literal string
// `_isms.yml:undefined` into a generated audit artefact with no tool complaining.
//
// So this script, which IS run by `quarto run`, re-spawns the same Deno binary in `test` mode. It
// locates that binary and Quarto's import map from its own environment rather than from any
// hardcoded path: `Deno.execPath()` is whatever `quarto run` launched, and quarto.js sets DENO_DIR
// to its own cache, computing the map as `join(denoDir, "../run_import_map.json")`. Following those
// two facts means a Quarto upgrade that moves the install layout is followed for free — no arch
// detection, no `quarto --paths` parsing, no `/Applications/quarto`.
//
// Dev tooling, not part of the baseline: `_tests/` is excluded from the template in
// `.quartoignore`, and underscore-prefixed so Quarto's `**/_*` glob never renders it as a page.
//
import { join } from "stdlib/path";

/** Tiers that need nothing but the source tree. Everything here builds its own fixtures. */
const FIXTURE_TIERS = [
  "_tests/blocks_test.ts",
  "_tests/compose_test.ts",
  "_tests/adoption_test.ts",
  "_tests/deviations_test.ts",
  "_tests/cli_test.ts",
];

const denoDir = Deno.env.get("DENO_DIR");
if (denoDir === undefined) {
  console.error("run this through `quarto run _tests/run.ts`.");
  console.error(
    "DENO_DIR is set by Quarto, and the import map that resolves the CLI's bare `stdlib/...`",
  );
  console.error("specifiers is found relative to it. Without it there is nothing to resolve against.");
  Deno.exit(2);
}

const importMap = join(denoDir, "..", "run_import_map.json");
try {
  Deno.statSync(importMap);
} catch {
  console.error(`no import map at ${importMap} — Quarto's cache layout changed?`);
  console.error("Expected `<DENO_DIR>/../run_import_map.json`, which is how quarto.js computes it.");
  Deno.exit(2);
}

// The project root, not the cwd: the tree tier compares against real composed output, and running
// from anywhere else would report a missing baseline rather than the real mistake.
try {
  Deno.statSync("_quarto.yml");
} catch {
  console.error(`run this from the project root (no _quarto.yml in ${Deno.cwd()})`);
  Deno.exit(2);
}

const wantsTree = Deno.args.includes("--tree") || Deno.args.includes("--site");
const files = [...FIXTURE_TIERS];
if (wantsTree) files.push("_tests/tree_test.ts");
if (Deno.args.includes("--site")) files.push("_tests/site_test.ts");

const cmd = new Deno.Command(Deno.execPath(), {
  args: [
    "test",
    "--import-map",
    importMap,
    // Every `stdlib/*` specifier is already in the cache Quarto ships. Refusing the network makes a
    // stray remote import a loud failure rather than a silently acquired dependency.
    "--cached-only",
    // The repo has no deno.json and no lockfile. Say so, rather than letting Deno discover one
    // further up the filesystem and resolve `stdlib/*` differently from how `quarto run` does.
    "--no-config",
    "--no-lock",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run=" + Deno.execPath(),
    ...files,
  ],
  stdout: "inherit",
  stderr: "inherit",
});
Deno.exit((await cmd.output()).code);
