//
// The block grammar: every rule the parser enforces, and every input it refuses.
//
// Every refusal asserts the IDENTIFIER the message must name — the offending attribute, the ids
// that do exist, the modes that do — never the sentence around it, so the wording stays free to
// improve. blocks.ts touches no Deno API, so nothing here needs a fixture on disk: "mem://x.qmd"
// is a filename only because the errors quote one.
//
import {
  BLOCK_CLOSE_RE,
  BLOCK_OPEN_RE,
  emit,
  isAncestor,
  parseDocument,
  parseOverrides,
} from "../_extensions/isms/cli/lib/blocks.ts";
import { assertContains, assertEquals, assertMissing, assertThrowsWith } from "./support/assert.ts";

Deno.test("parseDocument records a block by its id", () => {
  const doc = parseDocument(
    "mem://x.qmd",
    "---\ntitle: x\n---\n<!-- isms:begin id=scope -->\nhi\n<!-- isms:end id=scope -->\n",
  );
  assertEquals([...doc.blocks.keys()], ["scope"]);
});

// ---------------------------------------------------------------------------
// Attributes: the sets are closed, so a typo is an error rather than a no-op.
// ---------------------------------------------------------------------------

Deno.test("an attribute outside the delimiter's closed set is refused, listing the ones it accepts", () => {
  const err = assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin id=x colour=red -->\nb\n<!-- isms:end id=x -->"),
    "colour",
  );
  // The message has to say what IS allowed, or an author cannot tell a typo from a missing feature.
  for (const allowed of ["control", "hint", "id", "locked", "optional", "recommended", "required"]) {
    assertContains(err.message, allowed);
  }
});

Deno.test("the same attribute given twice is refused", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin id=a id=b -->\nb\n<!-- isms:end id=a -->"),
    "duplicate",
    "id",
  );
});

Deno.test("an attribute written without its `=` is refused rather than ignored", () => {
  assertThrowsWith(
    () =>
      parseOverrides(
        "mem://o.qmd",
        "<!-- isms:override id=x mode replace -->\nlocal\n<!-- isms:end id=x -->",
      ),
    "mode replace",
    "key=value",
  );
});

// The plan pairs this trigger with the `could not parse attributes: "..."` throw, but that one is
// unreachable: it fires only when nothing matched key=value AND the leftover scan found nothing,
// and the leftover is exactly what did not match, so the earlier throw always wins first.
Deno.test("a delimiter carrying a token that is not an attribute is refused, quoting the token", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin ?? -->\nb\n<!-- isms:end id=x -->"),
    "??",
    "key=value",
  );
});

// ---------------------------------------------------------------------------
// Delimiter shape.
// ---------------------------------------------------------------------------

Deno.test("a delimiter not anchored at column 0 is an error, not an ordinary comment", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "text\n  <!-- isms:begin id=x -->\nb\n<!-- isms:end id=x -->"),
    "isms:",
    "column 0",
  );
});

Deno.test("a delimiter with no closing `-->` before end of file is refused", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin id=x\nstill going\n"),
    "unterminated",
  );
});

Deno.test("nothing may follow the closing `-->` on a delimiter line", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin id=x --> trailing\nb\n<!-- isms:end id=x -->"),
    "-->",
  );
});

Deno.test("a delimiter without an id is refused", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin -->\nb\n<!-- isms:end id=x -->"),
    "isms:begin",
    "id",
  );
});

Deno.test("an id that is not kebab-case is refused", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin id=Not_Kebab -->\nb\n<!-- isms:end id=Not_Kebab -->"),
    "Not_Kebab",
    // Ids are the override contract, so the message steers away from positional names as well.
    "s05",
  );
});

Deno.test("a code fence left open at end of file is refused", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "```\nnever closed\n"),
    "fence",
  );
});

// ---------------------------------------------------------------------------
// Tree structure, in a baseline document.
// ---------------------------------------------------------------------------

Deno.test("isms:override in a baseline document is refused", () => {
  assertThrowsWith(
    () =>
      parseDocument(
        "mem://x.qmd",
        "<!-- isms:override id=x mode=replace -->\nlocal\n<!-- isms:end id=x -->",
      ),
    "isms:override",
  );
});

