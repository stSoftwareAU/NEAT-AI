/**
 * CreatureMutation.ts - Network structure repair and random connection creation.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import { Synapse as SynapseClass } from "../architecture/Synapse.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import {
  pruneOrphanMemeticReferences,
  removeHiddenNeuron,
} from "../compact/CompactUtils.ts";
import { cleanupOrphanedNeuronsInCreature } from "../compact/OrphanedNeuronCleanup.ts";
import { mergeTagsByNameValue } from "../utils/TagUtils.ts";
import { getLogger } from "../utils/Logger.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

/**
 * Create a random connection for the neuron at the given index.
 */
export function makeRandomConnection(
  creature: Creature,
  indx: number,
): Synapse | null {
  assert(
    Number.isInteger(indx),
    `Index must be an integer, got: ${String(indx)}`,
  );
  assert(
    indx >= 0 && indx < creature.neurons.length,
    `Index out of range: ${indx} (neurons length: ${creature.neurons.length})`,
  );

  const toType = creature.neurons[indx].type;
  assert(toType !== "input", "Can't connect to input");
  assert(toType !== "constant", "Can't connect to constant");

  for (let attempts = 0; attempts < 12; attempts++) {
    const from = Math.min(
      creature.neurons.length - creature.output - 1,
      Math.floor(getRandomNumberGenerator().random() * indx),
    );
    const c = creature.getSynapse(from, indx);
    if (c === null) {
      return creature.connect(
        from,
        indx,
        SynapseClass.randomWeight(),
      );
    }
  }

  const firstOutputIndex = creature.neurons.length - creature.output;
  for (let from = 0; from < indx; from++) {
    if (from >= firstOutputIndex) continue;
    const c = creature.getSynapse(from, indx);
    if (c === null) {
      return creature.connect(
        from,
        indx,
        SynapseClass.randomWeight(),
      );
    }
  }
  return null;
}

/**
 * Repair the creature into a structurally valid shape.
 *
 * Can remove recurrent synapses (when requested), merge duplicate synapses,
 * drop zero-weight synapses (with a guard for the last output inbound),
 * remove disconnected hidden neurons, run orphan cleanup, prune stale memetic
 * references, and bump semantic version to 4.0.0 when forced forward-only.
 *
 * Prefer **not** calling this on hot evolution paths when the genome is already
 * valid: structural edits and memetic clearing can **reduce fitness** relative
 * to the pre-repair network. Use it when correctness recovery matters more than
 * preserving the exact trained weights/topology.
 */
export function fix(
  creature: Creature,
  options?: {
    forwardOnly?: boolean;
    removeBackConnections?: boolean;
    removeSelfConnections?: boolean;
  },
): void {
  const forwardOnly = options?.forwardOnly === true;
  const removeBackConnections = forwardOnly ||
    options?.removeBackConnections === true;
  const removeSelfConnections = forwardOnly ||
    options?.removeSelfConnections === true;

  const holdDebug = creature.DEBUG;
  creature.DEBUG = false;
  const startUUID = CreatureUtil.makeUUID(creature);
  creature.DEBUG = holdDebug;
  const maxTo = creature.neurons.length - 1;
  const minTo = creature.input;

  // Merge duplicate synapses (same from/to/type) by summing weights.
  const merged = new Map<string, Synapse>();
  const inboundCountsByTo = new Map<number, number>();

  creature.synapses.forEach((synapse) => {
    if (removeSelfConnections && synapse.from === synapse.to) return;
    if (removeBackConnections && synapse.from > synapse.to) return;

    if (synapse.to > maxTo) {
      getLogger().debug("Ignoring connection to above max", maxTo, synapse);
      return;
    }
    if (synapse.to < minTo) {
      getLogger().debug("Ignoring connection to below min", minTo, synapse);
      return;
    }

    const typeKey = synapse.type ?? "";
    const key = `${synapse.from}->${synapse.to}:${typeKey}`;

    const existing = merged.get(key);
    if (existing) {
      existing.weight += synapse.weight;
      if (synapse.tags?.length) {
        existing.tags = mergeTagsByNameValue(existing.tags, synapse.tags);
      }
      return;
    }

    merged.set(key, synapse as Synapse);
    inboundCountsByTo.set(
      synapse.to,
      (inboundCountsByTo.get(synapse.to) ?? 0) + 1,
    );
  });

  const tmpSynapses: Synapse[] = [];
  for (const synapse of merged.values()) {
    if (synapse.weight !== 0 && Number.isFinite(synapse.weight)) {
      tmpSynapses.push(synapse);
      continue;
    }

    if (creature.neurons[synapse.to].type === "output") {
      const inbound = inboundCountsByTo.get(synapse.to) ?? 0;
      if (inbound === 1) {
        tmpSynapses.push(synapse);
      }
    }
  }

  creature.synapses = tmpSynapses;

  creature.synapses.sort((a, b) => {
    if (a.from === b.from) {
      return a.to - b.to;
    } else {
      return a.from - b.from;
    }
  });

  creature.clearCache();

  let neuronRemoved = true;
  while (neuronRemoved) {
    neuronRemoved = false;
    for (
      let pos = creature.input;
      pos < creature.neurons.length - creature.output;
      pos++
    ) {
      if (creature.neurons[pos].type === "output") continue;
      if (creature.outwardConnections(pos).length === 0) {
        if (creature.DEBUG) {
          getLogger().debug(
            `fix() removing disconnected neuron ${pos} ${
              creature.neurons[pos].id
            }`,
          );
        }
        removeHiddenNeuron(creature, pos);
        neuronRemoved = true;
        break;
      }
    }
  }

  for (let i = 1; i < creature.synapses.length; i++) {
    if (creature.synapses[i - 1].from > creature.synapses[i].from) {
      getLogger().error(
        "Synapses not sorted",
        creature.synapses[i - 1],
        creature.synapses[i],
      );
      creature.synapses.sort((a, b) => {
        if (a.from === b.from) {
          return a.to - b.to;
        } else {
          return a.from - b.from;
        }
      });
      break;
    }
  }

  creature.neurons.forEach((neuron) => {
    neuron.fix();
  });

  // Some mutation/breed paths can still strand a hidden neuron with outward
  // connections but no valid inbound source. Reuse the canonical orphan cleanup
  // pass here so fix() repairs those before validation retries.
  cleanupOrphanedNeuronsInCreature(creature);

  // Memetic can still reference removed neurons/synapses after partial repairs;
  // strict validate (e.g. Neat.populatePopulation) would throw MEMETIC otherwise.
  pruneOrphanMemeticReferences(creature);

  if (forwardOnly) {
    creature.forwardOnly = true;
    const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(creature.semanticVersion);
    if (match) {
      const major = Number.parseInt(match[1], 10);
      if (major === 2 || major === 3) {
        creature.semanticVersion = "4.0.0";
      }
    }
  }

  const tmpDebug = creature.DEBUG;
  creature.DEBUG = false;
  delete creature.uuid;
  const endUUID = CreatureUtil.makeUUID(creature);
  creature.DEBUG = tmpDebug;
  if (startUUID !== endUUID) {
    delete creature.memetic;
  }
}
