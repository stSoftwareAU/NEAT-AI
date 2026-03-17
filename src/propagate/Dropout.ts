/**
 * Dropout.ts - Inverted dropout regularisation for training.
 *
 * Issue #1860: Implements true dropout regularisation during the forward pass.
 * During training, a configurable fraction of hidden neurons are randomly
 * disabled (their activations set to zero) and remaining activations are
 * scaled by 1/(1-p) (inverted dropout). During inference, all neurons are
 * active and no scaling is needed.
 *
 * Reference: Srivastava et al. (2014), "Dropout: A Simple Way to Prevent
 * Neural Networks from Overfitting", https://arxiv.org/abs/1207.0580
 */

import type { Creature } from "../Creature.ts";
import type { RandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

/**
 * Apply inverted dropout to hidden neuron activations during training.
 *
 * For each hidden neuron, with probability `dropoutRate`, the activation
 * is set to zero. Remaining activations are scaled by `1 / (1 - dropoutRate)`
 * so that expected activation magnitudes remain consistent with inference
 * (where all neurons are active without scaling).
 *
 * Input and output neurons are never dropped.
 *
 * @param creature - The creature whose activations will be modified in place
 * @param dropoutRate - Probability of disabling each hidden neuron (0.0 to 1.0)
 * @param rng - Random number generator for reproducibility
 * @returns The number of neurons that were dropped out
 */
export function applyDropout(
  creature: Creature,
  dropoutRate: number,
  rng: RandomNumberGenerator,
): number {
  if (dropoutRate <= 0 || dropoutRate >= 1) {
    return 0;
  }

  const neurons = creature.neurons;
  const inputCount = creature.input;
  const outputCount = creature.output;
  const hiddenStart = inputCount;
  const hiddenEnd = neurons.length - outputCount;
  const activations = creature.state.activations;
  const scale = 1 / (1 - dropoutRate);
  let droppedCount = 0;

  for (let i = hiddenStart; i < hiddenEnd; i++) {
    if (rng.random() < dropoutRate) {
      // Drop this neuron: set activation to zero
      activations[i] = 0;
      droppedCount++;
    } else {
      // Keep this neuron: scale activation by 1/(1-p)
      activations[i] *= scale;
    }
  }

  return droppedCount;
}
