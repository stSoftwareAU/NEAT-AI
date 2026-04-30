/**
 * DnaSharingStrategy.ts - Pluggable interface for DNA-sharing primitives.
 *
 * Issue #2491 (parent #2490): Each candidate primitive — knob tuning, compact
 * sub-graph graft, knowledge distillation, pruning template — implements this
 * interface so the bake-off harness (`bench/DnaSharingBakeOff.ts`) can measure
 * them against the same baseline (production cluster vs Europa island) on the
 * same probe dataset with the same generation budget and seed.
 *
 * The harness invokes `prepare(recipient, donor, options)` once per strategy
 * before evolving the recipient against the probe dataset. A NoOp strategy
 * (see {@link NoOpStrategy}) is the baseline that does nothing — every other
 * primitive must beat that baseline on absolute score lift to land.
 */

import type { Creature } from "@creature";

/**
 * Options passed to a strategy's `prepare` step. Keep this minimal so new
 * primitives can extend it without breaking existing strategies.
 */
export interface DnaSharingPrepareOptions {
  /** Deterministic RNG seed for the strategy. Same value across all strategies in one bake-off run. */
  seed?: number;
  /** Generation budget for the harness's evolution loop after `prepare` returns. */
  generations?: number;
}

/**
 * A pluggable DNA-sharing primitive.
 *
 * - `name` is the short identifier shown in the harness output table.
 * - `prepare` mutates `recipient` in place using information from `donor`
 *   (e.g. transplanting hidden neurons, copying weights, pruning structure).
 *   The donor must NOT be mutated. The recipient must remain valid for
 *   activation and training after `prepare` resolves.
 *
 * Implementations should be deterministic when `options.seed` is supplied,
 * so harness rows are reproducible.
 */
export interface DnaSharingStrategy {
  /** Short identifier used as the row key in the harness Markdown table. */
  readonly name: string;

  /**
   * Apply the primitive to `recipient`, drawing from `donor`. Called once per
   * strategy at periodic Europa→cluster import time (or in the harness, once
   * per row).
   */
  prepare(
    recipient: Creature,
    donor: Creature,
    options: DnaSharingPrepareOptions,
  ): Promise<void>;
}
