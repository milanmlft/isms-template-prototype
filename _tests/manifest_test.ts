//
// `manifest.yml`'s `blocks:` lists against the delimiters actually in the baseline sources.
//
// The one test in this suite that is about THIS repo's content rather than the CLI's behaviour,
// and it earns the exception: `blocks:` is the published override API. Every adopter writes
// `_overrides/<ID>.qmd` against those ids, so drift in either direction is a broken promise — a
// missing entry hides an overridable block from everyone, and a phantom entry invites an override
// that composition will then reject. Removing or renaming one is a MAJOR release.
//
// It is validated here rather than in the CLI deliberately. Inside `compose()` it would fire during
// an adopting institution's render, over a defect only the baseline's maintainer can fix, and it
// would force reading the sources of un-adopted documents — which composition otherwise never
// touches.
//
// Needs no render and no fixture: it parses tracked source files with the project's own parser, and
// locates the project from this file rather than from the working directory.
//
import { fromFileUrl, join } from "stdlib/path";
import { loadProject } from "../_extensions/isms/cli/lib/project.ts";
import { parseDocument } from "../_extensions/isms/cli/lib/blocks.ts";

const { baseline } = loadProject(fromFileUrl(new URL("../", import.meta.url)));

Deno.test("every block in a baseline source is published in manifest.yml, and vice versa", async (t) => {
  // Never gated on adoption. `blocks:` is the shared artefact's API, so this repo's own decision
  // not to adopt a document must not switch off validation of it — and since this repo doubles as
  // the baseline's demo project, gating would leave an un-adopted document's block surface
  // verified nowhere at all.
  for (const spec of baseline.manifest.documents) {
    await t.step(spec.id, () => {
      const path = join(baseline.dir, spec.file);
      let src: string;
      try {
        src = Deno.readTextFileSync(path);
      } catch {
        throw new Error(`${spec.id}: manifest names ${spec.file}, which does not exist`);
      }

      const actual = [...parseDocument(path, src).blocks.keys()];
      const declared = spec.blocks ?? [];
      const undeclared = actual.filter((id) => !declared.includes(id));
      const phantom = declared.filter((id) => !actual.includes(id));

      if (undeclared.length > 0) {
        throw new Error(
          `${spec.id}: blocks in the source but not published in manifest.yml: ` +
            `${undeclared.join(", ")} — add them to that document's \`blocks:\` list (a MINOR ` +
            `release), or the override surface they represent is invisible to every adopter`,
        );
      }
      if (phantom.length > 0) {
        throw new Error(
          `${spec.id}: manifest.yml publishes blocks that no longer exist: ${phantom.join(", ")} ` +
            `— restore the ids, or accept their removal as a MAJOR release and say so in the ` +
            `release notes`,
        );
      }
    });
  }
});
