#!/usr/bin/env -S quarto run

import { bold, cyan, dim, green, red, yellow } from "stdlib/fmt_colors";
import { dirname, join } from "stdlib/path";
import { ensureDirSync } from "stdlib/fs";
import { equals } from "stdlib/bytes";
import { loadProject } from "./lib/project.ts"
import { type Asset, compose, COMPOSED_DIR, foldPath } from "./lib/compose.ts";
import { DEVIATIONS_PATH } from "./lib/deviations.ts";
import { ISMS_CONFIG_PATH } from "./lib/adoption.ts";

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
 * Mirror the baseline's and the institution's asset files next to the composed documents, so
 * their relative links resolve and Quarto carries them into `_site/`. Compares bytes before
 * writing to avoid unnecessary mtime changes (a changed Quarto input causes a needless re-render).
 */
function copyAssets(root: string, assets: Map<string, Asset>): string[] {
  const copied: string[] = [];
  for (const [rel, asset] of assets) {
    const abs = join(root, rel);
    const dir = dirname(abs);
    ensureDirSync(dir);

    const content = Deno.readFileSync(asset.path);
    let existing: Uint8Array | null = null;
    try { existing = Deno.readFileSync(abs); } catch { /* new file */ }
    if (existing === null || !equals(existing, content)) Deno.writeFileSync(abs, content);
    copied.push(rel);
  }
  return copied;
}

/**
 * Remove anything under `docs/` that composition did not produce. Docs/ is generated output,
 * gitignored, so files are either in `keep` or stale. Recurses to clean empty directories from
 * nested asset paths without leaving orphaned shells.
 */
function prune(root: string, keep: Set<string>): string[] {
  const removed: string[] = [];
  const keepFolded = new Set([...keep].map(foldPath));
  const sweep = (rel: string): boolean => {
    let empty = true;
    for (const e of [...Deno.readDirSync(join(root, rel))]) {
      const childRel = join(rel, e.name);
      if (e.isDirectory) {
        if (!sweep(childRel)) { empty = false; continue; }
        Deno.removeSync(join(root, childRel));
        removed.push(childRel);
      } else if (e.isFile && !keepFolded.has(foldPath(childRel))) {
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
  const localAssets = [...result.assets.values()].filter((a) => a.origin === "override").length;
  const localAssetsNote = localAssets > 0 ? ` (${localAssets} local)` : "";
  const notAdopted = result.unadopted.length > 0
    ? ` · ${yellow(String(result.unadopted.length))} not adopted`
    : "";
  console.log(
    `[isms] composed ${green(String(result.docs.length))} documents from baseline ` +
    `${cyan(baselineVersion)}${notAdopted} · ${overrides} local override` +
    `${overrides === 1 ? "" : "s"} · ${assets.length} asset` +
    `${assets.length === 1 ? "" : "s"}${localAssetsNote}`,
  );
  for (const doc of result.docs) {
    const local = doc.deviations.length > 0 ? ` (${doc.deviations.length} local)` : "";
    console.log(dim(`         ${doc.path}${local}`));
  }
  console.log(dim(`         ${DEVIATIONS_PATH} (${overrides} deviation${overrides === 1 ? "" : "s"})`));

  if (result.unadopted.length > 0) {
    console.log(
      `[isms] ${yellow(String(result.unadopted.length))} document` +
      `${result.unadopted.length === 1 ? "" : "s"} not adopted (${ISMS_CONFIG_PATH})`,
    );
    for (const doc of result.unadopted) {
      const why = doc.reason.replace(/\s+/g, " ").trim();
      const short = why.length > 96 ? `${why.slice(0, 95)}…` : why;
      console.log(dim(`         ${doc.ismsId} · ${short}`));
    }
  }

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
