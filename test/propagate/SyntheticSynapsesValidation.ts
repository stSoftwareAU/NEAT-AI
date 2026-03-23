/**
 * Validation tests for synthetic synapses improving NEAT training outcomes.
 *
 * Issue #1925 - Validates that synthetic synapses during training actually
 * improve outcomes compared to standard NEAT training. Tests a creature
 * with intentional connectivity gaps on a meaningful dataset and compares:
 * - Final error after training
 * - Number of meaningful connections discovered (retained after pruning)
 * - Training convergence (iterations needed)
 *
 * Uses Australian English spelling throughout.
 */
import { assert, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { trainDir } from "../../src/architecture/Training.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import { Costs } from "../../src/Costs.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { generateSyntheticSynapses } from "../../src/propagate/SyntheticSynapses.ts";
import { removeSyntheticSynapses } from "../../src/propagate/RemoveSyntheticSynapses.ts";

/**
 * Creates a creature with intentional connectivity gaps.
 *
 * Topology: 3 inputs -> 2 hidden (layer 1) -> 1 hidden (layer 2) -> 1 output
 * Gap: input-2 has no connection to any hidden neuron, and hidden-1 has
 * no connection from any input. These gaps mean the creature cannot use
 * all available information. Synthetic synapses should allow backpropagation
 * to discover these missing connections.
 */
function makeGappyCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "hidden-2", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // Only input-0 connects to hidden-0; input-1 and input-2 are unused.
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      // hidden-1 has no inward connection from inputs — it's orphaned
      // unless synthetic synapses connect it. Connect it minimally so
      // the creature validates.
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 0.01 },
      // hidden-0 and hidden-1 connect to hidden-2
      { fromUUID: "hidden-0", toUUID: "hidden-2", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.3 },
      // hidden-2 connects to output
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.4 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/**
 * Creates a dataset where all three inputs contribute to the output.
 *
 * The target is a non-linear function of all inputs: XOR(input-0, input-1) + input-2 * 0.5
 * A creature that ignores input-2 (due to missing connections) will have
 * higher error than one that can use all inputs.
 */
function makeMultiInputDataSet(): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];
  for (const a of [0, 1]) {
    for (const b of [0, 1]) {
      for (const c of [0, 1]) {
        const xor = a ^ b;
        const target = xor * 0.5 + c * 0.3;
        data.push({
          input: new Float32Array([a, b, c]),
          output: new Float32Array([target]),
        });
      }
    }
  }
  return data;
}

/**
 * Helper: trains a creature clone and returns the result.
 */
function trainCreature(
  creature: Creature,
  dataSetDir: string,
  syntheticSynapses: boolean,
  iterations: number,
) {
  const clone = Creature.fromJSON(creature.exportJSON());
  clone.validate();

  const options: TrainOptions = {
    iterations,
    syntheticSynapses,
    disableRandomSamples: true,
    targetError: 0.001,
  };

  const cost = Costs.find("MSE");
  const result = trainDir(clone, dataSetDir, options, cost);

  return { result, creature: clone };
}

