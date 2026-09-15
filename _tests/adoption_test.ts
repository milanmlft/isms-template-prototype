//
// `_isms.yml`: the adoption denylist, and every input it refuses.
//
// Almost every fixture here ships TWO baseline documents. Un-adopting the only document in the
// manifest trips the "nothing left to publish" guard, which would then be the error under test in
// every case rather than the one the case is about.
//
import { composeIn, project, SCOPE_BLOCK } from "./support/fixture.ts";
import { assertContains, assertEquals, assertMatch, assertRejectsWith } from "./support/assert.ts";

/** A two-document baseline plus the `_isms.yml` under test. Bodies are inert: nothing parses them. */
function adopting(adoption: string): string {
  return project({ docs: { ISMS01: "one", ISMS02: "two" }, adoption });
}

Deno.test("an _isms.yml that is not valid YAML is refused, naming the file", async () => {
  const err = await assertRejectsWith(
    () => composeIn(adopting("documents: [\n")),
    "_isms.yml",
    "YAML",
  );
  // The parser's own complaint is passed through, so the author sees where the syntax broke. A
  // length comparison cannot show that: the message is prefixed with the ABSOLUTE path, so it
  // clears any yardstick built from the relative one even if the complaint were dropped entirely.
  assertMatch(err.message, /not valid YAML: \S/);
});

Deno.test("an _isms.yml whose root is not a mapping is refused, naming what it found instead", async () => {
  await assertRejectsWith(
    () => composeIn(adopting("- just a list\n")),
    "_isms.yml",
    "mapping",
    "a list",
  );
});

Deno.test("`documents:` written as a sequence is refused, showing the mapping form it wants", async () => {
  // `- ISMS02` is the shape someone reaches for when they think of this as a list of dropped
  // documents; it parses fine, so only this check stands between it and a silent adoption of all.
  await assertRejectsWith(
    () => composeIn(adopting("documents:\n  - ISMS02\n")),
    "documents:",
    "a list",
    "adopted: false",
  );
});

Deno.test("an unknown top-level key is refused, listing the keys allowed there", async () => {
  await assertRejectsWith(
    () => composeIn(adopting("documentss:\n  ISMS02:\n    adopted: false\n")),
    "documentss",
    "documents",
  );
});

Deno.test("an id absent from the manifest is refused, listing the documents the baseline has", async () => {
  // A typo here would silently ADOPT the document the institution believes it dropped, so the
  // error names the baseline version too: a renaming baseline update is the innocent cause.
  await assertRejectsWith(
    () => composeIn(adopting("documents:\n  ISMS99:\n    adopted: false\n    reason: x\n")),
    "ISMS99",
    "9.9.9",
    "ISMS01, ISMS02",
  );
});

Deno.test("a document entry that is not a mapping is refused, naming the entry", async () => {
  await assertRejectsWith(
    () => composeIn(adopting("documents:\n  ISMS02: false\n")),
    "documents.ISMS02",
    "mapping",
    "adopted: false",
  );
});

Deno.test("an unknown key under a document is refused, listing the keys allowed there", async () => {
  await assertRejectsWith(
    () => composeIn(adopting("documents:\n  ISMS02:\n    adoptedd: false\n")),
    "documents.ISMS02",
    "adoptedd",
    "adopted, approved-by, approved-date, reason",
  );
});

Deno.test("a document entry with no `adopted:` key is refused, saying a document with no entry is adopted", async () => {
  await assertRejectsWith(
    () => composeIn(adopting("documents:\n  ISMS02:\n    reason: covered centrally\n")),
    "documents.ISMS02",
    "adopted: false",
    "_isms.yml",
  );
});

Deno.test('`adopted: no` is refused, because YAML resolves it to the truthy string "no"', async () => {
  // The whole value of this check: YAML 1.2's core schema resolves `no` to the STRING "no", which
  // is truthy, so without it the document would be silently ADOPTED — the opposite of the
  // institution's recorded decision. The message quotes the value back as the string it is.
  await assertRejectsWith(
    () => composeIn(adopting("documents:\n  ISMS02:\n    adopted: no\n    reason: x\n")),
    "documents.ISMS02.adopted",
    "true",
    "false",
    '"no"',
  );
});

Deno.test("un-adopting a document with no `reason:` is refused, unlike the same gap on a block override", async () => {
  // An un-adopted document leaves nothing anywhere — no composed file, no provenance marker — so
  // the register entry is the entire audit record of the decision, and a blank one is worthless.
  await assertRejectsWith(
    () => composeIn(adopting("documents:\n  ISMS02:\n    adopted: false\n")),
    "_isms.yml",
    "ISMS02",
    "reason",
  );
});

Deno.test("an empty `reason:` is refused exactly as a missing one is", async () => {
  await assertRejectsWith(
    () => composeIn(adopting('documents:\n  ISMS02:\n    adopted: false\n    reason: "   "\n')),
    "ISMS02",
    "reason",
  );
});

