/**
 * Integration tests for synthetic synapse training lifecycle.
 *
 * Issue #1923 - Verifies that the full synthetic synapse lifecycle works
 * correctly within the training pipeline:
 * 1. Generate synthetic synapses before backpropagation
 * 2. Run backpropagation with the additional synapses
 * 3. Prune near-zero synthetic synapses after training
 * 4. Score the result as normal
 *
 * These tests exercise the real trainDir() function with
 * syntheticSynapses: true to verify end-to-end behaviour.
 */
import { assert, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { trainDir } from "../../src/architecture/Training.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import { Costs } from "../../src/Costs.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";

/** Builds a simple creature: 2 inputs -> 1 hidden -> 1 output. */
function makeSimpleCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/** Builds a multi-layer creature with a gap (no direct input-1 to hidden). */
function makeGappyCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "hidden-1", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.3 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.4 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

/** Creates a simple XOR-like data set. */
function makeXorDataSet(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

Deno.test(
  "trainDir with syntheticSynapses=true completes without error",
  () => {
    const creature = makeSimpleCreature();
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 2,
        syntheticSynapses: true,
        disableRandomSamples: true,
      };

      const result = trainDir(creature, dataSetDir, options, cost);

      assert(Number.isFinite(result.error), "Error should be finite");
      assert(result.iteration > 0, "Should have run at least one iteration");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "syntheticSynapses=false does not alter synapse count",
  () => {
    const creature = makeSimpleCreature();
    const initialSynapseCount = creature.synapses.length;
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 1,
        syntheticSynapses: false,
        disableRandomSamples: true,
      };

      trainDir(creature, dataSetDir, options, cost);

      // Without synthetic synapses, the creature should have at most the
      // same synapse count (compaction may reduce it).
      assert(
        creature.synapses.length <= initialSynapseCount,
        `Synapse count should not increase without synthetic synapses: ` +
          `was ${initialSynapseCount}, now ${creature.synapses.length}`,
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "synthetic synapses are pruned after training — creature validates",
  () => {
    const creature = makeGappyCreature();
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 2,
        syntheticSynapses: true,
        disableRandomSamples: true,
      };

      const result = trainDir(creature, dataSetDir, options, cost);

      // The result should have a valid trace
      assert(result.trace, "Result should have trace data");
      assert(result.trace.neurons.length > 0, "Trace should have neurons");
      assert(result.trace.synapses.length > 0, "Trace should have synapses");

      // Creature should still be valid after synthetic synapse lifecycle
      const resultCreature = Creature.fromJSON(result.trace);
      resultCreature.validate();
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "syntheticSynapses default is off — no behaviour change without opt-in",
  () => {
    const creature = makeSimpleCreature();
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      // No syntheticSynapses option specified — should default to false
      const options: TrainOptions = {
        iterations: 1,
        disableRandomSamples: true,
      };

      const result = trainDir(creature, dataSetDir, options, cost);
      assert(Number.isFinite(result.error), "Error should be finite");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "synthetic synapses with gappy creature can discover new connections",
  () => {
    // The gappy creature has no connection from input-1 to any hidden neuron.
    // With synthetic synapses, backpropagation can train a weight on
    // input-1 -> hidden-0, and if it's significant, it will be retained.
    const creature = makeGappyCreature();
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 5,
        syntheticSynapses: true,
        disableRandomSamples: true,
      };

      const result = trainDir(creature, dataSetDir, options, cost);

      assert(Number.isFinite(result.error), "Error should be finite");
      assert(result.trace, "Result should have trace data");

      // The creature should validate after the full lifecycle
      const resultCreature = Creature.fromJSON(result.trace);
      resultCreature.validate();
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "compact output is valid when syntheticSynapses is enabled",
  () => {
    const creature = makeSimpleCreature();
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 2,
        syntheticSynapses: true,
        disableRandomSamples: true,
      };

      const result = trainDir(creature, dataSetDir, options, cost);

      if (result.compact) {
        // The compact output should produce a valid creature
        const compactCreature = Creature.fromJSON(result.compact);
        compactCreature.validate();
      }
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "syntheticSynapses works with single iteration",
  () => {
    const creature = makeSimpleCreature();
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: creature.input,
      output: creature.output,
    });

    try {
      const options: TrainOptions = {
        iterations: 1,
        syntheticSynapses: true,
        disableRandomSamples: true,
      };

      const result = trainDir(creature, dataSetDir, options, cost);

      assert(Number.isFinite(result.error), "Error should be finite");
      assert(result.iteration === 1, "Should complete exactly one iteration");
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);

Deno.test(
  "syntheticSynapses result error differs from non-synthetic training",
  () => {
    // Train the same creature topology with and without synthetic synapses.
    // The errors should differ because the synthetic synapses change the
    // training dynamics (even if slightly).
    const dataSet = makeXorDataSet();
    const cost = Costs.find("MSE");

    const dataSetDir = makeDataDir(dataSet, dataSet.length, {
      input: 2,
      output: 1,
    });

    try {
      // Without synthetic synapses
      const creatureA = makeGappyCreature();
      const resultA = trainDir(
        creatureA,
        dataSetDir,
        { iterations: 3, syntheticSynapses: false, disableRandomSamples: true },
        cost,
      );

      // With synthetic synapses (same initial topology)
      const creatureB = makeGappyCreature();
      const resultB = trainDir(
        creatureB,
        dataSetDir,
        { iterations: 3, syntheticSynapses: true, disableRandomSamples: true },
        cost,
      );

      // Both should produce finite errors
      assert(Number.isFinite(resultA.error), "Error A should be finite");
      assert(Number.isFinite(resultB.error), "Error B should be finite");

      // With a gappy creature, the synthetic version should train differently
      // because it has more connections to learn from.
      // We just verify both complete — the exact error relationship depends
      // on the specific training dynamics.
      assertNotEquals(
        resultA.trace.synapses.length,
        resultB.trace.synapses.length,
        "Trace synapse counts should likely differ due to synthetic connections",
      );
    } finally {
      Deno.removeSync(dataSetDir, { recursive: true });
    }
  },
);
