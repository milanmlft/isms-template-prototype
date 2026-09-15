// Which baseline documents this institution adopts.
//
// The baseline manifest is authoritative on which documents EXIST; `_isms.yml` at the project root
// is the institution's account of which of them it publishes. Documents are opt-out: a document
// with no entry is adopted. That way a document added by a future baseline arrives adopted on
// `quarto update`, rather than silently vanishing from an ISMS whose author never knew it had been
// written.

import { parse as parseYaml } from "stdlib/yaml";
import { join } from "stdlib/path";
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
    throw new Error(`${path}: not valid YAML: ${(err as Error).message}`);
  }
  if (!isMapping(parsed)) {
    throw new Error(`${path}: the file must be a mapping of keys to values, not ${describe(parsed)}`);
  }

  for (const key of Object.keys(parsed)) {
    if (TOP_KEYS.includes(key)) continue;
    throw new Error(
      `${path}: unknown key "${key}". Allowed here: ${TOP_KEYS.join(", ")}`,
    );
  }

  const raw = parsed.documents;
  if (raw === undefined || raw === null) return empty;
  if (!isMapping(raw)) {
    throw new Error(
      `${path}: \`documents:\` must be a mapping of ISMS IDs to their adoption status, not ` +
      `${describe(raw)}. Write \`ISMS08:\` with \`adopted: false\` beneath it, not \`- ISMS08\`.`,
    );
  }

  const specs = new Map(manifest.documents.map((d) => [d.id, d]));
  const declined = new Map<string, Omit<UnadoptedDoc, "ismsId" | "title" | "baselineSource">>();

  // Iterate the FILE's keys, not the manifest's: an ID that is in neither is the typo this loop
  // exists to catch, and it can only be seen from this side.
  for (const [id, entry] of Object.entries(raw)) {

    if (!specs.has(id)) {
      // A typo here would silently ADOPT a document the institution believes it dropped. The same
      // reasoning as an override targeting a block ID that does not exist.
      throw new Error(
        `${path}: no document "${id}" in baseline ${manifest.baseline_version}. It may have been renamed ` +
        `or removed by a baseline update, in which case delete this entry. ` +
        `Baseline documents: ${[...specs.keys()].join(", ")}`,
      );
    }
    if (!isMapping(entry)) {
      throw new Error(
        `${path}: \`documents.${id}\` must be a mapping, not ${describe(entry)}. ` +
        `Write \`adopted: false\` beneath it, with a \`reason:\`.`,
      );
    }
    for (const key of Object.keys(entry)) {
      if (DOC_KEYS.includes(key)) continue;
      throw new Error(
        `${path}: unknown key "${key}" under \`documents.${id}\`. Allowed here: ${DOC_KEYS.join(", ")}`,
      );
    }

    const adopted = entry.adopted;
    if (adopted === undefined) {
      throw new Error(
        `${path}: \`documents.${id}\` has no \`adopted:\` key. Write \`adopted: false\` to un-adopt this ` +
        `document; a document with no entry in ${rel} is adopted.`,
      );
    }
    if (typeof adopted !== "boolean") {
      throw new Error(
        `${path}: \`documents.${id}.adopted\` must be \`true\` or \`false\`, not ${describe(adopted)}`,
      );
    }
    if (adopted) continue;

    const reason = attrText(path, ["documents", id, "reason"], entry.reason);
    if (reason === undefined || reason.trim() === "") {
      throw new Error(
        `${path}: \`documents.${id}\` un-adopts ${id} but gives no \`reason:\`.`
      );
    }

    declined.set(id, {
      reason,
      approvedBy: attrText(path, ["documents", id, "approved-by"], entry["approved-by"]),
      approvedDate: attrText(path, ["documents", id, "approved-date"], entry["approved-date"]),
    });
  }

  if (manifest.documents.length > 0 && declined.size === manifest.documents.length) {
    // Not a policy judgement: Quarto crashes in sidebarItemsFromAuto when the sidebar's
    // `auto: "docs/*.qmd"` glob matches nothing, so a site with no controlled documents cannot
    // be rendered at all. Better to say so here than to hand over a Quarto stack trace.
    throw new Error(
      `${path}: every document in baseline ${manifest.baseline_version} is un-adopted ` +
      `(${[...specs.keys()].join(", ")}), leaving no controlled documents to publish. Quarto ` +
      `needs at least one document to render`,
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
      ...entry,
    };
    unadopted.set(spec.id, doc);
    warnings.push(
      ...governanceGaps(rel, `un-adoption of ${spec.id}`, doc, [
        "approved-by",
        "approved-date",
      ]),
    );
  }
  return { unadopted, warnings };
}

/**
 * Read a governance attribute as text.
 */
function attrText(
  path: string,
  keyPath: readonly string[],
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value;
  throw new Error(
    `${path}: \`${keyPath.join(".")}\` must be text, not ${describe(value)}.`,
  );
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
