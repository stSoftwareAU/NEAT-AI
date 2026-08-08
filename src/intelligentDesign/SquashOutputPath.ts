/**
 * Output path construction for Intelligent Design squash improvements
 * (Issue #3715).
 *
 * The improvement files are named after a creature-supplied neuron uuid and a
 * caller-supplied squash name. Neither is validated upstream, so both are
 * sanitised down to a safe filename character set and the resulting path is
 * asserted to stay inside the output directory before it reaches a write, a
 * read, or a remove.
 *
 * @module
 */

import { join } from "@std/path";
import { assertPathContained } from "@utils/PathContainment.ts";

/** Maximum characters kept from any single sanitised filename component. */
const MAX_COMPONENT_LENGTH = 32;

/** Number of trailing uuid characters used as the human-readable short id. */
const SHORT_ID_LENGTH = 8;

/**
 * Reduce an arbitrary string to a single safe filename component.
 *
 * Anything outside `[A-Za-z0-9_-]` becomes `_`, which removes path separators,
 * `..` traversal, and control characters. The result is length-capped and is
 * never empty.
 */
function sanitiseComponent(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, MAX_COMPONENT_LENGTH);

  return cleaned.length > 0 ? cleaned : "_";
}

/**
 * Build the path of an improved-creature file inside `outputDir`.
 *
 * @param outputDir Directory the file must live in.
 * @param squash Squash function name (caller supplied, unvalidated).
 * @param uuid Neuron uuid (creature supplied, unvalidated).
 * @returns The contained path, `"<outputDir>/<squash>_<shortId>.json"`.
 * @throws {ValidationError} If the resulting path escapes `outputDir`.
 */
export function buildSquashOutputPath(
  outputDir: string,
  squash: string,
  uuid: string,
): string {
  const shortId = sanitiseComponent(String(uuid).slice(-SHORT_ID_LENGTH));
  const squashName = sanitiseComponent(String(squash));
  const path = join(outputDir, `${squashName}_${shortId}.json`);

  // Defence in depth: sanitisation already removes traversal, so this only
  // fires if the construction above is ever changed unsafely.
  assertPathContained(outputDir, path, "Intelligent Design squash output");

  return path;
}
