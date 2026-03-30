/**
 * Unit tests for CandidateApplicationOps.
 *
 * Issue #1727: Tests for the low-level operations that apply discovery
 * changes (add neurons, add synapses, change squash, remove neurons,
 * remove synapses) to creature exports.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import {
  applyAddNeurons,
  applyAddSynapses,
  applyChangeSquash,
  applyRemoveNeuron,
  applyRemoveSynapse,
} from "../../src/discovery/CandidateApplicationOps.ts";
import { buildIdToIndexMap } from "../../src/discovery/CandidateApplication.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";

// Integer IDs for the neurons used in these tests (derived from UUID hashing)
// hidden-1 → 1775329650, hidden-new → 29715267, output-0 → -1

/** Base creature JSON: 2 inputs, 1 hidden, 1 output. */
function makeBaseJSON(): CreatureExport {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
  };
  normaliseCreatureExport(json);
  return json;
}

/** Candidate JSON with an extra synapse from input-1 → hidden-1. */
function makeCandidateWithExtraSynapse(): CreatureExport {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
    ],
  };
  normaliseCreatureExport(json);
  return json;
}

/** Candidate JSON with an extra neuron and synapses. */
function makeCandidateWithExtraNeuron(): CreatureExport {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-new", squash: "TANH", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-new", weight: 0.4 },
      { fromUUID: "hidden-new", toUUID: "output-0", weight: 0.6 },
    ],
  };
  normaliseCreatureExport(json);
  return json;
}

// --- applyAddSynapses ---

Deno.test("applyAddSynapses - adds new synapse from candidate", () => {
  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeCandidateWithExtraSynapse();

  const result = applyAddSynapses(
    creatureJSON,
    candidateJSON,
    false,
    undefined,
  );

  assert(result !== undefined, "should return a creature");
  const exported = result!.exportJSON();
  normaliseCreatureExport(exported);
  const synapseKeys = exported.synapses.map(
    (s) => `${s.fromId}->${s.toId}`,
  );
  assert(
    synapseKeys.some((k) => k.includes("->") && k.startsWith("1->")),
    "should contain the newly added synapse from input-1",
  );
});

Deno.test("applyAddSynapses - returns undefined when no new synapses", () => {
  const creatureJSON = makeBaseJSON();
  // Candidate has the same synapses as the creature
  const candidateJSON = makeBaseJSON();

  const result = applyAddSynapses(
    creatureJSON,
    candidateJSON,
    false,
    undefined,
  );
  assertEquals(
    result,
    undefined,
    "should return undefined when no new synapses",
  );
});

Deno.test("applyAddSynapses - enforces forward-only when requested", () => {
  const creatureJSON = makeBaseJSON();
  const uuidToIndex = buildIdToIndexMap(creatureJSON);

  // Candidate has a backward synapse (output-0 → hidden-1)
  const base = makeBaseJSON();
  const candidateJSON: CreatureExport = {
    ...base,
    synapses: [
      ...base.synapses,
      { fromId: -1, toId: 1775329650, weight: 0.2 },
    ],
  };

  const result = applyAddSynapses(
    creatureJSON,
    candidateJSON,
    true,
    uuidToIndex,
  );

  // Should return undefined because backward synapses are rejected
  assertEquals(
    result,
    undefined,
    "should reject backward synapse in forward-only mode",
  );
});

Deno.test("applyAddSynapses - skips synapse with non-existent endpoint", () => {
  const creatureJSON = makeBaseJSON();
  const base = makeBaseJSON();
  const candidateJSON: CreatureExport = {
    ...base,
    synapses: [
      ...base.synapses,
      { fromId: 9999999, toId: 1775329650, weight: 0.2 },
    ],
  };

  const result = applyAddSynapses(
    creatureJSON,
    candidateJSON,
    false,
    undefined,
  );
  assertEquals(
    result,
    undefined,
    "should return undefined when endpoint does not exist",
  );
});

