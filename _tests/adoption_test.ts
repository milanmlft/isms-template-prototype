//
// `_isms.yml`: the adoption denylist, and every input it refuses.
//
// Grown in Task 5 of _dev/tests-and-ci-plan.md.
//
import { composeIn, project } from "./support/fixture.ts";
import { assertEquals } from "./support/assert.ts";

Deno.test("no _isms.yml at all adopts everything", async () => {
  const result = await composeIn(
    project({ docs: { ISMS01: "<!-- isms:begin id=scope -->\nbase\n<!-- isms:end id=scope -->" } }),
  );
  assertEquals(result.unadopted.length, 0);
  assertEquals(result.docs.length, 1);
});
