#!/usr/bin/env -S quarto run

import { bold, cyan, dim, green, red, yellow } from "stdlib/fmt_colors";
import { dirname, join } from "stdlib/path";
import { ensureDirSync } from "stdlib/fs";
import { equals } from "stdlib/bytes";
import { loadProject } from "./lib/project.ts"
import { compose, COMPOSED_DIR } from "./lib/compose.ts";
import { DEVIATIONS_PATH } from "./lib/deviations.ts";

function writeAll(root: string, files: Map<string, string>): string[] {
  const written: string[] = [];
  for (const [rel, content] of files) {
    const abs = join(root, rel);
    ensureDirSync(dirname(abs));
    let existing: string | null = null;
    try { existing = Deno.readTextFileSync(abs); } catch { /* new file */ }
    if (existing !== content) Deno.writeTextFileSync(abs, content);
    written.push(rel);
  }
  return written;
}

/**
 * Mirror the baseline's asset files next to the composed documents, so their relative links
 * resolve and Quarto carries them into `_site/`.
 */
function copyAssets(root: string, assets: Map<string, string>): string[] {
  const copied: string[] = [];
  for (const [rel, src] of assets) {
    const abs = join(root, rel);
    ensureDirSync(dirname(abs));
    const content = Deno.readFileSync(src);
    let existing: Uint8Array | null = null;
    try { existing = Deno.readFileSync(abs); } catch { /* new file */ }
    if (existing === null || !equals(existing, content)) Deno.writeFileSync(abs, content);
    copied.push(rel);
  }
  return copied;
}

/**
 * Remove anything under `docs/` that this composition did not produce. 
 * It recurses because assets bring subdirectories with them, and clears directories it
 * empties, so un-adopting the last document that used `images/` does not leave the shell behind.
 */
function prune(root: string, keep: Set<string>): string[] {
  const removed: string[] = [];
  // Returns whether the directory is empty once its own stale entries are gone, so the caller
  // can remove it; that is only knowable bottom-up.
  const sweep = (rel: string): boolean => {
    let empty = true;
    for (const e of Deno.readDirSync(join(root, rel))) {
      const childRel = join(rel, e.name);
      if (e.isDirectory) {
        if (!sweep(childRel)) { empty = false; continue; }
        Deno.removeSync(join(root, childRel));
        removed.push(childRel);
      } else if (e.isFile && !keep.has(childRel)) {
        Deno.removeSync(join(root, childRel));
        removed.push(childRel);
      } else {
        empty = false;
      }
    }
    return empty;
  };
  try {
    sweep(COMPOSED_DIR);
  } catch (err) {
    // A docs/ that does not exist yet is the first-run case. Anything else is a real filesystem
    // problem, and reading it as "nothing to prune" would hide it.
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return removed;
}

async function run(): Promise<number> {
  const project = loadProject();
  const { root, baseline } = project;
  const baselineVersion = baseline.manifest.baseline_version
  const result = await compose(project);

  const written = writeAll(root, result.files);
  const assets = copyAssets(root, result.assets);
  const removed = prune(root, new Set([...written, ...assets]));

  const overrides = result.docs.reduce((n, d) => n + d.deviations.length, 0);
  console.log(
    `[isms] composed ${green(String(result.docs.length))} documents from baseline ` +
    `${cyan(baselineVersion)} · ${overrides} local override${overrides === 1 ? "" : "s"} · ` +
    `${assets.length} asset${assets.length === 1 ? "" : "s"}`,
  );
  for (const doc of result.docs) {
    const local = doc.deviations.length > 0 ? ` (${doc.deviations.length} local)` : "";
    console.log(dim(`         ${doc.path}${local}`));
  }
  console.log(dim(`         ${DEVIATIONS_PATH} (${overrides} deviation${overrides === 1 ? "" : "s"})`));

  // Prune reaches every regular file under docs/, at any depth
  if (removed.length > 0) {
    console.log(
      `[isms] pruned ${yellow(String(removed.length))} stale ` +
      `entr${removed.length === 1 ? "y" : "ies"} from ${COMPOSED_DIR}/`,
    );
    for (const rel of removed) console.log(dim(`         ${rel}`));
  }

  for (const warning of result.warnings) {
    console.log(yellow(`[isms] warning: ${warning}`));
  }

  return 0;
}

try {
  Deno.exit(await run());
} catch (err) {
  console.error("");
  console.error(red(bold("isms: ") + (err instanceof Error ? err.message : String(err))));
  Deno.exit(1);

}
