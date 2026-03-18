import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";
import { train } from "../TrainTestOnlyUtil.ts";

/**
 * Calculate mean squared error for a creature against a data set.
 */
function calculateError(
  creature: Creature,
  dataSet: DataRecordInterface[],
): number {
  let error = 0;
  const count = dataSet.length;
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const data = dataSet[i];
    const output = creature.activate(new Float32Array(data.input), false);
    error += mse.calculate(
      new Float32Array(data.output),
      new Float32Array(output),
    );
  }
  return error / count;
}

/**
 * Generate a data set from a creature's current behaviour.
 */
function generateDataSet(
  creature: Creature,
  count: number,
  inputRange = 2,
): DataRecordInterface[] {
  const dataSet: DataRecordInterface[] = [];
  for (let i = count; i--;) {
    const input = new Float32Array(creature.input);
    for (let j = 0; j < creature.input; j++) {
      input[j] = Math.random() * inputRange * 2 - inputRange;
    }
    const output = creature.activate(input, false);
    dataSet.push({
      input,
      output: new Float32Array(Array.from(output)),
    });
  }
  return dataSet;
}

/**
 * Perturb biases and weights on an exported creature JSON.
 */
function perturb(
  json: CreatureExport,
  biasAmount: number,
  weightAmount: number,
): CreatureExport {
  json.neurons.forEach((neuron, indx) => {
    neuron.bias += (indx % 2 === 0 ? 1 : -1) * biasAmount;
  });
  json.synapses.forEach((synapse, indx) => {
    synapse.weight += (indx % 2 === 0 ? 1 : -1) * weightAmount;
  });
  return json;
}

/**
 * Assert that training reduces error for a given creature topology.
 * Retries with fresh data sets to account for stochastic initialisation.
 */
function assertTrainingReducesError(
  makeCreatureFn: () => Creature,
  options?: {
    maxAttempts?: number;
    iterations?: number;
    perturbBias?: number;
    perturbWeight?: number;
    dataSetSize?: number;
    inputRange?: number;
  },
): void {
  const maxAttempts = options?.maxAttempts ?? 25;
  const iterations = options?.iterations ?? 200;
  const perturbBias = options?.perturbBias ?? 0.15;
  const perturbWeight = options?.perturbWeight ?? 0.15;
  const dataSetSize = options?.dataSetSize ?? 100;
  const inputRange = options?.inputRange ?? 2;

  for (let attempt = 0;; attempt++) {
    const creature = makeCreatureFn();
    const dataSet = generateDataSet(creature, dataSetSize, inputRange);

    const exportJSON = creature.exportJSON();
    perturb(exportJSON, perturbBias, perturbWeight);

    const perturbedCreature = Creature.fromJSON(exportJSON);
    perturbedCreature.validate();

    const beforeError = calculateError(perturbedCreature, dataSet);
    if (beforeError < 0.0001) continue; // Perturbation had no effect, retry

    const trainCreature = Creature.fromJSON(exportJSON);
    trainCreature.validate();

    const result = train(trainCreature, dataSet, {
      iterations,
      targetError: beforeError - 0.001,
    });

    const afterError = calculateError(trainCreature, dataSet);

    if (attempt < maxAttempts - 1) {
      if (beforeError <= afterError) continue;
    }

    assert(
      beforeError > afterError,
      `Backprop should reduce error: was ${beforeError}, now ${afterError}` +
        ` (reported: ${result.error})`,
    );
    break;
  }
}

// ---------------------------------------------------------------------------
// 1. Bounded → Bounded chain: TANH → LOGISTIC → BIPOLAR_SIGMOID
// ---------------------------------------------------------------------------
Deno.test("mixed squash: bounded chain TANH → LOGISTIC → BIPOLAR_SIGMOID reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h1", squash: "TANH", bias: 0.1 },
        { type: "hidden", uuid: "h2", squash: "LOGISTIC", bias: -0.1 },
        {
          type: "output",
          uuid: "output-0",
          squash: "BIPOLAR_SIGMOID",
          bias: 0.05,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.6 },
        { fromUUID: "input-1", toUUID: "h1", weight: -0.4 },
        { fromUUID: "h1", toUUID: "h2", weight: 0.7 },
        { fromUUID: "h2", toUUID: "output-0", weight: -0.5 },
      ],
      input: 2,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  });
});

// ---------------------------------------------------------------------------
// 2. Unbounded → Bounded chain: ReLU → TANH → LOGISTIC
// ---------------------------------------------------------------------------
Deno.test("mixed squash: unbounded-to-bounded chain ReLU → TANH → LOGISTIC reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h1", squash: "ReLU", bias: 0.0 },
        { type: "hidden", uuid: "h2", squash: "TANH", bias: 0.1 },
        {
          type: "output",
          uuid: "output-0",
          squash: "LOGISTIC",
          bias: -0.1,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
        { fromUUID: "h1", toUUID: "h2", weight: 0.6 },
        { fromUUID: "h2", toUUID: "output-0", weight: -0.8 },
      ],
      input: 2,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  });
});

