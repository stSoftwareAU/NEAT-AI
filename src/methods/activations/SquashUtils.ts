/**
 * Shared utility functions for squash (activation) function classification.
 *
 * Issue #1392: Extracted from CompactCreature.ts and Simplify.ts to
 * eliminate DRY violation where isAggregationSquash/isAggregationSquashName
 * were independently defined with identical logic.
 *
 * NOTE: Uses string literals rather than importing activation modules to
 * avoid circular dependency issues with the Activations module graph.
 */

/** Names of aggregation-type squash functions (not scale-homogeneous). */
const AGGREGATION_SQUASH_NAMES: ReadonlySet<string> = new Set([
  "MAXIMUM",
  "MINIMUM",
  "IF",
  "HYPOT",
  "HYPOTv2",
]);

/**
 * Determines whether a squash function is an aggregation type.
 *
 * Aggregation squashes (MAXIMUM, MINIMUM, IF, HYPOT, HYPOTv2) are not
 * scale-homogeneous: scaling all inputs does not simply scale the output.
 * This distinction matters for compaction (weight folding) and simplification
 * (identity neuron removal), which are only safe for scale-homogeneous squashes.
 *
 * @param name - The squash function name to check
 * @returns true if the squash is an aggregation type
 */
export function isAggregationSquash(name?: string): boolean {
  if (!name) return false;
  return AGGREGATION_SQUASH_NAMES.has(name);
}
