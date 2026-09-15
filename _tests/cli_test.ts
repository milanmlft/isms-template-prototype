//
// `isms.ts`: the write and prune layer, driven the way Quarto drives it.
//
// Everything else in the suite tests `compose()`, which is read-only and returns its result in
// memory. This file covers the only code that touches the disk — and the two decisions that both
// land in `prune()`: a document the BASELINE removed from the manifest, and a document the
// INSTITUTION declined in `_isms.yml`. Neither needs code beyond the prune, which is precisely why
// a test is worth having: nothing in the source distinguishes them, so nothing would notice if one
// stopped working.
//
// `isms.ts` exports nothing and ends in a top-level `Deno.exit(await run())`, so importing it would
// kill the test runner. It is run as a subprocess, cd'ed into the fixture, which is exactly how
// Quarto invokes it as a pre-render hook.
//
import { join } from "stdlib/path";
import { existsSync } from "stdlib/fs";
import { project, runCli } from "./support/fixture.ts";
import { assertContains, assertEquals } from "./support/assert.ts";

const SCOPE_BLOCK = "<!-- isms:begin id=scope -->\n## Scope {#sec-scope}\n\nbase\n<!-- isms:end id=scope -->";

/** Fail with the subprocess's own output, which is more specific than any assertion here. */
async function runOk(root: string): Promise<string> {
  const { code, stdout, stderr } = await runCli(root);
  assertEquals(code, 0, `the CLI exited ${code}:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}

Deno.test("the CLI writes composed documents, the preamble, assets and the register", async () => {
  const root = project({
    docs: { ISMS01: { title: "First Policy", body: SCOPE_BLOCK } },
    assets: { "_extensions/isms/docs/images/pic.png": new Uint8Array([137, 80, 78, 71]) },
  });
  await runOk(root);

  Deno.statSync(join(root, "docs", "ISMS01-first-policy.qmd"));
  Deno.statSync(join(root, "docs", "_preamble.qmd"));
  Deno.statSync(join(root, "deviations.qmd"));
  // Assets are carried by reference rather than through the composed file set, so they need their
  // own assertion — and a byte one: a missing image is a broken figure in a controlled document.
  assertEquals([...Deno.readFileSync(join(root, "docs", "images", "pic.png"))], [137, 80, 78, 71]);
});

Deno.test("the register is written even when there is nothing to report", async () => {
  // Unconditionally, which is what keeps the static navbar href from dangling and what puts the
  // page outside writeAll's prune scope safely.
  const root = project({ docs: { ISMS01: SCOPE_BLOCK } });
  await runOk(root);
  assertContains(Deno.readTextFileSync(join(root, "deviations.qmd")), "Coverage");
});

Deno.test("a second run does not rewrite a file whose content has not changed", async () => {
  // Writing unconditionally would mean git churn and a changed Quarto input on every render, which
  // is also why the register carries no generation timestamp.
  const root = project({ docs: { ISMS01: SCOPE_BLOCK } });
  await runOk(root);

  const doc = join(root, "docs", "ISMS01-isms01.qmd");
  const register = join(root, "deviations.qmd");
  const before = [doc, register].map((p) => Deno.statSync(p).mtime!.getTime());
  await runOk(root);
  const after = [doc, register].map((p) => Deno.statSync(p).mtime!.getTime());

  // mtime is the only observable here. `writeAll` returns every composed path whether or not it
  // wrote it — the push sits outside the content comparison — so the CLI's stdout roll-call says
  // "composed", not "written", and cannot distinguish the two.
  assertEquals(after, before, "a second run rewrote files whose content had not changed");
});

Deno.test("a document the baseline drops from the manifest has its output pruned", async () => {
  const root = project({ docs: { ISMS01: SCOPE_BLOCK, ISMS02: SCOPE_BLOCK } });
  await runOk(root);
  Deno.statSync(join(root, "docs", "ISMS02-isms02.qmd"));

  // A BASELINE decision: the manifest, not the filesystem, decides what is composed.
  Deno.writeTextFileSync(
    join(root, "_extensions", "isms", "manifest.yml"),
    'baseline_version: 9.9.9\ndocuments:\n  - id: ISMS01\n    file: docs/ISMS01.qmd\n    title: "ISMS01"\n',
  );
  await runOk(root);
  assertEquals(existsSync(join(root, "docs", "ISMS02-isms02.qmd")), false);
});

Deno.test("a document the institution un-adopts has its output pruned by the same path", async () => {
  const root = project({ docs: { ISMS01: SCOPE_BLOCK, ISMS02: SCOPE_BLOCK } });
  await runOk(root);
  Deno.statSync(join(root, "docs", "ISMS02-isms02.qmd"));

  // An INSTITUTION decision, reaching the same prune. The document's baseline source is untouched.
  Deno.writeTextFileSync(
    join(root, "_isms.yml"),
    "documents:\n  ISMS02:\n    adopted: false\n    reason: covered by the central process\n",
  );
  await runOk(root);
  assertEquals(existsSync(join(root, "docs", "ISMS02-isms02.qmd")), false);
  Deno.statSync(join(root, "_extensions", "isms", "docs", "ISMS02.qmd"));
});

Deno.test("an asset removed from the baseline is pruned from the composed tree", async () => {
  // The prune recurses, because assets bring subdirectories into the generated tree and a stray one
  // is as much a prune failure as a stray document.
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    assets: { "_extensions/isms/docs/images/pic.png": new Uint8Array([1, 2, 3]) },
  });
  await runOk(root);
  Deno.statSync(join(root, "docs", "images", "pic.png"));

  Deno.removeSync(join(root, "_extensions", "isms", "docs", "images", "pic.png"));
  await runOk(root);
  assertEquals(existsSync(join(root, "docs", "images", "pic.png")), false);
});

Deno.test("a composition error aborts the run, exits non-zero, and names what is wrong", async () => {
  // Composition is fail-loud by design: the pre-render hook must stop the render rather than
  // publish an ISMS that silently ignored a formally approved override.
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: {
      ISMS01: "<!-- isms:override id=nonesuch mode=replace reason=x -->\nlocal\n<!-- isms:end id=nonesuch -->",
    },
  });
  const { code, stdout, stderr } = await runCli(root);
  assertEquals(code !== 0, true, "a broken override composed successfully");
  assertContains(stdout + stderr, "nonesuch");
  // Nothing may be written from an aborted compose — a half-composed docs/ would then disagree
  // with the register that was never regenerated.
  assertEquals(existsSync(join(root, "docs")), false);
});

Deno.test("running outside a project is refused rather than composing nothing", async () => {
  const empty = Deno.makeTempDirSync({ prefix: "isms-not-a-project-" });
  const { code, stdout, stderr } = await runCli(empty);
  assertEquals(code !== 0, true, "the CLI reported success with no baseline to compose");
  assertContains(stdout + stderr, "_extensions");
});