// ---------------------------------------------------------------------------
// 3. Non-differentiable mixed: STEP → ReLU → TANH
// ---------------------------------------------------------------------------
Deno.test("mixed squash: non-differentiable chain STEP → ReLU → TANH reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h1", squash: "STEP", bias: 0.0 },
        { type: "hidden", uuid: "h2", squash: "ReLU", bias: 0.1 },
        { type: "output", uuid: "output-0", squash: "TANH", bias: 0.0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.8 },
        { fromUUID: "input-1", toUUID: "h1", weight: -0.6 },
        { fromUUID: "h1", toUUID: "h2", weight: 0.5 },
        { fromUUID: "h2", toUUID: "output-0", weight: 0.7 },
      ],
      input: 2,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  }, { iterations: 300 });
});

// ---------------------------------------------------------------------------
// 4. Aggregate mixed: IF → TANH → ReLU
// ---------------------------------------------------------------------------
Deno.test("mixed squash: aggregate chain IF → TANH → ReLU reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h-if", squash: "IF", bias: 0.0 },
        { type: "hidden", uuid: "h-tanh", squash: "TANH", bias: 0.1 },
        { type: "output", uuid: "output-0", squash: "ReLU", bias: 0.0 },
      ],
      synapses: [
        // IF condition
        {
          fromUUID: "input-0",
          toUUID: "h-if",
          weight: 1.0,
          type: "condition",
        },
        // IF positive branch
        {
          fromUUID: "input-1",
          toUUID: "h-if",
          weight: 0.8,
          type: "positive",
        },
        // IF negative branch
        {
          fromUUID: "input-2",
          toUUID: "h-if",
          weight: 0.6,
          type: "negative",
        },
        { fromUUID: "h-if", toUUID: "h-tanh", weight: 0.5 },
        { fromUUID: "h-tanh", toUUID: "output-0", weight: 0.7 },
      ],
      input: 3,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  }, { iterations: 300 });
});

// ---------------------------------------------------------------------------
// 5. Aggregate mixed: MAXIMUM → LOGISTIC
// ---------------------------------------------------------------------------
Deno.test("mixed squash: aggregate chain MAXIMUM → LOGISTIC reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h-max", squash: "MAXIMUM", bias: 0.0 },
        {
          type: "output",
          uuid: "output-0",
          squash: "LOGISTIC",
          bias: -0.1,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h-max", weight: 0.7 },
        { fromUUID: "input-1", toUUID: "h-max", weight: 0.5 },
        { fromUUID: "input-2", toUUID: "h-max", weight: 0.3 },
        { fromUUID: "h-max", toUUID: "output-0", weight: 0.6 },
      ],
      input: 3,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  });
});

// ---------------------------------------------------------------------------
// 6. All saturating: LOGISTIC → TANH → LOGISTIC with saturation inputs
// ---------------------------------------------------------------------------
Deno.test("mixed squash: all-saturating LOGISTIC → TANH → LOGISTIC reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0.0 },
        { type: "hidden", uuid: "h2", squash: "TANH", bias: 0.0 },
        {
          type: "output",
          uuid: "output-0",
          squash: "LOGISTIC",
          bias: 0.0,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.9 },
        { fromUUID: "input-1", toUUID: "h1", weight: -0.7 },
        { fromUUID: "h1", toUUID: "h2", weight: 1.2 },
        { fromUUID: "h2", toUUID: "output-0", weight: -0.8 },
      ],
      input: 2,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  }, { inputRange: 4 }); // Larger inputs push into saturation zones
});

// ---------------------------------------------------------------------------
// 7. Saturation chain: GAUSSIAN (zero derivative at peak) → SELU
// ---------------------------------------------------------------------------
Deno.test("mixed squash: saturation chain GAUSSIAN → SELU reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h1", squash: "GAUSSIAN", bias: 0.0 },
        { type: "output", uuid: "output-0", squash: "SELU", bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
        { fromUUID: "input-1", toUUID: "h1", weight: -0.3 },
        { fromUUID: "h1", toUUID: "output-0", weight: 0.8 },
      ],
      input: 2,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  });
});

// ---------------------------------------------------------------------------
// 8. Saturation chain: Exponential (exploding derivative) → bounded functions
// ---------------------------------------------------------------------------
Deno.test("mixed squash: Exponential → TANH → LOGISTIC reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "h1", squash: "Exponential", bias: 0.0 },
        { type: "hidden", uuid: "h2", squash: "TANH", bias: 0.1 },
        {
          type: "output",
          uuid: "output-0",
          squash: "LOGISTIC",
          bias: 0.0,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
        { fromUUID: "input-1", toUUID: "h1", weight: -0.2 },
        { fromUUID: "h1", toUUID: "h2", weight: 0.4 },
        { fromUUID: "h2", toUUID: "output-0", weight: 0.6 },
      ],
      input: 2,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  }, { inputRange: 1.5 }); // Keep inputs moderate for Exponential
});

