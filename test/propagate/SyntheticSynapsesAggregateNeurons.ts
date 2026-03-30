/**
 * Tests for synthetic synapses with aggregate neurons (IF, MAXIMUM, MINIMUM).
 *
 * Issue #1940 - Corner cases discovered when SyntheticSynapses is enabled
 * by default. Aggregate neurons have special structural requirements
 * (typed connections for IF, minimum inward counts) that synthetic
 * synapse generation and removal must respect.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { generateSyntheticSynapses } from "@propagate/SyntheticSynapses.ts";
import { removeSyntheticSynapses } from "@propagate/RemoveSyntheticSynapses.ts";
import { trainDir } from "@architecture/Training.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { Costs } from "@costs";

/** Builds a creature with an IF neuron that has condition/positive/negative connections. */
function makeCreatureWithIF(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "if-neuron", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.5 },
      {
        fromUUID: "hidden-0",
        toUUID: "if-neuron",
        weight: 0.3,
        type: "condition",
      },
      {
        fromUUID: "hidden-1",
        toUUID: "if-neuron",
        weight: 0.4,
        type: "positive",
      },
      {
        fromUUID: "input-0",
        toUUID: "if-neuron",
        weight: 0.2,
        type: "negative",
      },
      { fromUUID: "if-neuron", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/** Builds a creature with a MAXIMUM neuron. */
function makeCreatureWithMAXIMUM(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "max-neuron", squash: "MAXIMUM", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "max-neuron", weight: 1.0 },
      { fromUUID: "hidden-1", toUUID: "max-neuron", weight: 1.0 },
      { fromUUID: "max-neuron", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/** Builds a creature with a MINIMUM neuron. */
function makeCreatureWithMINIMUM(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "min-neuron", squash: "MINIMUM", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "min-neuron", weight: 1.0 },
      { fromUUID: "hidden-1", toUUID: "min-neuron", weight: 1.0 },
      { fromUUID: "min-neuron", toUUID: "output-0", weight: 0.6 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/** Simple XOR-like dataset for training tests. */
function makeTrainingData(): DataRecordInterface[] {
  return [
    {
      input: new Float32Array([0, 0]),
      output: new Float32Array([0]),
    },
    {
      input: new Float32Array([1, 0]),
      output: new Float32Array([1]),
    },
    {
      input: new Float32Array([0, 1]),
      output: new Float32Array([1]),
    },
    {
      input: new Float32Array([1, 1]),
      output: new Float32Array([0]),
    },
  ];
}

// --- Unit tests: generateSyntheticSynapses skips aggregate neurons ---

Deno.test("generateSyntheticSynapses skips IF neurons as targets", () => {
  const creature = makeCreatureWithIF();
  const ifNeuronIdx = creature.neurons.findIndex((n) => n.squash === "IF");
  assert(ifNeuronIdx >= 0, "IF neuron should exist");

  const result = generateSyntheticSynapses(creature);

  // Verify no synthetic synapse targets the IF neuron.
  for (const key of result.syntheticKeys) {
    const toIdx = parseInt(key.split("-")[1], 10);
    assertNotEquals(
      toIdx,
      ifNeuronIdx,
      `Synthetic synapse should not target IF neuron (index ${ifNeuronIdx})`,
    );
  }
  creature.validate();
});

Deno.test("generateSyntheticSynapses skips MAXIMUM neurons as targets", () => {
  const creature = makeCreatureWithMAXIMUM();
  const maxNeuronIdx = creature.neurons.findIndex(
    (n) => n.squash === "MAXIMUM",
  );
  assert(maxNeuronIdx >= 0, "MAXIMUM neuron should exist");

  const result = generateSyntheticSynapses(creature);

  for (const key of result.syntheticKeys) {
    const toIdx = parseInt(key.split("-")[1], 10);
    assertNotEquals(
      toIdx,
      maxNeuronIdx,
      `Synthetic synapse should not target MAXIMUM neuron (index ${maxNeuronIdx})`,
    );
  }
  creature.validate();
});

Deno.test("generateSyntheticSynapses skips MINIMUM neurons as targets", () => {
  const creature = makeCreatureWithMINIMUM();
  const minNeuronIdx = creature.neurons.findIndex(
    (n) => n.squash === "MINIMUM",
  );
  assert(minNeuronIdx >= 0, "MINIMUM neuron should exist");

  const result = generateSyntheticSynapses(creature);

  for (const key of result.syntheticKeys) {
    const toIdx = parseInt(key.split("-")[1], 10);
    assertNotEquals(
      toIdx,
      minNeuronIdx,
      `Synthetic synapse should not target MINIMUM neuron (index ${minNeuronIdx})`,
    );
  }
  creature.validate();
});

// --- Unit tests: removeSyntheticSynapses preserves aggregate neuron structure ---

Deno.test("removeSyntheticSynapses preserves IF neuron typed connections", () => {
  const creature = makeCreatureWithIF();
  const ifNeuronIdx = creature.neurons.findIndex((n) => n.squash === "IF");

  // Record existing typed connections before.
  const beforeTyped = creature.inwardConnections(ifNeuronIdx)
    .filter((c) => c.type)
    .map((c) => `${c.from}-${c.to}:${c.type}`);

  // Generate and remove synthetic synapses (IF should be skipped as target).
  const genResult = generateSyntheticSynapses(creature);
  removeSyntheticSynapses(creature, genResult.syntheticKeys);

  // Verify IF neuron still has all its typed connections.
  const afterTyped = creature.inwardConnections(ifNeuronIdx)
    .filter((c) => c.type)
    .map((c) => `${c.from}-${c.to}:${c.type}`);

  assertEquals(
    beforeTyped.length,
    afterTyped.length,
    "IF neuron should retain all typed connections after synthetic synapse lifecycle",
  );
  creature.validate();
});

// --- Integration tests: training with syntheticSynapses and aggregate neurons ---

Deno.test("training with syntheticSynapses=true and IF neuron produces valid creature", () => {
  const creature = makeCreatureWithIF();
  const trainingData = makeTrainingData();

  const dataDir = makeDataDir(trainingData, trainingData.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const cost = Costs.find("MSE");
    const result = trainDir(creature, dataDir, {
      iterations: 2,
      targetError: 0.01,
      syntheticSynapses: true,
      disableRandomSamples: true,
    }, cost);

    assert(result, "Training should return a result");
    assert(Number.isFinite(result.error), "Error should be finite");

    // The creature should be valid after training.
    creature.validate();

    // The trace should produce a valid creature.
    if (result.trace) {
      const traceCreature = Creature.fromJSON(result.trace);
      traceCreature.validate();
    }

    // The compact should produce a valid creature.
    if (result.compact) {
      const compactCreature = Creature.fromJSON(result.compact);
      compactCreature.validate();
    }
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("training with syntheticSynapses=true and IF neuron, single iteration", () => {
  const creature = makeCreatureWithIF();
  const trainingData = makeTrainingData();

  const dataDir = makeDataDir(trainingData, trainingData.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const cost = Costs.find("MSE");
    // Single iteration — the specific corner case where applyLearnings
    // can modify the creature without loadFrom restoring the best state.
    const result = trainDir(creature, dataDir, {
      iterations: 1,
      targetError: 0.01,
      syntheticSynapses: true,
      disableRandomSamples: true,
    }, cost);

    assert(result, "Training should return a result");
    assert(Number.isFinite(result.error), "Error should be finite");
    creature.validate();

    if (result.trace) {
      const traceCreature = Creature.fromJSON(result.trace);
      traceCreature.validate();
    }

    if (result.compact) {
      const compactCreature = Creature.fromJSON(result.compact);
      compactCreature.validate();
    }
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("training with syntheticSynapses=true and MAXIMUM neuron produces valid creature", () => {
  const creature = makeCreatureWithMAXIMUM();
  const trainingData = makeTrainingData();

  const dataDir = makeDataDir(trainingData, trainingData.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const cost = Costs.find("MSE");
    const result = trainDir(creature, dataDir, {
      iterations: 2,
      targetError: 0.01,
      syntheticSynapses: true,
      disableRandomSamples: true,
    }, cost);

    assert(result, "Training should return a result");
    creature.validate();

    if (result.trace) {
      Creature.fromJSON(result.trace).validate();
    }
    if (result.compact) {
      Creature.fromJSON(result.compact).validate();
    }
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

Deno.test("training with syntheticSynapses=true and MINIMUM neuron produces valid creature", () => {
  const creature = makeCreatureWithMINIMUM();
  const trainingData = makeTrainingData();

  const dataDir = makeDataDir(trainingData, trainingData.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const cost = Costs.find("MSE");
    const result = trainDir(creature, dataDir, {
      iterations: 2,
      targetError: 0.01,
      syntheticSynapses: true,
      disableRandomSamples: true,
    }, cost);

    assert(result, "Training should return a result");
    creature.validate();

    if (result.trace) {
      Creature.fromJSON(result.trace).validate();
    }
    if (result.compact) {
      Creature.fromJSON(result.compact).validate();
    }
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});

// --- Regression test: large creature with IF neurons ---

Deno.test("syntheticSynapses with large creature containing IF neurons", async () => {
  const creature = Creature.fromJSON(
    JSON.parse(
      await Deno.readTextFile("test/propagate/large/creature.json"),
    ),
  );

  // Verify the creature has IF neurons.
  const ifCount = creature.neurons.filter((n) => n.squash === "IF").length;
  assert(ifCount > 0, "Large creature should have IF neurons");

  // Generate synthetic synapses — IF neurons should be skipped as targets.
  const genResult = generateSyntheticSynapses(creature);
  assert(genResult.addedCount > 0, "Should add synthetic synapses");

  // Verify no synthetic synapses target IF neurons.
  const ifIndices = new Set(
    creature.neurons
      .filter((n) => n.squash === "IF")
      .map((n) => n.index),
  );
  for (const key of genResult.syntheticKeys) {
    const toIdx = parseInt(key.split("-")[1], 10);
    assert(
      !ifIndices.has(toIdx),
      `Synthetic synapse must not target IF neuron at index ${toIdx}`,
    );
  }

  // Remove and verify creature is still valid.
  removeSyntheticSynapses(creature, genResult.syntheticKeys);
  creature.validate();
});

// --- Corner case: well-connected IDENTITY network ---

/**
 * When a creature's layers are already well-connected, synthetic synapses
 * spread gradient across extra connections during training. After removal,
 * the original synapses may have slightly different weights than they would
 * without synthetic synapses. This test verifies that training with
 * syntheticSynapses still produces a valid result and does not crash,
 * even if convergence behaviour differs from non-synthetic training.
 */
Deno.test("syntheticSynapses with well-connected IDENTITY network trains without error", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "bipolar-3", squash: "BIPOLAR", bias: 0.1 },
      { type: "hidden", uuid: "cosine-4", squash: "Cosine", bias: -0.1 },
      { type: "hidden", uuid: "absolute-5", squash: "ABSOLUTE", bias: 0.2 },
      {
        type: "hidden",
        uuid: "identity-6",
        squash: "IDENTITY",
        bias: -0.2,
      },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 1 },
      { type: "output", squash: "IDENTITY", uuid: "output-1", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bipolar-3", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "absolute-5", weight: -1.1 },
      { fromUUID: "input-0", toUUID: "cosine-4", weight: -0.3 },
      { fromUUID: "cosine-4", toUUID: "identity-6", weight: 0.3 },
      { fromUUID: "bipolar-3", toUUID: "identity-6", weight: -0.3 },
      { fromUUID: "absolute-5", toUUID: "identity-6", weight: 0.3 },
      { fromUUID: "identity-6", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "input-1", toUUID: "identity-6", weight: 0.35 },
      { fromUUID: "cosine-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  // Generate training data from the creature's own activations.
  const trainingData: DataRecordInterface[] = [];
  for (let i = 0; i < 50; i++) {
    const input = new Float32Array([
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ]);
    const output = creature.activate(input);
    trainingData.push({ input, output: new Float32Array(Array.from(output)) });
  }

  // Perturb biases to create an error signal.
  const exportJSON = creature.exportJSON();
  exportJSON.neurons.forEach((neuron, indx) => {
    neuron.bias += (indx % 2 === 0 ? 1 : -1) * 0.1;
  });

  const dataDir = makeDataDir(trainingData, trainingData.length, {
    input: 3,
    output: 2,
  });

  try {
    const modifiedCreature = Creature.fromJSON(exportJSON);
    modifiedCreature.validate();

    const cost = Costs.find("MSE");
    const result = trainDir(modifiedCreature, dataDir, {
      iterations: 10,
      targetError: 0,
      syntheticSynapses: true,
      disableRandomSamples: true,
    }, cost);

    assert(result, "Training should return a result");
    assert(Number.isFinite(result.error), "Error should be finite");
    modifiedCreature.validate();

    if (result.trace) {
      Creature.fromJSON(result.trace).validate();
    }
    if (result.compact) {
      Creature.fromJSON(result.compact).validate();
    }
  } finally {
    Deno.removeSync(dataDir, { recursive: true });
  }
});
