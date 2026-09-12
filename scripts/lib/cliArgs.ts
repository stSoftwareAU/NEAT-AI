/**
 * `--name=value` argument reading, shared by the measurement harnesses.
 *
 * Small, but duplicated once already: the surrogate feasibility study
 * (Issue #3930) and the archive capture beside it both need the same three
 * readers, and a second private copy of a parser that silently accepts a
 * mistyped flag is exactly how two harnesses come to disagree about what
 * `--seed=` means.
 *
 * Every reader refuses a value it cannot parse rather than substituting a
 * default: a run that quietly fell back to a default it was not asked for
 * reports numbers for a configuration nobody chose.
 *
 * @module cliArgs
 */

/** The value of `--name=value`, or `undefined` when the flag is absent. */
export function stringArg(
  args: readonly string[],
  name: string,
): string | undefined {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/**
 * The value of `--name=<number>`, or `fallback` when the flag is absent.
 *
 * @throws {Error} When the flag is present but is not a finite number.
 */
export function numberArg(
  args: readonly string[],
  name: string,
  fallback: number,
): number {
  const raw = stringArg(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} is not a number, got '${raw}'`);
  }
  return value;
}

/**
 * The value of `--name=<positive integer>`, or `fallback` when absent.
 *
 * @throws {Error} When the flag is present but is not a positive integer.
 */
export function intArg(
  args: readonly string[],
  name: string,
  fallback: number,
): number {
  const raw = stringArg(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer, got '${raw}'`);
  }
  return value;
}
