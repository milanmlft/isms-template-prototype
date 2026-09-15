//
// Composition: the override contract, the front-matter merge rules, and the asset walk.
//
// Grown in Task 4 of _dev/tests-and-ci-plan.md.
//
import { composeIn, project } from "./support/fixture.ts";
import { assertEquals } from "./support/assert.ts";

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
