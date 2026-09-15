// The deviations register.
//
// Composition applies an override and then remembers nothing about it but the fact that it
// happened. This is where the reason, the approver and the date someone signed off on become
// visible — and the only place a mode=delete appears at all, since a deleted block leaves
// nothing in the composed document but an HTML comment.

import { BLOCK_CLOSE_RE, BLOCK_OPEN_RE } from "./blocks.ts";
import type { Block, OverrideMode, OverrideOp } from "./blocks.ts";
import type { UnadoptedDoc } from "./adoption.ts";
// Type-only, so that the compose.ts <-> deviations.ts edge is erased at compile and the
// runtime module graph stays one-directional.
import type { ComposedDoc } from "./compose.ts";

/**
 * Written at the project root, beside index.qmd — deliberately not in `docs/`.
 *
 * The register is a report ABOUT the controlled documents, not one of them, and `docs/*.qmd`
 * is the sidebar's `auto:` glob, which would file it under "Controlled documents".
 */
export const DEVIATIONS_PATH = "deviations.qmd";

export interface Deviation {
  blockId: string;
  mode: OverrideMode;
  /**
   * Explicit `{#...}` anchor the block sits under IN THE COMPOSED OUTPUT. Absent when the
   * override replaced or deleted away every heading it could have landed under, in which case
   * there is genuinely nothing to link to.
   */
  anchor?: string;
  reason?: string;
  approvedBy?: string;
  approvedDate?: string;
  /** The institution's text — or, for mode=delete, the baseline text it removed. */
  text: string;
  /** 1-based line of the `isms:override` delimiter in the override file: the audit citation. */
  line: number;
}

interface ComposedIndex {
  /** 0-based line span of each block's emitted range, keyed by block id. */
  ranges: Map<string, { start: number; end: number }>;
  /** Explicit heading anchors, in document order. */
  anchors: { line: number; id: string }[];
}

// An ATX heading carrying an explicit Pandoc id: `## Document Scope {#sec-scope}`.
const HEADING_ANCHOR_RE = /^#{1,6}\s.*\{#([A-Za-z][\w:.-]*)[^}]*\}\s*$/;
const MARKER_RE = /^<!-- \/?isms:[a-z]+\b.*-->$/;

/**
 * Index the composed body's block markers and heading anchors in one pass.
 *
 * We read the OUTPUT rather than the baseline block tree because an anchor derived from the
 * baseline can name a heading the override just deleted. That link resolves to nothing: the
 * browser loads the page and stays at the top, so the reader concludes the section is there and
 * they mis-scrolled. A confidently wrong link in an audit artefact is worse than no link.
 * Anything found here is, by construction, in the page we point at.
 *
 * Fences are tracked on the same rule as the parser: `## Foo {#bar}` inside a code sample is
 * not a heading.
 */
function indexComposed(body: string): ComposedIndex {
  const ranges = new Map<string, { start: number; end: number }>();
  const anchors: { line: number; id: string }[] = [];
  const lines = body.split("\n");
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fm = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fm) {
      const char = fm[1][0];
      const len = fm[1].length;
      if (fence === null) {
        fence = { char, len };
        continue;
      } else if (char === fence.char && len >= fence.len && fm[2].trim() === "") {
        fence = null;
        continue;
      }
    }
    if (fence !== null) continue;

    const close = line.match(BLOCK_CLOSE_RE);
    if (close) {
      const range = ranges.get(close[1]);
      if (range) range.end = i;
      continue;
    }
    const open = line.match(BLOCK_OPEN_RE);
    if (open) {
      ranges.set(open[1], { start: i, end: lines.length - 1 });
      continue;
    }
    const heading = line.match(HEADING_ANCHOR_RE);
    if (heading) anchors.push({ line: i, id: heading[1] });
  }
  return { ranges, anchors };
}

