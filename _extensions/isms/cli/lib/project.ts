import { parse as parseYaml } from "stdlib/yaml";
import { join, resolve, basename, dirname } from "stdlib/path";
import { walkSync } from "stdlib/fs";

export interface DocumentSpec {
  id: string;
  file: string;
  title: string;
  kind?: string;
  order?: number;
  since?: string;
  default_review_period?: string;
  blocks?: string[];
}

export interface Manifest {
  baseline_version: string;
  documents: DocumentSpec[];
}

export interface Baseline {
  /** Absolute path to the vendored extension directory. */
  dir: string;
  manifest: Manifest;
}

export interface Project {
  root: string;
  baseline: Baseline;
}

/** Find the baseline directory as the extension installation path may be different depending on installation mechanism */
function findBaselineDir(root: string): string | null {
  const extRoot = join(root, "_extensions")
  for (const entry of walkSync(extRoot, {
    includeDirs: false,
    maxDepth: 5,
    match: [/manifest\.yml$/],
  })) {
    if (basename(dirname(entry.path)) === "isms") {
      return dirname(entry.path)
    }
  }
  return null;
}

export function loadProject(root = Deno.cwd()): Project {
  const baselineDir = findBaselineDir(root)
  if (baselineDir == null) {
    throw new Error(`ISMS baseline directory not found under '_extensions/' (looked for a manifest.yml)`)
  }
  const manifest = parseYaml(Deno.readTextFileSync(join(baselineDir, "manifest.yml"))) as Manifest;
  return { root: resolve(root), baseline: { dir: baselineDir, manifest: manifest } };
}
