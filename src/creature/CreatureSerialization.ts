/**
 * CreatureSerialization.ts - JSON import/export and cloning.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { assert, fail } from "@std/assert";
import type { TagInterface } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "../architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { Neuron } from "../architecture/Neuron.ts";
import type { NeuronTrace } from "../architecture/NeuronInterfaces.ts";
import { Synapse } from "../architecture/Synapse.ts";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "../architecture/SynapseInterfaces.ts";
import { upgradeOne } from "../upgrade/UpgradeOne.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";

/**
 * Convert the creature to a JSON export object.
 */
export function exportJSON(creature: Creature): CreatureExport {
  if (creature.DEBUG) {
    creatureValidate(creature);
  }
  const builder = new CreatureExportBuilder(creature);
  return builder.build();
}

/**
 * Convert the creature to a trace JSON object.
 */
export function traceJSON(creature: Creature): CreatureTrace {
  const exportCreature = exportJSON(creature);

  const state = creature.state;
  let exportIndex = 0;
  creature.neurons.forEach((n) => {
    if (n.type !== "input") {
      if (n.type !== "constant") {
        const indx = n.index;

        const traceNeuron: NeuronTrace = exportCreature
          .neurons[exportIndex] as NeuronTrace;

        const ns = state.node(indx);
        if (ns.count) {
          (traceNeuron as NeuronTrace).trace = ns;
        }
      }
      exportIndex++;
    }
  });

  creature.synapses.forEach((c, indx) => {
    const exportConnection = exportCreature.synapses[indx] as SynapseTrace;
    const cs = state.connection(c.from, c.to);
    if (cs.count) {
      exportConnection.trace = cs;
    }
  });

  return exportCreature as CreatureTrace;
}

/**
 * Load the creature from a JSON object.
 */
export function loadFrom(
  creature: Creature,
  json: CreatureInternal | CreatureExport,
  validate: boolean,
): void {
  creature.uuid = (json as CreatureInternal).uuid;
  if (json.semanticVersion) {
    creature.semanticVersion = json.semanticVersion;
  }
  creature.forwardOnly = (json as CreatureExport).forwardOnly;

  const neuronCount = json.neurons.length;
  const synapseCount = json.synapses.length;
  creature.neurons = new Array(neuronCount);
  creature.synapses = new Array(synapseCount);

  if (json.tags) {
    creature.tags = [...json.tags];
  }

  creature.clearState();
  const state = creature.state;
  const uuidMap = new Map<string, number>();

  let i = json.input;
  while (i--) {
    const key = `input-${i}`;
    uuidMap.set(key, i);
    const n = new Neuron(key, "input", 0, creature);
    n.index = i;
    creature.neurons[i] = n;
  }

  let pos = json.input;
  let outputIndex = 0;
  const neurons = json.neurons;

  for (let i = 0; i < neurons.length; i++) {
    const jn = neurons[i];
    if (jn.type === "input") continue;

    if (jn.type === "output") {
      (jn as { uuid: string }).uuid = `output-${outputIndex++}`;
    }

    const n = Neuron.fromJSON(jn, creature);
    n.index = pos;

    if ((jn as NeuronTrace).trace) {
      Object.assign(state.node(n.index), (jn as NeuronTrace).trace);
    }

    uuidMap.set(n.uuid, pos);
    creature.neurons[pos++] = n;
  }

  const synapses = json.synapses;
  let isSorted = true;
  let lastFrom = -1;
  let lastTo = -1;
  for (let i = 0; i < synapseCount; i++) {
    const synapse = synapses[i];
    const se = synapse as SynapseExport;
    const from = se.fromUUID
      ? uuidMap.get(se.fromUUID)
      : (synapse as SynapseInternal).from;

    assert(from !== undefined, "FROM is undefined");

    const to = se.toUUID
      ? uuidMap.get(se.toUUID)
      : (synapse as SynapseInternal).to;

    if (to === undefined) {
      fail(
        `TO is undefined: uuid ${se.toUUID}, index ${
          (synapse as SynapseInternal).to
        }`,
      );
    }

    if (isSorted) {
      if (from > lastFrom) {
        lastFrom = from;
        lastTo = -1;
      } else if (from < lastFrom || to <= lastTo) {
        isSorted = false;
      }
      lastTo = to;
    }

    const tmpSynapse = new Synapse(from!, to!, synapse.weight, synapse.type);
    creature.synapses[i] = tmpSynapse;

    if (synapse.tags) {
      tmpSynapse.tags = synapse.tags.slice();
    }

    if ((synapse as SynapseTrace).trace) {
      Object.assign(
        state.connection(tmpSynapse.from, tmpSynapse.to),
        (synapse as SynapseTrace).trace,
      );
    }
  }

  creature.memetic = json.memetic;
  creature.clearCache();

  if (!isSorted) {
    creature.synapses.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      return a.to - b.to;
    });
  }

  creature.prebuildInwardIndexIfLarge();

  if (validate) {
    creatureValidate(creature);
  }
}

