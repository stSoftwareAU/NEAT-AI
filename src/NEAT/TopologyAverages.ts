/**
 * TopologyAverages.ts - Per-generation population topology telemetry
 * (Issue #3402).
 *
 * Reports the mean neuron and synapse counts across a population. Surfaced on
 * every `generation_complete` training event so an operator watching a
 * `[memprofile]`-style line can correlate heap growth with topology growth.
 *
 * The GRQ-19 OOM post-mortem (Issue #3402) found the memory-profile line
 * carried `avg_neurons=0 avg_synapses=0`, so a heap that ballooned within one
 * generation could not be attributed to runaway topology — a population of 19
 * creatures should not retain gigabytes. Emitting the real averages closes that
 * diagnostic gap.
 *
 * "Neurons" counts every neuron (input + hidden + output), matching the
 * `bestNeurons` semantics already used by `EvolveRLMilestoneEvent`.
 */

import type { Creature } from "@creature";

/**
 * Mean topology size across a population.
 */
export interface TopologyAverages {
  /**
   * Mean neuron count (input + hidden + output) across the population.
   * `0` for an empty population.
   */
  readonly averageNeurons: number;
  /**
   * Mean synapse count across the population. `0` for an empty population.
   */
  readonly averageSynapses: number;
}

/**
 * Compute the mean neuron and synapse counts for a population.
 *
 * @param creatures - The population to summarise.
 * @returns The mean neuron and synapse counts. An empty population yields
 *   `{ averageNeurons: 0, averageSynapses: 0 }` rather than `NaN`, so the
 *   telemetry never emits a non-finite value.
 */
export function computeTopologyAverages(
  creatures: readonly Creature[],
): TopologyAverages {
  const count = creatures.length;
  if (count === 0) {
    return { averageNeurons: 0, averageSynapses: 0 };
  }

  let totalNeurons = 0;
  let totalSynapses = 0;
  for (const creature of creatures) {
    totalNeurons += creature.neurons.length;
    totalSynapses += creature.synapses.length;
  }

  return {
    averageNeurons: totalNeurons / count,
    averageSynapses: totalSynapses / count,
  };
}
