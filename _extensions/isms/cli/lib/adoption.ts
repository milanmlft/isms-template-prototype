// Which baseline documents this institution adopts.
//
// The baseline manifest is authoritative on which documents EXIST; `_isms.yml` at the project root
// is the institution's account of which of them it publishes. Documents are opt-out: a document
// with no entry is adopted. That way a document added by a future baseline arrives adopted on
// `quarto update`, rather than silently vanishing from an ISMS whose author never knew it had been
// written.

import { parse as parseYaml } from "stdlib/yaml";
import { join, relative } from "stdlib/path";
import { ParseError } from "./blocks.ts";
import type { Baseline } from "./project.ts";
import { governanceGaps } from "./deviations.ts";

/** Institution-level ISMS configuration. Root-level and underscore-prefixed, like `_quarto.yml`. */
export const ISMS_CONFIG_PATH = "_isms.yml";

const TOP_KEYS = ["documents"];
const DOC_KEYS = ["adopted", "approved-by", "approved-date", "reason"];

/**
 * A baseline document the institution has declined to adopt.
 *
 * `reason` is mandatory, unlike a block override's. A block override leaves its text in the
 * composed document, wrapped in a provenance marker; an un-adopted document leaves nothing
 * anywhere, so the register entry is the entire audit record of the decision.
 */
export interface UnadoptedDoc {
  ismsId: string;
  title: string;
  reason: string;
  approvedBy?: string;
  approvedDate?: string;
  /** `_isms.yml`, relative: the register cites it, and a rendered page must not leak a build path. */
  source: string;
  /** 1-based line of this document's key in `_isms.yml` — the audit citation. */
  line: number;
  /** Project-relative path of the baseline source, cited (never linked) in the register. */
  baselineSource: string;
}

export interface Adoption {
  /** Keyed by ISMS ID, built in MANIFEST order so the register reads in document order. */
  unadopted: Map<string, UnadoptedDoc>;
  /** Governance gaps worth naming. Not errors: composition still succeeded. */
  warnings: string[];
}

export function loadAdoption(root: string, baseline: Baseline): Adoption {
  const empty: Adoption = { unadopted: new Map(), warnings: [] };
  const manifest = baseline.manifest;
  const rel = ISMS_CONFIG_PATH;
  const path = join(root, rel);

  let src: string;
  try {
    src = Deno.readTextFileSync(path);
  } catch (err) {
    // No `_isms.yml` at all is the normal case: most institutions adopt the whole baseline.
    if (err instanceof Deno.errors.NotFound) return empty;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(src || "{}") ?? {};
  } catch (err) {
    throw new ParseError(path, 1, `not valid YAML: ${(err as Error).message}`);
  }
  if (!isMapping(parsed)) {
    throw new ParseError(
      path,
      1,
      `the file must be a mapping of keys to values, not ${describe(parsed)}`,
    );
  }

  for (const key of Object.keys(parsed)) {
    if (TOP_KEYS.includes(key)) continue;
    throw new ParseError(
      path,
      keyLine(src, [key]),
      `unknown key "${key}". Allowed here: ${TOP_KEYS.join(", ")}`,
    );
  }

  const raw = parsed.documents;
  if (raw === undefined || raw === null) return empty;
  if (!isMapping(raw)) {
    throw new ParseError(
      path,
      keyLine(src, ["documents"]),
      `\`documents:\` must be a mapping of ISMS IDs to their adoption status, not ` +
      `${describe(raw)}. Write \`ISMS08:\` with \`adopted: false\` beneath it, not \`- ISMS08\`.`,
    );
  }

  const specs = new Map(manifest.documents.map((d) => [d.id, d]));
  const declined = new Map<string, Omit<UnadoptedDoc, "ismsId" | "title" | "baselineSource">>();

  // Iterate the FILE's keys, not the manifest's: an ID that is in neither is the typo this loop
  // exists to catch, and it can only be seen from this side.
  for (const [id, entry] of Object.entries(raw)) {
    const at = (...tail: string[]) => keyLine(src, ["documents", id, ...tail]);

    if (!specs.has(id)) {
      // A typo here would silently ADOPT a document the institution believes it dropped. The same
      // reasoning as an override targeting a block ID that does not exist.
      throw new ParseError(
        path,
        at(),
        `no document "${id}" in baseline ${manifest.baseline_version}. It may have been renamed ` +
        `or removed by a baseline update, in which case delete this entry. ` +
        `Baseline documents: ${[...specs.keys()].join(", ")}`,
      );
    }
    if (!isMapping(entry)) {
      throw new ParseError(
        path,
        at(),
        `\`documents.${id}\` must be a mapping, not ${describe(entry)}. ` +
        `Write \`adopted: false\` beneath it, with a \`reason:\`.`,
      );
    }
    for (const key of Object.keys(entry)) {
      if (DOC_KEYS.includes(key)) continue;
      throw new ParseError(
        path,
        at(key),
        `unknown key "${key}" under \`documents.${id}\`. Allowed here: ${DOC_KEYS.join(", ")}`,
      );
    }

    const adopted = entry.adopted;
    if (adopted === undefined) {
      throw new ParseError(
        path,
        at(),
        `\`documents.${id}\` has no \`adopted:\` key. Write \`adopted: false\` to un-adopt this ` +
        `document; a document with no entry in ${rel} is adopted.`,
      );
    }
    if (typeof adopted !== "boolean") {
      // YAML 1.2 resolves only true/false, so `adopted: no` is the STRING "no" — truthy, and not
      // equal to false. Without this check the document would be silently adopted.
      const hint = typeof adopted === "string" && /^(yes|no|on|off)$/i.test(adopted)
        ? ` (YAML reads \`${adopted}\` here as the text "${adopted}", not as a boolean.)`
        : "";
      throw new ParseError(
        path,
        at("adopted"),
        `\`documents.${id}.adopted\` must be \`true\` or \`false\`, not ${describe(adopted)}.${hint}`,
      );
    }
    // Recording a reviewed decision to adopt is legitimate, and lets an institution turn a
    // document back on by changing one word rather than deleting a governed entry.
    if (adopted) continue;

    const reason = attrText(path, src, ["documents", id, "reason"], entry.reason);
    if (reason === undefined || reason.trim() === "") {
      throw new ParseError(
        path,
        at(),
        `\`documents.${id}\` un-adopts ${id} but gives no \`reason:\`. An un-adopted document ` +
        `leaves no trace in the composed site, so the deviations register is the only record ` +
        `of the decision.`,
      );
    }

    declined.set(id, {
      reason,
      approvedBy: attrText(path, src, ["documents", id, "approved-by"], entry["approved-by"]),
      approvedDate: attrText(path, src, ["documents", id, "approved-date"], entry["approved-date"]),
      source: rel,
      line: at(),
    });
  }

  if (manifest.documents.length > 0 && declined.size === manifest.documents.length) {
    // Not a policy judgement: Quarto crashes in sidebarItemsFromAuto when the sidebar's
    // `auto: "docs/*.qmd"` glob matches nothing, so a site with no controlled documents cannot
    // be rendered at all. Better to say so here than to hand over a Quarto stack trace.
    throw new ParseError(
      path,
      keyLine(src, ["documents"]),
      `every document in baseline ${manifest.baseline_version} is un-adopted ` +
      `(${[...specs.keys()].join(", ")}), leaving no controlled documents to publish. Quarto ` +
      `cannot build a site whose sidebar glob matches nothing, so an ISMS must adopt at least one.`,
    );
  }

  // Built by walking the MANIFEST, so Map insertion order is document order and the register
  // needs no sort of its own.
  const unadopted = new Map<string, UnadoptedDoc>();
  const warnings: string[] = [];
  for (const spec of manifest.documents) {
    const entry = declined.get(spec.id);
    if (entry === undefined) continue;
    const doc: UnadoptedDoc = {
      ismsId: spec.id,
      title: spec.title,
      baselineSource: relative(root, join(baseline.dir, spec.file)),
      ...entry,
    };
    unadopted.set(spec.id, doc);
    warnings.push(
      ...governanceGaps(rel, `un-adoption of ${spec.id}`, doc.line, doc, [
        "approved-by",
        "approved-date",
      ]),
    );
  }
  return { unadopted, warnings };
}

