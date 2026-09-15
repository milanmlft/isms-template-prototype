//
// The deviations register: what it reports, where its deep links land, and what it refuses to do.
//
// Two of these cases have never been executed by anything in this repo: `mode=before` and
// `mode=delete` appear in the grammar, in `emit()` and in `MODE_LABEL`, but no override file in
// the demo project uses either, so "Added before", "Removed" and the delete branch that quotes the
// removed baseline text shipped unexercised.
//
import { composeIn, type FixtureSpec, project, SCOPE_BLOCK } from "./support/fixture.ts";
import { assertContains, assertEquals, assertMissing, assertThrowsWith } from "./support/assert.ts";
import {
  emit,
  type OverrideMode,
  parseDocument,
  parseOverrides,
} from "../_extensions/isms/cli/lib/blocks.ts";
import {
  collectDeviations,
  DEVIATIONS_PATH,
  type RegisterInput,
  renderRegister,
  unadoptedAnchor,
} from "../_extensions/isms/cli/lib/deviations.ts";

/** The register for a fixture, with `composeIn`'s structural invariants already run over it. */
async function registerFor(spec: FixtureSpec): Promise<string> {
  const result = await composeIn(project(spec));
  const register = result.files.get(DEVIATIONS_PATH);
  if (register === undefined) throw new Error(`no ${DEVIATIONS_PATH} in the composed file set`);
  return register;
}

/** `slug()` lowercases and hyphenates the MANIFEST title, so this is the path every link uses. */
const DOC_PATH = "docs/ISMS01-access-control.qmd";

/** A parent block with its own heading and a nested child, for the anchor-precedence cases. */
function accessDoc(childBody: string) {
  return {
    title: "Access Control",
    body: "<!-- isms:begin id=access -->\n" +
      "## Access {#sec-access}\n\n" +
      "Baseline intro.\n\n" +
      "<!-- isms:begin id=access.chain -->\n" +
      childBody + "\n" +
      "<!-- isms:end id=access.chain -->\n" +
      "<!-- isms:end id=access -->",
  };
}



// --- Anchor precedence: the three-way rule -----------------------------------------------------
//
// `anchorFor()` is private and stays private. It is reached here through a real compose, and what
// is asserted is the link the register actually publishes.

Deno.test("a block deep-links to its own anchor, not to one belonging to a nested child", async () => {
  const register = await registerFor({
    docs: { ISMS01: accessDoc("### Chain {#sec-chain}\n\nBaseline chain.") },
    overrides: {
      ISMS01: "<!-- isms:override id=access mode=after reason=r -->\nLocal addition.\n" +
        "<!-- isms:end id=access -->",
    },
  });
  assertContains(register, `${DOC_PATH}#sec-access`);
  // The child's heading sits inside the child's range. Attributing it to the parent would land the
  // reader past the very text the row is about.
  assertMissing(register, "#sec-chain");
});

Deno.test("a block with no anchor of its own deep-links to its dotted ancestor's", async () => {
  const register = await registerFor({
    docs: { ISMS01: accessDoc("Prose only, with no heading of its own.") },
    overrides: {
      ISMS01: "<!-- isms:override id=access.chain mode=after reason=r -->\nLocal addition.\n" +
        "<!-- isms:end id=access.chain -->",
    },
  });
  assertContains(register, `${DOC_PATH}#sec-access`);
});

Deno.test("a block with no anchor anywhere above it gets no fragment at all", async () => {
  const register = await registerFor({
    docs: {
      ISMS01: {
        title: "Access Control",
        body: "<!-- isms:begin id=scope -->\nProse only, no heading anywhere in the document.\n" +
          "<!-- isms:end id=scope -->",
      },
    },
    overrides: {
      ISMS01: "<!-- isms:override id=scope mode=after reason=r -->\nLocal addition.\n" +
        "<!-- isms:end id=scope -->",
    },
  });
  assertContains(register, `](${DOC_PATH})`);
  // Guessing is what this rule refuses: Quarto's slug for a heading containing a `{{< var >}}`
  // shortcode is not predictable from the source, so only explicit `{#...}` anchors count.
  assertMissing(register, `${DOC_PATH}#`);
});

