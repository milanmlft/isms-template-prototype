//
// Locating the toolchain `quarto run` is already using.
//
// Three callers need this — the test runner, the type-checker and the fixture builder's subprocess
// helper — and it must be one definition, because it encodes a fact about Quarto's internals that a
// Quarto upgrade could invalidate: `quarto.js`'s `denoRunHandler` sets DENO_DIR to its own cache and
// computes the import map as `join(denoDir, "../run_import_map.json")`. Deriving it the same way,
// from the environment `quarto run` hands us, means a moved install layout is followed for free —
// no arch detection, no `quarto --paths` parsing, no hardcoded `/Applications/quarto`.
//
// The alternative — a root `deno.json` with its own `imports` map — was rejected deliberately. It
// would pin `@std` versions independently of the ones `quarto run` actually executes, so the tests
// would compile against something other than what ships, and diverge silently on the next upgrade.
//
import { join } from "stdlib/path";

/**
 * Flags shared by every Deno invocation the suite makes.
 *
 * The repo has no `deno.json` and no lockfile; saying so stops Deno discovering one further up the
 * filesystem and resolving `stdlib/*` differently from how `quarto run` does.
 *
 * `--cached-only` is NOT here: `deno check` rejects it, so the two runners add it separately.
 */
export const DENO_BASE_FLAGS = ["--no-config", "--no-lock"] as const;

/**
 * Path to Quarto's import map, or exit 2 with an explanation.
 *
 * Exits rather than throws: every caller is a top-level script whose only sensible response is to
 * stop, and a stack trace would bury the one sentence that says what to do.
 */
export function quartoImportMap(): string {
  const denoDir = Deno.env.get("DENO_DIR");
  if (denoDir === undefined) {
    console.error("run this through `quarto run`.");
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
  return importMap;
}
