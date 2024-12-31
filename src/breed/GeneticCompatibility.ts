import { assert } from "@std/assert/assert";
import type { Creature } from "../../mod.ts";

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
