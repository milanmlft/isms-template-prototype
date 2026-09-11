// Block parsing, hashing and emission.
//
// A block is a NAMED TEXT RANGE in a source file, carrying attributes, forming a tree.
//
// Delimiters are line-anchored HTML comments. They are invisible in every output format,
// and harmless if they reach Quarto (they become RawBlock html, dropped in PDF/docx), so a
// baseline document still renders standalone for the policy author who owns it.

export type BlockAttrs = Record<string, string>;

export interface Segment {
  kind: "text" | "block";
  text?: string; // kind === "text"
  block?: Block; // kind === "block"
}

export interface Block {
  id: string;
  attrs: BlockAttrs;
  /** Exact source text between the begin and end delimiters, children's delimiters included. */
  innerRaw: string;
  segments: Segment[];
  /** 1-based line of the begin delimiter, for error messages. */
  line: number;
}

export interface ParsedDoc {
  frontMatter: string; // raw YAML text, without the --- fences ("" if none)
  /** Synthetic root: `segments` interleaves top-level text and top-level blocks. */
  root: Block;
  /** Every block in the document, keyed by id, in document order. */
  blocks: Map<string, Block>;
}

export class ParseError extends Error {
  constructor(file: string, line: number, msg: string) {
    super(`${file}:${line}: ${msg}`);
  }
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;

// Closed attribute sets. Names not yet enforced are still accepted so that a newer
// baseline does not fail to parse under an older CLI.
const ATTRS_BEGIN = new Set(["id", "hint", "locked", "required", "optional", "recommended", "control"]);
const ATTRS_OVERRIDE = new Set(["id", "mode", "reason", "approved-by", "approved-date"]);
const ATTRS_END = new Set(["id"]);

export const OVERRIDE_MODES = ["replace", "before", "after", "delete"] as const;
export type OverrideMode = (typeof OVERRIDE_MODES)[number];

interface Delimiter {
  kind: "begin" | "end" | "override";
  attrs: BlockAttrs;
  line: number; // 1-based, of the first line of the delimiter
  endLine: number; // 1-based, of the line carrying `-->`
}

/** Split leading YAML front matter from the body. */
function splitFrontMatter(src: string): { frontMatter: string; body: string; bodyStartLine: number } {
  const lines = src.split("\n");
  if (lines[0]?.trim() !== "---") return { frontMatter: "", body: src, bodyStartLine: 1 };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      return {
        frontMatter: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n"),
        bodyStartLine: i + 2,
      };
    }
  }
  return { frontMatter: "", body: src, bodyStartLine: 1 };
}

function parseAttrs(file: string, line: number, raw: string, allowed: Set<string>): BlockAttrs {
  const attrs: BlockAttrs = {};
  // key="quoted value" | key=bare-value
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|(\S+))/g;
  let consumed = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1];
    if (!allowed.has(key)) {
      throw new ParseError(
        file,
        line,
        `unknown attribute "${key}". Allowed here: ${[...allowed].sort().join(", ")}`,
      );
    }
    if (key in attrs) throw new ParseError(file, line, `duplicate attribute "${key}"`);
    attrs[key] = m[2] !== undefined ? m[2] : m[3];
    consumed += m[0];
  }
  // Catch `mode replace` (missing =) and other stray tokens rather than ignoring them.
  const leftover = raw.replace(re, "").trim();
  if (leftover.length > 0) {
    throw new ParseError(file, line, `could not parse attributes near "${leftover}" (expected key=value)`);
  }
  if (consumed.length === 0 && raw.trim().length > 0) {
    throw new ParseError(file, line, `could not parse attributes: "${raw.trim()}"`);
  }
  return attrs;
}

