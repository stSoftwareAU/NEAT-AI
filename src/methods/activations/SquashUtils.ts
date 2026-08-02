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

/**
 * Names of squash functions that support parallel bridge neuron merging.
 *
 * Parallel merging combines multiple bridge neurons (1 inbound, 1 outbound)
 * that all feed the same target into a single neuron with merged weights.
 *
 * The mathematical requirement is **additivity** (or convertibility to an
 * additive form): f(a + b) = f(a) + f(b).
 *
 * Analysis of each squash function family (issue #1948):
 *
 * **Mergeable:**
 * - IDENTITY: f(x) = x is linear. f(a+b) = a+b = f(a)+f(b). ✓
 * - COMPLEMENT: f(x) = 1-x is affine. Can be algebraically converted to
 *   IDENTITY by negating inbound weights and adjusting bias:
 *   1 - (w*x + b) = (-w)*x + (1 - b). After conversion, standard IDENTITY
 *   merging applies. ✓
 *
 * **Not mergeable (non-linear — f(a+b) ≠ f(a)+f(b)):**
 * - LOGISTIC: f(x) = 1/(1+e^(-x)). Sigmoid curve, non-additive.
 * - TANH: f(x) = tanh(x). Symmetric sigmoid, non-additive.
 * - ReLU: f(x) = max(0, x). Piecewise-linear but breakpoints differ per
 *   input, so max(0, a+b) ≠ max(0, a) + max(0, b) in general.
 * - LeakyReLU: Same issue as ReLU with the leaky slope.
 * - ABSOLUTE: f(x) = |x|. Scale-homogeneous but |a+b| ≠ |a| + |b|.
 * - GELU, Swish, ELU, SELU, Mish, etc.: All non-linear, non-additive.
 *
 * **Not mergeable (aggregation — process inputs non-additively):**
 * - MAXIMUM, MINIMUM, IF, HYPOT, HYPOTv2: These use special input
 *   aggregation (max, min, conditional) rather than weighted sum.
 */
const PARALLEL_MERGEABLE_SQUASH_NAMES: ReadonlySet<string> = new Set([
  "IDENTITY",
  "COMPLEMENT",
]);

/**
 * Determines whether a squash function supports parallel bridge neuron merging.
 *
 * Only squash functions that are additive or can be converted to an additive
 * form (like COMPLEMENT → IDENTITY) are safe for parallel merging. See the
 * detailed analysis above for the mathematical justification.
 *
 * @param name - The squash function name to check
 * @returns true if the squash supports parallel bridge merging
 */
export function isParallelMergeableSquash(name?: string): boolean {
  if (!name) return false;
  return PARALLEL_MERGEABLE_SQUASH_NAMES.has(name);
}
