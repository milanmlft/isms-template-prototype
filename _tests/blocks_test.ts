//
// The block grammar: every rule the parser enforces, and every input it refuses.
//
// Grown in Task 3 of _dev/tests-and-ci-plan.md.
//
import { parseDocument } from "../_extensions/isms/cli/lib/blocks.ts";
import { assertEquals } from "./support/assert.ts";

Deno.test("parseDocument records a block by its id", () => {
  const doc = parseDocument(
    "mem://x.qmd",
    "---\ntitle: x\n---\n<!-- isms:begin id=scope -->\nhi\n<!-- isms:end id=scope -->\n",
  );
  assertEquals([...doc.blocks.keys()], ["scope"]);
});
