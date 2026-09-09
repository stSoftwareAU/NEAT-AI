/**
 * LayerBucket.ts - Coarse depth bucket for a neuron within a creature.
 *
 * Extracted from `SquashEffectivenessTracker` (Issue #2457) so the per-operator
 * mutation telemetry (Issue #3971) buckets a mutation site exactly the way the
 * squash tracker buckets a neuron role — one definition, one behaviour.
 *
 * The bucket is intentionally coarse to avoid sparsity: a neuron is
 * `input-adjacent`, `mid`, or `output-adjacent`, derived from the layer
 * assignments computed by `computeLayerAssignments`.
 */

import type { Creature } from "@creature";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";

/** Coarse layer bucket. */
export type LayerBucket = "input-adjacent" | "mid" | "output-adjacent";

/**
 * Bucket the neuron at `neuronIndex` by its depth within `creature`.
 *
 * Output neurons are always `output-adjacent`. Input neurons and anything at
 * depth ≤ 1 are `input-adjacent`. The deepest hidden layer is treated as
 * `output-adjacent` because it feeds the outputs directly; everything between
 * is `mid`.
 *
 * The call runs `computeLayerAssignments` over the whole creature, which is
 * O(neurons + synapses). Callers on a hot path must invoke it per *mutation*,
 * never per synapse.
 *
 * @param creature - The creature the neuron belongs to.
 * @param neuronIndex - Index of the neuron to bucket.
 * @returns The coarse layer bucket for that neuron.
 */
export function computeLayerBucket(
  creature: Creature,
  neuronIndex: number,
): LayerBucket {
  const inputCount = creature.input;
  const outputStart = creature.neurons.length - creature.output;

  if (neuronIndex >= outputStart) {
    // Output neurons are always output-adjacent.
    return "output-adjacent";
  }

  const layers = computeLayerAssignments(creature);
  // Find this neuron's depth and the maximum hidden depth.
  let depth = -1;
  let maxHiddenDepth = 0;
  for (const [layerNum, indices] of layers) {
    if (indices.includes(neuronIndex)) depth = layerNum;
    // Track the maximum depth that does not contain output neurons.
    if (indices[0] !== undefined && indices[0] < outputStart) {
      if (layerNum > maxHiddenDepth) maxHiddenDepth = layerNum;
    }
  }

  if (depth <= 1 || neuronIndex < inputCount) {
    return "input-adjacent";
  }
  if (depth >= maxHiddenDepth) {
    // Last hidden layer — adjacent to outputs.
    return "output-adjacent";
  }
  return "mid";
}