// --- applyAddNeurons ---

Deno.test("applyAddNeurons - adds new hidden neuron from candidate", () => {
  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeCandidateWithExtraNeuron();

  const result = applyAddNeurons(creatureJSON, candidateJSON, false);

  assert(result !== undefined, "should return a creature");
  const exported = result!.exportJSON();
  normaliseCreatureExport(exported);
  const neuronIds = exported.neurons.map((n) => n.id);
  assert(
    neuronIds.includes(29715267),
    "should contain the newly added neuron (hidden-new id=29715267)",
  );
});

Deno.test("applyAddNeurons - returns undefined when no new neurons", () => {
  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeBaseJSON();

  const result = applyAddNeurons(creatureJSON, candidateJSON, false);
  assertEquals(
    result,
    undefined,
    "should return undefined when no new neurons",
  );
});

Deno.test("applyAddNeurons - includes synapses connected to new neuron", () => {
  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeCandidateWithExtraNeuron();

  const result = applyAddNeurons(creatureJSON, candidateJSON, false);

  assert(result !== undefined, "should return a creature");
  const exported = result!.exportJSON();
  normaliseCreatureExport(exported);
  const synapseKeys = exported.synapses.map(
    (s) => `${s.fromId}->${s.toId}`,
  );
  assert(
    synapseKeys.length >= 3,
    "should have incoming synapse to new neuron",
  );
  assert(
    synapseKeys.length >= 3,
    "should have outgoing synapse from new neuron",
  );
});

// --- applyChangeSquash ---

Deno.test("applyChangeSquash - changes squash for target neuron", () => {
  const creature = Creature.fromJSON(makeBaseJSON());
  creature.validate();
  CreatureUtil.makeUUID(creature);

  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeBaseJSON();
  // Change hidden-1's squash in candidate (id=1775329650)
  candidateJSON.neurons[0].squash = "TANH";

  const candidate: DiscoveryCandidate = {
    creature,
    change: {
      type: "change-squash",
      description: "test",
      squashCandidate: {
        neuronUuid: "hidden-1",
        previousSquash: "IDENTITY",
        squash: "TANH",
        expectedCreatureScoreGain: 0.05,
        improvedError: 0.02,
        currentError: 0.1,
      },
    },
  };

  const result = applyChangeSquash(
    creature,
    creatureJSON,
    candidateJSON,
    candidate,
  );

  assert(result !== undefined, "should return a creature");
  // Find the hidden neuron and check its squash
  const hiddenNeuron = result!.neurons.find((n) => n.id === 1775329650);
  assert(hiddenNeuron, "should find hidden neuron");
  assertEquals(
    hiddenNeuron!.squash,
    "TANH",
    "squash should be changed to TANH",
  );
});

Deno.test("applyChangeSquash - returns original creature when squash already matches", () => {
  const creature = Creature.fromJSON(makeBaseJSON());
  creature.validate();
  CreatureUtil.makeUUID(creature);

  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeBaseJSON(); // Same squash

  const candidate: DiscoveryCandidate = {
    creature,
    change: {
      type: "change-squash",
      description: "test",
      squashCandidate: {
        neuronUuid: "hidden-1",
        previousSquash: "IDENTITY",
        squash: "IDENTITY", // Same as current
        expectedCreatureScoreGain: 0.05,
        improvedError: 0.02,
        currentError: 0.1,
      },
    },
  };

  const result = applyChangeSquash(
    creature,
    creatureJSON,
    candidateJSON,
    candidate,
  );

  // When no change is made, returns the original creature
  assertEquals(
    result,
    creature,
    "should return original creature when no change",
  );
});

// --- applyRemoveSynapse ---

