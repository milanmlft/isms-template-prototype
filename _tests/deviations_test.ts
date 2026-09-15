//
// The deviations register: what it reports, where its deep links land, and what it refuses to do.
//
// Grown in Task 6 of _dev/tests-and-ci-plan.md.
//
import { composeIn, project } from "./support/fixture.ts";
import { assertContains } from "./support/assert.ts";

Deno.test("the register is generated even with no deviations at all", async () => {
  const result = await composeIn(
    project({ docs: { ISMS01: "<!-- isms:begin id=scope -->\nbase\n<!-- isms:end id=scope -->" } }),
  );
  const register = result.files.get("deviations.qmd");
  if (register === undefined) throw new Error("no deviations.qmd in the composed file set");
  assertContains(register, "Coverage");
});
