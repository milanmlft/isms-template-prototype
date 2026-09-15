//
// The `--tree` tier: this repo's own composed output on disk, against the composer that should
// have produced it.
//
// Everything above this file builds fixtures and asks "does the CLI behave?". This tier asks a
// different question — "does what is actually checked in and rendered agree with the code?" — and
// the two are not substitutes. A fixture cannot notice that someone hand-edited `docs/`, forgot to
// render, or dropped a document from the manifest without pruning its output.
//
// Transplanted from the standing verification pass that used to live, untracked, at
// `.pi/skills/isms-verify/scripts/check.ts`.
//
import { basename, join, SEPARATOR } from "stdlib/path";
import { equals } from "stdlib/bytes";
import { parse as parseYaml } from "stdlib/yaml";
import { loadProject } from "../_extensions/isms/cli/lib/project.ts";
import {
  compose,
  COMPOSED_DIR,
  OVERRIDES_DIR,
} from "../_extensions/isms/cli/lib/compose.ts";
import { parseDocument } from "../_extensions/isms/cli/lib/blocks.ts";
import {
  DEVIATIONS_PATH,
  unadoptedAnchor,
} from "../_extensions/isms/cli/lib/deviations.ts";
import { ISMS_CONFIG_PATH } from "../_extensions/isms/cli/lib/adoption.ts";
import { assertWellFormed } from "./support/invariants.ts";
import { assertEquals } from "./support/assert.ts";

const project = loadProject();
const { root, baseline } = project;

/**
 * Refuse to run rather than pass vacuously.
 *
 * With no `docs/` there is nothing for this tier to disagree with, so every assertion below would
 * succeed by having no input — the same silent no-op the CLI treats as its worst outcome.
 */
function requireComposed(): void {
  try {
    Deno.statSync(join(root, COMPOSED_DIR));
  } catch {
    throw new Error(
      `${COMPOSED_DIR}/ does not exist — run \`quarto render\` before the --tree tier. This tier ` +
        `compares the composer against what is actually on disk; with nothing on disk it would ` +
        `pass by having nothing to disagree with.`,
    );
  }
}

function read(abs: string): string | null {
  try {
    return Deno.readTextFileSync(abs);
  } catch {
    return null;
  }
}

/** First line number where two texts diverge, for a diff hint that beats "differs". */
function firstDiffLine(a: string, b: string): number {
  const x = a.split("\n");
  const y = b.split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return i + 1;
  }
  return 0;
}

/** Fenced-code tracking on the parser's rule, so a delimiter in a code sample is not a delimiter. */
function withoutFencedCode(lines: string[]): (string | null)[] {
  const out: (string | null)[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    const fm = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fm) {
      const char = fm[1][0];
      const len = fm[1].length;
      if (fence === null) {
        fence = { char, len };
        out.push(null);
        continue;
      } else if (char === fence.char && len >= fence.len && fm[2].trim() === "") {
        fence = null;
        out.push(null);
        continue;
      }
    }
    out.push(fence === null ? line : null);
  }
  return out;
}

const result = await compose(project);

Deno.test("composed output on disk matches what the composer produces now", async (t) => {
  requireComposed();
  for (const [rel, expected] of result.files) {
    await t.step(rel, () => {
      const disk = read(join(root, rel));
      if (disk === null) throw new Error(`${rel} is missing on disk — run \`quarto render\``);
      if (disk !== expected) {
        throw new Error(
          `${rel} differs from freshly composed output at line ${firstDiffLine(disk, expected)} — ` +
            `either it was hand-edited, or the baseline/overrides changed since the last render ` +
            `(run \`quarto render\`)`,
        );
      }
    });
  }
});

