/**
 * CreatureSerialization.ts - JSON import/export and cloning.
 *
 * Extracted from Creature.ts (Issue #1409) to keep the Creature class
 * under 500 lines and each module focused on a single responsibility.
 */

import { fail } from "@std/assert";
import type { TagInterface } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "../architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { Neuron } from "../architecture/Neuron.ts";
import {
  ensureIdAbove,
  inputNeuronId,
  outputNeuronId,
} from "../architecture/NeuronId.ts";
import type { NeuronTrace } from "../architecture/NeuronInterfaces.ts";
import { Synapse } from "../architecture/Synapse.ts";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "../architecture/SynapseInterfaces.ts";
import type { MemeticInterface } from "../blackbox/MemeticInterface.ts";
import { rejectRecurrentSynapseIfForwardOnlyCreature } from "../architecture/ForwardOnlySynapseGuard.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";
import { upgradeOne } from "../upgrade/UpgradeOne.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";

/** Keys that must never be copied from untrusted data to prevent prototype pollution. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Safely copies own properties from source to target, skipping prototype-polluting keys.
 *
 * Uses Object.defineProperty instead of bracket assignment so that static analysis
 * tools (CodeQL) can verify that Object.prototype is never modified.
 */
function safeAssignProperties(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(source)) {
    if (!UNSAFE_KEYS.has(key)) {
      Object.defineProperty(target, key, {
        value: source[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
}

/**
 * Removes internal integer neuron/synapse ids from a plain export object.
 * Prefer {@link exportSnapshotJSON} when starting from a {@link Creature}.
 */
export function stripNumericIdsFromCreatureExport(
  json: CreatureExport,
): CreatureExport {
  const clone = structuredClone(json) as CreatureExport;
  for (const n of clone.neurons) {
    delete (n as { id?: number }).id;
  }
  for (const s of clone.synapses) {
    delete (s as { fromId?: number }).fromId;
    delete (s as { toId?: number }).toId;
  }
  return clone;
}

/**
 * Builds creature export JSON from the live creature graph (no validation).
 *
 * @param includeIds When true, includes runtime integer IDs for internal use.
 */
function buildCreatureExportJSON(
  creature: Creature,
  includeIds: boolean,
): CreatureExport {
  const builder = new CreatureExportBuilder(creature);
  const json = builder.build(includeIds) as CreatureExport;
  if (includeIds && json.memetic) {
    normaliseCreatureExport(json);
  }
  return json;
}

/**
 * External creature JSON: wire UUIDs only, no runtime integer IDs.
 *
 * Issue #2054: The external export format omits `id` on neurons and
 * `fromId`/`toId` on synapses. External consumers should use UUID fields
 * (`uuid`, `fromUUID`, `toUUID`) which are stable across generations and
 * machines.
 *
 * **Hot-path policy (do not regress):** do **not** add unconditional
 * `creatureValidate` here. Full validation on every export destroys throughput
 * in evolution/training. Invariants should be enforced where structures are
 * produced (mutation, breed, discovery) and in tests; use `creature.DEBUG`
 * to opt into validation on export during development.
 */
export function exportJSON(creature: Creature): CreatureExport {
  if (creature.DEBUG) {
    creatureValidate(creature);
  }
  return buildCreatureExportJSON(creature, false);
}

/**
 * Wire-only snapshot JSON: same as {@link exportJSON} — omits runtime
 * integer neuron and synapse IDs (stable UUID endpoints only).
 *
 * Since Issue #2054, {@link exportJSON} already omits integer IDs, so this
 * method is equivalent. Retained for backward compatibility.
 */
export function exportSnapshotJSON(creature: Creature): CreatureExport {
  return exportJSON(creature);
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
 * Converts UUID-keyed memetic data to use runtime integer neuron IDs.
 * Memetic biases/weights use UUID strings as keys in the wire format;
 * internally the runtime indexes by integer neuron ID.
 */
function convertMemeticToIntIds(
  // deno-lint-ignore no-explicit-any
  memetic: any,
  creature: Creature,
  uuidToIndex: Map<string, number>,
): typeof memetic {
  if (!memetic) return memetic;

  const uuidToIntId = new Map<string, number>();
  for (const [uuid, index] of uuidToIndex) {
    if (index < creature.neurons.length) {
      uuidToIntId.set(uuid, creature.neurons[index].id);
    }
  }

  const needsConversion = (key: string): boolean => {
    return isNaN(Number(key)) && uuidToIntId.has(key);
  };

  // Check if any keys need conversion
  let hasUuidKeys = false;
  if (memetic.biases) {
    for (const key in memetic.biases) {
      if (needsConversion(key)) {
        hasUuidKeys = true;
        break;
      }
    }
  }
  if (!hasUuidKeys && memetic.weights) {
    for (const key in memetic.weights) {
      if (needsConversion(key)) {
        hasUuidKeys = true;
        break;
      }
    }
  }

  if (!hasUuidKeys) return memetic;

  // Deep clone to avoid mutating the original JSON
  // deno-lint-ignore no-explicit-any
  const result: any = JSON.parse(JSON.stringify(memetic));

  // Convert biases keys
  if (result.biases) {
    const newBiases: Record<number, number> = {};
    for (const key in result.biases) {
      const intId = uuidToIntId.get(key);
      if (intId !== undefined) {
        newBiases[intId] = result.biases[key];
      } else {
        const numKey = Number(key);
        if (!isNaN(numKey)) {
          newBiases[numKey] = result.biases[key];
        }
      }
    }
    result.biases = newBiases;
  }

  // Convert weights keys and toUUID/toId inside weight entries
  if (result.weights) {
    // deno-lint-ignore no-explicit-any
    const newWeights: Record<number, any[]> = {};
    for (const key in result.weights) {
      const intId = uuidToIntId.get(key);
      const numericKey = intId !== undefined ? intId : Number(key);
      if (isNaN(numericKey)) continue;

      // deno-lint-ignore no-explicit-any
      const entries = result.weights[key].map((entry: any) => {
        const newEntry = { ...entry };
        if (typeof newEntry.toUUID === "string") {
          const toIntId = uuidToIntId.get(newEntry.toUUID);
          if (toIntId !== undefined) {
            newEntry.toId = toIntId;
            delete newEntry.toUUID;
          }
        }
        return newEntry;
      });
      newWeights[numericKey] = entries;
    }
    result.weights = newWeights;
  }

  // Convert ancestry if present
  if (result.ancestry && Array.isArray(result.ancestry)) {
    // deno-lint-ignore no-explicit-any
    result.ancestry = result.ancestry.map((ancestor: any) => {
      return convertMemeticToIntIds(ancestor, creature, uuidToIndex);
    });
  }

  return result;
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
    const major = Number.parseInt(
      json.semanticVersion.split(".")[0] ?? "0",
      10,
    );
    creature.cachedMajorVersion = Number.isFinite(major) ? major : 0;
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
  // UUIDs are the canonical wire identity for neurons and synapses.
  // uuidToIndex resolves UUID strings (e.g. "input-0", neuron.uuid) to
  // runtime array indices. numericIdToIndex is a fallback for internal
  // round-trips that may still carry runtime integer IDs.
  const uuidToIndex = new Map<string, number>();
  const numericIdToIndex = new Map<number, number>();

  let i = json.input;
  while (i--) {
    const neuronId = inputNeuronId(i);
    numericIdToIndex.set(neuronId, i);
    uuidToIndex.set(`input-${i}`, i);
    const n = new Neuron(neuronId, "input", 0, creature);
    n.index = i;
    creature.neurons[i] = n;
  }

  let pos = json.input;
  let outputIndex = 0;
  const neurons = json.neurons;

  for (let i = 0; i < neurons.length; i++) {
    const jn = neurons[i];
    if (jn.type === "input") continue;

    // deno-lint-ignore no-explicit-any
    const raw = jn as any;

    if (jn.type === "output") {
      const outId = outputNeuronId(outputIndex++);
      (jn as { id: number }).id = outId;
      if (typeof raw.uuid === "string") {
        uuidToIndex.set(raw.uuid, pos);
      }
    } else if (typeof raw.uuid === "string") {
      uuidToIndex.set(raw.uuid, pos);
    }

    const n = Neuron.fromJSON(jn, creature);
    n.index = pos;
    ensureIdAbove(n.id);

    if ((jn as NeuronTrace).trace) {
      const target = state.node(n.index) as unknown as Record<string, unknown>;
      const source = (jn as NeuronTrace).trace as unknown as Record<
        string,
        unknown
      >;
      safeAssignProperties(target, source);
    }

    numericIdToIndex.set(n.id, pos);
    creature.neurons[pos++] = n;
  }

  const synapses = json.synapses;
  let isSorted = true;
  let lastFrom = -1;
  let lastTo = -1;
  for (let i = 0; i < synapseCount; i++) {
    const synapse = synapses[i];
    const se = synapse as SynapseExport;
    // deno-lint-ignore no-explicit-any
    const rawSyn = synapse as any;

    let from: number | undefined;
    if (typeof rawSyn.fromUUID === "string") {
      from = uuidToIndex.get(rawSyn.fromUUID);
    }
    if (from === undefined && se.fromId !== undefined) {
      from = numericIdToIndex.get(se.fromId);
    }
    if (from === undefined) {
      from = (synapse as SynapseInternal).from;
    }

    if (from === undefined) {
      fail(
        `FROM is undefined: fromId ${se.fromId}, fromUUID ${rawSyn.fromUUID}, index ${
          (synapse as SynapseInternal).from
        }, synapse[${i}/${synapseCount}], uuidToIndex size ${uuidToIndex.size}`,
      );
    }

    let to: number | undefined;
    if (typeof rawSyn.toUUID === "string") {
      to = uuidToIndex.get(rawSyn.toUUID);
    }
    if (to === undefined && se.toId !== undefined) {
      to = numericIdToIndex.get(se.toId);
    }
    if (to === undefined) {
      to = (synapse as SynapseInternal).to;
    }

    if (to === undefined) {
      fail(
        `TO is undefined: id ${se.toId}, index ${
          (synapse as SynapseInternal).to
        }`,
      );
    }

    // Forward-only genomes must never contain recurrent edges on the wire or after load:
    // if `json.forwardOnly === true`, reject self-loops and backward links here (same rule
    // as `Creature.connect`). Prevention is at export/source — do not emit `forwardOnly: true`
    // with recurrent synapses; repair tooling must rewrite exports before distribution — Issue #2086.

    rejectRecurrentSynapseIfForwardOnlyCreature(creature, from!, to!);

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

    if (synapse.frozen) {
      tmpSynapse.frozen = true;
    }

    if (synapse.tags) {
      tmpSynapse.tags = synapse.tags.slice();
    }

    if ((synapse as SynapseTrace).trace) {
      const target = state.connection(
        tmpSynapse.from,
        tmpSynapse.to,
      ) as unknown as Record<string, unknown>;
      const source = (synapse as SynapseTrace).trace as unknown as Record<
        string,
        unknown
      >;
      safeAssignProperties(target, source);
    }
  }

  if (json.memetic && uuidToIndex.size > 0) {
    creature.memetic = convertMemeticToIntIds(
      json.memetic,
      creature,
      uuidToIndex,
    );
  } else {
    creature.memetic = json.memetic;
  }
  // Issue #1863: Load per-creature evolvable hyperparameters
  creature.hyperparameters = json.hyperparameters
    ? { ...json.hyperparameters }
    : undefined;
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
    // Deep clone nested weights/biases/ancestry. A shallow copy shares those
    // objects with the source so mutating the clone's synapses can leave stale
    // memetic entries that still match the parent — DEBUG export then fails
    // memetic-vs-synapse validation (e.g. XOR-evolve with global DEBUG).
    clone.memetic = JSON.parse(
      JSON.stringify(creature.memetic),
    ) as MemeticInterface;
  }

  // Issue #1863: Copy per-creature evolvable hyperparameters
  if (creature.hyperparameters) {
    clone.hyperparameters = { ...creature.hyperparameters };
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
    const neuron = new Neuron(original.id, "input", 0, clone);
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
      original.id,
      original.type,
      original.bias,
      clone,
      original.squash,
      original.uuid,
    );
    neuron.index = i;
    if (original.frozen) {
      neuron.frozen = true;
    }
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
    if (original.frozen) {
      synapse.frozen = true;
    }
    if (original.tags) {
      synapse.tags = [...original.tags];
    }
    clone.synapses[i] = synapse;
  }

  return clone;
}
