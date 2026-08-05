import { parse as parseYaml } from "stdlib/yaml";
import { join, resolve } from "stdlib/path";

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

export function loadProject(root = Deno.cwd()): Project {
  const baselineDir = join(root, "_extensions", "isms");
  const manifest = parseYaml(Deno.readTextFileSync(join(baselineDir, "manifest.yml"))) as Manifest;
  const baseline = { dir: baselineDir, manifest: manifest }
  return { root: resolve(root), baseline: baseline };
}
