/**
 * Tests for the extracted DiscoveryApplication module.
 *
 * Verifies that the standalone application functions (removeSynapse,
 * addHelpfulSynapses, addHelpfulNeurons, changeSquash, removeHarmfulNeuron,
 * removeLowImpactNeuron, validateAndFixIfNeeded) correctly modify creatures.
 */

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "../../src/methods/activations/types/LOGISTIC.ts";
import {
  addHelpfulNeurons,
  addHelpfulSynapses,
  changeSquash,
  getRemovalSameUUIDCount,
  recordDiscoveryIssue,
  removeHarmfulNeuron,
  removeSynapse,
  resetRemovalDiagnostics,
  validateAndFixIfNeeded,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoveryApplication.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { initWasmForTests } from "../_initWasm.ts";

function makeTestCreature(): Creature {
  const exportJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: IDENTITY.NAME,
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: IDENTITY.NAME,
        bias: 0.2,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.75 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.25 },
    ],
  };

  return Creature.fromJSON(exportJSON);
}

Deno.test("validateAndFixIfNeeded succeeds for valid creature", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const original = makeTestCreature();

  const result = validateAndFixIfNeeded(
    creature,
    original,
    "test-id",
    "test-op",
    {},
  );

  assertEquals(result.success, true);
  assertEquals(result.fixWasCalled, false);
});

Deno.test("removeSynapse returns null for undefined candidate", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const result = removeSynapse("test-id", creature, undefined);
  assertEquals(result, null);
});

Deno.test("removeSynapse removes an existing synapse", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();

  const candidate: CandidateSynapse = {
    fromNeuronUUID: "hidden-1",
    toNeuronUUID: "output-0",
    weight: 0.25,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 5,
    totalCount: 10,
  };

  const result = removeSynapse("test-id", creature, candidate);
  assert(result !== null, "should return a modified creature");
  // The modified creature should have fewer synapses
  assert(
    result!.synapses.length < creature.synapses.length,
    "should have fewer synapses",
  );
});

Deno.test("removeSynapse returns null for non-existent synapse", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();

  const candidate: CandidateSynapse = {
    fromNeuronUUID: "hidden-0",
    toNeuronUUID: "hidden-1", // This synapse doesn't exist
    weight: 0.5,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 5,
    totalCount: 10,
  };

  const result = removeSynapse("test-id", creature, candidate);
  assertEquals(result, null);
});

Deno.test("addHelpfulSynapses returns undefined for empty candidates", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  assertEquals(addHelpfulSynapses("test-id", creature, []), undefined);
  assertEquals(addHelpfulSynapses("test-id", creature, undefined), undefined);
});

Deno.test("addHelpfulSynapses adds a new synapse", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();

  const candidate: CandidateSynapse = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "hidden-1", // New connection
    weight: 0.4,
    targetNeuronImpact: 0.8,
    expectedCreatureErrorReduction: 0.02,
    expectedCreatureScoreGain: 0.02,
    improvedCount: 7,
    totalCount: 10,
  };

  const result = addHelpfulSynapses("test-id", creature, [candidate]);
  assert(result !== undefined, "should return a modified creature");
  assert(
    result!.synapses.length > creature.synapses.length,
    "should have more synapses",
  );
});

Deno.test("addHelpfulSynapses skips already existing synapse", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();

  const candidate: CandidateSynapse = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "hidden-0", // Already exists
    weight: 0.5,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0.01,
    expectedCreatureScoreGain: 0.01,
    improvedCount: 5,
    totalCount: 10,
  };

  const result = addHelpfulSynapses("test-id", creature, [candidate]);
  assertEquals(result, undefined);
});

Deno.test("changeSquash returns undefined for empty candidates", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  assertEquals(changeSquash("test-id", creature, []), undefined);
  assertEquals(changeSquash("test-id", creature, undefined), undefined);
});

