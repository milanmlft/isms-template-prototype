//
// Composition: the override contract, the front-matter merge rules, and the asset walk.
//
// Grown in Task 4 of _dev/tests-and-ci-plan.md.
//
import { join } from "stdlib/path";
import { composeIn, project } from "./support/fixture.ts";
import {
  assertContains,
  assertEquals,
  assertMatch,
  assertMissing,
  assertRejectsWith,
} from "./support/assert.ts";

const SCOPE_BLOCK = "<!-- isms:begin id=scope -->\nbase\n<!-- isms:end id=scope -->";

Deno.test("a three-file fixture composes one document", async () => {
  const root = project({
    docs: {
      ISMS01: {
        title: "First Policy",
        body: "<!-- isms:begin id=scope -->\n## Scope {#sec-scope}\n\nbase\n<!-- isms:end id=scope -->",
      },
    },
  });
  const result = await composeIn(root);
  assertEquals(result.files.has("docs/ISMS01-first-policy.qmd"), true);
  assertEquals(result.docs.length, 1);
  assertEquals(result.unadopted.length, 0);
});

Deno.test("a document with no manifest title composes under its own id as the slug", async () => {
  // The rest of this file leans on this: a fixture doc declared as a bare string gets `title: <id>`,
  // and the slug is lower-cased, so the composed path is `docs/ISMS01-isms01.qmd` — the id in both
  // halves but spelled differently. Pinned once, empirically, rather than assumed.
  const result = await composeIn(project({ docs: { ISMS01: SCOPE_BLOCK } }));
  assertEquals([...result.files.keys()].includes("docs/ISMS01-isms01.qmd"), true);
});

//
// Fail-loud paths. Each asserts the identifiers the message must name — never its prose.
//

Deno.test("a baseline with no _preamble.qmd cannot be composed", async () => {
  const root = project({ docs: { ISMS01: SCOPE_BLOCK } });
  // The preamble is the one baseline file reached by hard-coded path rather than through the
  // manifest, so only deleting it after the fact reproduces an incompletely vendored baseline.
  Deno.removeSync(join(root, "_extensions", "isms", "docs", "_preamble.qmd"));
  await assertRejectsWith(() => composeIn(root), "_preamble.qmd");
});

Deno.test("two assets that would land on the same composed path are refused, naming both origins", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    assets: {
      "_extensions/isms/docs/logo.png": new Uint8Array([1, 2, 3]),
      "_overrides/logo.png": new Uint8Array([4, 5, 6]),
    },
  });
  await assertRejectsWith(
    () => composeIn(root),
    "docs/logo.png",
    "baseline",
    "override",
  );
});

Deno.test("an override file for a document _isms.yml un-adopts is refused", async () => {
  const root = project({
    // Two documents: un-adopting the only one hits the adoption guard against an empty sidebar
    // first, and this test would then be asserting a different error.
    docs: { ISMS01: SCOPE_BLOCK, ISMS02: SCOPE_BLOCK },
    overrides: {
      ISMS02: "<!-- isms:override id=scope mode=replace reason=x -->\nlocal\n<!-- isms:end id=scope -->",
    },
    adoption: "documents:\n  ISMS02:\n    adopted: false\n    reason: covered centrally\n",
  });
  await assertRejectsWith(
    () => composeIn(root),
    "ISMS02",
    "_overrides",
    "_isms.yml",
  );
});

Deno.test("an override on a block the baseline does not have is refused, listing the ids that do", async () => {
  const root = project({
    docs: {
      ISMS01: "<!-- isms:begin id=scope -->\nbase\n<!-- isms:begin id=scope.detail -->\nd\n" +
        "<!-- isms:end id=scope.detail -->\n<!-- isms:end id=scope -->",
    },
    overrides: {
      ISMS01:
        "<!-- isms:override id=nonesuch mode=replace reason=x -->\nlocal\n<!-- isms:end id=nonesuch -->",
    },
  });
  const err = await assertRejectsWith(() => composeIn(root), "nonesuch");
  // CLAUDE.md's promise is that the error lists the ids that DO exist, so a typo is fixable from
  // the message alone. Pin the list, not the sentence around it.
  assertContains(err.message, "scope");
  assertContains(err.message, "scope.detail");
});

