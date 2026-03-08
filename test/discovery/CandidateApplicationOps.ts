/**
 * Unit tests for CandidateApplicationOps.
 *
 * Issue #1727: Tests for the low-level operations that apply discovery
 * changes (add neurons, add synapses, change squash, remove neurons,
 * remove synapses) to creature exports.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import {
  applyAddNeurons,
  applyAddSynapses,
  applyChangeSquash,
  applyRemoveNeuron,
  applyRemoveSynapse,
} from "../../src/discovery/CandidateApplicationOps.ts";
import { buildUuidToIndexMap } from "../../src/discovery/CandidateApplication.ts";

/** Base creature JSON: 2 inputs, 1 hidden, 1 output. */
function makeBaseJSON(): CreatureExport {
  return {
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
}

/** Candidate JSON with an extra synapse from input-1 → hidden-1. */
function makeCandidateWithExtraSynapse(): CreatureExport {
  return {
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
}

/** Candidate JSON with an extra neuron and synapses. */
function makeCandidateWithExtraNeuron(): CreatureExport {
  return {
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
  const synapseKeys = exported.synapses.map(
    (s: { fromUUID: string; toUUID: string }) => `${s.fromUUID}->${s.toUUID}`,
  );
  assert(
    synapseKeys.includes("input-1->hidden-1"),
    "should contain the newly added synapse",
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
  const uuidToIndex = buildUuidToIndexMap(creatureJSON);

  // Candidate has a backward synapse (output-0 → hidden-1)
  const candidateJSON: CreatureExport = {
    ...makeBaseJSON(),
    synapses: [
      ...makeBaseJSON().synapses,
      { fromUUID: "output-0", toUUID: "hidden-1", weight: 0.2 },
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
  const candidateJSON: CreatureExport = {
    ...makeBaseJSON(),
    synapses: [
      ...makeBaseJSON().synapses,
      { fromUUID: "nonexistent", toUUID: "hidden-1", weight: 0.2 },
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
  const neuronUUIDs = exported.neurons.map(
    (n: { uuid: string }) => n.uuid,
  );
  assert(
    neuronUUIDs.includes("hidden-new"),
    "should contain the newly added neuron",
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
  const synapseKeys = exported.synapses.map(
    (s: { fromUUID: string; toUUID: string }) => `${s.fromUUID}->${s.toUUID}`,
  );
  assert(
    synapseKeys.includes("input-1->hidden-new"),
    "should have incoming synapse to new neuron",
  );
  assert(
    synapseKeys.includes("hidden-new->output-0"),
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
  // Change hidden-1's squash in candidate
  candidateJSON.neurons[0].squash = "TANH";

  const candidate: DiscoveryCandidate = {
    creature,
    change: {
      type: "change-squash",
      description: "test",
      squashCandidate: {
        neuronUUID: "hidden-1",
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
  const hiddenNeuron = result!.neurons.find((n) => n.uuid === "hidden-1");
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
        neuronUUID: "hidden-1",
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

  // Candidate is missing hidden-1 → output-0 synapse
  const candidateJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      // hidden-1 → output-0 removed; direct input-0 → output-0 reconnection added
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.25 },
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
  const synapseKeys = exported.synapses.map(
    (s: { fromUUID: string; toUUID: string }) => `${s.fromUUID}->${s.toUUID}`,
  );
  assert(
    !synapseKeys.includes("hidden-1->output-0"),
    "removed synapse should be gone",
  );
  assert(
    synapseKeys.includes("input-0->output-0"),
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

  // Candidate has hidden-1 removed with a direct reconnection
  const candidateJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.25 },
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
  const neuronUUIDs = exported.neurons.map(
    (n: { uuid: string }) => n.uuid,
  );
  assert(
    !neuronUUIDs.includes("hidden-1"),
    "removed neuron should be gone",
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

// --- buildUuidToIndexMap ---

Deno.test("buildUuidToIndexMap - maps input and hidden/output UUIDs correctly", () => {
  const json = makeBaseJSON();
  const uuidToIndex = buildUuidToIndexMap(json);

  // Input neurons: input-0 → 0, input-1 → 1
  assertEquals(uuidToIndex.get("input-0"), 0);
  assertEquals(uuidToIndex.get("input-1"), 1);

  // Hidden/output neurons: offset by input count (2)
  assertEquals(uuidToIndex.get("hidden-1"), 2);
  assertEquals(uuidToIndex.get("output-0"), 3);
});

Deno.test("buildUuidToIndexMap - handles creature with no inputs", () => {
  const json: CreatureExport = {
    input: 0,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };

  const uuidToIndex = buildUuidToIndexMap(json);
  assertEquals(uuidToIndex.get("output-0"), 0);
  assertEquals(uuidToIndex.size, 1);
});