Deno.test("a replace that removes the heading does not leave the register citing the anchor it took away", async () => {
  const register = await registerFor({
    docs: {
      ISMS01: {
        title: "Access Control",
        body: "<!-- isms:begin id=scope -->\n## Scope {#sec-scope}\n\nBaseline scope.\n" +
          "<!-- isms:end id=scope -->",
      },
    },
    overrides: {
      ISMS01: "<!-- isms:override id=scope mode=replace reason=r -->\nNo heading here.\n" +
        "<!-- isms:end id=scope -->",
    },
  });
  // The anchor is gone from the composed page. A link to it would leave the browser at the top of
  // the document and the reader concluding they mis-scrolled.
  assertMissing(register, "#sec-scope");
  assertContains(register, `](${DOC_PATH})`);
});

Deno.test("a block whose emitted marker range is missing is refused rather than silently unlinked", () => {
  const baseline = parseDocument(
    "mem://ISMS01.qmd",
    "---\nisms-id: ISMS01\n---\n\n<!-- isms:begin id=scope -->\nBaseline scope.\n" +
    "<!-- isms:end id=scope -->\n",
  );
  const { ops } = parseOverrides(
    "mem://_overrides/ISMS01.qmd",
    "<!-- isms:override id=scope mode=replace reason=r -->\nLocal.\n<!-- isms:end id=scope -->\n",
  );
  const body = emit(baseline.root, ops, true);
  // Exactly the drift the throw exists to catch: `emit()` and the register disagreeing about the
  // marker format would otherwise void every deep link on the page without a word.
  const stripped = body.split("\n").filter((l) => !l.startsWith("<!-- isms:block")).join("\n");

  assertThrowsWith(() => collectDeviations(stripped, ops, baseline.blocks), "scope", "isms:block");
});

// --- All four override modes -------------------------------------------------------------------

// Typed against the CLI's own OverrideMode rather than spelled freely, so a fifth mode added to
// OVERRIDE_MODES is a COMPILE error here — `deno test` type-checks, which is the whole reason
// _tests/run.ts exists — rather than a silent coverage hole where the loop keeps covering four.
// The label strings stay written out: they are the published contract, and importing the register's
// own private MODE_LABEL would make the assertion tautological.
const MODE_LABEL: Record<OverrideMode, string> = {
  replace: "Replaced",
  before: "Added before",
  after: "Added after",
  delete: "Removed",
};

for (const [mode, label] of Object.entries(MODE_LABEL) as [OverrideMode, string][]) {
  Deno.test(`mode=${mode} is reported in the register under its own label`, async () => {
    const register = await registerFor({
      docs: {
        ISMS01: {
          title: "Access Control",
          body: "<!-- isms:begin id=scope -->\n## Scope {#sec-scope}\n\nBaseline scope text.\n" +
            "<!-- isms:end id=scope -->",
        },
      },
      overrides: {
        ISMS01: `<!-- isms:override id=scope mode=${mode} reason=r approved-by=A ` +
          `approved-date=2026-01-01 -->\n` +
          (mode === "delete" ? "" : "Local scope text.\n") +
          "<!-- isms:end id=scope -->",
      },
    });

    // The row's Change cell is the label linked to its detail section, so one assertion pins both.
    const detail = "#dev-isms01-scope";
    assertContains(register, `[${label}](${detail})`);
    assertContains(register, `### ISMS01 · \`scope\` {${detail}}`);
    assertContains(register, "**Reason:** r");
    assertContains(register, "approved by A on 2026-01-01");

    if (mode === "delete") {
      // A deletion leaves nothing in the composed document but an HTML comment, so this page is
      // the only place the removed baseline text will ever appear.
      assertContains(register, "**Baseline text removed:**");
      assertContains(register, "> Baseline scope text.");
      // Demoted and stripped of its anchor, so the quote cannot pose as a section of the register
      // or claim the policy's id on this page.
      assertContains(register, "> ##### Scope");
      assertMissing(register, "{#sec-scope}");
    } else {
      assertContains(register, "**Local text:**");
      assertContains(register, "> Local scope text.");
    }
  });
}

// --- Un-adopted documents ----------------------------------------------------------------------

Deno.test("an un-adopted document is visible in the register, not merely absent", async () => {
  const register = await registerFor({
    docs: {
      ISMS01: { title: "Access Control", body: "Adopted." },
      ISMS02: { title: "Physical Security", body: "Declined." },
    },
    adoption: "documents:\n  ISMS02:\n    adopted: false\n" +
      "    reason: covered by the central estates process\n" +
      "    approved-by: Information Governance Board\n    approved-date: 2026-03-01\n",
  });
  assertContains(register, `{#${unadoptedAnchor("ISMS02")}}`);
  assertContains(register, "covered by the central estates process");
  assertContains(register, "Information Governance Board");
  // Nothing was composed for it, so this entry is the entire audit record that it ever existed.
  assertContains(register, "Physical Security");
});