Deno.test("an override nested inside a block the same file replaces is refused, naming both", async () => {
  const root = project({
    docs: {
      ISMS01: "<!-- isms:begin id=access -->\nbase\n<!-- isms:begin id=access.chain -->\nc\n" +
        "<!-- isms:end id=access.chain -->\n<!-- isms:end id=access -->",
    },
    overrides: {
      ISMS01: "<!-- isms:override id=access mode=replace reason=x -->\nlocal\n<!-- isms:end id=access -->\n" +
        "<!-- isms:override id=access.chain mode=after reason=y -->\nmore\n<!-- isms:end id=access.chain -->",
    },
  });
  await assertRejectsWith(() => composeIn(root), "access.chain", "access", "mode=replace");
});

Deno.test("override front matter that is not valid YAML is refused", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: { ISMS01: "---\nreview: [unclosed\n---\n" },
  });
  await assertRejectsWith(() => composeIn(root), "YAML");
});

Deno.test("override front matter that is a sequence rather than a mapping is refused", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: { ISMS01: "---\n- one\n- two\n---\n" },
  });
  await assertRejectsWith(() => composeIn(root), "mapping");
});

Deno.test("a document: key that is not an ISMS ID is refused, at the line it sits on", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    // `document:` is put on the second front-matter line deliberately: the error must cite the key
    // it objects to, not the top of the file, which is the whole reason metaLine() exists.
    overrides: { ISMS01: '---\ntitle: "Local"\ndocument: 42\n---\n' },
  });
  const err = await assertRejectsWith(() => composeIn(root), "document", "ISMS01");
  assertContains(err.message, "_overrides/ISMS01.qmd:3:");
});

Deno.test("a document: key naming another document is refused, naming both ids", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK, ISMS02: SCOPE_BLOCK },
    overrides: { ISMS01: '---\ntitle: "Local"\ndocument: ISMS02\n---\n' },
  });
  const err = await assertRejectsWith(() => composeIn(root), "ISMS02", "ISMS01");
  assertContains(err.message, "_overrides/ISMS01.qmd:3:");
});

//
// PROTECTED_META, one test per key. Deliberately not a loop: each key is refused for its own
// documented reason — the first three because a document that can rewrite its own provenance can
// misreport it, `author` because Quarto draws a second byline over the one the preamble renders —
// and a loop would let a regression in one of them hide behind the other three.
//

Deno.test("an override cannot rewrite isms-id, the key its own overrides are filed under", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: { ISMS01: "---\nisms-id: ISMS99\n---\n" },
  });
  await assertRejectsWith(() => composeIn(root), "isms-id");
});

Deno.test("an override cannot rewrite baseline-doc-version, which records what it was composed from", async () => {
  const root = project({
    docs: {
      ISMS01: {
        frontMatter: 'isms-id: ISMS01\ntitle: "ISMS01"\nbaseline-doc-version: 1.0.0',
        body: SCOPE_BLOCK,
      },
    },
    overrides: { ISMS01: "---\nbaseline-doc-version: 9.9.9\n---\n" },
  });
  await assertRejectsWith(() => composeIn(root), "baseline-doc-version");
});

Deno.test("an override cannot rewrite filename, which the manifest decides", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: { ISMS01: "---\nfilename: somewhere-else.qmd\n---\n" },
  });
  await assertRejectsWith(() => composeIn(root), "filename");
});

Deno.test("an override cannot set author, which Quarto would render as a second byline", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: { ISMS01: "---\nauthor: Real Person\n---\n" },
  });
  const err = await assertRejectsWith(() => composeIn(root), "author");
  // The message must point at the key that IS settable, or the institution has no way forward.
  assertContains(err.message, "document-author");
});

//
// The front-matter merge table.
//

Deno.test("mappings deep-merge so naming one field does not drop its siblings", async () => {
  const root = project({
    docs: {
      ISMS01: {
        frontMatter: 'isms-id: ISMS01\ntitle: "ISMS01"\n' +
          "review:\n  reviewer: Policy Owner\n  period: 1 year",
        body: SCOPE_BLOCK,
      },
    },
    overrides: { ISMS01: "---\nreview:\n  reviewer: Real Person\n---\n" },
  });
  const out = (await composeIn(root)).files.get("docs/ISMS01-isms01.qmd")!;
  assertContains(out, "Real Person");
  // The preamble reads review.period too, so merging must not lose the sibling left alone.
  assertContains(out, "1 year");
  assertMissing(out, "Policy Owner");
});

