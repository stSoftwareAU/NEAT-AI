import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  type CandidateNeuron,
  type CandidateSquash,
  type CandidateSynapse,
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import {
  assertRustDiscoveryAvailable,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import {
  buildDiscoveryCandidates,
  type DiscoveryCandidate,
} from "../../src/discovery/DiscoveryCandidates.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { MSE } from "../../src/costs/MSE.ts";

function makeBaselineCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 4,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: -0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.2 },
      { fromUUID: "input-1", toUUID: "hidden-2", weight: 0.15 },
      { fromUUID: "hidden-2", toUUID: "output-1", weight: -0.3 },
      { fromUUID: "hidden-1", toUUID: "output-1", weight: 0.05 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function makeTargetCreature(): Creature {
  const creature = Creature.fromJSON({
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-3",
        squash: IDENTITY.NAME,
        bias: Math.PI,
      },
      {
        type: "hidden",
        uuid: "hidden-4",
        squash: TANH.NAME,
        bias: Math.SQRT1_2,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: IDENTITY.NAME,
        bias: -0.123,
      },
      {
        type: "output",
        uuid: "output-1",
        squash: LeakyReLU.NAME,
        bias: 0.456,
      },
      {
        type: "output",
        uuid: "output-2",
        squash: Mish.NAME,
        bias: 0.345,
      },
    ],
    synapses: [
      { fromUUID: "input-33", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-50", toUUID: "hidden-4", weight: 0.3 },
      { fromUUID: "input-11", toUUID: "hidden-3", weight: -0.1 },
      { fromUUID: "input-22", toUUID: "hidden-4", weight: 0.2 },
      { fromUUID: "hidden-3", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-10", toUUID: "output-2", weight: -0.4 },
      { fromUUID: "hidden-4", toUUID: "output-2", weight: 0.13 },
    ],
    input: 100,
    output: 3,
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

function generateTrainingData(
  creature: Creature,
  sampleCount = 1024,
): DataRecordInterface[] {
  const trainingData: DataRecordInterface[] = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    const inputValues = new Float32Array(creature.input);
    for (let i = 0; i < creature.input; i++) {
      inputValues[i] = Math.random() * 2 - 1;
    }
    const outputValues = creature.activate(inputValues);
    trainingData.push({
      input: new Float32Array(inputValues),
      output: new Float32Array(outputValues),
    });
  }
  return trainingData;
}

function makeCrippledCreature(targetCreature: Creature): Creature {
  const exported = targetCreature.exportJSON();
  exported.synapses = exported.synapses.filter((synapse) => {
    const removeHidden3 = synapse.fromUUID === "input-33" &&
      synapse.toUUID === "hidden-3";
    const removeHidden4 = synapse.fromUUID === "input-22" &&
      synapse.toUUID === "hidden-4";
    return !(removeHidden3 || removeHidden4);
  });
  exported.synapses.push({
    fromUUID: "input-44",
    toUUID: "hidden-3",
    weight: 1,
  });
  const crippled = Creature.fromJSON(exported);
  crippled.validate();
  CreatureUtil.makeUUID(crippled);
  return crippled;
}

function findCandidate(
  candidates: DiscoveryCandidate[],
  type: DiscoveryCandidate["change"]["type"],
): DiscoveryCandidate {
  const candidate = candidates.find((entry) => entry.change.type === type);
  assert(candidate, `Expected to find candidate for ${type}`);
  return candidate;
}

function averageMSE(
  creature: Creature,
  trainingData: DataRecordInterface[],
): number {
  const evaluator = Creature.fromJSON(creature.exportJSON());
  const mse = new MSE();
  let total = 0;
  for (const record of trainingData) {
    const prediction = evaluator.activate(new Float32Array(record.input));
    total += mse.calculate(record.output, prediction);
  }
  return total / trainingData.length;
}

Deno.test("buildDiscoveryCandidates returns empty list when there are no suggestions", () => {
  const base = makeBaselineCreature();
  const discovery: DiscoverResult = {
    ID: "ABCD1234",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    removeHarmfulSynapse: undefined,
    candidateSquashes: undefined,
  };

  const candidates: DiscoveryCandidate[] = buildDiscoveryCandidates(
    base,
    discovery,
  );
  assertEquals(candidates.length, 0);
  const originalSynapseCount = base.exportJSON().synapses.length;
  assertEquals(originalSynapseCount, 5);
});

Deno.test({
  name:
    "buildDiscoveryCandidates integrates live discovery data for add/remove combinations",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assertRustDiscoveryAvailable();
    const targetCreature = makeTargetCreature();
    const trainingData = generateTrainingData(targetCreature);
    const crippledCreature = makeCrippledCreature(targetCreature);

    const discoverStructure = new DiscoverStructure(
      crippledCreature,
      60,
      DEFAULT_RUST_FLUSH_RECORDS,
    );
    const neuronPromises: Map<string, Promise<void>> = new Map();
    discoverStructure.initialize(neuronPromises);
    try {
      const recorded = discoverStructure.record(trainingData, neuronPromises);
      assert(recorded, "Recording discovery dataset should succeed");
      await Promise.all([...neuronPromises.values()]);

      const flushSuccess = discoverStructure.flushRustRecording();
      assert(flushSuccess, "Flushing discovery data should succeed");

      await discoverStructure.analyzeSelectedNeurons(["hidden-4"]);
      const helpfulSynapses = await discoverStructure.analyzeSelectedNeurons([
        "hidden-3",
      ]);
      assert(
        helpfulSynapses && helpfulSynapses.length >= 1,
        "Expected at least one helpful synapse candidate",
      );

      const removeCandidate = await discoverStructure
        .analyzeSelectedNeuronsForRemoval([
          "hidden-3",
        ]);
      assert(removeCandidate, "Expected a harmful synapse candidate");

      const discovery: DiscoverResult = {
        ID: "TEST-DISCOVERY",
        addHelpfulSynapses: helpfulSynapses ?? undefined,
        addHelpfulNeurons: undefined,
        removeHarmfulSynapse: removeCandidate,
        candidateSquashes: undefined,
      };

      const candidates = buildDiscoveryCandidates(
        crippledCreature,
        discovery,
      );
      const types = candidates.map((candidate) => candidate.change.type).sort();
      assertEquals(types, [
        "add-synapses",
        "combo-add-remove",
        "combo-all",
        "remove-synapse",
      ]);

      const addCandidate = findCandidate(candidates, "add-synapses");
      const addSynapses = addCandidate.creature.exportJSON().synapses;
      const restoredInput22 = addSynapses.some((synapse) =>
        synapse.fromUUID === "input-22" && synapse.toUUID === "hidden-4"
      );
      const restoredInput33 = addSynapses.some((synapse) =>
        synapse.fromUUID === "input-33" && synapse.toUUID === "hidden-3"
      );
      assert(
        restoredInput22 && restoredInput33,
        "Expected missing synapses to be restored by add-synapses candidate",
      );

      const removeEntry = findCandidate(candidates, "remove-synapse");
      const removedSynapses = removeEntry.creature.exportJSON().synapses;
      const removedInput44 = removedSynapses.some((synapse) =>
        synapse.fromUUID === "input-44" && synapse.toUUID === "hidden-3"
      );
      assert(!removedInput44, "Harmful synapse should be removed");

      const comboEntry = findCandidate(candidates, "combo-add-remove");
      const comboSynapses = comboEntry.creature.exportJSON().synapses;
      const comboHasInput22 = comboSynapses.some((synapse) =>
        synapse.fromUUID === "input-22" && synapse.toUUID === "hidden-4"
      );
      const comboHasInput33 = comboSynapses.some((synapse) =>
        synapse.fromUUID === "input-33" && synapse.toUUID === "hidden-3"
      );
      const comboRemovedInput44 = comboSynapses.some((synapse) =>
        synapse.fromUUID === "input-44" && synapse.toUUID === "hidden-3"
      );
      assert(
        comboHasInput22 && comboHasInput33,
        "Combo candidate should contain newly discovered synapses",
      );
      assert(
        !comboRemovedInput44,
        "Combo candidate should exclude the harmful synapse",
      );

      const baselineError = averageMSE(crippledCreature, trainingData);
      const removeError = averageMSE(removeEntry.creature, trainingData);
      const comboError = averageMSE(comboEntry.creature, trainingData);
      const addError = averageMSE(addCandidate.creature, trainingData);

      assert(
        removeError < baselineError,
        "Removing harmful synapses should reduce mean squared error",
      );
      assert(
        comboError < baselineError,
        "Combining discovered changes should reduce mean squared error",
      );
      assert(
        comboError <= addError,
        "Combo candidate should not perform worse than adding synapses alone",
      );
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test("buildDiscoveryCandidates includes helpful neuron suggestions", () => {
  const base = makeBaselineCreature();
  const neuronCandidate: CandidateNeuron = {
    fromNeuronUUID: "input-0",
    toNeuronUUID: "hidden-1",
    incomingWeight: 0.42,
    outgoingWeight: -0.27,
    squash: TANH.NAME,
    bias: 0.11,
    expectedImprovementPercentage: 0.25,
    improvedCount: 8,
    totalCount: 10,
  };

  const discovery: DiscoverResult = {
    ID: "NEURON-123",
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: [neuronCandidate],
    removeHarmfulSynapse: undefined,
    candidateSquashes: undefined,
  };

  const candidates = buildDiscoveryCandidates(base, discovery);
  const addedNeuron = findCandidate(candidates, "add-neurons");
  const exported = addedNeuron.creature.exportJSON();

  const discoveryNeuron = exported.neurons.find((neuron) =>
    neuron.uuid.startsWith("hidden-discovery-")
  );
  assert(discoveryNeuron, "Expected a discovered neuron to be added.");
  assertEquals(discoveryNeuron?.squash, neuronCandidate.squash);

  const incomingSynapseExists = exported.synapses.some((synapse) =>
    synapse.toUUID === discoveryNeuron?.uuid &&
    synapse.fromUUID === neuronCandidate.fromNeuronUUID
  );
  const outgoingSynapseExists = exported.synapses.some((synapse) =>
    synapse.fromUUID === discoveryNeuron?.uuid &&
    synapse.toUUID === neuronCandidate.toNeuronUUID
  );

  assert(
    incomingSynapseExists && outgoingSynapseExists,
    "Expected discovered neuron to include incoming and outgoing synapses.",
  );
});

Deno.test(
  "buildDiscoveryCandidates synthesises combined candidate across categories",
  () => {
    const base = makeBaselineCreature();
    const helpfulSynapses: CandidateSynapse[] = [{
      fromNeuronUUID: "hidden-2",
      toNeuronUUID: "output-0",
      weight: 0.9,
      expectedImprovementPercentage: 0.2,
      improvedCount: 3,
      totalCount: 5,
    }];
    const removeCandidate: CandidateSynapse = {
      fromNeuronUUID: "input-0",
      toNeuronUUID: "hidden-1",
      weight: 0.1,
      expectedImprovementPercentage: 0.15,
      improvedCount: 4,
      totalCount: 6,
    };
    const neuronCandidate: CandidateNeuron = {
      fromNeuronUUID: "input-2",
      toNeuronUUID: "hidden-2",
      incomingWeight: 0.33,
      outgoingWeight: -0.22,
      squash: TANH.NAME,
      bias: 0.07,
      expectedImprovementPercentage: 0.18,
      improvedCount: 6,
      totalCount: 8,
    };
    const squashCandidate: CandidateSquash = {
      neuronUUID: "hidden-1",
      previousSquash: IDENTITY.NAME,
      squash: Mish.NAME,
      expectedImprovementPercentage: 0.21,
      improvedError: 0.04,
      currentError: 0.09,
    };

    const discovery: DiscoverResult = {
      ID: "COMBO-ALL",
      addHelpfulSynapses: helpfulSynapses,
      addHelpfulNeurons: [neuronCandidate],
      removeHarmfulSynapse: removeCandidate,
      candidateSquashes: [squashCandidate],
    };

    const candidates = buildDiscoveryCandidates(base, discovery);
    const comboAll = findCandidate(candidates, "combo-all");
    const exported = comboAll.creature.exportJSON();

    const harmfulStillExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === removeCandidate.fromNeuronUUID &&
      synapse.toUUID === removeCandidate.toNeuronUUID
    );
    assertEquals(
      harmfulStillExists,
      false,
      "Combined candidate should remove the harmful synapse.",
    );

    const helpfulSynapseExists = exported.synapses.some((synapse) =>
      synapse.fromUUID === helpfulSynapses[0].fromNeuronUUID &&
      synapse.toUUID === helpfulSynapses[0].toNeuronUUID &&
      Math.abs(synapse.weight - helpfulSynapses[0].weight) < 1e-6
    );
    assert(
      helpfulSynapseExists,
      "Combined candidate should include the beneficial synapse.",
    );

    const hidden1 = exported.neurons.find((neuron) =>
      neuron.uuid === "hidden-1"
    );
    assert(hidden1, "Hidden neuron should exist after combination.");
    assertEquals(
      hidden1?.squash,
      squashCandidate.squash,
      "Combined candidate should update the squash function.",
    );

    const incomingDiscoverySynapse = exported.synapses.find((synapse) =>
      synapse.fromUUID === neuronCandidate.fromNeuronUUID &&
      Math.abs(synapse.weight - neuronCandidate.incomingWeight) < 1e-6
    );
    assert(
      incomingDiscoverySynapse,
      "Expected discovery neuron incoming synapse to exist.",
    );
    const discoveredNeuronUUID = incomingDiscoverySynapse!.toUUID;
    const outgoingDiscoverySynapse = exported.synapses.find((synapse) =>
      synapse.fromUUID === discoveredNeuronUUID &&
      synapse.toUUID === neuronCandidate.toNeuronUUID &&
      Math.abs(synapse.weight - neuronCandidate.outgoingWeight) < 1e-6
    );
    assert(
      outgoingDiscoverySynapse,
      "Expected discovery neuron outgoing synapse to exist.",
    );

    const discoveredNeuron = exported.neurons.find((neuron) =>
      neuron.uuid === discoveredNeuronUUID
    );
    assert(
      discoveredNeuron,
      "Combined candidate should include discovered neuron.",
    );
  },
);