Deno.test("changeSquash modifies neuron squash function", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();

  const candidate: CandidateSquash = {
    neuronUUID: "hidden-0",
    previousSquash: IDENTITY.NAME,
    squash: LOGISTIC.NAME,
    expectedCreatureScoreGain: 0.03,
    improvedError: 0.01,
    currentError: 0.05,
  };

  const result = changeSquash("test-id", creature, [candidate]);
  assert(result !== undefined, "should return a modified creature");
  const modifiedNeuron = result!.neurons.find((n) => n.uuid === "hidden-0");
  assert(modifiedNeuron !== undefined, "hidden-0 should exist");
  assertEquals(modifiedNeuron!.squash, LOGISTIC.NAME);
});

Deno.test("addHelpfulNeurons returns undefined for empty candidates", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  assertEquals(addHelpfulNeurons("test-id", creature, []), undefined);
  assertEquals(addHelpfulNeurons("test-id", creature, undefined), undefined);
});

Deno.test("addHelpfulNeurons adds a new neuron with synapses", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const originalNeuronCount = creature.neurons.length;

  const candidate: CandidateNeuron = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "output-0",
    incomingWeight: 0.5,
    outgoingWeight: 0.3,
    squash: IDENTITY.NAME,
    bias: 0.1,
    targetNeuronImpact: 1.0,
    expectedCreatureErrorReduction: 0.02,
    expectedCreatureScoreGain: 0.02,
    improvedCount: 8,
    totalCount: 10,
  };

  const result = addHelpfulNeurons("test-id", creature, [candidate]);
  assert(result !== undefined, "should return a modified creature");
  assert(
    result!.neurons.length > originalNeuronCount,
    "should have more neurons",
  );
});

Deno.test("removeHarmfulNeuron returns undefined for undefined candidate", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  assertEquals(removeHarmfulNeuron("test-id", creature, undefined), undefined);
});

Deno.test("removeHarmfulNeuron removes a hidden neuron", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const originalNeuronCount = creature.neurons.length;

  const candidate: CandidateHarmfulNeuron = {
    neuronUUID: "hidden-1",
    errorMagnitude: 0.5,
    expectedCreatureScoreGain: 0.05,
    sampleCount: 100,
    averageActivation: 0.3,
  };

  const result = removeHarmfulNeuron("test-id", creature, candidate);
  assert(result !== undefined, "should return a modified creature");
  assert(
    result!.neurons.length < originalNeuronCount,
    "should have fewer neurons",
  );
  assertEquals(
    result!.neurons.find((n) => n.uuid === "hidden-1"),
    undefined,
  );
});

Deno.test("removeHarmfulNeuron refuses to remove output neurons", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();

  const candidate: CandidateHarmfulNeuron = {
    neuronUUID: "output-0",
    errorMagnitude: 0.5,
    expectedCreatureScoreGain: 0.05,
    sampleCount: 100,
    averageActivation: 0.3,
  };

  const result = removeHarmfulNeuron("test-id", creature, candidate);
  assertEquals(result, undefined);
});

Deno.test("resetRemovalDiagnostics and getRemovalSameUUIDCount work together", () => {
  resetRemovalDiagnostics();
  assertEquals(getRemovalSameUUIDCount(), 0);
});

Deno.test("recordDiscoveryIssue writes diagnostic files", async () => {
  await initWasmForTests();
  const creature = makeTestCreature();
  const tempDir = await Deno.makeTempDir({
    prefix: "discovery-issue-test-",
  });

  try {
    recordDiscoveryIssue(
      creature,
      "test-id",
      "add-neurons",
      "ordering",
      { message: "test issue" },
      tempDir,
    );

    // Verify the issues directory was created
    let foundIssueDir = false;
    for await (const entry of Deno.readDir(`${tempDir}/issues`)) {
      if (entry.isDirectory) {
        foundIssueDir = true;
        // Verify files were created
        const files = [];
        for await (
          const file of Deno.readDir(`${tempDir}/issues/${entry.name}`)
        ) {
          files.push(file.name);
        }
        assert(files.includes("candidate.json"), "should have candidate.json");
        assert(
          files.includes("original-creature.json"),
          "should have original-creature.json",
        );
        assert(files.includes("error.txt"), "should have error.txt");
      }
    }
    assert(foundIssueDir, "should have created an issue directory");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