/** Scan lines for isms delimiters, skipping fenced code blocks so that a delimiter-looking */
function scanDelimiters(file: string, lines: string[], lineOffset: number): Delimiter[] {
  const found: Delimiter[] = [];
  let fence: { char: string; len: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + lineOffset;

    // Fence tracking: opening/closing fence indented at most 3 spaces.
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

    const open = line.match(/^<!--\s+isms:(begin|end|override)\b(.*)$/);
    if (!open) {
      // A stray `isms:` marker that is not column-anchored is almost always a mistake.
      if (/<!--\s*isms:(begin|end|override)\b/.test(line)) {
        throw new ParseError(
          file,
          lineNo,
          `isms delimiter must start at column 0 with exactly "<!-- isms:..."`,
        );
      }
      continue;
    }

    const kind = open[1] as Delimiter["kind"];
    let rest = open[2];
    let j = i;
    // Attributes may wrap across lines; consume until the line carrying `-->`.
    while (!rest.includes("-->")) {
      j++;
      if (j >= lines.length) throw new ParseError(file, lineNo, `unterminated delimiter: no "-->" found`);
      rest += "\n" + lines[j];
    }
    const closeIdx = rest.indexOf("-->");
    const trailing = rest.slice(closeIdx + 3).trim();
    if (trailing.length > 0) {
      throw new ParseError(file, lineNo + (j - i), `nothing may follow "-->" on a delimiter line`);
    }
    const attrs = parseAttrs(file, lineNo, rest.slice(0, closeIdx), {
      begin: ATTRS_BEGIN,
      end: ATTRS_END,
      override: ATTRS_OVERRIDE,
    }[kind]);

    if (!attrs.id) throw new ParseError(file, lineNo, `isms:${kind} requires an id attribute`);
    if (!ID_RE.test(attrs.id)) {
      throw new ParseError(
        file,
        lineNo,
        `invalid block id "${attrs.id}". Ids must be semantic and kebab-case, dot-separated ` +
        `for nesting (e.g. user-access.approval-chain) — never positional like "s05".`,
      );
    }
    found.push({ kind, attrs, line: lineNo, endLine: lineNo + (j - i) });
    i = j;
  }
  if (fence !== null) throw new ParseError(file, lineOffset + lines.length - 1, `unclosed code fence`);
  return found;
}
/** Parse a baseline document into a block tree. */
export function parseDocument(file: string, src: string): ParsedDoc {
  const { frontMatter, body, bodyStartLine } = splitFrontMatter(src);
  const lines = body.split("\n");
  const delims = scanDelimiters(file, lines, bodyStartLine);

  const blocks = new Map<string, Block>();
  const root: Block = { id: "", attrs: {}, innerRaw: body, segments: [], line: 0 };
  const stack: Block[] = [root];
  // Index into `lines` (0-based) where the current run of plain text began.
  let textStart = 0;

  const lineIdx = (l: number) => l - bodyStartLine;

  const flushText = (upToLineIdx: number) => {
    if (upToLineIdx > textStart) {
      const text = lines.slice(textStart, upToLineIdx).join("\n");
      stack[stack.length - 1].segments.push({ kind: "text", text });
    }
  };

  for (const d of delims) {
    if (d.kind === "override") {
      throw new ParseError(file, d.line, `isms:override is only valid in an override file`);
    }
    if (d.kind === "begin") {
      flushText(lineIdx(d.line));
      const parent = stack[stack.length - 1];
      if (parent.id !== "" && !d.attrs.id.startsWith(parent.id + ".")) {
        throw new ParseError(
          file,
          d.line,
          `nested block "${d.attrs.id}" must be a dotted child of its parent "${parent.id}" ` +
          `(expected "${parent.id}.<name>")`,
        );
      }
      if (blocks.has(d.attrs.id)) {
        throw new ParseError(file, d.line, `duplicate block id "${d.attrs.id}"`);
      }
      const block: Block = {
        id: d.attrs.id,
        attrs: d.attrs,
        innerRaw: "",
        segments: [],
        line: d.line,
      };
      blocks.set(block.id, block);
      parent.segments.push({ kind: "block", block });
      stack.push(block);
      // Content starts on the line after the delimiter's closing `-->`.
      textStart = lineIdx(d.endLine) + 1;
      // Remember where content began so innerRaw can be sliced on `end`.
      (block as Block & { _contentStart?: number })._contentStart = textStart;
    } else {
      const open = stack[stack.length - 1];
      if (!open || open.id === "") {
        throw new ParseError(file, d.line, `isms:end id=${d.attrs.id} with no matching isms:begin`);
      }
      if (open.id !== d.attrs.id) {
        throw new ParseError(
          file,
          d.line,
          `isms:end id=${d.attrs.id} does not close the open block "${open.id}" (opened at line ${open.line})`,
        );
      }
      // Flush BEFORE popping: this text belongs to the block being closed, not to its parent.
      flushText(lineIdx(d.line));
      stack.pop();
      const cs = (open as Block & { _contentStart?: number })._contentStart ?? 0;
      open.innerRaw = lines.slice(cs, lineIdx(d.line)).join("\n");
      textStart = lineIdx(d.endLine) + 1;
    }
  }
  if (stack.length !== 1) {
    const open = stack[stack.length - 1];
    throw new ParseError(file, open.line, `block "${open.id}" is never closed`);
  }
  flushText(lines.length);
  return { frontMatter, root, blocks };
}