Deno.test("a scalar and a sequence each replace the baseline value outright", async () => {
  const root = project({
    docs: {
      ISMS01: {
        frontMatter: 'isms-id: ISMS01\ntitle: "ISMS01"\nclassification: Internal\n' +
          "keywords:\n  - baseline-one\n  - baseline-two",
        body: SCOPE_BLOCK,
      },
    },
    overrides: { ISMS01: "---\nclassification: Public\nkeywords:\n  - local-only\n---\n" },
  });
  const out = (await composeIn(root)).files.get("docs/ISMS01-isms01.qmd")!;
  assertContains(out, "classification: Public");
  assertContains(out, "local-only");
  // A sequence is not merged element-wise: the baseline's entries are gone, not appended to.
  assertMissing(out, "baseline-one");
  assertMissing(out, "baseline-two");
});

Deno.test("an explicit null sets the key rather than removing it", async () => {
  // `null` is a real value in this front matter — baseline ISMS08 ships `sources: null` — so an
  // override writing one must set the key, not delete it and leave the preamble reading undefined.
  const root = project({
    docs: {
      ISMS01: {
        frontMatter: 'isms-id: ISMS01\ntitle: "ISMS01"\nsources: Some source',
        body: SCOPE_BLOCK,
      },
    },
    overrides: { ISMS01: "---\nsources: ~\n---\n" },
  });
  const out = (await composeIn(root)).files.get("docs/ISMS01-isms01.qmd")!;
  assertMatch(out, /^sources: null$/m);
  assertMissing(out, "Some source");
});

Deno.test("an unquoted YAML date is not republished as a UTC timestamp", async () => {
  const root = project({
    docs: {
      ISMS01: {
        frontMatter: 'isms-id: ISMS01\ntitle: "ISMS01"\napproval:\n  date: TBC',
        body: SCOPE_BLOCK,
      },
    },
    overrides: { ISMS01: "---\napproval:\n  date: 2026-07-14\n---\n" },
  });
  const out = (await composeIn(root)).files.get("docs/ISMS01-isms01.qmd")!;
  assertContains(out, "2026-07-14");
  // YAML's default schema turns the unquoted date into a JS Date, which re-serialises as
  // `2026-07-14T00:00:00.000Z` — a timestamp nobody means to publish under "Approved date".
  assertMissing(out, "T00:00:00");
});

Deno.test("a front-matter key absent from the baseline warns rather than failing", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: { ISMS01: "---\ntypo-key: value\n---\n" },
  });
  const result = await composeIn(root);
  assertEquals(result.files.has("docs/ISMS01-isms01.qmd"), true);
  const warnings = result.warnings.join("\n");
  assertContains(warnings, "typo-key");
  // The likeliest cause is a misspelt baseline key, so the warning lists the keys that do exist.
  assertContains(warnings, "isms-id");
});

Deno.test("a front-matter-only override leaves the document adopted verbatim", async () => {
  const root = project({
    docs: {
      ISMS01: {
        frontMatter: 'isms-id: ISMS01\ntitle: "ISMS01"\ndocument-author: Policy Owner',
        body: SCOPE_BLOCK,
      },
    },
    overrides: { ISMS01: "---\ndocument-author: Real Person\n---\n" },
  });
  const result = await composeIn(root);
  // Replacing a placeholder author is adopting the baseline, not departing from it, so it earns
  // no row in the register — and no provenance marker in the composed body either.
  assertEquals(result.docs[0].deviations.length, 0);
  assertContains(result.files.get("deviations.qmd")!, "Adopted verbatim");
  assertMissing(result.files.get("docs/ISMS01-isms01.qmd")!, "source=override");
});

