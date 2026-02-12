import { removeHiddenNeuron } from "../compact/CompactUtils.ts";
import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { getMajorVersion } from "../upgrade/Upgrade.ts";

/**
 * Selects a random non-input, non-constant neuron index with focus-aware retry.
 *
 * Used by ModBias, ModSquash, and similar mutations that target a single neuron.
 * Tries up to `maxAttempts` times; relaxes the focus constraint after `relaxAfter`
 * attempts so the mutation can still proceed when the focus list is very restrictive.
 *
 * @param creature - The creature whose neurons to select from
 * @param focusList - Optional focus list for targeted mutations
 * @param maxAttempts - Maximum selection attempts (default 12)
 * @param relaxAfter - Relax focus constraint after this many attempts (default 6)
 * @returns The selected neuron index, or -1 if no valid neuron found
 */
export function selectFocusedNeuronIndex(
  creature: Creature,
  focusList?: number[],
  maxAttempts?: number,
  relaxAfter?: number,
): number {
  const effectiveMax = maxAttempts ?? 12;
  const effectiveRelax = relaxAfter ?? 6;

  for (let attempts = 0; attempts < effectiveMax; attempts++) {
    const index = Math.floor(
      Math.random() * (creature.neurons.length - creature.input) +
        creature.input,
    );
    const neuron = creature.neurons[index];
    if (neuron.type === "constant") continue;
    if (
      !creature.inFocus(index, focusList) && attempts < effectiveRelax
    ) {
      continue;
    }
    return index;
  }

  return -1;
}

/**
 * Handles cleanup of a neuron that has lost all inward connections.
 *
 * When a synapse removal leaves a hidden neuron with no inward connections:
 * - If it also has no outward connections, remove it entirely
 * - If it still has outward connections, convert it to a constant
 *   (squashing its bias through the activation function)
 *
 * Used by SubSelfCon and SubBackCon after disconnecting synapses.
 *
 * @param creature - The creature containing the neuron
 * @param neuronIndex - The index of the neuron to check
 * @returns true if the neuron was removed (indices shifted), false otherwise
 */
export function cleanupDisconnectedNeuron(
  creature: Creature,
  neuronIndex: number,
): boolean {
  const inwardList = creature.inwardConnections(neuronIndex);
  if (inwardList.length > 0) return false;

  const neuron = creature.neurons[neuronIndex];
  if (neuron.type !== "hidden") return false;

  const outwardList = creature.outwardConnections(neuronIndex);
  if (outwardList.length === 0) {
    console.info(
      `Remove neuron ${neuron.uuid} as completely disconnected`,
    );
    removeHiddenNeuron(creature, neuronIndex);
    return true;
  }

  // Convert to constant: squash the bias through the activation function
  console.info(
    `Convert neuron ${neuron.uuid} from ${neuron.type} to constant`,
  );
  const squash = neuron.findSquash();
  const activation = squash as ActivationInterface;
  if (activation.squash) {
    const constantBias = activation.squash(neuron.bias);
    console.info(
      `Adjust neuron ${neuron.uuid} bias ${neuron.bias} to ${constantBias}`,
    );
    neuron.bias = constantBias;
  }
  neuron.type = "constant";
  neuron.setSquash(undefined);
  return false;
}

/**
 * Validates a forward-only creature and bumps its semantic version to 4.x
 * if it passes validation. For 4.x creatures, validation failures are fatal.
 * For pre-4.x creatures, self-connection or recursive synapse errors trigger
 * a fix-and-revalidate cycle.
 *
 * @param creature - The creature to validate
 * @param operationName - Name of the calling operation for error messages
 */
export function validateAndBumpForwardOnly(
  creature: Creature,
  operationName: string,
): void {
  const major = getMajorVersion(creature.semanticVersion);
  try {
    creature.validate({ forwardOnly: true });
    bumpToFourIfForwardOnlyConfirmed(creature);
  } catch (e) {
    const error = e as Error;
    if (major >= 4) {
      throw new Error(
        `[${operationName}] CRITICAL: 4.x forward-only creature is invalid: ` +
          `${error.name} - ${error.message}`,
      );
    }

    if (
      error.name === "SELF_CONNECTION" || error.name === "RECURSIVE_SYNAPSE"
    ) {
      creature.fix({ forwardOnly: true });
      creature.validate({ forwardOnly: true });
      bumpToFourIfForwardOnlyConfirmed(creature);
    } else {
      throw e;
    }
  }
}

/**
 * Bumps the creature's semantic version to 4.0.0 if it is currently 2.x or 3.x.
 *
 * This confirms the creature as forward-only once validated, locking in the
 * hard forward-only invariant from 4.x onward.
 *
 * @param creature - The creature whose version to bump
 */
export function bumpToFourIfForwardOnlyConfirmed(creature: Creature): void {
  const major = getMajorVersion(creature.semanticVersion);
  if (major === 2 || major === 3) {
    creature.semanticVersion = "4.0.0";
  }
}