Deno.test("every mirrored asset matches its source byte for byte", async (t) => {
  requireComposed();
  // A byte comparison, not a text one: an image missing from the composed tree is a broken figure
  // in a controlled document, not cosmetic drift.
  for (const [rel, asset] of result.assets) {
    await t.step(rel, () => {
      let disk: Uint8Array;
      try {
        disk = Deno.readFileSync(join(root, rel));
      } catch {
        throw new Error(`${rel} is missing on disk — run \`quarto render\``);
      }
      if (!equals(disk, Deno.readFileSync(asset.path))) {
        throw new Error(
          `${rel} differs from its ${asset.origin} source (${asset.path}) — run \`quarto render\``,
        );
      }
    });
  }
});

// A hidden path segment, tested by anchored regex rather than walkAssets()'s split-and-scan.
// Identical code cannot disagree with itself, so re-using that exact technique here would be blind
// to precisely the class of regression this check exists to catch — walkAssets() once tested only
// the file's own name instead of every segment, and a byte-identical copy of that mistake would
// have "independently" confirmed it. Anchored on SEPARATOR for the same reason walkAssets() splits
// on it rather than on `[\\/]`: a backslash is a legal POSIX filename character, and treating it as
// a segment boundary here too would misclassify a file whose name merely contains one.
const SEP_IN_REGEX = SEPARATOR === "\\" ? "\\\\" : SEPARATOR;
const HIDDEN_SEGMENT = new RegExp(`(^|${SEP_IN_REGEX})\\.`);

function walkForCheck(dir: string): { rel: string; hidden: boolean; symlink: boolean }[] {
  const out: { rel: string; hidden: boolean; symlink: boolean }[] = [];
  const walk = (abs: string, rel: string) => {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(abs)];
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return; // no _overrides/ is the normal case
      throw err;
    }
    for (const entry of entries) {
      const childRel = rel ? join(rel, entry.name) : entry.name;
      if (entry.isSymlink) {
        // Neither followed (matches followSymlinks:false) nor treated as a plain file.
        out.push({ rel: childRel, hidden: false, symlink: true });
      } else if (entry.isDirectory) {
        walk(join(abs, entry.name), childRel);
      } else if (!entry.name.toLowerCase().endsWith(".qmd")) {
        out.push({ rel: childRel, hidden: HIDDEN_SEGMENT.test(childRel), symlink: false });
      }
    }
  };
  walk(dir, "");
  return out;
}

Deno.test("hidden paths and symlinks are excluded from the asset set, everything else mirrored", async (t) => {
  for (
    const [label, assetRoot] of [
      [`baseline ${COMPOSED_DIR}/`, join(baseline.dir, COMPOSED_DIR)],
      [`institution ${OVERRIDES_DIR}/`, join(root, OVERRIDES_DIR)],
    ] as const
  ) {
    await t.step(label, () => {
      for (const { rel, hidden, symlink } of walkForCheck(assetRoot)) {
        const composedRel = join(COMPOSED_DIR, rel);
        const mirrored = result.assets.has(composedRel);
        if (hidden || symlink) {
          if (mirrored) {
            throw new Error(
              `${label}${rel} is ${symlink ? "a symlink" : "a dotfile, or inside one,"} but was ` +
                `mirrored to ${composedRel} anyway — the skip rule in walkAssets() regressed`,
            );
          }
        } else if (!mirrored) {
          throw new Error(
            `${label}${rel} should be mirrored to ${composedRel}, but is missing from the ` +
              `composed asset set`,
          );
        }
      }
    });
  }
});

Deno.test("nothing stale survives under docs/", () => {
  requireComposed();
  // Recurses, because assets bring subdirectories (docs/images/) into the generated tree, and a
  // stray one is as much a prune failure as a stray document.
  const sweep = (rel: string): void => {
    for (const entry of Deno.readDirSync(join(root, rel))) {
      const childRel = join(rel, entry.name);
      if (entry.isDirectory) {
        sweep(childRel);
      } else if (entry.isFile && !result.files.has(childRel) && !result.assets.has(childRel)) {
        throw new Error(
          `${childRel} is not in the current manifest result set — prune failed, or it is a ` +
            `stray file`,
        );
      }
    }
  };
  sweep(COMPOSED_DIR);
});

