import { assert } from "@std/assert";
import type { Creature } from "../../mod.ts";
import { getCachedDistance, setCachedDistance } from "./DistanceCache.ts";

/**
 * Calculates the genetic compatibility between two creatures for breeding.
 *
 * This function measures how similar two creatures are based on their hidden neurons.
 * It compares the hidden neurons of both creatures and returns a compatibility score
 * between 0 and 1, where 1 indicates perfect compatibility (all hidden neurons match)
 * and 0 indicates no compatibility (no hidden neurons match).
 *
 * The compatibility is calculated as the ratio of matching hidden neurons to the
 * total number of hidden neurons in the smaller creature.
 *
 * Issue #1032: Uses cached hidden neuron UUIDs for improved performance.
 * Issue #1293: Uses distance cache for incremental computation. Since creature
 * UUIDs are deterministic hashes of structure, a cached distance remains valid
 * as long as neither creature's structure has changed.
 *
 * @param father - The first creature for compatibility calculation
 * @param mother - The second creature for compatibility calculation
 * @returns A compatibility score between 0 and 1, where higher values indicate better compatibility
 *
 * @example
 * ```ts
 * const compatibility = geneticCompatibility(father, mother);
 * if (compatibility > 0.5) {
 *   console.log("Creatures are genetically compatible for breeding");
 * }
 * ```
 */
export function geneticCompatibility(
  father: Creature,
  mother: Creature,
): number {
  // Issue #1293: Check distance cache first when both creatures have UUIDs
  if (father.uuid && mother.uuid) {
    const cached = getCachedDistance(father.uuid, mother.uuid);
    if (cached !== undefined) {
      return cached;
    }
  }

  // Use cached hidden neuron UUIDs for improved performance (Issue #1032)
  const fatherNeurons = father.getHiddenNeuronUUIDs();
  const motherNeurons = mother.getHiddenNeuronUUIDs();

  const smallestNeuronSet = fatherNeurons.size < motherNeurons.size
    ? fatherNeurons
    : motherNeurons;

  const otherNeuronSet = fatherNeurons.size < motherNeurons.size
    ? motherNeurons
    : fatherNeurons;

  const totalNeurons = smallestNeuronSet.size;

  if (totalNeurons === 0) return 1;

  // Issue #1033: Use direct iteration instead of spread + filter pattern.
  // This avoids creating an intermediate array and is ~2.75x faster.
  let matchingNeuronCount = 0;
  for (const n of smallestNeuronSet) {
    if (otherNeuronSet.has(n)) {
      matchingNeuronCount++;
    }
  }

  const neuronCompatibility = matchingNeuronCount / totalNeurons;
  assert(
    neuronCompatibility >= 0 && neuronCompatibility <= 1,
    `Neuron compatibility should be between 0 and 1, got ${neuronCompatibility}`,
  );

  // Issue #1293: Store in distance cache for future lookups
  if (father.uuid && mother.uuid) {
    setCachedDistance(father.uuid, mother.uuid, neuronCompatibility);
  }

  return neuronCompatibility;
}