Deno.test("applyRemoveSynapse - removes synapse that was in base but not candidate", () => {
  // Base has 2 synapses
  const baseJSON = makeBaseJSON();
  const creatureJSON = makeBaseJSON();

  // Candidate is missing hidden-1 → output-0 synapse (1775329650 → -1)
  const candidateJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { id: 1775329650, type: "hidden", squash: "IDENTITY", bias: 0 },
      { id: -1, type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: 1775329650, weight: 0.5 },
      // hidden-1 → output-0 removed; direct input-0 → output-0 reconnection added
      { fromId: 0, toId: -1, weight: 0.25 },
    ],
  };

  const result = applyRemoveSynapse(
    creatureJSON,
    candidateJSON,
    baseJSON,
    false,
    undefined,
  );

  assert(result !== undefined, "should return a creature");
  const exported = result!.exportJSON();
  normaliseCreatureExport(exported);
  const _synapseKeys = exported.synapses.map(
    (s) => `${s.fromId}->${s.toId}`,
  );
  assert(
    exported.synapses.length < 3,
    "removed synapse should be gone",
  );
  assert(
    exported.synapses.length >= 1,
    "reconnection synapse should be added",
  );
});

Deno.test("applyRemoveSynapse - returns undefined when nothing to remove or add", () => {
  const baseJSON = makeBaseJSON();
  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeBaseJSON(); // Same as base

  const result = applyRemoveSynapse(
    creatureJSON,
    candidateJSON,
    baseJSON,
    false,
    undefined,
  );

  assertEquals(result, undefined, "should return undefined when no changes");
});

// --- applyRemoveNeuron ---

Deno.test("applyRemoveNeuron - removes hidden neuron that was in base but not candidate", () => {
  const baseJSON = makeBaseJSON();
  const creatureJSON = makeBaseJSON();
  const creature = Creature.fromJSON(makeBaseJSON());
  creature.validate();

  // Candidate has hidden-1 (id=1775329650) removed with a direct reconnection
  const candidateJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { id: -1, type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromId: 0, toId: -1, weight: 0.25 },
    ],
  };

  const result = applyRemoveNeuron(
    creature,
    creatureJSON,
    candidateJSON,
    baseJSON,
    false,
    "remove-neuron",
  );

  assert(result !== undefined, "should return a creature");
  const exported = result!.exportJSON();
  normaliseCreatureExport(exported);
  const neuronIds = exported.neurons.map((n) => n.id);
  assert(
    !neuronIds.includes(1775329650),
    "removed neuron (hidden-1) should be gone",
  );
});

Deno.test("applyRemoveNeuron - returns original creature when nothing to remove", () => {
  const baseJSON = makeBaseJSON();
  const creatureJSON = makeBaseJSON();
  const candidateJSON = makeBaseJSON(); // Same as base
  const creature = Creature.fromJSON(makeBaseJSON());
  creature.validate();

  const result = applyRemoveNeuron(
    creature,
    creatureJSON,
    candidateJSON,
    baseJSON,
    false,
    "remove-neuron",
  );

  assertEquals(
    result,
    creature,
    "should return original creature when no changes",
  );
});

// --- buildIdToIndexMap ---

Deno.test("buildIdToIndexMap - maps input and hidden/output UUIDs correctly", () => {
  const json = makeBaseJSON();
  const uuidToIndex = buildIdToIndexMap(json);

  // Input neurons: input-0 → 0, input-1 → 1
  assertEquals(uuidToIndex.get(0), 0);
  assertEquals(uuidToIndex.get(1), 1);

  // Hidden/output neurons: offset by input count (2)
  // hidden-1 has id=1775329650, output-0 has id=-1
  assertEquals(uuidToIndex.get(1775329650), 2);
  assertEquals(uuidToIndex.get(-1), 3);
});

Deno.test("buildIdToIndexMap - handles creature with no inputs", () => {
  const json: CreatureExport = {
    input: 0,
    output: 1,
    neurons: [
      { id: -1, type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };

  const uuidToIndex = buildIdToIndexMap(json);
  assertEquals(uuidToIndex.get(-1), 0);
  assertEquals(uuidToIndex.size, 1);
});
