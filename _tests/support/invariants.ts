//
// Structural assertions applied to EVERY composed document a fixture produces, so a malformed
// marker cannot slip through on a document whose own test happened to be about something else.
//
// The marker patterns are imported from blocks.ts, never re-spelled here. The standing verification
// pass re-spelled them as local regex literals — the exact drift its own header warns about — and
// its copy of the open pattern stopped at the id, so the `source=override mode=<mode>` provenance
// payload that `emit()` writes was verified by nothing at all.
//
import { BLOCK_CLOSE_RE, BLOCK_OPEN_RE } from "../../_extensions/isms/cli/lib/blocks.ts";

/**
 * The generated banner is present, no authoring delimiter leaked into the output, and every
 * `isms:block` marker is balanced and dotted-nested.
 *
 * These markers are load-bearing rather than cosmetic: the deviations register re-parses them to
 * resolve its deep links, and throws rather than dropping a link when a range is missing.
 */
export function assertWellFormed(rel: string, content: string): void {
  const problems: string[] = [];

  if (!content.includes("DO NOT EDIT BY HAND")) problems.push("generated banner is missing");

  const stack: string[] = [];
  content.split("\n").forEach((line, i) => {
    const leaked = line.match(/^<!-- isms:(begin|end|override)\b/);
    if (leaked) {
      problems.push(`line ${i + 1}: isms:${leaked[1]} delimiter leaked into composed output`);
      return;
    }
    const close = line.match(BLOCK_CLOSE_RE);
    if (close) {
      const open = stack.pop();
      if (open === undefined) {
        problems.push(`line ${i + 1}: close of "${close[1]}" with nothing open`);
      } else if (open !== close[1]) {
        problems.push(`line ${i + 1}: "${close[1]}" closes while "${open}" is open`);
      }
      return;
    }
    const open = line.match(BLOCK_OPEN_RE);
    if (open) {
      const parent = stack[stack.length - 1];
      if (parent !== undefined && !open[1].startsWith(parent + ".")) {
        problems.push(
          `line ${i + 1}: "${open[1]}" nests inside "${parent}" but is not its dotted child`,
        );
      }
      stack.push(open[1]);
    }
  });
  if (stack.length > 0) problems.push(`unclosed block marker(s): ${stack.join(", ")}`);

  if (problems.length > 0) throw new Error(`${rel}:\n  ${problems.join("\n  ")}`);
}
