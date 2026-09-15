//
// `isms.ts`: the write and prune layer, driven the way Quarto drives it.
//
// Grown in Task 8 of _dev/tests-and-ci-plan.md.
//
import { join } from "stdlib/path";
import { project, runCli } from "./support/fixture.ts";
import { assertEquals } from "./support/assert.ts";

Deno.test("the CLI writes composed documents and the register", async () => {
  const root = project({
    docs: {
      ISMS01: {
        title: "First Policy",
        body: "<!-- isms:begin id=scope -->\nbase\n<!-- isms:end id=scope -->",
      },
    },
  });
  const { code, stdout, stderr } = await runCli(root);
  assertEquals(code, 0, `CLI failed:\n${stdout}\n${stderr}`);
  Deno.statSync(join(root, "docs", "ISMS01-first-policy.qmd"));
  Deno.statSync(join(root, "deviations.qmd"));
});
