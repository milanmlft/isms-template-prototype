#!/usr/bin/env python3
"""
ISMS markdown ingestion: turn a plain-markdown policy into a DRAFT block-tagged baseline .qmd.

This is a draft generator, not an autopilot. It does the deterministic, mechanical work — front
matter shell, `{{< include _preamble.qmd >}}`, per-heading isms:begin/end delimiters, {#sec-...}
anchors, a proposed semantic block id per heading, and the manifest.yml snippet — and it FLAGS
(never silently rewrites) phrases that look like institution specifics belonging in _variables.yml.

The decisions the tool cannot make well are left to a human review of the output:
  * the right GRANULARITY of blocks (this blocks per heading only);
  * whether each proposed id is genuinely SEMANTIC (a heading like "General" -> a weak id);
  * turning institution specifics into {{< var ... >}} (only candidates are flagged).

Standard library only. Run with the system Python 3, independently of the Quarto/Deno toolchain:

    python _ingest/ingest.py _ingest/input/ISMS05-foo.md --id ISMS05 --title "Foo Policy" [--dry-run] [--update-manifest]

Verify the result with the project's own oracle before committing:

    quarto run _tests/run.ts     # includes _tests/manifest_test.ts (block/manifest agreement)
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------------------
# Paths, resolved from this file so the script works from any working directory.
# --------------------------------------------------------------------------------------
INGEST_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = INGEST_DIR.parent
BASELINE_DOCS = PROJECT_ROOT / "_extensions" / "isms" / "docs"
MANIFEST_PATH = PROJECT_ROOT / "_extensions" / "isms" / "manifest.yml"
VARIABLES_PATH = PROJECT_ROOT / "_variables.yml"

# The id grammar the parser enforces (lib/blocks.ts ID_RE): kebab-case, dot-separated for nesting.
ID_SEGMENT_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# A heading line in markdown: leading #s, then text, with an optional trailing {#anchor}.
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*(\{#([^}]+)\})?\s*$")

# Fenced code block boundary (``` or ~~~), so we never treat a # inside code as a heading.
FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")


# --------------------------------------------------------------------------------------
# Slug / id helpers
# --------------------------------------------------------------------------------------
def slugify(text: str) -> str:
    """Kebab-case slug from heading text. Strips markdown emphasis and punctuation."""
    # Drop inline markdown emphasis / code markers and any shortcodes already present.
    text = re.sub(r"\{\{<.*?>\}\}", " ", text)  # existing {{< var ... >}}
    text = re.sub(r"[*_`]", "", text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text or "section"


def unique(candidate: str, taken: set[str]) -> str:
    """Ensure a slug is unique within the document by suffixing -2, -3, ... if needed."""
    if candidate not in taken:
        taken.add(candidate)
        return candidate
    n = 2
    while f"{candidate}-{n}" in taken:
        n += 1
    result = f"{candidate}-{n}"
    taken.add(result)
    return result


def weak_id(segment: str) -> bool:
    """A leaf id segment that is positional or too vague to be a good override contract."""
    if not ID_SEGMENT_RE.match(segment):
        return True
    weak_words = {"section", "general", "introduction", "intro", "misc", "other", "part"}
    if segment in weak_words:
        return True
    # Purely numeric or single-letter-plus-number, e.g. "s05", "5", "12".
    if re.fullmatch(r"[a-z]?\d+", segment):
        return True
    return False


# --------------------------------------------------------------------------------------
# Variable-candidate detection (FLAG only, never rewrite)
# --------------------------------------------------------------------------------------
def load_role_strings() -> list[tuple[str, str]]:
    """
    Read _variables.yml with a minimal parser and return (phrase, var-key) pairs whose phrases
    might appear verbatim in a source doc, e.g. ("Head of Research Data Governance", "roles.ig_lead").

    Deliberately a tiny hand-rolled reader rather than a YAML dep: the file is a flat map with one
    nested `roles:` block, and this script must run on a bare stdlib Python.
    """
    pairs: list[tuple[str, str]] = []
    if not VARIABLES_PATH.exists():
        return pairs
    section: str | None = None
    for raw in VARIABLES_PATH.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0 and line.endswith(":") and ":" not in line[:-1]:
            section = line[:-1]
            continue
        m = re.match(r'^([a-zA-Z0-9_]+):\s*"?(.*?)"?\s*$', line)
        if not m:
            continue
        key, value = m.group(1), m.group(2)
        if not value:
            continue
        full_key = f"{section}.{key}" if (indent > 0 and section) else key
        pairs.append((value, full_key))
    # Longest phrases first, so "Information Asset Owner" wins over "Information".
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    return pairs


def variable_flags(body: str, org_names: list[str]) -> list[str]:
    """Return human-readable notes about institution specifics that look like they need a var."""
    role_pairs = load_role_strings()
    notes: list[str] = []
    for phrase, key in role_pairs:
        if len(phrase) < 4:
            continue
        if re.search(r"\b" + re.escape(phrase) + r"\b", body):
            notes.append(f'  - "{phrase}" -> consider {{{{< var {key} >}}}}')
    for name in org_names:
        if re.search(r"\b" + re.escape(name) + r"\b", body):
            notes.append(f'  - "{name}" -> consider {{{{< var organisation >}}}}')
    return notes


# --------------------------------------------------------------------------------------
# Parsing the source into a heading tree
# --------------------------------------------------------------------------------------
@dataclass
class Section:
    level: int
    title: str
    anchor: str | None
    block_id: str
    lines: list[str] = field(default_factory=list)
    children: list["Section"] = field(default_factory=list)


@dataclass
class ParsedSource:
    front_matter: str  # raw YAML text if the source had a front matter block, else ""
    preamble_lines: list[str]  # content before the first heading
    sections: list[Section]  # top-level sections


def split_front_matter(text: str) -> tuple[str, str]:
    """Return (front_matter_yaml, body). Front matter is a leading --- ... --- block."""
    lines = text.split("\n")
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                return "\n".join(lines[1:i]), "\n".join(lines[i + 1 :])
    return "", text


def parse_source(text: str, doc_id: str) -> ParsedSource:
    front_matter, body = split_front_matter(text)
    lines = body.split("\n")

    preamble: list[str] = []
    roots: list[Section] = []
    # Stack of open sections by heading level.
    stack: list[Section] = []
    taken_slugs: set[str] = set()
    in_fence = False

    def attach(section: Section) -> None:
        # Pop sections at the same or deeper level, then attach under the current parent.
        while stack and stack[-1].level >= section.level:
            stack.pop()
        if stack:
            stack[-1].children.append(section)
        else:
            roots.append(section)
        stack.append(section)

    for line in lines:
        if FENCE_RE.match(line):
            in_fence = not in_fence
        m = None if in_fence else HEADING_RE.match(line)
        if m:
            hashes, title, _, explicit_anchor = m.groups()
            level = len(hashes)
            slug = slugify(title)
            # Build a semantic-ish id. Nested headings get a dotted child of their parent.
            parent = stack[-1] if stack and stack[-1].level < level else None
            # Find the nearest ancestor strictly shallower than this level for dotted nesting.
            ancestor = None
            for s in reversed(stack):
                if s.level < level:
                    ancestor = s
                    break
            leaf = unique(slug, taken_slugs)
            block_id = f"{ancestor.block_id}.{leaf}" if ancestor else leaf
            anchor = explicit_anchor or f"sec-{leaf}"
            section = Section(level=level, title=title, anchor=anchor, block_id=block_id)
            attach(section)
        elif stack:
            stack[-1].lines.append(line)
        else:
            preamble.append(line)

    return ParsedSource(front_matter=front_matter, preamble_lines=preamble, sections=roots)


# --------------------------------------------------------------------------------------
# Emitting the .qmd
# --------------------------------------------------------------------------------------
def collect_block_ids(sections: list[Section]) -> list[str]:
    ids: list[str] = []
    for s in sections:
        ids.append(s.block_id)
        ids.extend(collect_block_ids(s.children))
    return ids


def emit_section(s: Section, out: list[str]) -> None:
    hint = ' hint="TODO: describe what an adopter should customise here, or remove."'
    out.append(f"<!-- isms:begin id={s.block_id}{hint} -->")
    out.append("")
    hashes = "#" * s.level
    out.append(f"{hashes} {s.title} {{#{s.anchor}}}")
    # Body lines of this section (already excludes child headings).
    body = "\n".join(s.lines).strip("\n")
    if body.strip():
        out.append("")
        out.append(body.strip("\n"))
    # Children nested inside.
    for child in s.children:
        out.append("")
        emit_section(child, out)
    out.append("")
    out.append(f"<!-- isms:end id={s.block_id} -->")


def top_level_keys(front_matter: str) -> set[str]:
    """
    The top-level YAML keys present in a front-matter block. A light line scan, not a full YAML
    parse: a key is a `name:` at column 0 (indented lines belong to a nested mapping/sequence).
    Good enough to detect PRESENCE of the pipeline keys, which is all we add-or-skip on.
    """
    keys: set[str] = set()
    for line in front_matter.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0] in (" ", "\t", "-"):  # nested mapping value or sequence item
            continue
        m = re.match(r"^([A-Za-z0-9_-]+)\s*:", line)
        if m:
            keys.add(m.group(1))
    return keys


# Pipeline keys the composition machinery needs regardless of document content. The SOURCE value
# always wins: the script only fills a key the source omitted, and warns when it does.
PIPELINE_KEYS = ("isms-id", "title", "filename", "baseline-doc-version", "number-sections")


def build_front_matter(
    source_front_matter: str, doc_id: str, title: str, filename: str
) -> tuple[str, list[str]]:
    """
    Preserve the source front matter verbatim; append only the pipeline keys it is missing.

    Presentation keys (document-author, version, classification, review.*, approval.*, sources) are
    the document's own content and are read by docs/_preamble.qmd — they are never touched. Returns
    the assembled front-matter text and a list of warnings naming each key that was synthesised.
    """
    existing = top_level_keys(source_front_matter)
    warnings: list[str] = []
    additions: list[str] = []

    defaults = {
        "isms-id": doc_id,
        "title": f'"{doc_id} - {title}"',
        "filename": filename,
        "baseline-doc-version": '"0.1"',
        "number-sections": "true",
    }
    for key in PIPELINE_KEYS:
        if key not in existing:
            additions.append(f"{key}: {defaults[key]}")
            warnings.append(
                f"  - {key}: not in source front matter; added `{key}: {defaults[key]}` "
                f"(review: a source value would have won had one been present)"
            )

    body = source_front_matter.strip("\n")
    if additions:
        block = body + ("\n" if body else "") + "\n".join(additions)
    else:
        block = body
    return "---\n" + block + "\n---", warnings


def build_qmd(
    parsed: ParsedSource, doc_id: str, title: str, filename: str
) -> tuple[str, list[str]]:
    out: list[str] = []
    front_matter, fm_warnings = build_front_matter(parsed.front_matter, doc_id, title, filename)
    out.append(front_matter)
    out.append("")
    out.append("{{< include _preamble.qmd >}}")
    out.append("")
    # Preamble prose (before the first heading) is emitted verbatim and is NOT overridable,
    # matching the project's rule that unblocked text is fixed. Usually empty.
    pre = "\n".join(parsed.preamble_lines).strip("\n")
    if pre.strip():
        out.append(pre.strip("\n"))
        out.append("")
    for s in parsed.sections:
        emit_section(s, out)
        out.append("")
    return "\n".join(out).rstrip("\n") + "\n", fm_warnings


def manifest_snippet(doc_id: str, filename: str, title: str, block_ids: list[str]) -> str:
    lines = [
        f"  - id: {doc_id}",
        f"    file: docs/{filename}.qmd",
        f"    title: {title}",
        "    blocks:",
    ]
    for bid in block_ids:
        lines.append(f"      - {bid}")
    return "\n".join(lines)


def append_to_manifest(snippet: str) -> None:
    # Append only, matching the file's existing line ending, so a CRLF working copy is not rewritten
    # wholesale into a spurious diff. Read raw bytes to detect the ending and to avoid translation.
    raw = MANIFEST_PATH.read_bytes()
    newline = "\r\n" if b"\r\n" in raw else "\n"
    text = raw.decode("utf-8")
    if not text.endswith(("\n", "\r")):
        text += newline
    addition = snippet.replace("\n", newline) + newline
    with open(MANIFEST_PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text + addition)


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------
def derive_filename(doc_id: str, title: str, source: Path) -> str:
    """<ID>-<slug of title>. Falls back to the source stem if no title is given."""
    base = title if title else source.stem
    return f"{doc_id}-{slugify(base)}"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Draft-generate a block-tagged ISMS .qmd from markdown.")
    ap.add_argument("source", type=Path, help="path to the source .md (e.g. _ingest/input/ISMS05-foo.md)")
    ap.add_argument("--id", required=True, help="canonical ISMS id, e.g. ISMS05")
    ap.add_argument("--title", default="", help='document title, e.g. "Risk Management Policy"')
    ap.add_argument("--dry-run", action="store_true", help="print the .qmd and manifest snippet; write nothing")
    ap.add_argument("--update-manifest", action="store_true", help="append the document entry to manifest.yml")
    ap.add_argument(
        "--org-name",
        action="append",
        default=[],
        help="an institution name to flag as a variable candidate (repeatable), e.g. --org-name UCL",
    )
    args = ap.parse_args(argv)

    if not args.source.exists():
        print(f"error: source not found: {args.source}", file=sys.stderr)
        return 1
    if not re.match(r"^ISMS\d+$", args.id):
        print(f"warning: id '{args.id}' does not look like ISMSnn; continuing anyway", file=sys.stderr)

    text = args.source.read_text(encoding="utf-8")
    parsed = parse_source(text, args.id)
    if not parsed.sections:
        print("error: no markdown headings found; nothing to block", file=sys.stderr)
        return 1

    title = args.title or args.source.stem
    filename = derive_filename(args.id, args.title, args.source)
    qmd, fm_warnings = build_qmd(parsed, args.id, title, filename)
    block_ids = collect_block_ids(parsed.sections)
    snippet = manifest_snippet(args.id, filename, title, block_ids)

    # ---- Review notes to stderr, so stdout stays clean for piping the .qmd if wanted ----
    print("=" * 78, file=sys.stderr)
    print(f"Ingested {args.source} as {args.id}", file=sys.stderr)
    print(f"Proposed output: _extensions/isms/docs/{filename}.qmd", file=sys.stderr)
    print(f"Blocks: {len(block_ids)}", file=sys.stderr)

    if fm_warnings:
        print("\nREVIEW - pipeline front-matter keys synthesised (source front matter otherwise "
              "preserved verbatim):", file=sys.stderr)
        for note in fm_warnings:
            print(note, file=sys.stderr)

    weak = [b for b in block_ids if weak_id(b.split(".")[-1])]
    if weak:
        print("\nREVIEW - weak / positional block ids (rename before committing; ids are the "
              "public override API):", file=sys.stderr)
        for b in weak:
            print(f"  - {b}", file=sys.stderr)

    flags = variable_flags(text, args.org_name)
    if flags:
        print("\nREVIEW - institution specifics that may belong in _variables.yml "
              "(NOT auto-replaced):", file=sys.stderr)
        for note in flags:
            print(note, file=sys.stderr)

    print("\nManifest entry (add to _extensions/isms/manifest.yml under documents:):", file=sys.stderr)
    print(snippet, file=sys.stderr)
    print("=" * 78, file=sys.stderr)

    if args.dry_run:
        print(qmd)  # the draft .qmd to stdout
        return 0

    out_path = BASELINE_DOCS / f"{filename}.qmd"
    if out_path.exists():
        print(f"error: {out_path} already exists; refusing to overwrite. Remove it first if you "
              f"mean to regenerate.", file=sys.stderr)
        return 1
    # Write LF-only regardless of platform: the block parser splits on \n and the tracked baseline
    # sources are LF in the repo, so emitting CRLF on Windows would diverge from what CI validates.
    out_path.write_text(qmd, encoding="utf-8", newline="\n")
    print(f"wrote {out_path}", file=sys.stderr)

    if args.update_manifest:
        append_to_manifest(snippet)
        print(f"appended {args.id} to {MANIFEST_PATH}", file=sys.stderr)
    else:
        print("manifest.yml NOT updated (pass --update-manifest to append the entry).", file=sys.stderr)

    print("\nNext: review block ids and variables, then verify:", file=sys.stderr)
    print("  quarto run _tests/run.ts", file=sys.stderr)
    print("  quarto run _tests/typecheck.ts", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
