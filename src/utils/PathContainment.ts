/**
 * Filesystem path containment guard (Issue #3670).
 *
 * Defence in depth for directories built by concatenating a caller-supplied
 * component onto a base directory. Any such path is eventually created,
 * written to, and removed recursively, so a component containing `..` (or an
 * absolute path) must never be allowed to escape its base.
 *
 * @module PathContainment
 */

import { resolve, SEPARATOR } from "@std/path";
import { ValidationError } from "@errors/ValidationError.ts";

/**
 * Assert that `candidate` resolves to `baseDir` itself or a descendant of it.
 *
 * @param baseDir The directory the candidate must stay inside.
 * @param candidate The path to check.
 * @param context Short description of the call site, included in the error.
 * @throws {ValidationError} When `candidate` escapes `baseDir`.
 */
export function assertPathContained(
  baseDir: string,
  candidate: string,
  context: string,
): void {
  const base = resolve(baseDir);
  const target = resolve(candidate);
  const prefix = base.endsWith(SEPARATOR) ? base : base + SEPARATOR;

  if (target !== base && !target.startsWith(prefix)) {
    throw new ValidationError(
      `${context}: resolved path "${target}" escapes base directory ` +
        `"${base}".`,
      "OTHER",
    );
  }
}
