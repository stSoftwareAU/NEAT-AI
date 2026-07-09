/**
 * SquashHistogram.ts - Per-generation squash (activation) histogram telemetry
 * (Issue #3263).
 *
 * Counts how many hidden/output neurons across a population use each canonical
 * squash function. Surfaced on every `generation_complete` training event so an
 * operator running the squash-budget A/B experiment can watch the activation
 * mix converge (or fail to) and diagnose whether a budget is actually
 * restricting the population.
 *
 * Input neurons carry no squash and constants are excluded — only the
 * activations that mutation and neuron creation can introduce are counted.
 */

import type { Creature } from "@creature";
import { Activations } from "@methods/activations/Activations.ts";

/**
 * A map of canonical squash name → number of neurons using it across the
 * population. Names are canonical (aliases resolved), so `RELU` and `ReLU`
 * count under a single key.
 */
export type SquashHistogram = Record<string, number>;

/**
 * Compute the squash histogram for a population.
 *
 * @param creatures - The population to summarise.
 * @returns A record of canonical squash name → count. Unknown squash names
 * (should not occur in a valid creature) are counted under their raw name so
 * the telemetry never silently drops a neuron.
 */
export function computeSquashHistogram(
  creatures: readonly Creature[],
): SquashHistogram {
  const histogram: SquashHistogram = {};
  for (const creature of creatures) {
    for (const neuron of creature.neurons) {
      if (neuron.type !== "hidden" && neuron.type !== "output") continue;
      const squash = neuron.squash;
      if (squash === undefined) continue;
      // Canonicalise aliases so RELU and ReLU share a bucket. Fall back to the
      // raw name if the activation is somehow unknown rather than dropping it.
      let name = squash;
      try {
        name = Activations.find(squash).getName();
      } catch {
        // Keep the raw name; a genuinely unknown squash is a separate bug and
        // must remain visible in the histogram, not be hidden.
      }
      histogram[name] = (histogram[name] ?? 0) + 1;
    }
  }
  return histogram;
}