Deno.test("manifest blocks match the delimiters in the baseline sources", async (t) => {
  // The gap CLAUDE.md calls out: those lists are declarative only. They are also the published
  // override surface, so drift in either direction is a broken promise — a missing entry hides an
  // overridable block from every adopter, and a phantom entry invites an override that composition
  // will then reject.
  //
  // Never gated on adoption. `blocks:` is the published override API for EVERY adopter, so one
  // institution's decision not to adopt a document must not switch off validation of the shared
  // artefact — and in this repo, which is the baseline's own demo project, gating it would mean an
  // un-adopted document's block surface is verified nowhere at all.
  for (const spec of baseline.manifest.documents) {
    await t.step(spec.id, () => {
      const path = join(baseline.dir, spec.file);
      const src = read(path);
      if (src === null) {
        throw new Error(`${spec.id}: manifest names ${spec.file}, which does not exist`);
      }
      const actual = [...parseDocument(path, src).blocks.keys()];
      const declared = spec.blocks ?? [];
      const undeclared = actual.filter((id) => !declared.includes(id));
      const phantom = declared.filter((id) => !actual.includes(id));
      if (undeclared.length > 0) {
        throw new Error(
          `${spec.id}: blocks in the source but not published in manifest.yml: ` +
            `${undeclared.join(", ")}`,
        );
      }
      if (phantom.length > 0) {
        throw new Error(
          `${spec.id}: manifest.yml publishes blocks that no longer exist: ${phantom.join(", ")}`,
        );
      }
    });
  }
});

Deno.test("every manifest document is either composed or recorded as not adopted", () => {
  // The keystone. A document can leave the ISMS two ways — removed from the manifest by the
  // baseline, or declined by the institution — and only the second leaves a record. Everything
  // else in this file assumes this holds.
  const composedIds = new Set(result.docs.map((d) => d.ismsId));
  const unadopted = new Set(result.unadopted.map((u) => u.ismsId));
  for (const spec of baseline.manifest.documents) {
    if (composedIds.has(spec.id) || unadopted.has(spec.id)) continue;
    throw new Error(
      `${spec.id} is in manifest.yml but was neither composed nor recorded as not adopted — it ` +
        `has fallen out of the ISMS with no trace in ${COMPOSED_DIR}/ or in ${DEVIATIONS_PATH}`,
    );
  }
});

Deno.test("_isms.yml and the composer agree about what this ISMS adopts", () => {
  const composedIds = new Set(result.docs.map((d) => d.ismsId));
  const unadopted = new Set(result.unadopted.map((u) => u.ismsId));

  // Read the policy independently of the composer, so that the two can disagree. Plain YAML is not
  // the CLI's invention, so this is an independent derivation rather than a second copy of a
  // grammar — the rule about re-using the CLI's own modules is aimed at the block parser.
  const declared = new Set<string>();
  let config: string | null = null;
  try {
    config = Deno.readTextFileSync(join(root, ISMS_CONFIG_PATH));
  } catch (err) {
    // Absence is the normal case; anything else means this tier and composition disagree about a
    // file composition demonstrably managed to read.
    if (!(err instanceof Deno.errors.NotFound)) {
      throw new Error(`${ISMS_CONFIG_PATH}: could not read it (${(err as Error).message})`);
    }
  }
  if (config !== null) {
    const raw = (parseYaml(config || "{}") ?? {}) as Record<string, unknown>;
    const documents = raw.documents;
    if (documents !== null && typeof documents === "object" && !Array.isArray(documents)) {
      for (const [id, entry] of Object.entries(documents as Record<string, unknown>)) {
        const e = entry as Record<string, unknown> | null;
        if (e !== null && typeof e === "object" && e.adopted === false) declared.add(id);
      }
    }
  }

  // The complement of the keystone, and the direction a mutation actually reaches: a document in
  // BOTH lists means the policy was recorded but the skip never happened, so the register announces
  // a document as not adopted while the site goes on publishing it.
  for (const id of unadopted) {
    if (!composedIds.has(id)) continue;
    throw new Error(
      `${id} was composed into ${COMPOSED_DIR}/, but ${ISMS_CONFIG_PATH} declares it not adopted ` +
        `— the adoption policy is not reaching the document loop, and the register claims a ` +
        `document is absent while the site publishes it`,
    );
  }
  for (const id of declared) {
    if (unadopted.has(id)) continue;
    throw new Error(
      `${ISMS_CONFIG_PATH} declares ${id} not adopted, but compose() still lists it as an adopted ` +
        `document — the adoption policy is not reaching the document loop`,
    );
  }
  for (const id of unadopted) {
    if (declared.has(id)) continue;
    throw new Error(
      `compose() reports ${id} as not adopted, but ${ISMS_CONFIG_PATH} does not say so — the ` +
        `composer and the adoption policy disagree about which documents this ISMS adopts`,
    );
  }
});

