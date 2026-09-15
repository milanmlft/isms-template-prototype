//
// Fixture projects, written into temp dirs.
//
// `compose()` is read-only and takes its root from the `Project` it is handed — nothing reads
// `Deno.cwd()` — so a complete ISMS project is three files and a full compose takes ~35ms with no
// Quarto process involved. That is what makes per-case fixtures affordable, and per-case fixtures
// are what let the suite provoke the fail-loud paths the standing verification pass never reached.
//
// THE BUILDER IS A DUMB FILE WRITER with defaults. It must never synthesise a manifest from the
// docs it is handed, and must never compute a composed filename's slug. The moment it does either,
// it is a second composer with its own bugs, and a test can pass because the builder and the
// composer are wrong in the same way — the drift argument the CLI's own modules exist to avoid.
//
import { dirname, join } from "stdlib/path";
import { compose } from "../../_extensions/isms/cli/lib/compose.ts";
import { loadProject } from "../../_extensions/isms/cli/lib/project.ts";
import type { ComposeResult } from "../../_extensions/isms/cli/lib/compose.ts";
import { assertWellFormed } from "./invariants.ts";

export interface DocSpec {
  /** Manifest title. Defaults to the id. The composed filename is `<id>-<slug(title)>.qmd`. */
  title?: string;
  /** Path under the baseline, relative to `_extensions/isms/`. Defaults to `docs/<id>.qmd`. */
  file?: string;
  /** Manifest `blocks:` list. Declarative only — the CLI never reads it. Defaults to none. */
  blocks?: string[];
  /** Front matter WITHOUT the `---` fences. Defaults to `isms-id` + `title`. */
  frontMatter?: string;
  /** Markdown body, verbatim. */
  body: string;
}

export interface FixtureSpec {
  baselineVersion?: string;
  /** Baseline documents, keyed on ISMS ID. A bare string is shorthand for `{ body }`. */
  docs: Record<string, string | DocSpec>;
  /** `_overrides/<ID>.qmd` contents, verbatim. */
  overrides?: Record<string, string>;
  /** `_isms.yml` contents, verbatim. Omit for the common case of no file at all. */
  adoption?: string;
  /** Extra files, keyed on a path relative to the project root. Use for assets. */
  assets?: Record<string, Uint8Array>;
  /** `_extensions/isms/docs/_preamble.qmd`. Defaults to a one-liner. */
  preamble?: string;
}

function write(path: string, content: string | Uint8Array): void {
  Deno.mkdirSync(dirname(path), { recursive: true });
  if (typeof content === "string") Deno.writeTextFileSync(path, content);
  else Deno.writeFileSync(path, content);
}

/** Write a project into a fresh temp dir and return its root. */
export function project(spec: FixtureSpec): string {
  const root = Deno.makeTempDirSync({ prefix: "isms-fixture-" });
  const baseline = join(root, "_extensions", "isms");

  const entries: string[] = [];
  for (const [id, raw] of Object.entries(spec.docs)) {
    const doc: DocSpec = typeof raw === "string" ? { body: raw } : raw;
    const title = doc.title ?? id;
    const file = doc.file ?? `docs/${id}.qmd`;
    const frontMatter = doc.frontMatter ?? `isms-id: ${id}\ntitle: "${title}"`;
    write(join(baseline, file), `---\n${frontMatter}\n---\n\n${doc.body}\n`);

    const blocks = (doc.blocks ?? []).map((b) => `      - ${b}`).join("\n");
    entries.push(
      `  - id: ${id}\n    file: ${file}\n    title: "${title}"` +
        (blocks ? `\n    blocks:\n${blocks}` : ""),
    );
  }

  write(
    join(baseline, "manifest.yml"),
    `baseline_version: ${spec.baselineVersion ?? "9.9.9"}\ndocuments:\n${entries.join("\n")}\n`,
  );
  // Mandatory: compose() reads it by hard-coded path and refuses to compose a baseline without one.
  write(join(baseline, "docs", "_preamble.qmd"), spec.preamble ?? "*preamble*\n");

  for (const [id, body] of Object.entries(spec.overrides ?? {})) {
    write(join(root, "_overrides", `${id}.qmd`), body);
  }
  if (spec.adoption !== undefined) write(join(root, "_isms.yml"), spec.adoption);
  for (const [rel, bytes] of Object.entries(spec.assets ?? {})) write(join(root, rel), bytes);

  return root;
}

/**
 * Compose a fixture, asserting the structural invariants on every composed document as it goes.
 *
 * Running the invariants here rather than per-test means a malformed marker cannot slip through on
 * a document whose own test happened to be about something else.
 */
export async function composeIn(root: string): Promise<ComposeResult> {
  const result = await compose(loadProject(root));
  for (const [rel, content] of result.files) {
    // The register is a report about the controlled documents, not one of them, and `_`-prefixed
    // files are shared includes Quarto never renders. Neither carries a banner of its own.
    if (rel === "deviations.qmd" || rel.startsWith("docs/_")) continue;
    assertWellFormed(rel, content);
  }
  return result;
}

/**
 * Run the real CLI against a fixture, as a subprocess.
 *
 * `isms.ts` ends in a top-level `Deno.exit(await run())`, so importing it would kill the test
 * runner; and `run()` calls `loadProject()` with no argument, so the process must be cd'ed into the
 * fixture. Both are exactly how Quarto invokes it as a pre-render hook, which is the point.
 */
export async function runCli(
  root: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const denoDir = Deno.env.get("DENO_DIR");
  if (denoDir === undefined) throw new Error("no DENO_DIR — run the suite through _tests/run.ts");
  const cli = new URL("../../_extensions/isms/cli/isms.ts", import.meta.url).pathname;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--import-map",
      join(denoDir, "..", "run_import_map.json"),
      "--cached-only",
      "--no-config",
      "--no-lock",
      "--allow-all",
      cli,
    ],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}
