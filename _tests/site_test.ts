//
// The `--site` tier: what `quarto render` actually published.
//
// Separate from the tree tier because it only means anything immediately after a render. A full
// project render prunes `_site/`, but an incremental or interrupted one does not — and a site still
// serving a policy this ISMS has not adopted is a governance failure rather than a stale artefact.
//
import { basename, join } from "stdlib/path";
import { loadProject } from "../_extensions/isms/cli/lib/project.ts";
import { compose, COMPOSED_DIR } from "../_extensions/isms/cli/lib/compose.ts";
import { DEVIATIONS_PATH } from "../_extensions/isms/cli/lib/deviations.ts";

const project = loadProject();
const { root } = project;
const result = await compose(project);

function requireRendered(): void {
  try {
    Deno.statSync(join(root, "_site"));
  } catch {
    throw new Error(
      "_site/ does not exist — run `quarto render` before the --site tier. Composing is not " +
        "rendering: this tier is about what Quarto published, and with nothing published it " +
        "would pass by having nothing to disagree with.",
    );
  }
}

const pages = [
  ...[...result.files.keys()].filter(
    (rel) => rel !== DEVIATIONS_PATH && !basename(rel).startsWith("_"),
  ),
  DEVIATIONS_PATH,
  "index.qmd",
];

Deno.test("every composed document, the register and the index were rendered", async (t) => {
  requireRendered();
  for (const rel of pages) {
    await t.step(rel, () => {
      const html = join(root, "_site", rel.replace(/\.qmd$/, ".html"));
      try {
        Deno.statSync(html);
      } catch {
        throw new Error(`${html.slice(root.length + 1)} was not rendered`);
      }
    });
  }
});

Deno.test("no page survives in _site/ for a document this ISMS has not adopted", async (t) => {
  requireRendered();
  let served: string[] = [];
  try {
    served = [...Deno.readDirSync(join(root, "_site", COMPOSED_DIR))]
      .filter((e) => e.isFile && e.name.endsWith(".html"))
      .map((e) => e.name);
  } catch { /* a missing _site/docs is already reported above */ }

  for (const u of result.unadopted) {
    await t.step(u.ismsId, () => {
      for (const name of served.filter((n) => n.startsWith(`${u.ismsId}-`))) {
        throw new Error(
          `_site/${COMPOSED_DIR}/${name} still exists, but ${u.ismsId} is not adopted — the ` +
            `rendered site is serving a document this ISMS has not adopted; delete _site/ and ` +
            `re-render`,
        );
      }
    });
  }
});