Deno.test("no composed output survives for an un-adopted document", () => {
  requireComposed();
  // A prefix scan rather than a rebuilt slug: it also catches a file composed under an older title,
  // which a slug derived from today's manifest would walk straight past.
  let present: string[] = [];
  try {
    present = [...Deno.readDirSync(join(root, COMPOSED_DIR))]
      .filter((e) => e.isFile && e.name.endsWith(".qmd"))
      .map((e) => e.name);
  } catch { /* requireComposed already reported a missing docs/ */ }

  for (const u of result.unadopted) {
    for (const name of present.filter((n) => n.startsWith(`${u.ismsId}-`))) {
      throw new Error(
        `${COMPOSED_DIR}/${name} exists, but ${ISMS_CONFIG_PATH} declares ${u.ismsId} not ` +
          `adopted — run \`quarto render\`; if it persists, prune() in cli/isms.ts is not ` +
          `removing un-adopted documents`,
      );
    }
  }
});

Deno.test("composed documents on disk are well formed", async (t) => {
  requireComposed();
  // `_`-prefixed files are shared includes, not pages: docs/_preamble.qmd carries no banner of its
  // own and Quarto never renders it.
  for (const rel of result.files.keys()) {
    if (rel === DEVIATIONS_PATH || basename(rel).startsWith("_")) continue;
    await t.step(rel, () => {
      const content = read(join(root, rel));
      if (content === null) return; // already reported by the first test
      assertWellFormed(rel, content);
    });
  }
});

const HEADING_ANCHOR_RE = /^#{1,6}\s.*\{#([A-Za-z][\w:.-]*)[^}]*\}\s*$/;
const anchorCache = new Map<string, Set<string>>();