/**
 * The anchor a register row should deep-link to.
 *
 * A block usually opens with its own heading, so the first anchor inside its range — and before
 * any nested child, whose heading belongs to the child — is the block's own section. Failing
 * that, walk the dotted ancestors: `user-access.approval-chain` has no heading of its own but
 * sits under `## User Access Management {#sec-user-access}`.
 *
 * The scan never crosses a range boundary. Nothing in the grammar requires a block to open with
 * a heading, so for a block that starts with prose the nearest preceding heading in the file at
 * large belongs to the PREVIOUS SIBLING section — plausible, adjacent and wrong.
 *
 * Only explicit `{#...}` anchors count. Quarto generates an identifier for a bare heading too,
 * but the slug for a heading containing `{{< var organisation >}}` is not predictable from the
 * source, and guessing brings the dead link back.
 */
function anchorFor(blockId: string, index: ComposedIndex): string | undefined {
  const own = index.ranges.get(blockId);
  // emit() wraps every non-root block, so a missing range means blocks.ts and this module have
  // drifted apart on the marker format — which would otherwise silently void every deep link.
  if (!own) {
    throw new Error(
      `no "<!-- isms:block id=${blockId} -->" marker in the composed output; emit() and the ` +
      `register's marker pattern have diverged`,
    );
  }

  let childStart = own.end;
  for (const [id, range] of index.ranges) {
    if (id.startsWith(blockId + ".") && range.start < childStart) childStart = range.start;
  }
  const ownAnchor = index.anchors.find((a) => a.line > own.start && a.line < childStart);
  if (ownAnchor) return ownAnchor.id;

  const parts = blockId.split(".");
  for (let n = parts.length - 1; n > 0; n--) {
    const ancestor = index.ranges.get(parts.slice(0, n).join("."));
    if (!ancestor) continue;
    const above = index.anchors.filter((a) => a.line > ancestor.start && a.line < own.start);
    if (above.length > 0) return above[above.length - 1].id;
  }
  return undefined;
}

/** Drop the isms marker comments from a raw block body. */
function stripMarkers(s: string): string {
  return s.split("\n").filter((l) => !MARKER_RE.test(l)).join("\n");
}

