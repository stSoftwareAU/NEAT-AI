/**
 * Semantic version validation for creature JSON files.
 *
 * Issue #2349: Ensures every creature written to disk carries a valid
 * semanticVersion. The minimum writeable version is 2.0.0 — versions
 * below that indicate an un-upgraded or corrupt creature.
 *
 * @module SemanticVersionValidation
 */

/**
 * Regex matching a valid writeable semantic version (major >= 2).
 *
 * Accepts `2.0.0`, `4.0.0`, `10.1.3`, etc.
 * Rejects `""`, `"0.0.1"`, `"1.0.0"`, or any non-semver string.
 */
export const VALID_WRITEABLE_SEMANTIC_VERSION_RE =
  /^([2-9]|[1-9][0-9]+)\.[0-9]+\.[0-9]+$/;

/**
 * Returns true when `version` is a valid semantic version string with
 * major version >= 2, suitable for writing to disk.
 */
export function isValidWriteableSemanticVersion(
  version: string | undefined,
): boolean {
  if (!version) return false;
  return VALID_WRITEABLE_SEMANTIC_VERSION_RE.test(version);
}

/**
 * Throws if `version` is not a valid writeable semantic version (>= 2.0.0).
 *
 * Use at write boundaries to prevent corrupt creature files from reaching disk.
 */
export function assertValidWriteableSemanticVersion(
  version: string | undefined,
): asserts version is string {
  if (!isValidWriteableSemanticVersion(version)) {
    throw new Error(
      `Invalid semanticVersion for disk write: "${version ?? ""}"` +
        ` — must match ${VALID_WRITEABLE_SEMANTIC_VERSION_RE}`,
    );
  }
}