Deno.test("a governance attribute that is not text is refused, naming its key path", async () => {
  await assertRejectsWith(
    () =>
      composeIn(adopting(
        "documents:\n  ISMS02:\n    adopted: false\n    reason: x\n    approved-by: 42\n",
      )),
    "documents.ISMS02.approved-by",
    "text",
    "a number",
  );
});

Deno.test("un-adopting every document is refused, because Quarto cannot render an empty sidebar", async () => {
  // Not a policy judgement: `auto: "docs/*.qmd"` matching nothing crashes Quarto in
  // sidebarItemsFromAuto, so this says it here rather than handing over a Quarto stack trace.
  await assertRejectsWith(
    () =>
      composeIn(adopting(
        "documents:\n" +
          "  ISMS01:\n    adopted: false\n    reason: a\n" +
          "  ISMS02:\n    adopted: false\n    reason: b\n",
      )),
    "9.9.9",
    "ISMS01, ISMS02",
    "one document",
  );
});

Deno.test("no _isms.yml at all adopts everything", async () => {
  const result = await composeIn(
    project({ docs: { ISMS01: SCOPE_BLOCK } }),
  );
  assertEquals(result.unadopted.length, 0);
  assertEquals(result.docs.length, 1);
});

Deno.test("an _isms.yml with no `documents:` key adopts everything", async () => {
  const result = await composeIn(adopting("documents:\n"));
  assertEquals(result.unadopted.length, 0);
  assertEquals(result.docs.length, 2);
});

Deno.test("a document with no entry is adopted — the file is a denylist", async () => {
  // The point of the denylist: a document a future baseline adds arrives ADOPTED, rather than
  // vanishing from an ISMS whose author never knew it had been written.
  const result = await composeIn(
    adopting("documents:\n  ISMS02:\n    adopted: false\n    reason: covered centrally\n"),
  );
  assertEquals(result.docs.map((d) => d.ismsId), ["ISMS01"]);
});

Deno.test("`adopted: true` is a legal no-op, so a reviewed decision to adopt can be recorded", async () => {
  const result = await composeIn(adopting("documents:\n  ISMS02:\n    adopted: true\n"));
  assertEquals(result.docs.length, 2);
  assertEquals(result.unadopted.length, 0);
  // A recorded adoption is not a deviation, so it earns no governance warning either.
  assertEquals(result.warnings, []);
});

Deno.test("an un-adopted document is composed nowhere and recorded in unadopted", async () => {
  const result = await composeIn(
    adopting("documents:\n  ISMS02:\n    adopted: false\n    reason: covered centrally\n"),
  );
  assertEquals(result.unadopted.map((u) => u.ismsId), ["ISMS02"]);
  assertEquals(result.unadopted.map((u) => u.reason), ["covered centrally"]);
  assertEquals([...result.files.keys()].some((k) => k.startsWith("docs/ISMS02-")), false);
});

Deno.test("un-adoptions are listed in manifest order, not in the order _isms.yml names them", async () => {
  // The register reads in document order and does no sort of its own, so the Map this builds has
  // to arrive already ordered.
  const root = project({
    docs: { ISMS01: "one", ISMS02: "two", ISMS03: "three" },
    adoption: "documents:\n" +
      "  ISMS03:\n    adopted: false\n    reason: c\n" +
      "  ISMS01:\n    adopted: false\n    reason: a\n",
  });
  const result = await composeIn(root);
  assertEquals(result.unadopted.map((u) => u.ismsId), ["ISMS01", "ISMS03"]);
});

Deno.test("a missing approved-by warns but still composes", async () => {
  // An approval may be mid-flight; only the reason is load-bearing enough to refuse.
  const result = await composeIn(
    adopting("documents:\n  ISMS02:\n    adopted: false\n    reason: covered centrally\n"),
  );
  const warnings = result.warnings.join("\n");
  assertContains(warnings, "approved-by");
  assertContains(warnings, "approved-date");
  assertContains(warnings, "ISMS02");
  assertContains(warnings, "_isms.yml");
  // The reason is present, so it must NOT be reported as a gap — the wording is shared with block
  // overrides, where `reason` is only a warning.
  assertEquals(warnings.includes("has no reason"), false);
});

Deno.test("an unquoted approved-date is coerced, not republished as a UTC timestamp", async () => {
  // YAML's default schema turns an unquoted 2026-09-01 into a JS Date, which re-serialises as
  // 2026-09-01T00:00:00.000Z — a timestamp nobody meant to publish under "Approved date".
  const result = await composeIn(adopting(
    "documents:\n  ISMS02:\n    adopted: false\n    reason: covered centrally\n" +
      "    approved-by: Information Governance Board\n    approved-date: 2026-09-01\n",
  ));
  assertEquals(result.unadopted[0].approvedDate, "2026-09-01");
  assertEquals(result.unadopted[0].approvedBy, "Information Governance Board");
  // Both approval fields are present, so this un-adoption produces no governance warning at all.
  assertEquals(result.warnings, []);
});
