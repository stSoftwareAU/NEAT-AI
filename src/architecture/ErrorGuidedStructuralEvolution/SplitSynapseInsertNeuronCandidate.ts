import type { CreatureExport } from "../CreatureInterfaces.ts";
import type { NeuronExport } from "../NeuronInterfaces.ts";
import type { SynapseExport } from "../SynapseInterfaces.ts";
import { CreatureUtil } from "../CreatureUtils.ts";
import { Creature } from "../../Creature.ts";
import { cleanupMemeticForRemovedSynapse } from "../../compact/CompactUtils.ts";

export interface SplitSynapseInsertNeuronCandidateSynapse {
  "from_uuid": string;
  "to_uuid": string;
  weight: number;
  type?: string;
}

/**
 * Candidate emitted by NEAT-AI-Discovery (Rust): split an existing synapse by
 * inserting a new hidden neuron between two existing neurons.
 */
export interface SplitSynapseInsertNeuronCandidate {
  type: "split_synapse_insert_neuron";
  fromNeuronUuid: string;
  toNeuronUuid: string;
  oldWeight: number;
  newNeuron: { uuid: string; type: "hidden"; squash: string; bias: number };
  newSynapses: [
    SplitSynapseInsertNeuronCandidateSynapse,
    SplitSynapseInsertNeuronCandidateSynapse,
  ];
  expectedCreatureScoreGain: number;
  comment?: string;
  fromNeuronIndex?: number;
  toNeuronIndex?: number;
  targetNeuronImpact?: number;
}

export interface ApplySplitSynapseInsertNeuronCandidateOptions {
  /**
   * Allowed absolute difference between the creature's synapse weight and the
   * candidate's `oldWeight`.
   *
   * Defaults to 1e-6 to tolerate minor JSON rounding.
   */
  weightEpsilon?: number;
}

const DEFAULT_WEIGHT_EPSILON = 1e-6;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSynapseType(
  value: unknown,
): value is NonNullable<SynapseExport["type"]> {
  return value === "positive" || value === "negative" || value === "condition";
}

function buildUuidToIndexMap(creature: CreatureExport): Map<string, number> {
  const uuidToIndex = new Map<string, number>();
  const inputCount = creature.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    uuidToIndex.set(`input-${i}`, i);
  }
  for (let i = 0; i < creature.neurons.length; i++) {
    uuidToIndex.set(creature.neurons[i].uuid, inputCount + i);
  }
  return uuidToIndex;
}

function assertForwardOnlyOrThrow(creature: CreatureExport): void {
  const uuidToIndex = buildUuidToIndexMap(creature);
  for (const synapse of creature.synapses) {
    const from = uuidToIndex.get(synapse.fromUUID);
    const to = uuidToIndex.get(synapse.toUUID);
    if (from === undefined || to === undefined) {
      throw new Error(
        `Cannot validate forward-only ordering: missing neuron UUID for synapse ${synapse.fromUUID} -> ${synapse.toUUID}`,
      );
    }
    if (from >= to) {
      throw new Error(
        `Creature is not forward-only ordered (found self-loop or back-connection): ${synapse.fromUUID} -> ${synapse.toUUID}`,
      );
    }
  }
}

/**
 * Apply a split-synapse candidate deterministically.
 *
 * Behaviour:
 * - Validates exactly one synapse exists from fromNeuronUuid → toNeuronUuid
 * - Validates its weight matches oldWeight within epsilon
 * - Inserts the new hidden neuron immediately before the original target neuron
 *   in evaluation order (forward-only)
 * - Removes the original synapse and adds exactly two new synapses
 *
 * Returns a new Creature instance (does not mutate the input creature).
 */
