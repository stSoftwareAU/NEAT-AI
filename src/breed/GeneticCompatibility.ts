import { assert } from "@std/assert/assert";
import type { Creature } from "../../mod.ts";

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
  const fatherNeurons = new Set(
    father.neurons.filter((n) => n.type === "hidden").map((n) => n.uuid),
  );
  const motherNeurons = new Set(
    mother.neurons.filter((n) => n.type === "hidden").map((n) => n.uuid),
  );

  const smallestNeuronSet = fatherNeurons.size < motherNeurons.size
    ? fatherNeurons
    : motherNeurons;

  const otherNeuronSet = fatherNeurons.size < motherNeurons.size
    ? motherNeurons
    : fatherNeurons;

  const matchingNeurons = new Set(
    [...smallestNeuronSet].filter((n) => otherNeuronSet.has(n)),
  );

  const totalNeurons = smallestNeuronSet.size;

  if (totalNeurons === 0) return 1;

  const matchingNeuronCount = matchingNeurons.size;

  const neuronCompatibility = matchingNeuronCount / totalNeurons;
  assert(
    neuronCompatibility >= 0 && neuronCompatibility <= 1,
    `Neuron compatibility should be between 0 and 1, got ${neuronCompatibility}`,
  );
  return neuronCompatibility;
}