/**
 * Read a governance attribute as text.
 *
 * `approved-date: 2026-09-01` parses to a JS `Date` under YAML's default schema — exactly as it
 * does in override front matter — and would otherwise reach the register as a UTC timestamp.
 * Coerced by the same rule `normaliseDates()` uses. The format is not validated beyond that: the
 * override attribute is free text today, and making `_isms.yml` stricter would split one
 * governance convention into two.
 */
function attrText(
  path: string,
  src: string,
  keyPath: readonly string[],
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value;
  throw new ParseError(
    path,
    keyLine(src, keyPath),
    `\`${keyPath.join(".")}\` must be text, not ${describe(value)}.`,
  );
}

/**
 * 1-based line of a nested key path in `_isms.yml`, so an error points at the offending key.
 *
 * Falls back to the deepest step it could resolve, which is what a MISSING key wants: the path
 * `["documents", "ISMS08", "reason"]` on an entry with no `reason:` points at the `ISMS08:` line.
 * Indentation-aware, but not a YAML parser — flow style falls back the same way, as `metaLine()`
 * in compose.ts does for front matter. If a third caller ever appears, promote both into a
 * `lib/yaml-lines.ts` rather than growing a third copy.
 */
function keyLine(src: string, path: readonly string[]): number {
  const lines = src.split("\n");
  let found = 1;
  let from = 0;
  let parentIndent = -1;

  for (const step of path) {
    // Every key at one level shares one indent, and the first candidate below the parent fixes
    // it. Anything deeper is a nested mapping or the continuation of a block scalar — and
    // `reason:` is authored as a folded scalar in the shipped template, so a wrapped line that
    // happens to read "ISMS08: change management…" is the realistic case this guards against.
    // Without it that line is taken for the ISMS08 key, and the register cites another
    // document's prose as the provenance of an un-adoption.
    let childIndent = -1;
    let hit = -1;
    for (let i = from; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const indent = line.length - trimmed.length;
      // Dedenting to the parent's level or beyond means this key's subtree has ended.
      if (indent <= parentIndent) break;
      if (childIndent === -1) childIndent = indent;
      if (indent !== childIndent) continue;
      const m = trimmed.match(/^(['"]?)(.+?)\1\s*:(?:\s|$)/);
      if (m && m[2] === step) {
        hit = i;
        break;
      }
    }
    if (hit === -1) return found;
    found = hit + 1;
    from = hit + 1;
    parentIndent = lines[hit].length - lines[hit].trimStart().length;
  }
  return found;
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** How a wrong-typed value reads in an error message. */
function describe(v: unknown): string {
  if (Array.isArray(v)) return "a list";
  if (v === null) return "nothing";
  if (typeof v === "string") return `"${v}"`;
  if (v instanceof Date) return "a date";
  return `a ${typeof v}`;
}