/**
 * Factory method to create a creature from JSON.
 * Handles semantic version upgrades via upgradeOne().
 * Normalises legacy properties (nodes -> neurons, connections -> synapses).
 */
export function fromJSON(
  json: CreatureInternal | CreatureExport,
  validate: boolean,
  CreatureClass: {
    new (
      input: number,
      output: number,
      options: { lazyInitialization: boolean; semanticVersion?: string },
    ): Creature;
  },
): Creature {
  const semanticVersion = json.semanticVersion ?? "0.0.1";
  if (semanticVersion.startsWith("0.")) {
    json = upgradeOne(json);
  }

  const creature = new CreatureClass(json.input, json.output, {
    lazyInitialization: true,
    semanticVersion: json.semanticVersion,
  });

  const raw = json as unknown as Record<string, unknown>;
  if (raw.nodes) {
    raw.neurons = raw.nodes;
    delete raw.nodes;
  }
  if (raw.connections) {
    raw.synapses = raw.connections;
    delete raw.connections;
  }
  loadFrom(creature, json, validate);

  return creature;
}

/**
 * Creates a shallow clone of a creature.
 * Significantly faster than using fromJSON(exportJSON()).
 * Issue #1025: Performance optimisation for fittest creature tracking.
 */
export function shallowClone(
  creature: Creature,
  CreatureClass: {
    new (
      input: number,
      output: number,
      options: {
        lazyInitialization: boolean;
        semanticVersion: string;
      },
    ): Creature;
  },
): Creature {
  const clone = new CreatureClass(creature.input, creature.output, {
    lazyInitialization: true,
    semanticVersion: creature.semanticVersion,
  });

  clone.uuid = creature.uuid;
  clone.score = creature.score;
  clone.forwardOnly = creature.forwardOnly;
  clone.DEBUG = creature.DEBUG;

  if (creature.memetic) {
    clone.memetic = { ...creature.memetic };
  }

  if (creature.tags) {
    clone.tags = [...creature.tags];
  }

  if (creature.cachedScoreComponents) {
    clone.cachedScoreComponents = { ...creature.cachedScoreComponents };
  }

  const neuronCount = creature.neurons.length;
  clone.neurons = new Array(neuronCount);

  for (let i = 0; i < creature.input; i++) {
    const original = creature.neurons[i];
    const neuron = new Neuron(original.uuid, "input", 0, clone);
    neuron.index = i;
    const originalTags = original.tags as TagInterface[] | undefined;
    if (originalTags) {
      (neuron as { tags: TagInterface[] | undefined }).tags = [
        ...originalTags,
      ];
    }
    clone.neurons[i] = neuron;
  }

  for (let i = creature.input; i < neuronCount; i++) {
    const original = creature.neurons[i];
    const neuron = new Neuron(
      original.uuid,
      original.type,
      original.bias,
      clone,
      original.squash,
    );
    neuron.index = i;
    const originalTags = original.tags as TagInterface[] | undefined;
    if (originalTags) {
      (neuron as { tags: TagInterface[] | undefined }).tags = [
        ...originalTags,
      ];
    }
    clone.neurons[i] = neuron;
  }

  const synapseCount = creature.synapses.length;
  clone.synapses = new Array(synapseCount);

  for (let i = 0; i < synapseCount; i++) {
    const original = creature.synapses[i];
    const synapse = new Synapse(
      original.from,
      original.to,
      original.weight,
      original.type,
    );
    if (original.tags) {
      synapse.tags = [...original.tags];
    }
    clone.synapses[i] = synapse;
  }

  return clone;
}