Deno.test("Coverage is a roll-call of every manifest document, in manifest order", async () => {
  const register = await registerFor({
    docs: {
      ISMS01: { title: "First", body: "a" },
      ISMS02: { title: "Second", body: "b" },
      ISMS03: { title: "Third", body: "c" },
    },
    adoption: "documents:\n  ISMS02:\n    adopted: false\n    reason: r\n",
  });
  // Two ordered subsequences cannot be re-interleaved once one is missing from the middle, which
  // is why `renderRegister` takes `manifestOrder` rather than deriving order from its two lists.
  const rows = register.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Document"));
  assertEquals(
    rows.slice(0, 3).map((r) => r.split("|")[1].trim()),
    ["[First](docs/ISMS01-first.qmd)", "ISMS02 — Second", "[Third](docs/ISMS03-third.qmd)"],
  );
});

Deno.test("the register never links to a path Quarto does not render", async () => {
  const register = await registerFor({
    docs: {
      ISMS01: {
        title: "Access Control",
        body: "<!-- isms:begin id=scope -->\n## Scope {#sec-scope}\n\nBaseline.\n" +
          "<!-- isms:end id=scope -->",
      },
      ISMS02: { title: "Physical Security", body: "Declined." },
    },
    overrides: {
      ISMS01: "<!-- isms:override id=scope mode=replace reason=r -->\n## Scope {#sec-scope}\n\n" +
        "Local, with a [cross-reference](#sec-scope).\n<!-- isms:end id=scope -->",
    },
    adoption: "documents:\n  ISMS02:\n    adopted: false\n    reason: r\n",
  });
  for (const m of register.matchAll(/\]\(([^)#\s]+)/g)) {
    const path = m[1];
    const ok = path === "index.qmd" || path === "deviations.qmd" || path.startsWith("docs/");
    if (!ok) throw new Error(`register links to ${path}, which Quarto does not render`);
  }
  // The un-adopted document's only source is under `_extensions/`, which Quarto does not render: a
  // link there resolves on disk, passes a naive existence check, and 404s in the published site.
  assertMissing(register, "](_extensions");
  // A quoted block's bare `#sec-...` links are rebased onto the document they were quoted from,
  // rather than reproduced as dead links on the page whose job is to be trustworthy.
  assertContains(register, `](${DOC_PATH}#sec-scope)`);
});

// --- renderRegister, called directly ------------------------------------------------------------
//
// `renderRegister` takes one plain data object and returns a string — no filesystem anywhere in its
// reach — so these cases need no fixture at all. `register()` supplies only the fields every call
// would otherwise repeat; each test overrides what it is actually about.

const FIRST_DOC = { ismsId: "ISMS01", title: "First", path: "docs/ISMS01-first.qmd", deviations: [] };

function register(over: Partial<RegisterInput>): string {
  return renderRegister({
    banner: "<!-- DO NOT EDIT BY HAND -->",
    baselineVersion: "9.9.9",
    manifestOrder: ["ISMS01"],
    docs: [FIRST_DOC],
    unadopted: [],
    ...over,
  });
}

Deno.test("a manifest document that is neither composed nor un-adopted is refused", () => {
  assertThrowsWith(
    () =>
      register({ manifestOrder: ["ISMS01", "ISMS02"] }),
    "ISMS02",
  );
});

Deno.test("the empty state still renders every section", async () => {
  // A no-deviation project still gets a generated register page.
  const noDevs = await registerFor({ docs: { ISMS01: SCOPE_BLOCK } });
  assertContains(noDevs, "Coverage");
  
  // `renderRegister` has exactly one return: the old `total === 0` early return sat mid-page and
  // silently dropped every section below it.
  const out = register({});
  assertContains(out, "{#coverage}");
  assertContains(out, "{#register}");
});

Deno.test("an un-adopted document still gets its section when there are no block deviations", () => {
  const out = register({
    manifestOrder: ["ISMS01", "ISMS02"],
    unadopted: [{ ismsId: "ISMS02", title: "Second", reason: "r", approvedBy: "A" }],
  });
  // The state an early return would have hidden: nothing overridden, one document dropped.
  assertContains(out, "{#not-adopted}");
  assertContains(out, `{#${unadoptedAnchor("ISMS02")}}`);
  assertContains(out, "{#register}");
  // Unrecorded governance metadata is spelled out rather than dashed: this is the only page where
  // the gaps line up side by side.
  assertContains(out, "*(not recorded)*");
});