// ---------------------------------------------------------------------------
// 9. Gradient magnitude: verify all weights remain finite and backprop
//    modifies at least some weights through a deep mixed chain
// ---------------------------------------------------------------------------
Deno.test("mixed squash: gradient signal remains finite through 5-layer chain", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "h1", squash: "TANH", bias: 0.0 },
      { type: "hidden", uuid: "h2", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "h3", squash: "BIPOLAR_SIGMOID", bias: -0.1 },
      { type: "hidden", uuid: "h4", squash: "ReLU", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "SELU", bias: 0.05 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h1", weight: -0.3 },
      { fromUUID: "h1", toUUID: "h2", weight: 0.6 },
      { fromUUID: "h2", toUUID: "h3", weight: -0.7 },
      { fromUUID: "h3", toUUID: "h4", weight: 0.4 },
      { fromUUID: "h4", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  // Record all original weights
  const originalSynapses = creature.exportJSON().synapses;
  const originalWeights = originalSynapses.map((s) => s.weight);

  // Use manual backprop to avoid compaction removing intermediate layers
  const config = createBackPropagationConfig({
    disableRandomSamples: true,
    generations: 0,
    learningRate: 0.5,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  for (let epoch = 0; epoch < 10; epoch++) {
    for (let i = 0; i < 20; i++) {
      const input = new Float32Array([
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ]);
      creature.activateAndTrace(input, false, sparseConfig);
      creature.propagate(new Float32Array([0.5]), config, sparseConfig);
    }
    creature.propagateUpdate(config, sparseConfig);
  }

  // Verify all weights remain finite and at least some changed
  const updatedSynapses = creature.exportJSON().synapses;
  let anyChanged = false;

  for (let i = 0; i < updatedSynapses.length; i++) {
    const w = updatedSynapses[i].weight;
    assert(
      isFinite(w),
      `Weight for ${updatedSynapses[i].fromUUID} → ${
        updatedSynapses[i].toUUID
      } should be finite, got ${w}`,
    );
    if (Math.abs(w - originalWeights[i]) > 1e-10) {
      anyChanged = true;
    }
  }

  assert(
    anyChanged,
    "Backprop through 5-layer mixed chain should modify at least some weights",
  );
});

// ---------------------------------------------------------------------------
// 10. Safe zone interaction: mixed squash types with wide input range
//     Tests that safeZoneAdjustment factors compose correctly across
//     different upstream squash types during error distribution.
// ---------------------------------------------------------------------------
Deno.test("mixed squash: safe zone interaction across diverse squash types reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        // Three different squash types feeding into a single output
        { type: "hidden", uuid: "h-tanh", squash: "TANH", bias: 0.0 },
        { type: "hidden", uuid: "h-relu", squash: "ReLU", bias: 0.0 },
        {
          type: "hidden",
          uuid: "h-logistic",
          squash: "LOGISTIC",
          bias: 0.0,
        },
        {
          type: "output",
          uuid: "output-0",
          squash: "IDENTITY",
          bias: 0.0,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h-tanh", weight: 0.6 },
        { fromUUID: "input-1", toUUID: "h-relu", weight: 0.5 },
        { fromUUID: "input-2", toUUID: "h-logistic", weight: -0.7 },
        // All three feed into output — error must distribute correctly
        { fromUUID: "h-tanh", toUUID: "output-0", weight: 0.4 },
        { fromUUID: "h-relu", toUUID: "output-0", weight: -0.3 },
        { fromUUID: "h-logistic", toUUID: "output-0", weight: 0.5 },
      ],
      input: 3,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  }, { inputRange: 3 }); // Wider range pushes some squash types into safe zone boundaries
});

// ---------------------------------------------------------------------------
// 11. TANH saturated feeding LOGISTIC near boundary
// ---------------------------------------------------------------------------
Deno.test("mixed squash: saturated TANH feeding LOGISTIC near boundary reduces error", () => {
  assertTrainingReducesError(() => {
    const json: CreatureExport = {
      neurons: [
        // Large bias pushes TANH towards saturation
        { type: "hidden", uuid: "h1", squash: "TANH", bias: 2.5 },
        {
          type: "output",
          uuid: "output-0",
          squash: "LOGISTIC",
          bias: -3.0,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "h1", weight: 1.5 },
        { fromUUID: "h1", toUUID: "output-0", weight: 1.0 },
      ],
      input: 1,
      output: 1,
    };
    const creature = Creature.fromJSON(json);
    creature.validate();
    return creature;
  }, { inputRange: 4, perturbBias: 0.2, perturbWeight: 0.2 });
});