Deno.test("overriding title: retitles the page but not the composed filename", async () => {
  const root = project({
    docs: { ISMS01: { title: "First Policy", body: SCOPE_BLOCK } },
    overrides: { ISMS01: '---\ntitle: "Local Access Policy"\n---\n' },
  });
  const result = await composeIn(root);
  // The filename is `<ID>-<slug(manifest title)>.qmd` — the manifest decides it, not the override.
  assertEquals(result.files.has("docs/ISMS01-first-policy.qmd"), true);
  assertEquals(result.docs[0].title, "Local Access Policy");
});

Deno.test("an overridden block carries its provenance payload in the composed output", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    overrides: {
      ISMS01: "<!-- isms:override id=scope mode=after reason=x -->\nextra\n<!-- isms:end id=scope -->",
    },
  });
  const out = (await composeIn(root)).files.get("docs/ISMS01-isms01.qmd")!;
  // The register re-parses these markers to resolve its deep links, so the payload is load-bearing
  // rather than decorative — and nothing verified it before this test.
  assertMatch(out, /<!-- isms:block id=scope[^>]*source=override[^>]*mode=after/);
});

//
// The asset walk.
//

Deno.test("a hidden path segment anywhere in an asset's path excludes it, not just its own name", async () => {
  // The regression this pins: the walk once tested the file's own name only, so a perfectly
  // ordinary `.png` inside a `.ipynb_checkpoints/` directory was mirrored into the published site.
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    assets: {
      "_extensions/isms/docs/images/ok.png": new Uint8Array([1, 2, 3]),
      "_extensions/isms/docs/.ipynb_checkpoints/hidden.png": new Uint8Array([1, 2, 3]),
      "_extensions/isms/docs/images/.DS_Store": new Uint8Array([1, 2, 3]),
    },
  });
  const result = await composeIn(root);
  assertEquals(result.assets.has("docs/images/ok.png"), true);
  assertEquals([...result.assets.keys()].some((k) => k.includes("ipynb_checkpoints")), false);
  assertEquals(result.assets.has("docs/images/.DS_Store"), false);
  const warnings = result.warnings.join("\n");
  assertContains(warnings, "docs/.ipynb_checkpoints/hidden.png");
  assertContains(warnings, "docs/images/.DS_Store");
});

Deno.test("a symlinked asset is not copied", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    assets: { "_extensions/isms/docs/images/ok.png": new Uint8Array([1, 2, 3]) },
  });
  Deno.symlinkSync(
    join(root, "_extensions", "isms", "docs", "images", "ok.png"),
    join(root, "_extensions", "isms", "docs", "images", "link.png"),
  );
  const result = await composeIn(root);
  assertEquals(result.assets.has("docs/images/ok.png"), true);
  assertEquals(result.assets.has("docs/images/link.png"), false);
  assertContains(result.warnings.join("\n"), "docs/images/link.png");
});

Deno.test("an institution's own asset is mirrored to the same position under docs/", async () => {
  const root = project({
    docs: { ISMS01: SCOPE_BLOCK },
    assets: {
      "_extensions/isms/docs/images/baseline.png": new Uint8Array([1]),
      "_overrides/images/local.svg": new Uint8Array([2]),
      "_overrides/data/table.csv": new Uint8Array([3]),
    },
  });
  const result = await composeIn(root);
  assertEquals(result.assets.get("docs/images/baseline.png")!.origin, "baseline");
  assertEquals(result.assets.get("docs/images/local.svg")!.origin, "override");
  assertEquals(result.assets.get("docs/data/table.csv")!.origin, "override");
});

Deno.test("a .qmd under _overrides/ is never mirrored as an asset", async () => {
  // Every composed path ends in `.qmd` and the walk skips `.qmd` outright, so an asset can never
  // collide with a composed DOCUMENT — compose.ts's guard for that case is unreachable today.
  // Recorded here as current behaviour rather than fixed: see the report accompanying this suite.
  const root = project({
    docs: { ISMS01: { title: "First Policy", body: SCOPE_BLOCK } },
    assets: { "_overrides/ISMS01-first-policy.qmd": new Uint8Array([1, 2, 3]) },
  });
  const result = await composeIn(root);
  assertEquals([...result.assets.keys()], []);
  assertEquals(result.files.get("docs/ISMS01-first-policy.qmd")!.includes("base"), true);
});