export function applySplitSynapseInsertNeuronCandidate(
  creature: Creature,
  candidate: SplitSynapseInsertNeuronCandidate,
  options: ApplySplitSynapseInsertNeuronCandidateOptions = {},
): Creature {
  const weightEpsilon = options.weightEpsilon ?? DEFAULT_WEIGHT_EPSILON;

  if (candidate.type !== "split_synapse_insert_neuron") {
    throw new Error(
      `Unsupported candidate type: ${candidate.type}`,
    );
  }

  const base: CreatureExport = creature.exportJSON();
  assertForwardOnlyOrThrow(base);

  if (!candidate.fromNeuronUuid || !candidate.toNeuronUuid) {
    throw new Error("Candidate must specify fromNeuronUuid and toNeuronUuid");
  }
  if (!isFiniteNumber(candidate.oldWeight)) {
    throw new Error("Candidate oldWeight must be a finite number");
  }
  if (
    !candidate.newNeuron || candidate.newNeuron.type !== "hidden" ||
    typeof candidate.newNeuron.uuid !== "string" ||
    candidate.newNeuron.uuid.length === 0
  ) {
    throw new Error("Candidate newNeuron must be a hidden neuron with a UUID");
  }
  if (
    typeof candidate.newNeuron.squash !== "string" ||
    candidate.newNeuron.squash.length === 0
  ) {
    throw new Error("Candidate newNeuron.squash must be a non-empty string");
  }
  if (!isFiniteNumber(candidate.newNeuron.bias)) {
    throw new Error("Candidate newNeuron.bias must be a finite number");
  }

  const uuidToIndex = buildUuidToIndexMap(base);
  const inputCount = base.input ?? 0;

  const fromIndex = uuidToIndex.get(candidate.fromNeuronUuid);
  const toIndex = uuidToIndex.get(candidate.toNeuronUuid);
  if (fromIndex === undefined) {
    throw new Error(
      `fromNeuronUuid not found in creature: ${candidate.fromNeuronUuid}`,
    );
  }
  if (toIndex === undefined) {
    throw new Error(
      `toNeuronUuid not found in creature: ${candidate.toNeuronUuid}`,
    );
  }
  if (fromIndex >= toIndex) {
    throw new Error(
      `Candidate does not respect forward-only ordering: ${candidate.fromNeuronUuid} -> ${candidate.toNeuronUuid}`,
    );
  }
  if (toIndex < inputCount) {
    throw new Error(
      `Candidate toNeuronUuid must not be an input neuron: ${candidate.toNeuronUuid}`,
    );
  }

  const existingNeuronUUIDs = new Set<string>();
  for (let i = 0; i < inputCount; i++) {
    existingNeuronUUIDs.add(`input-${i}`);
  }
  for (const neuron of base.neurons) {
    existingNeuronUUIDs.add(neuron.uuid);
  }
  if (existingNeuronUUIDs.has(candidate.newNeuron.uuid)) {
    throw new Error(
      `Candidate newNeuron UUID already exists in creature: ${candidate.newNeuron.uuid}`,
    );
  }

  if (
    !Array.isArray(candidate.newSynapses) || candidate.newSynapses.length !== 2
  ) {
    throw new Error(
      "Candidate newSynapses must be an array of exactly two synapses",
    );
  }
  const [s0, s1] = candidate.newSynapses;
  const expected0 = `${candidate.fromNeuronUuid}->${candidate.newNeuron.uuid}`;
  const expected1 = `${candidate.newNeuron.uuid}->${candidate.toNeuronUuid}`;
  const got0 = `${s0.from_uuid}->${s0.to_uuid}`;
  const got1 = `${s1.from_uuid}->${s1.to_uuid}`;
  if (got0 !== expected0 || got1 !== expected1) {
    throw new Error(
      `Candidate newSynapses endpoints must be [${expected0}, ${expected1}], got [${got0}, ${got1}]`,
    );
  }
  if (!isFiniteNumber(s0.weight) || !isFiniteNumber(s1.weight)) {
    throw new Error("Candidate newSynapses weights must be finite numbers");
  }
  if (s0.type !== undefined && !isSynapseType(s0.type)) {
    throw new Error(
      `Unsupported synapse type for first new synapse: ${s0.type}`,
    );
  }
  if (s1.type !== undefined && !isSynapseType(s1.type)) {
    throw new Error(
      `Unsupported synapse type for second new synapse: ${s1.type}`,
    );
  }

  const originalKey = `${candidate.fromNeuronUuid}->${candidate.toNeuronUuid}`;
  const originalMatches = base.synapses.filter((s) =>
    `${s.fromUUID}->${s.toUUID}` === originalKey
  );
  if (originalMatches.length !== 1) {
    throw new Error(
      `Expected exactly one synapse ${originalKey} to exist, found ${originalMatches.length}`,
    );
  }
  const original = originalMatches[0];
  if (Math.abs(original.weight - candidate.oldWeight) > weightEpsilon) {
    throw new Error(
      `Synapse ${originalKey} weight mismatch: creature=${original.weight} candidate=${candidate.oldWeight} (epsilon=${weightEpsilon})`,
    );
  }

  const existingSynapseKeys = new Set(
    base.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
  );
  if (
    existingSynapseKeys.has(expected0) || existingSynapseKeys.has(expected1)
  ) {
    throw new Error(
      `Candidate would create duplicate synapse(s): ${
        existingSynapseKeys.has(expected0) ? expected0 : ""
      } ${existingSynapseKeys.has(expected1) ? expected1 : ""}`.trim(),
    );
  }

  const next: CreatureExport = {
    ...base,
    neurons: [...base.neurons],
    synapses: base.synapses.filter((s) =>
      `${s.fromUUID}->${s.toUUID}` !== originalKey
    ),
  };

  // Clean up memetic data if it referenced the removed synapse.
  cleanupMemeticForRemovedSynapse(
    next,
    candidate.fromNeuronUuid,
    candidate.toNeuronUuid,
  );

  // Insert neuron immediately before the original target neuron.
  const insertAt = toIndex - inputCount;
  const insertedNeuron: NeuronExport = {
    uuid: candidate.newNeuron.uuid,
    type: "hidden",
    squash: candidate.newNeuron.squash,
    bias: candidate.newNeuron.bias,
  };
  next.neurons.splice(insertAt, 0, insertedNeuron);

  const newSynapse0: SynapseExport = {
    fromUUID: candidate.fromNeuronUuid,
    toUUID: candidate.newNeuron.uuid,
    weight: s0.weight,
    ...(s0.type ? { type: s0.type } : {}),
  };
  const newSynapse1: SynapseExport = {
    fromUUID: candidate.newNeuron.uuid,
    toUUID: candidate.toNeuronUuid,
    weight: s1.weight,
    ...(s1.type ? { type: s1.type } : {}),
  };

  next.synapses.push(newSynapse0, newSynapse1);

  // Recreate creature to rebuild any internal caches.
  const updated = Creature.fromJSON(next);
  updated.forwardOnly = true;
  updated.validate({ forwardOnly: true });
  CreatureUtil.makeUUID(updated);
  return updated;
}
