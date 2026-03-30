/**
 * NeuronTopology.ts - Topology fixing, mutation, and connectivity.
 *
 * Extracted from Neuron.ts (Issue #1599) to keep the Neuron class
 * under 500 lines and each module focused on a single responsibility.
 */

import { removeTag } from "@stsoftware/tags/mod";
import type { Neuron } from "@architecture/Neuron.ts";
import { Synapse } from "@architecture/Synapse.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { Mutation } from "@neat/Mutation.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { isFixableActivation } from "@neuron/NeuronActivation.ts";

/**
 * Ensures this neuron has valid topology (connections, outward links).
 */
export function fix(neuron: Neuron): void {
  // Clear cached methods since topology is changing
  neuron.setSquash(neuron.squash);

  const rng = getRandomNumberGenerator();

  if (neuron.squash !== "IF") {
    const toList = neuron.creature.inwardConnections(neuron.index);
    toList.forEach((c) => {
      delete c.type;
    });
  }

  if (neuron.type === "hidden") {
    ensureHiddenOutwardConnection(neuron, true);
    const toList = neuron.creature.inwardConnections(neuron.index);
    if (toList.length === 0) {
      // Try all possible sources in random order
      const possibleSources: number[] = [];
      for (let fromIndx = 0; fromIndx < neuron.index; fromIndx++) {
        // Check if connection doesn't already exist
        if (!neuron.creature.getSynapse(fromIndx, neuron.index)) {
          possibleSources.push(fromIndx);
        }
      }

      if (possibleSources.length > 0) {
        // Pick a random valid source
        const fromIndx =
          possibleSources[Math.floor(rng.random() * possibleSources.length)];
        neuron.creature.connect(
          fromIndx,
          neuron.index,
          Synapse.randomWeight(),
        );
      }
    }
  } else if (neuron.type === "output") {
    const toList = neuron.creature.inwardConnections(neuron.index);
    if (toList.length === 0) {
      const fromIndx = Math.floor(
        rng.random() *
          (neuron.creature.nodeCount() - neuron.creature.outputCount()),
      );
      neuron.creature.connect(
        fromIndx,
        neuron.index,
        Synapse.randomWeight(),
      );
    }
  }

  if (neuron.squash) {
    const squashFunction = neuron.findSquash();

    if (isFixableActivation(squashFunction)) {
      squashFunction.fix(neuron);
    }
  }

  if (
    neuron.type === "hidden" &&
    neuron.creature.outwardConnections(neuron.index).length === 0
  ) {
    ensureHiddenOutwardConnection(neuron, false);
  }
}

/**
 * Ensures a hidden neuron has at least one outward connection.
 */
function ensureHiddenOutwardConnection(
  neuron: Neuron,
  allowSelfTargets: boolean,
): boolean {
  if (neuron.creature.outwardConnections(neuron.index).length > 0) {
    return true;
  }

  // Forward-only safety: never create a self-loop as a "last resort" outward
  // connection when the creature is explicitly marked as forward-only.
  const isForwardOnly = neuron.creature.forwardOnly === true;

  const candidates: number[] = [];
  const nodeCount = neuron.creature.nodeCount();

  for (let targetIdx = neuron.index + 1; targetIdx < nodeCount; targetIdx++) {
    const candidate = neuron.creature.neurons[targetIdx];
    if (!candidate || candidate.type === "constant") {
      continue;
    }
    if (!neuron.creature.getSynapse(neuron.index, candidate.index)) {
      candidates.push(candidate.index);
    }
  }

  // Only consider a self-loop as a true "last resort".
  if (
    allowSelfTargets &&
    isForwardOnly === false &&
    candidates.length === 0 &&
    !neuron.creature.getSynapse(neuron.index, neuron.index)
  ) {
    candidates.push(neuron.index);
  }

  if (candidates.length === 0) {
    if (!allowSelfTargets) {
      return ensureHiddenOutwardConnection(neuron, true);
    }
    return false;
  }

  const targetIndex = candidates[
    Math.floor(getRandomNumberGenerator().random() * candidates.length)
  ];
  neuron.creature.connect(
    neuron.index,
    targetIndex,
    Synapse.randomWeight(),
  );

  return true;
}

/**
 * Mutates the neuron with the given method.
 */
export function mutate(neuron: Neuron, method: string): boolean {
  if (typeof method !== "string") {
    throw new TopologyError(
      "Mutate method wrong type: " + (typeof method),
      "INVALID_STATE",
    );
  }
  if (neuron.type === "input") {
    throw new TopologyError(
      "Mutate on wrong node type: " + neuron.type,
      "INVALID_NEURON_TYPE",
    );
  }
  switch (method) {
    case Mutation.MOD_SQUASH.name: {
      switch (neuron.type) {
        case "hidden":
        case "output":
          break;
        default:
          throw new TopologyError(
            `Can't modify activation for type ${neuron.type}`,
            "INVALID_NEURON_TYPE",
          );
      }
      const tmpSquash = Activations.pickRandomSquash(neuron.squash);

      neuron.setSquash(tmpSquash);

      removeTag(neuron, "CRISPR");
      break;
    }
    case Mutation.MOD_BIAS.name: {
      // Calculate the quantum based on the current bias
      const biasMagnitude = Math.abs(neuron.bias);
      let quantum = 1;

      if (biasMagnitude >= 1) {
        // Find the largest power of 10 smaller than the biasMagnitude
        quantum = Math.pow(10, Math.floor(Math.log10(biasMagnitude)));
      }

      // Generate a random modification value based on the quantum
      const modification = (getRandomNumberGenerator().random() * 2 - 1) *
        quantum;

      neuron.bias += modification;
      break;
    }
    default:
      throw new TopologyError(
        "Unknown mutate method: " + method,
        "INVALID_STATE",
      );
  }
  delete neuron.creature.uuid;
  neuron.creature.state.preparedNeurons = false;
  return true;
}