function anchorsOf(rel: string): Set<string> | null {
  const cached = anchorCache.get(rel);
  if (cached) return cached;
  const content = read(join(root, rel));
  if (content === null) return null;
  const ids = new Set<string>();
  for (const line of withoutFencedCode(content.split("\n"))) {
    if (line === null) continue;
    const heading = line.match(HEADING_ANCHOR_RE);
    if (heading) ids.add(heading[1]);
    // Fallback: any explicit id, so an anchor on a div or span is not a false failure.
    for (const m of line.matchAll(/\{#([A-Za-z][\w:.-]*)[^}]*\}/g)) ids.add(m[1]);
  }
  anchorCache.set(rel, ids);
  return ids;
}

Deno.test("every link in the deviations register resolves", () => {
  requireComposed();
  const register = read(join(root, DEVIATIONS_PATH));
  if (register === null) throw new Error(`${DEVIATIONS_PATH} is missing — run \`quarto render\``);

  const ownAnchors = anchorsOf(DEVIATIONS_PATH) ?? new Set<string>();
  let links = 0;
  for (const m of register.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    links++;
    if (target.startsWith("#")) {
      const id = target.slice(1);
      if (!ownAnchors.has(id)) {
        throw new Error(`${DEVIATIONS_PATH}: in-page link #${id} has no matching anchor`);
      }
      continue;
    }
    const [path, fragment] = target.split("#");
    // Quarto renders index.qmd, the register and docs/ — nothing else. A link to a baseline source
    // under _extensions/ resolves on disk, satisfies a naive existence check, and then 404s in the
    // published site. That is the trap an un-adopted document invites, since its text still exists
    // in the vendored baseline: cite it as inline code, never as a link.
    const renderable = path === "index.qmd" || path === DEVIATIONS_PATH ||
      path.startsWith(`${COMPOSED_DIR}/`);
    if (!renderable) {
      throw new Error(
        `${DEVIATIONS_PATH}: links to ${path}, which Quarto does not render — the register may ` +
          `only link to index.qmd or to files under ${COMPOSED_DIR}/; cite anything else as ` +
          `inline code, not as a link`,
      );
    }
    const ids = anchorsOf(path);
    if (ids === null) throw new Error(`${DEVIATIONS_PATH}: links to ${path}, which does not exist`);
    if (fragment !== undefined && !ids.has(fragment)) {
      throw new Error(`${DEVIATIONS_PATH}: ${path}#${fragment} — no such anchor in the composed document`);
    }
  }
  if (links === 0) throw new Error(`${DEVIATIONS_PATH} contains no links at all, which is suspicious`);
});

Deno.test("every un-adopted document is visible in the register", async (t) => {
  requireComposed();
  const register = read(join(root, DEVIATIONS_PATH))!;
  const ownAnchors = anchorsOf(DEVIATIONS_PATH) ?? new Set<string>();

  // An un-adopted document must be VISIBLE, not merely absent. That is the whole point of the
  // feature: a mode=delete was worse than absent because it left no trace in the output, and
  // dropping a document is that failure at document scale.
  for (const u of result.unadopted) {
    await t.step(u.ismsId, () => {
      const anchor = unadoptedAnchor(u.ismsId);
      if (!ownAnchors.has(anchor)) {
        throw new Error(
          `${DEVIATIONS_PATH}: ${u.ismsId} is not adopted, but the register has no #${anchor} ` +
            `section — an un-adopted document must be visible in the register, not merely absent`,
        );
      }
      // The un-adopted Coverage row deliberately carries NO document link — there is nothing to
      // link to — so this looks for the row's link to the section, not a link to a document.
      const inCoverage = register.split("\n").some(
        (l) => l.startsWith("| ") && l.includes(`(#${anchor})`),
      );
      if (!inCoverage) {
        throw new Error(
          `${DEVIATIONS_PATH}: the Coverage table has no row linking to #${anchor} — Coverage ` +
            `must list every document the baseline ships, adopted or not`,
        );
      }
      // Flattened the way the register flattens a table cell, so a reason written as a wrapped
      // YAML scalar still matches.
      const reason = u.reason.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
      if (reason !== "" && !register.includes(reason)) {
        throw new Error(
          `${DEVIATIONS_PATH}: the reason recorded for not adopting ${u.ismsId} does not appear ` +
            `in the register — it is the only justification an auditor has for the document's ` +
            `absence`,
        );
      }
    });
  }
});

Deno.test("this repo's own content has no governance gaps", () => {
  // INVERTED relative to the standing pass, which printed warnings and could never fail on them.
  // Asserting the demo content is clean means a missing `reason` / `approved-by` / `approved-date`
  // introduced into an override or into `_isms.yml` turns the suite red — which is the only way
  // this check can ever catch anything, since the fixtures assert the warnings FIRE and this
  // asserts the shipped content has none.
  assertEquals(result.warnings, [], `governance gaps in this repo's own content:\n  ${result.warnings.join("\n  ")}`);
});