Deno.test("a nested block whose id is not a dotted child of its parent is refused", () => {
  assertThrowsWith(
    () =>
      parseDocument(
        "mem://x.qmd",
        "<!-- isms:begin id=a -->\n<!-- isms:begin id=b -->\nx\n<!-- isms:end id=b -->\n<!-- isms:end id=a -->",
      ),
    '"b"',
    '"a"',
    "a.<name>",
  );
});

Deno.test("two blocks with the same id in one document are refused", () => {
  assertThrowsWith(
    () =>
      parseDocument(
        "mem://x.qmd",
        "<!-- isms:begin id=a -->\nx\n<!-- isms:end id=a -->\n<!-- isms:begin id=a -->\ny\n<!-- isms:end id=a -->",
      ),
    "duplicate",
    '"a"',
  );
});

Deno.test("isms:end with no block open is refused", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "prose\n<!-- isms:end id=a -->\n"),
    "a",
    "isms:begin",
  );
});

Deno.test("isms:end that does not close the open block is refused, naming both ids and the line it opened on", () => {
  const err = assertThrowsWith(
    () =>
      parseDocument(
        "mem://x.qmd",
        "---\ntitle: x\n---\n<!-- isms:begin id=a -->\nbody\n<!-- isms:end id=b -->",
      ),
    '"a"',
    "id=b",
  );
  // Line numbers count from the top of the FILE, front matter included, or the author cannot find
  // either delimiter in an editor.
  assertContains(err.message, "mem://x.qmd:6");
  assertContains(err.message, "line 4");
});

Deno.test("a block that is never closed is refused", () => {
  assertThrowsWith(
    () => parseDocument("mem://x.qmd", "<!-- isms:begin id=a -->\nbody with no end\n"),
    '"a"',
  );
});

// ---------------------------------------------------------------------------
// Override files.
// ---------------------------------------------------------------------------

Deno.test("isms:begin in an override file is refused", () => {
  assertThrowsWith(
    () => parseOverrides("mem://o.qmd", "<!-- isms:begin id=x -->\nlocal\n<!-- isms:end id=x -->"),
    "isms:override",
    "isms:begin",
  );
});

Deno.test("an override closed by an end for a different id is refused", () => {
  assertThrowsWith(
    () => parseOverrides("mem://o.qmd", "<!-- isms:override id=a -->\nlocal\n<!-- isms:end id=b -->"),
    '"a"',
    "isms:end id=a",
  );
});

Deno.test("an unknown override mode is refused, listing the modes that exist", () => {
  assertThrowsWith(
    () =>
      parseOverrides(
        "mem://o.qmd",
        "<!-- isms:override id=x mode=sideways -->\nlocal\n<!-- isms:end id=x -->",
      ),
    "sideways",
    "replace, before, after, delete",
  );
});

Deno.test("mode=delete with a body is refused", () => {
  assertThrowsWith(
    () =>
      parseOverrides(
        "mem://o.qmd",
        "<!-- isms:override id=x mode=delete -->\nleftover text\n<!-- isms:end id=x -->",
      ),
    "delete",
  );
});

Deno.test("two overrides for the same block in one file are refused", () => {
  assertThrowsWith(
    () =>
      parseOverrides(
        "mem://o.qmd",
        "<!-- isms:override id=x -->\none\n<!-- isms:end id=x -->\n" +
          "<!-- isms:override id=x -->\ntwo\n<!-- isms:end id=x -->",
      ),
    "duplicate",
    '"x"',
  );
});

// ---------------------------------------------------------------------------
// What the grammar guarantees when it does parse.
// ---------------------------------------------------------------------------

Deno.test("text outside any block survives emit verbatim and is not overridable", () => {
  const doc = parseDocument(
    "mem://x.qmd",
    "intro prose\n<!-- isms:begin id=scope -->\nin\n<!-- isms:end id=scope -->\noutro prose\n",
  );
  assertEquals([...doc.blocks.keys()], ["scope"]);

  // An override naming the unblocked text cannot exist — there is no id to name — so the only way
  // to reach that prose is to edit the baseline. This is the "leave it unblocked to lock it" rule.
  const { ops } = parseOverrides(
    "mem://o.qmd",
    "<!-- isms:override id=scope -->\nlocal\n<!-- isms:end id=scope -->",
  );
  const out = emit(doc.root, ops, true);
  assertContains(out, "intro prose");
  assertContains(out, "outro prose");
  assertContains(out, "local");
  assertMissing(out, "\nin\n");
});