/** Strip blank leading/trailing lines and the common indentation. */
function dedent(s: string): string {
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const indents = lines.filter((l) => l.trim() !== "").map((l) => l.match(/^ */)![0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(common)).join("\n");
}

/**
 * Pair each override with the place it landed in the composed output.
 *
 * Ordered by BASELINE block order rather than the order the institution happened to write them
 * into the override file: the register should read in the same order as the document it
 * describes.
 */
export function collectDeviations(
  composedBody: string,
  ops: Map<string, OverrideOp>,
  baselineBlocks: Map<string, Block>,
): Deviation[] {
  if (ops.size === 0) return [];
  const index = indexComposed(composedBody);
  const deviations: Deviation[] = [];

  for (const [id, block] of baselineBlocks) {
    const op = ops.get(id);
    if (!op) continue;
    deviations.push({
      blockId: op.id,
      mode: op.mode,
      anchor: anchorFor(op.id, index),
      reason: op.reason,
      approvedBy: op.approvedBy,
      approvedDate: op.approvedDate,
      // A deletion has no local text. The baseline text it removed is the only content it has,
      // and this page is the only place that content will ever appear.
      text: dedent(op.mode === "delete" ? stripMarkers(block.innerRaw) : op.text),
      line: op.line,
    });
  }
  return deviations;
}

/**
 * Governance metadata that is missing rather than merely unremarkable.
 *
 * Not a composition error — an override may be mid-approval, and requiring the attributes would
 * break every existing override file that omits one — but it is precisely what the register
 * exists to expose, so the CLI names each gap with a file:line the author can go and fix.
 */
export function governanceWarnings(source: string, deviations: readonly Deviation[]): string[] {
  return deviations.flatMap((d) => governanceGaps(source, `override "${d.blockId}"`, d));
}

export type GovernanceAttr = "reason" | "approved-by" | "approved-date";

/**
 * `<source>:<line>: <subject> has no <attr>` for each governance attribute left blank.
 *
 * Shared by block overrides and by `_isms.yml` un-adoptions, so that the two cannot drift into
 * describing the same gap in different words. `attrs` differs between them: an un-adoption with
 * no reason is a hard error at load time, so only the approval fields can ever reach here.
 */
export function governanceGaps(
  source: string,
  subject: string,
  meta: { reason?: string; approvedBy?: string; approvedDate?: string },
  attrs: readonly GovernanceAttr[] = ["reason", "approved-by", "approved-date"],
): string[] {
  const values: Record<GovernanceAttr, string | undefined> = {
    "reason": meta.reason,
    "approved-by": meta.approvedBy,
    "approved-date": meta.approvedDate,
  };
  const gaps: string[] = [];
  for (const attr of attrs) {
    const value = values[attr];
    if (value === undefined || value.trim() === "") {
      gaps.push(`${source}: ${subject} has no ${attr}`);
    }
  }
  return gaps;
}

/** How a mode reads to someone auditing the register, rather than to the parser. */
const MODE_LABEL: Record<OverrideMode, string> = {
  replace: "Replaced",
  before: "Added before",
  after: "Added after",
  delete: "Removed",
};

/**
 * Make a value safe for a pipe-table cell.
 *
 * Only two things break a row: `|` ends a cell and a newline ends the row. A quoted attribute
 * value may legitimately wrap across lines, so flatten first. Nothing else is escaped —
 * emphasis, links and shortcodes in a reason should render.
 */
function flatten(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/**
 * Missing governance metadata is spelled out rather than dashed: all three attributes are
 * optional and unvalidated, and this is the only page where the gaps line up side by side.
 */
function cell(s: string | undefined): string {
  return s === undefined || s.trim() === "" ? "*(not recorded)*" : flatten(s);
}

/** Markdown links need forward slashes; `join()` yields `docs\...` on Windows. */
function href(path: string, anchor?: string): string {
  return path.replace(/\\/g, "/") + (anchor ? `#${anchor}` : "");
}

/** The shared slug rule for the register's own in-page anchors. */
function anchorSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function detailAnchor(ismsId: string, blockId: string): string {
  return anchorSlug(`dev-${ismsId}-${blockId}`);
}

/**
 * A namespace of its own, deliberately not `detailAnchor(id, "unadopted")`: a baseline document
 * that one day contains a block literally named `unadopted` would otherwise collide with a real
 * un-adoption entry. A distinct prefix makes that impossible by construction.
 */
export function unadoptedAnchor(ismsId: string): string {
  return anchorSlug(`unadopted-${ismsId}`);
}

function quote(s: string): string {
  return s.split("\n").map((l) => (l.trim() === "" ? ">" : `> ${l}`)).join("\n");
}

/**
 * Push a quoted block's headings below the detail section that contains them, and take away
 * their explicit anchors.
 *
 * A deleted block is quoted whole, headings included. Left alone, `## Physical Access
 * {#sec-physical-access}` would sit at the same level as the register's own `## Register`,
 * appear in the page TOC, and claim that id on this page rather than in the policy — a quote
 * would be posing as a section of the register.
 */
function demoteHeadings(text: string): string {
  return text.replace(
    /^(#{1,6})[ \t]+(.*?)(?:[ \t]*\{#[^}]*\})?[ \t]*$/gm,
    (_, hashes: string, title: string) => `${"#".repeat(Math.min(hashes.length + 3, 6))} ${title}`,
  );
}

/**
 * Point a quoted block's `#sec-...` links back at the document it was quoted from.
 *
 * Policy text cross-references sections by bare fragment, which resolves inside the composed
 * document and nowhere else. Reproduced verbatim here it would be a dead link on the very page
 * whose job is to be trustworthy.
 */
function rebaseAnchors(text: string, docPath: string): string {
  return text.replace(/\]\(#([A-Za-z][\w:.-]*)\)/g, (_, anchor) => `](${href(docPath, anchor)})`);
}

export interface RegisterInput {
  banner: string;
  baselineVersion: string;
  /**
   * Every document ID in `manifest.yml`, in manifest order — the Coverage roll-call.
   *
   * Passed in rather than derived: `docs` and `unadopted` are two ordered subsequences, and once
   * a document in the middle is missing they cannot be re-interleaved without the parent order.
   * Row-by-row correspondence with the manifest is the only thing that makes Coverage a roll-call
   * rather than a subset.
   */
  manifestOrder: readonly string[];
  docs: readonly ComposedDoc[];
  unadopted: readonly UnadoptedDoc[];
}

/**
 * Render the register page.
 *
 * Always rendered, even with nothing to report: the navbar href is static, so an absent file is
 * a dead link, and "no deviations" is itself the evidence an auditor wants — a missing page only
 * says that nobody generated one.
 *
 * EXACTLY ONE RETURN, at the end. Section emptiness is handled inside the section that is empty,
 * never by returning from the function. An early return here silently drops every section below
 * it — which is precisely how an un-adopted document would vanish from the one page whose job is
 * to show it, in the very state (no block deviations, one document dropped) that is most likely.
 *
 * Deliberately carries no generation timestamp. `writeAll` writes only when content differs, so
 * a clock value here means git churn and a changed Quarto input on every single render.
 * Provenance is the commit.
 */
export function renderRegister(input: RegisterInput): string {
  const { banner, baselineVersion, manifestOrder, docs, unadopted } = input;

  // `total` stays equal to the number of rows in the Register table: it is the number an auditor
  // verifies by counting. An un-adoption is a different unit and gets its own sentence.
  const total = docs.reduce((n, d) => n + d.deviations.length, 0);
  const changed = docs.filter((d) => d.deviations.length > 0).length;
  const composed = new Map(docs.map((d) => [d.ismsId, d]));
  const declined = new Map(unadopted.map((u) => [u.ismsId, u]));
  const plural = (n: number) => (n === 1 ? "" : "s");

  const out: string[] = [
    `---`,
    `title: "Deviations register"`,
    `---`,
    ``,
    banner,
    ``,
    `Every departure from the ISMS baseline (version \`${baselineVersion}\`) that ` +
    `{{< var organisation >}} has made is recorded here, with the reason given and the approval ` +
    `recorded at the time: whole documents not adopted, and individual blocks of text changed ` +
    `inside the documents that were. [Coverage](#coverage) lists every document the baseline ` +
    `ships, adopted or not; inside an adopted document, anything not listed here is baseline ` +
    `text, adopted unchanged.`,
    ``,
  ];

  if (docs.length > 0) {
    out.push(
      `**${total} deviation${plural(total)}** across ${changed} of ${docs.length} ` +
      `adopted document${plural(docs.length)}.`,
      ``,
    );
  }
  if (unadopted.length > 0) {
    out.push(
      docs.length === 0
        ? `**None of the ${manifestOrder.length} documents in baseline version ` +
        `\`${baselineVersion}\` is adopted.** Each is listed under ` +
        `[Documents not adopted](#not-adopted) with the reason recorded against it.`
        : `**${unadopted.length} of the ${manifestOrder.length} baseline documents ` +
        `${unadopted.length === 1 ? "is" : "are"} not adopted.** See ` +
        `[Documents not adopted](#not-adopted) for the reason recorded against ` +
        `${unadopted.length === 1 ? "it" : "each"}.`,
      ``,
    );
  }

  // Every section carries an explicit {#...} anchor: the verification pass accepts only explicit
  // ones, so an in-page link is legal only if the id is emitted here rather than left to Quarto.
  out.push(
    `## Coverage {#coverage}`,
    ``,
    `| Document | Status |`,
    `|----------|--------|`,
  );

  for (const id of manifestOrder) {
    const doc = composed.get(id);
    if (doc !== undefined) {
      const n = doc.deviations.length;
      const status = n === 0 ? "Adopted verbatim" : `${n} deviation${plural(n)}`;
      out.push(`| [${flatten(doc.title)}](${href(doc.path)}) | ${status} |`);
      continue;
    }
    const gone = declined.get(id);
    if (gone !== undefined) {
      // Plain text, not a link. There is no composed document to point at, and the baseline
      // source under `_extensions/` is not rendered by Quarto — a link to it would resolve on
      // disk, pass a naive check, and 404 in the published site.
      out.push(
        `| ${flatten(`${gone.ismsId} — ${gone.title}`)} | ` +
        `[Not adopted](#${unadoptedAnchor(gone.ismsId)}) |`,
      );
      continue;
    }
    throw new Error(
      `manifest document ${id} was neither composed nor recorded as un-adopted; the register ` +
      `cannot account for it, and an audit artefact that silently omits a baseline document is ` +
      `the failure this page exists to prevent`,
    );
  }

  if (unadopted.length > 0) {
    out.push(
      ``,
      `## Documents not adopted {#not-adopted}`,
      ``,
      `The baseline ships the documents below; {{< var organisation >}} has not adopted them. ` +
      `They are not composed into this ISMS and their text appears nowhere in it, so this is the ` +
      `only record that they exist and the only record of why they were left out.`,
      ``,
    );
    for (const u of unadopted) {
      out.push(
        `### ${u.ismsId} · ${flatten(u.title)} {#${unadoptedAnchor(u.ismsId)}}`,
        ``,
        `Not adopted · approved by ${cell(u.approvedBy)} on ${cell(u.approvedDate)}.`,
        `**Reason:** ${cell(u.reason)}`,
      );
    }
    out.push(`## Register {#register}`, ``);
  } else {
    out.push(``, `## Register {#register}`, ``);
  }

  if (total === 0) {
    out.push(`::: {.callout-note}`);
    if (docs.length === 0) {
      out.push(`No deviations: this ISMS adopts no baseline document.`);
    } else if (unadopted.length > 0) {
      out.push(
        `No deviations. Every adopted document is baseline text, unchanged. The documents this ` +
        `ISMS does not adopt are listed under [Documents not adopted](#not-adopted).`,
      );
    } else {
      out.push(`No deviations. Every adopted document is baseline text, unchanged.`);
    }
    out.push(`:::`, ``);
  } else {
    out.push(
      `| Document | Block | Change | Reason | Approved by | Approved | Source |`,
      `|----------|-------|--------|--------|-------------|----------|--------|`,
    );
    for (const doc of docs) {
      for (const d of doc.deviations) {
        out.push("| " + [
          `[${doc.ismsId}](${href(doc.path)})`,
          `[\`${d.blockId}\`](${href(doc.path, d.anchor)})`,
          `[${MODE_LABEL[d.mode]}](#${detailAnchor(doc.ismsId, d.blockId)})`,
          cell(d.reason),
          cell(d.approvedBy),
          cell(d.approvedDate),
          doc.overrideSource ? `\`${href(doc.overrideSource)}:${d.line}\`` : "",
        ].join(" | ") + " |");
      }
    }

    // Only when there is something to detail: an empty `## Detail` heading with nothing beneath
    // it reads as a page that failed to finish rendering.
    out.push(``, `## Detail {#detail}`, ``);
    for (const doc of docs) {
      for (const d of doc.deviations) {
        out.push(
          `### ${doc.ismsId} · \`${d.blockId}\` {#${detailAnchor(doc.ismsId, d.blockId)}}`,
          ``,
          `${MODE_LABEL[d.mode]} in [${flatten(doc.title)}](${href(doc.path, d.anchor)}) · ` +
          `approved by ${cell(d.approvedBy)} on ${cell(d.approvedDate)}.`,
          ``,
          `**Reason:** ${cell(d.reason)}`,
          ``,
          d.mode === "delete" ? `**Baseline text removed:**` : `**Local text:**`,
          ``,
          quote(demoteHeadings(rebaseAnchors(d.text, doc.path))),
          ``,
        );
      }
    }
  }

  return out.join("\n") + "\n";
}