export interface OverrideOp {
  id: string;
  mode: OverrideMode;
  text: string;
  reason?: string;
  approvedBy?: string;
  approvedDate?: string;
  line: number;
}

/**
 * Parse an institution override file. Same grammar, `isms:override` instead of `isms:begin`.
 *
 * The front matter comes back as raw YAML text, exactly as `parseDocument` returns the
 * baseline's: this module owns the block grammar and nothing else, so what the keys *mean* —
 * `document:`, the front-matter overrides, which keys are protected — is `compose.ts`'s business.
 */
export function parseOverrides(file: string, src: string): { frontMatter: string; ops: Map<string, OverrideOp> } {
  const { frontMatter, body, bodyStartLine } = splitFrontMatter(src);
  const lines = body.split("\n");
  const delims = scanDelimiters(file, lines, bodyStartLine);
  const ops = new Map<string, OverrideOp>();

  let i = 0;
  while (i < delims.length) {
    const d = delims[i];
    if (d.kind !== "override") {
      throw new ParseError(file, d.line, `expected isms:override, found isms:${d.kind}`);
    }
    const close = delims[i + 1];
    if (!close || close.kind !== "end" || close.attrs.id !== d.attrs.id) {
      throw new ParseError(
        file,
        d.line,
        `override "${d.attrs.id}" must be closed by <!-- isms:end id=${d.attrs.id} -->`,
      );
    }
    const mode = (d.attrs.mode ?? "replace") as OverrideMode;
    if (!OVERRIDE_MODES.includes(mode)) {
      throw new ParseError(file, d.line, `unknown mode "${mode}". Use one of: ${OVERRIDE_MODES.join(", ")}`);
    }
    const text = lines.slice(d.endLine - bodyStartLine + 1, close.line - bodyStartLine).join("\n");
    if (mode === "delete" && text.trim() !== "") {
      throw new ParseError(file, d.line, `mode=delete must have an empty body`);
    }
    if (ops.has(d.attrs.id)) throw new ParseError(file, d.line, `duplicate override for "${d.attrs.id}"`);
    ops.set(d.attrs.id, {
      id: d.attrs.id,
      mode,
      text,
      reason: d.attrs.reason,
      approvedBy: d.attrs["approved-by"],
      approvedDate: d.attrs["approved-date"],
      line: d.line,
    });
    i += 2;
  }
  return { frontMatter, ops };
}

function trimBlankLines(s: string): string {
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/** True when `ancestor` is a strict dotted ancestor of `id`. */
export function isAncestor(ancestor: string, id: string): boolean {
  return id.startsWith(ancestor + ".");
}

/**
 * Render a block tree to markdown with overrides applied.
 *
 * Text outside any block is emitted verbatim and is therefore NOT overridable — which is a
 * free governance primitive: to make something unchangeable, leave it unblocked.
 */
export function emit(node: Block, ops: Map<string, OverrideOp>, isRoot = false): string {
  const op = isRoot ? undefined : ops.get(node.id);

  const inner = () =>
    node.segments
      .map((s) => (s.kind === "text" ? s.text ?? "" : emit(s.block!, ops)))
      .join("\n");

  // Overridden content is emitted verbatim. Provenance comes from the marker comments below,
  // NOT from a visual wrapper.
  //
  // A `::: {.isms-local}` fenced div was tried and removed, because it cannot be applied to
  // indented content: with the fence at column 0 the surrounding list splits into three
  // sibling structures, and with the fence indented into a list continuation Pandoc stops
  // parsing it and the `:::` leaks into the output as literal text. Indented blocks are
  // exactly the ones worth marking — an approver list nested under a bullet is the canonical
  // thing an institution must change — so a wrapper that skips them is worse than none: a
  // reader who learns to trust the marker reads unmarked local content as baseline.
  const local = (op: OverrideOp) => trimBlankLines(op.text);

  let body: string;
  if (!op) body = inner();
  else if (op.mode === "replace") body = local(op);
  else if (op.mode === "delete") body = `<!-- isms:deleted id=${node.id} -->`;
  else if (op.mode === "before") body = `${local(op)}\n${inner()}`;
  else body = `${inner()}\n${local(op)}`;

  if (isRoot) return body;
  const src = op ? ` source=override mode=${op.mode}` : "";
  return `\n<!-- isms:block id=${node.id}${src} -->\n${body}\n<!-- /isms:block id=${node.id} -->\n`;
}

