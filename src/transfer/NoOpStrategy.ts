/**
 * NoOpStrategy.ts - Baseline DNA-sharing strategy that does nothing.
 *
 * Issue #2491: The bake-off harness must produce a row even when no DNA
 * sharing has happened. NoOpStrategy is that baseline — its `finalScore`
 * equals its `baselineScore` and its `lift` is zero. Real primitives must
 * beat NoOp on absolute score lift to be worth landing.
 */

import type { Creature } from "@creature";
import type {
  DnaSharingPrepareOptions,
  DnaSharingStrategy,
} from "./DnaSharingStrategy.ts";

/**
 * Baseline strategy: leaves the recipient untouched. Every candidate
 * primitive must beat this row in the harness output to be worth landing.
 */
export class NoOpStrategy implements DnaSharingStrategy {
  readonly name = "NoOp";

  prepare(
    _recipient: Creature,
    _donor: Creature,
    _options: DnaSharingPrepareOptions,
  ): Promise<void> {
    // Deliberate no-op: this is the baseline row in the bake-off table.
    return Promise.resolve();
  }
}
