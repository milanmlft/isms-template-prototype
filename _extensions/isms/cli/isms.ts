#!/usr/bin/env -S quarto run

import { bold, cyan, dim, green, red, yellow } from "stdlib/fmt_colors";
import { dirname, join } from "stdlib/path";
import { ensureDirSync } from "stdlib/fs";
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
  // Prune composed documents that no longer belong (e.g. a document was un-adopted).
  try {
    for (const e of Deno.readDirSync(join(root, COMPOSED_DIR))) {
      const rel = join(COMPOSED_DIR, e.name);
      if (e.isFile && e.name.endsWith(".qmd") && !files.has(rel)) {
        Deno.removeSync(join(root, rel));
      }
    }
  } catch { /* no docs/ yet */ }
  return written;
}

async function run(): Promise<number> {
  const project = loadProject();
  const { root, baseline } = project;
  const baselineVersion = baseline.manifest.baseline_version
  const result = await compose(project);

  writeAll(root, result.files);

  const overrides = result.docs.reduce((n, d) => n + d.deviations.length, 0);
  console.log(
    `[isms] composed ${green(String(result.docs.length))} documents from baseline ` +
    `${cyan(baselineVersion)} · ${overrides} local override${overrides === 1 ? "" : "s"}`,
  );
  for (const doc of result.docs) {
    const local = doc.deviations.length > 0 ? ` (${doc.deviations.length} local)` : "";
    console.log(dim(`         ${doc.path}${local}`));
  }
  console.log(dim(`         ${DEVIATIONS_PATH} (${overrides} deviation${overrides === 1 ? "" : "s"})`));

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