Deno.test("a delimiter inside a fenced code block is not a delimiter", () => {
  const doc = parseDocument(
    "mem://x.qmd",
    "```markdown\n<!-- isms:begin id=example -->\n```\n",
  );
  assertEquals([...doc.blocks.keys()], []);
});

Deno.test("isAncestor is dotted-prefix, not string-prefix", () => {
  assertEquals(isAncestor("user-access", "user-access.approval-chain"), true);
  assertEquals(isAncestor("user-access", "user-access-review"), false);
  // Strict: a block is not its own ancestor.
  assertEquals(isAncestor("user-access", "user-access"), false);
});

Deno.test("emit marks an overridden block's provenance with source=override and the mode", () => {
  const doc = parseDocument("mem://x.qmd", "<!-- isms:begin id=scope -->\nbase\n<!-- isms:end id=scope -->");
  const { ops } = parseOverrides(
    "mem://o.qmd",
    "<!-- isms:override id=scope mode=replace reason=x -->\nlocal\n<!-- isms:end id=scope -->",
  );
  const out = emit(doc.root, ops, true);
  assertContains(out, "<!-- isms:block id=scope source=override mode=replace -->");
  assertContains(out, "local");
  assertMissing(out, "base");
});

Deno.test("a block adopted verbatim carries a marker with no source attribute", () => {
  const doc = parseDocument("mem://x.qmd", "<!-- isms:begin id=scope -->\nbase\n<!-- isms:end id=scope -->");
  const out = emit(doc.root, new Map(), true);
  assertContains(out, "<!-- isms:block id=scope -->");
  assertMissing(out, "source=");
});

Deno.test("before and after splice around the baseline, replace and delete stand in for it", () => {
  const src = "<!-- isms:begin id=scope -->\nbase\n<!-- isms:end id=scope -->";
  const bodyFor = (mode: string, text: string) => {
    const { ops } = parseOverrides(
      "mem://o.qmd",
      `<!-- isms:override id=scope mode=${mode} -->\n${text}\n<!-- isms:end id=scope -->`,
    );
    return emit(parseDocument("mem://x.qmd", src).root, ops, true)
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.startsWith("<!-- isms:block") && !l.startsWith("<!-- /isms:block"));
  };
  assertEquals(bodyFor("before", "local"), ["local", "base"]);
  assertEquals(bodyFor("after", "local"), ["base", "local"]);
  assertEquals(bodyFor("replace", "local"), ["local"]);
  // A deleted block still emits a marker: the composed document records that something was removed.
  assertEquals(bodyFor("delete", ""), ["<!-- isms:deleted id=scope -->"]);
});

Deno.test("the markers emit writes are the ones BLOCK_OPEN_RE and BLOCK_CLOSE_RE match", () => {
  // Two other modules re-read these markers — the deviations register resolves its deep links from
  // them, and throws rather than dropping a link when a range is missing — so a change to emit's
  // marker format that left the patterns behind would break them silently.
  const doc = parseDocument(
    "mem://x.qmd",
    "<!-- isms:begin id=a -->\nx\n<!-- isms:begin id=a.b -->\ny\n<!-- isms:end id=a.b -->\n<!-- isms:end id=a -->",
  );
  const { ops } = parseOverrides(
    "mem://o.qmd",
    "<!-- isms:override id=a.b mode=after -->\nlocal\n<!-- isms:end id=a.b -->",
  );
  const lines = emit(doc.root, ops, true).split("\n");
  const opened = lines.map((l) => l.match(BLOCK_OPEN_RE)?.[1]).filter((id) => id !== undefined);
  const closed = lines.map((l) => l.match(BLOCK_CLOSE_RE)?.[1]).filter((id) => id !== undefined);
  assertEquals(opened, ["a", "a.b"]);
  assertEquals(closed, ["a.b", "a"]);
});

Deno.test("front matter is returned as raw YAML without its fences", () => {
  const doc = parseDocument("mem://x.qmd", "---\nisms-id: ISMS03\ntitle: x\n---\nbody\n");
  assertEquals(doc.frontMatter, "isms-id: ISMS03\ntitle: x");
});
