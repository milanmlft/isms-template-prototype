//
// Assertions, hand-rolled.
//
// `jsr:@std/assert` is NOT in the Deno cache Quarto ships — only the five `stdlib/*` specifiers the
// CLI imports are pre-seeded there — so importing it would add a jsr.io fetch on every run and
// break the README's standing promise of "Quarto >= 1.8. Nothing else". Fifty lines buys
// hermeticity, and the suite runs with `--cached-only` so a future import that needs the network
// fails loudly rather than quietly acquiring a dependency.
//

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ?? "not equal"}\n  actual:   ${a}\n  expected: ${b}`);
}

export function assertContains(haystack: string, needle: string, msg?: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${msg ?? "missing substring"}\n  wanted: ${needle}\n  in:     ${haystack}`);
  }
}

export function assertMissing(haystack: string, needle: string, msg?: string): void {
  if (haystack.includes(needle)) {
    throw new Error(`${msg ?? "unwanted substring"}\n  found:  ${needle}\n  in:     ${haystack}`);
  }
}

export function assertMatch(haystack: string, re: RegExp, msg?: string): void {
  if (!re.test(haystack)) {
    throw new Error(`${msg ?? "no match"}\n  wanted: ${re}\n  in:     ${haystack}`);
  }
}

/**
 * Assert `fn` throws, and that every needle appears in the message. Returns the error, so a caller
 * can make further assertions on it.
 *
 * Needles are identifiers, lists and numbers — never sentences. An error's prose should be free to
 * improve without turning the suite red; what the message PROMISES is the contract worth pinning:
 * that it names the offending id, that it lists the ids that do exist, that it cites a line.
 */
export function assertThrowsWith(fn: () => unknown, ...needles: string[]): Error {
  let thrown: unknown;
  let returned: unknown;
  let threw = false;
  try {
    returned = fn();
  } catch (err) {
    thrown = err;
    threw = true;
  }
  if (!threw) {
    throw new Error(`expected a throw, got none (returned ${JSON.stringify(returned)?.slice(0, 200)})`);
  }
  const err = thrown instanceof Error ? thrown : new Error(String(thrown));
  for (const needle of needles) {
    assertContains(err.message, needle, `error message lacks "${needle}"`);
  }
  return err;
}

/** The async twin, for `compose()` — which is declared async even though it never awaits. */
export async function assertRejectsWith(
  fn: () => Promise<unknown>,
  ...needles: string[]
): Promise<Error> {
  let thrown: unknown;
  let threw = false;
  try {
    await fn();
  } catch (err) {
    thrown = err;
    threw = true;
  }
  if (!threw) throw new Error(`expected a rejection, got none`);
  const err = thrown instanceof Error ? thrown : new Error(String(thrown));
  for (const needle of needles) {
    assertContains(err.message, needle, `error message lacks "${needle}"`);
  }
  return err;
}