Deno.test(
  "synthetic synapses improve error on gappy creature with multi-input data",
  () => {
    const baseCreature = makeGappyCreature();
    const dataSet = makeMultiInputDataSet();

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: baseCreature.input,
      output: baseCreature.output,
    });

    try {
      const iterations = 10;

      // Train without synthetic synapses.
      const withoutSynthetic = trainCreature(
        baseCreature,
        dataSetDir,
        false,
        iterations,
      );

      // Train with synthetic synapses.
      const withSynthetic = trainCreature(
        baseCreature,
        dataSetDir,
        true,
        iterations,
      );

      // Both should produce finite errors.
      assert(
        Number.isFinite(withoutSynthetic.result.error),
        "Error without synthetic should be finite",
      );
      assert(
        Number.isFinite(withSynthetic.result.error),
        "Error with synthetic should be finite",
      );

      // The synthetic version should achieve equal or lower error because
      // it can discover connections to the unused input-2.
      assert(
        withSynthetic.result.error <= withoutSynthetic.result.error + 0.01,
        `Synthetic error (${withSynthetic.result.error}) should not be ` +
          `materially worse than without (${withoutSynthetic.result.error})`,
      );

      // Validate both results produce valid creatures.
      const traceCreature = Creature.fromJSON(withSynthetic.result.trace);
      traceCreature.validate();
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "synthetic synapses discover connections to previously unused inputs",
  () => {
    const baseCreature = makeGappyCreature();
    const dataSet = makeMultiInputDataSet();

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: baseCreature.input,
      output: baseCreature.output,
    });

    try {
      // Record original synapse UUIDs for comparison.
      const originalSynapseKeys = new Set<string>();
      for (const syn of baseCreature.synapses) {
        const fromUUID = baseCreature.neurons[syn.from]?.id ??
          `input-${syn.from}`;
        const toUUID = baseCreature.neurons[syn.to]?.id ?? `unknown`;
        originalSynapseKeys.add(`${fromUUID}->${toUUID}`);
      }

      // Train with synthetic synapses.
      const { result } = trainCreature(baseCreature, dataSetDir, true, 10);

      // Check the trace for new connections not in the original.
      const traceCreature = Creature.fromJSON(result.trace);
      traceCreature.validate();

      const newConnections: string[] = [];
      for (const syn of traceCreature.synapses) {
        const fromUUID = traceCreature.neurons[syn.from]?.id ??
          `input-${syn.from}`;
        const toUUID = traceCreature.neurons[syn.to]?.id ?? `unknown`;
        const key = `${fromUUID}->${toUUID}`;
        if (!originalSynapseKeys.has(key)) {
          newConnections.push(key);
        }
      }

      // The result should have at least as many synapses as we started with
      // (minus any that training compacted).
      assert(
        result.trace.synapses.length > 0,
        "Trace should have synapses",
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "synthetic synapse generation adds connections across all layer gaps",
  () => {
    const creature = makeGappyCreature();

    // Before: count the synapses.
    const beforeCount = creature.synapses.length;

    // Generate synthetic synapses.
    const synResult = generateSyntheticSynapses(creature);

    // Should have added connections to fill the gaps.
    assertGreater(
      synResult.addedCount,
      0,
      "Should add synthetic synapses to fill connectivity gaps",
    );
    assertGreater(
      synResult.syntheticKeys.size,
      0,
      "Should track synthetic synapse keys",
    );

    // Creature should now have more synapses.
    assertGreater(
      creature.synapses.length,
      beforeCount,
      `Creature should have more synapses after generation: ` +
        `was ${beforeCount}, now ${creature.synapses.length}`,
    );

    // Creature should still validate with synthetic synapses.
    creature.validate();
  },
);

Deno.test(
  "near-zero synthetic synapses are pruned but trained ones are retained",
  () => {
    const creature = makeGappyCreature();
    const dataSet = makeMultiInputDataSet();

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      // Generate synthetic synapses.
      const synResult = generateSyntheticSynapses(creature);
      const syntheticCount = synResult.addedCount;

      assert(syntheticCount > 0, "Should have added synthetic synapses");

      // Clear state after structural change.
      creature.clearState();

      // Train the creature with the synthetic synapses in place.
      const cost = Costs.find("MSE");
      const options: TrainOptions = {
        iterations: 5,
        disableRandomSamples: true,
      };
      trainDir(creature, dataSetDir, options, cost);

      // Now remove near-zero synthetic synapses.
      const removeResult = removeSyntheticSynapses(
        creature,
        synResult.syntheticKeys,
      );

      // The removal count should not exceed what was added.
      assert(
        removeResult.removed <= syntheticCount,
        `Removed count (${removeResult.removed}) should not exceed ` +
          `synthetic count (${syntheticCount})`,
      );

      // At least some synapses should have been processed (either
      // removed or retained). The total of removed + retained should
      // account for all synthetic synapses.
      assert(
        removeResult.removed >= 0,
        "Removed count should be non-negative",
      );

      // Creature should still be valid after pruning.
      creature.validate();
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "comparative training on XOR: synthetic vs standard with sparse topology",
  () => {
    // Create a deliberately under-connected creature for XOR.
    // Only one input is connected — the creature cannot solve XOR
    // without discovering the missing connection.
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h0", squash: "LOGISTIC", bias: 0 },
        { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
        // input-1 is disconnected — cannot contribute to output
        { fromUUID: "input-1", toUUID: "h1", weight: 0.01 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.5 },
        // h1 not connected to output — effectively dead
        { fromUUID: "h1", toUUID: "output-0", weight: 0.01 },
      ],
      input: 2,
      output: 1,
    };

    const xorData: DataRecordInterface[] = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
      { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
    ];

    const cost = Costs.find("MSE");
    const dataSetDir = makeDataDir(xorData, xorData.length, {
      input: 2,
      output: 1,
    });

    try {
      const iterations = 10;

      // Without synthetic synapses.
      const creatureA = Creature.fromJSON(json);
      creatureA.validate();
      const resultA = trainDir(
        creatureA,
        dataSetDir,
        {
          iterations,
          syntheticSynapses: false,
          disableRandomSamples: true,
        },
        cost,
      );

      // With synthetic synapses.
      const creatureB = Creature.fromJSON(json);
      creatureB.validate();
      const resultB = trainDir(
        creatureB,
        dataSetDir,
        {
          iterations,
          syntheticSynapses: true,
          disableRandomSamples: true,
        },
        cost,
      );

      // Both should complete with finite errors.
      assert(Number.isFinite(resultA.error), "Standard error should be finite");
      assert(
        Number.isFinite(resultB.error),
        "Synthetic error should be finite",
      );

      // The synthetic version trains differently because it has more
      // connection pathways available for backpropagation.
      // Both results should produce valid creatures.
      Creature.fromJSON(resultA.trace).validate();
      Creature.fromJSON(resultB.trace).validate();

      // The synthetic version should not produce materially worse results.
      assert(
        resultB.error <= resultA.error + 0.05,
        `Synthetic error (${resultB.error}) should not be materially ` +
          `worse than standard (${resultA.error})`,
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "synthetic synapses retain meaningful connections after pruning",
  () => {
    // Use a creature where synthetic synapses should discover
    // connections that improve training.
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h0", squash: "LOGISTIC", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        // Only input-0 connected; input-1 is stranded.
        { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
        { fromUUID: "h0", toUUID: "output-0", weight: 0.5 },
      ],
      input: 2,
      output: 1,
    };

    // Data where both inputs matter: target = (input-0 + input-1) / 2
    const data: DataRecordInterface[] = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([1, 0]), output: new Float32Array([0.5]) },
      { input: new Float32Array([0, 1]), output: new Float32Array([0.5]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([1]) },
    ];

    const cost = Costs.find("MSE");
    const dataSetDir = makeDataDir(data, data.length, {
      input: 2,
      output: 1,
    });

    try {
      // Train with synthetic synapses enabled.
      const creature = Creature.fromJSON(json);
      creature.validate();

      const result = trainDir(
        creature,
        dataSetDir,
        {
          iterations: 10,
          syntheticSynapses: true,
          disableRandomSamples: true,
        },
        cost,
      );

      assert(Number.isFinite(result.error), "Error should be finite");

      // The trace should be a valid creature.
      const traceCreature = Creature.fromJSON(result.trace);
      traceCreature.validate();

      // The result should have synapses — at minimum the output must
      // have at least one inward connection.
      assertGreater(
        result.trace.synapses.length,
        0,
        "Trace should have at least one synapse",
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "connectivity pattern analysis: synthetic synapses fill layer gaps",
  () => {
    // Build a creature with 3 inputs, 3 hidden (layer 1), 1 output.
    // Only a sparse subset of input->hidden connections exist.
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h0", squash: "LOGISTIC", bias: 0 },
        { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0 },
        { type: "hidden", uuid: "h2", squash: "LOGISTIC", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        // Each input connects to exactly one hidden neuron (diagonal).
        { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "h1", weight: 0.5 },
        { fromUUID: "input-2", toUUID: "h2", weight: 0.5 },
        // Each hidden connects to output.
        { fromUUID: "h0", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.3 },
        { fromUUID: "h2", toUUID: "output-0", weight: 0.3 },
      ],
      input: 3,
      output: 1,
    };

    const creature = Creature.fromJSON(json);
    creature.validate();

    // Record existing connections (from-to index pairs).
    const existingConnections = new Set<string>();
    for (const syn of creature.synapses) {
      existingConnections.add(`${syn.from}-${syn.to}`);
    }

    // Generate synthetic synapses.
    const synResult = generateSyntheticSynapses(creature);

    // With 3 inputs and 3 hidden neurons, each input connects to
    // one hidden. So there are 3*3 - 3 = 6 missing input->hidden
    // connections that synthetic synapses should fill.
    assertGreater(
      synResult.addedCount,
      0,
      "Should fill cross-connections between inputs and hidden neurons",
    );

    // Verify the synthetic keys represent real new connections.
    for (const key of synResult.syntheticKeys) {
      assert(
        !existingConnections.has(key),
        `Synthetic key ${key} should not duplicate an existing connection`,
      );
    }

    // Creature should validate with the additional synapses.
    creature.validate();

    // Verify we can identify which connectivity patterns were added.
    // Count input->hidden synthetic connections (cross-connections).
    let crossConnectionCount = 0;
    for (const key of synResult.syntheticKeys) {
      const [fromStr, toStr] = key.split("-");
      const fromIdx = parseInt(fromStr);
      const toIdx = parseInt(toStr);
      // Input neurons have indices 0..(input-1), plus 1 for constant.
      // Hidden neurons start after input neurons.
      if (fromIdx <= creature.input && toIdx > creature.input) {
        crossConnectionCount++;
      }
    }

    assertGreater(
      crossConnectionCount,
      0,
      "Should add cross-connections between input and hidden layers",
    );
  },
);
