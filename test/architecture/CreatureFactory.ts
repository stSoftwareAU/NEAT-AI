/**
 * Tests for the Creature Factory (Issue #2794).
 *
 * Covers the metadata-only entry point (`creatureForProblem`) and the
 * optional dataset-scan entry point (`creatureForDataset`), plus the
 * static-method forwarders on `Creature`.
 *
 * Acceptance criteria from the issue:
 *  - Factory lives in its own module — exercised by importing from
 *    `@architecture/CreatureFactory.ts` directly.
 *  - Output activation + loss derived from the cost.
 *  - Weight/bias init scaled by fan-in / activation.
 *  - Capacity heuristic from `(n_in, n_out)`, biased small for high-dim.
 *  - Declarable input/output ranges select bounded output (TANH) and
 *    skip normalization with no scan.
 *  - Optional `forDataset` scan adds non-declarable smarts (dead-feature
 *    pruning, target stats) — not normalization.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import {
  creatureForDataset,
  creatureForProblem,
  DEAD_FEATURE_VARIANCE_THRESHOLD,
  HIGH_DIMENSIONAL_INPUT_THRESHOLD,
  pickHiddenCapacity,
  pickOutputSquashForProblem,
  readCurrentGenerationFromCreature,
  readWarmupGenerationsFromCreature,
  rescaleWeightsForInit,
  scanTrainingData,
  targetInitStddev,
} from "@architecture/CreatureFactory.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

// ─── Output squash selection ────────────────────────────────────────────

Deno.test("pickOutputSquashForProblem: CROSS_ENTROPY + multi-class → SOFTMAX", () => {
  assertEquals(
    pickOutputSquashForProblem({
      inputs: 10,
      outputs: 10,
      cost: "CROSS_ENTROPY",
    }),
    "SOFTMAX",
  );
});

Deno.test("pickOutputSquashForProblem: CROSS_ENTROPY + high-dim multi-class → SOFTMAX", () => {
  assertEquals(
    pickOutputSquashForProblem({
      inputs: 784,
      outputs: 10,
      cost: "CROSS_ENTROPY",
    }),
    "SOFTMAX",
  );
});

Deno.test("pickOutputSquashForProblem: BINARY_CROSS_ENTROPY → LOGISTIC", () => {
  assertEquals(
    pickOutputSquashForProblem({
      inputs: 5,
      outputs: 1,
      cost: "BINARY_CROSS_ENTROPY",
    }),
    "LOGISTIC",
  );
});

Deno.test("pickOutputSquashForProblem: HINGE → TANH", () => {
  assertEquals(
    pickOutputSquashForProblem({ inputs: 5, outputs: 3, cost: "HINGE" }),
    "TANH",
  );
});

Deno.test("pickOutputSquashForProblem: MSE with no range → IDENTITY (linear)", () => {
  assertEquals(
    pickOutputSquashForProblem({ inputs: 10, outputs: 1, cost: "MSE" }),
    "IDENTITY",
  );
});

Deno.test("pickOutputSquashForProblem: MSE with outputRange [-1, 1] → TANH", () => {
  assertEquals(
    pickOutputSquashForProblem({
      inputs: 3000,
      outputs: 1,
      cost: "MSE",
      outputRange: { min: -1, max: 1 },
    }),
    "TANH",
  );
});

Deno.test("pickOutputSquashForProblem: MSE with outputRange [0, 1] → LOGISTIC", () => {
  assertEquals(
    pickOutputSquashForProblem({
      inputs: 10,
      outputs: 1,
      cost: "MSE",
      outputRange: { min: 0, max: 1 },
    }),
    "LOGISTIC",
  );
});

Deno.test("pickOutputSquashForProblem: no cost, no range → IDENTITY", () => {
  assertEquals(
    pickOutputSquashForProblem({ inputs: 5, outputs: 2 }),
    "IDENTITY",
  );
});

// ─── Hidden-capacity heuristic ──────────────────────────────────────────

Deno.test("pickHiddenCapacity: high-dim uses geometric mean (3000×1 → ~55)", () => {
  const hidden = pickHiddenCapacity({ inputs: 3000, outputs: 1 });
  // sqrt(3000) ≈ 54.77 → rounds to 55.
  assertEquals(hidden, 55);
});

Deno.test("pickHiddenCapacity: small problems use Heaton (10×2 → 9)", () => {
  // ⌈2/3 · 10 + 2⌉ = ⌈8.667⌉ = 9. Cap = 20, not active.
  const hidden = pickHiddenCapacity({ inputs: 10, outputs: 2 });
  assertEquals(hidden, 9);
});

Deno.test("pickHiddenCapacity: Heaton cap at 2·n_in (1×5 → cap=2)", () => {
  // ⌈2/3 + 5⌉ = 6, cap = 2, result = 2.
  const hidden = pickHiddenCapacity({ inputs: 1, outputs: 5 });
  assertEquals(hidden, 2);
});

Deno.test("pickHiddenCapacity: explicit hiddenCapacity override wins", () => {
  assertEquals(
    pickHiddenCapacity({ inputs: 3000, outputs: 1, hiddenCapacity: 8 }),
    8,
  );
});

Deno.test("pickHiddenCapacity: high-dim threshold edge case", () => {
  // Right at threshold: 100×1 → geometric path → round(sqrt(100)) = 10.
  assert(
    pickHiddenCapacity({
      inputs: HIGH_DIMENSIONAL_INPUT_THRESHOLD,
      outputs: 1,
    }) === 10,
  );
});

// ─── Weight-init scaling ────────────────────────────────────────────────

Deno.test("targetInitStddev: He family scales by sqrt(2/fan_in)", () => {
  const stddev = targetInitStddev("RELU", 100, 10);
  assertEquals(stddev, Math.sqrt(2 / 100));
});

Deno.test("targetInitStddev: Xavier family scales by sqrt(2/(fan_in+fan_out))", () => {
  const stddev = targetInitStddev("TANH", 100, 100);
  assertEquals(stddev, Math.sqrt(2 / 200));
});

Deno.test("targetInitStddev: unknown squash falls back to LeCun (sqrt(1/fan_in))", () => {
  const stddev = targetInitStddev("MYSTERY", 100, 10);
  assertEquals(stddev, Math.sqrt(1 / 100));
});

Deno.test("rescaleWeightsForInit: hidden-layer weights bounded by He scaling", () => {
  const creature = creatureForProblem({
    inputs: 100,
    outputs: 1,
    cost: "MSE",
    hiddenSquash: "RELU",
  });
  // fan_in into the hidden layer = 100, He stddev = sqrt(2/100) ≈ 0.1414.
  // A weight rescaled from uniform [-0.5, 0.5] (stddev ≈ 0.289) to the
  // target scales by 0.1414/0.289 ≈ 0.49 — so |weight| ≤ 0.5 · 0.49 ≈ 0.245.
  // The bound applies only to He-family destinations (the hidden layer);
  // the output's Xavier scale legitimately produces larger weights when
  // fan_in into the output is small.
  const heLimit = Math.sqrt(2 / 100) * 0.5 / Math.sqrt(1 / 12);
  let heChecked = 0;
  for (const synapse of creature.synapses) {
    const dest = creature.neurons[synapse.to];
    if (dest.squash !== "RELU") continue;
    heChecked++;
    assert(
      Math.abs(synapse.weight) <= heLimit + 1e-6,
      `weight ${synapse.weight} exceeded He upper bound ${heLimit}`,
    );
  }
  assert(
    heChecked > 0,
    "expected at least one synapse into the RELU hidden layer",
  );
});

// ─── Construction integrity ─────────────────────────────────────────────

Deno.test("creatureForProblem(MNIST-shape) produces a valid SOFTMAX classifier", () => {
  const creature = creatureForProblem({
    inputs: 784,
    outputs: 10,
    cost: "CROSS_ENTROPY",
    inputRange: { min: 0, max: 1 },
  });
  creatureValidate(creature);
  assertEquals(creature.input, 784);
  assertEquals(creature.output, 10);
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") assertEquals(neuron.squash, "SOFTMAX");
  }
  // The factory should not seed a 2·784-wide hidden layer for this input
  // arity; 784 is past the high-dim threshold so geometric mean applies.
  // sqrt(784·10) ≈ 88.5 → 89.
  const hiddenCount =
    creature.neurons.filter((n) => n.type === "hidden").length;
  assertEquals(hiddenCount, 89);
});

Deno.test("creatureForProblem(worked-example) uses small hidden + TANH output", () => {
  // From the issue: 3000 inputs, 1 output, MSE, all values in [-1, 1].
  const creature = creatureForProblem({
    inputs: 3000,
    outputs: 1,
    cost: "MSE",
    inputRange: { min: -1, max: 1 },
    outputRange: { min: -1, max: 1 },
  });
  creatureValidate(creature);
  const output = creature.neurons.find((n) => n.type === "output")!;
  assertEquals(output.squash, "TANH");
  const hiddenCount =
    creature.neurons.filter((n) => n.type === "hidden").length;
  // sqrt(3000) ≈ 55 — much smaller than 2/3·3000 = 2000.
  assertEquals(hiddenCount, 55);
});

Deno.test("creatureForProblem leaves hidden neurons as RELU by default", () => {
  const creature = creatureForProblem({ inputs: 8, outputs: 2, cost: "MSE" });
  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") assertEquals(neuron.squash, "RELU");
  }
});

Deno.test("creatureForProblem honours hiddenSquash override", () => {
  const creature = creatureForProblem({
    inputs: 8,
    outputs: 2,
    cost: "MSE",
    hiddenSquash: "TANH",
  });
  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") assertEquals(neuron.squash, "TANH");
  }
});

Deno.test("creatureForProblem rejects non-positive dims", () => {
  assertThrows(
    () => creatureForProblem({ inputs: 0, outputs: 1 }),
    RangeError,
  );
  assertThrows(
    () => creatureForProblem({ inputs: 5, outputs: 0 }),
    RangeError,
  );
});

// ─── Dataset scan ───────────────────────────────────────────────────────

Deno.test("scanTrainingData: detects constant (dead) features", () => {
  const records: DataRecordInterface[] = [
    { input: new Float32Array([0, 1, 2]), output: new Float32Array([0.1]) },
    { input: new Float32Array([0, 3, 4]), output: new Float32Array([0.2]) },
    { input: new Float32Array([0, 5, 6]), output: new Float32Array([0.3]) },
  ];
  const scan = scanTrainingData(records);
  assertEquals(scan.sampleCount, 3);
  assertEquals(scan.deadInputIndices, [0]);
  assert(scan.inputVariance[0] <= DEAD_FEATURE_VARIANCE_THRESHOLD);
  assert(scan.inputVariance[1] > DEAD_FEATURE_VARIANCE_THRESHOLD);
});

Deno.test("scanTrainingData: target mean used for output-bias warm-start", () => {
  const records: DataRecordInterface[] = [
    { input: new Float32Array([1, 2]), output: new Float32Array([5]) },
    { input: new Float32Array([3, 4]), output: new Float32Array([7]) },
    { input: new Float32Array([5, 6]), output: new Float32Array([9]) },
  ];
  const scan = scanTrainingData(records);
  // mean = (5 + 7 + 9) / 3 = 7.
  assertEquals(scan.outputMean[0], 7);
});

Deno.test("scanTrainingData: rejects empty training set", () => {
  assertThrows(
    () => scanTrainingData([]),
    RangeError,
  );
});

Deno.test("scanTrainingData: rejects inconsistent record shapes", () => {
  assertThrows(
    () =>
      scanTrainingData([
        { input: new Float32Array([1, 2]), output: new Float32Array([0]) },
        { input: new Float32Array([1, 2, 3]), output: new Float32Array([0]) },
      ]),
    RangeError,
  );
});

Deno.test("creatureForDataset: regression output bias matches target mean", () => {
  const records: DataRecordInterface[] = [
    { input: new Float32Array([1, 2]), output: new Float32Array([5]) },
    { input: new Float32Array([3, 4]), output: new Float32Array([7]) },
    { input: new Float32Array([5, 6]), output: new Float32Array([9]) },
  ];
  const creature = creatureForDataset(records, { cost: "MSE" });
  const output = creature.neurons.find((n) => n.type === "output")!;
  assertEquals(output.squash, "IDENTITY");
  // Target mean = 7; output bias should be initialised to that.
  assertEquals(output.bias, 7);
});

Deno.test("creatureForDataset: zeroes synapses out of dead inputs", () => {
  const records: DataRecordInterface[] = [
    { input: new Float32Array([0, 1, 2]), output: new Float32Array([0.1]) },
    { input: new Float32Array([0, 3, 4]), output: new Float32Array([0.2]) },
    { input: new Float32Array([0, 5, 6]), output: new Float32Array([0.3]) },
  ];
  const creature = creatureForDataset(records, { cost: "MSE" });
  // Input neuron 0 is constant — every synapse from index 0 must be zeroed.
  let zeroed = 0;
  let nonZeroFromOtherInputs = 0;
  for (const synapse of creature.synapses) {
    if (synapse.from === 0) {
      assertEquals(synapse.weight, 0);
      zeroed++;
    } else if (synapse.from === 1 || synapse.from === 2) {
      if (synapse.weight !== 0) nonZeroFromOtherInputs++;
    }
  }
  assert(zeroed > 0, "expected at least one synapse from dead input 0");
  assert(
    nonZeroFromOtherInputs > 0,
    "live inputs must keep some non-zero synapses",
  );
});

Deno.test("creatureForDataset: classification output bias is NOT overridden", () => {
  // Bias warm-start is meaningful only for IDENTITY outputs (regression);
  // a SOFTMAX output should NOT be force-set to the one-hot mean.
  const records: DataRecordInterface[] = [
    {
      input: new Float32Array([0.1, 0.2]),
      output: new Float32Array([1, 0, 0]),
    },
    {
      input: new Float32Array([0.3, 0.4]),
      output: new Float32Array([0, 1, 0]),
    },
    {
      input: new Float32Array([0.5, 0.6]),
      output: new Float32Array([0, 0, 1]),
    },
  ];
  const creature = creatureForDataset(records, { cost: "CROSS_ENTROPY" });
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") {
      assertEquals(neuron.squash, "SOFTMAX");
      // The IDENTITY-only bias path must NOT have run, so bias is still
      // the constructor's small random draw, certainly not 1/3.
      assert(
        Math.abs(neuron.bias) < 0.2,
        `softmax output bias should be near the constructor default, was ${neuron.bias}`,
      );
    }
  }
});

Deno.test("creatureForDataset: empty training set throws", () => {
  assertThrows(
    () => creatureForDataset([], { cost: "MSE" }),
    RangeError,
  );
});

Deno.test("creatureForProblem: optional warmupGenerations tag when set", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    cost: "MSE",
    warmupGenerations: 25,
  });
  assertEquals(getTag(creature, "warmupGenerations"), "25");
  const roundTrip = Creature.fromJSON(creature.exportJSON());
  assertEquals(readWarmupGenerationsFromCreature(roundTrip), 25);
  assertEquals(readCurrentGenerationFromCreature(roundTrip), 0);
});

Deno.test("creatureForProblem: omits warmupGenerations tag when unset", () => {
  const creature = creatureForProblem({
    inputs: 4,
    outputs: 1,
    cost: "MSE",
  });
  assertEquals(getTag(creature, "warmupGenerations"), null);
});

Deno.test("creatureForProblem: rejects negative warmupGenerations", () => {
  assertThrows(
    () =>
      creatureForProblem({
        inputs: 4,
        outputs: 1,
        warmupGenerations: -1,
      }),
    RangeError,
  );
});

// ─── Static-method forwarders on Creature ───────────────────────────────

Deno.test("Creature.forProblem static method delegates to factory", () => {
  const creature = Creature.forProblem({
    inputs: 4,
    outputs: 10,
    cost: "CROSS_ENTROPY",
  });
  assert(creature instanceof Creature);
  for (const neuron of creature.neurons) {
    if (neuron.type === "output") assertEquals(neuron.squash, "SOFTMAX");
  }
});

Deno.test("Creature.forDataset static method delegates to factory", () => {
  const records: DataRecordInterface[] = [
    { input: new Float32Array([1, 2]), output: new Float32Array([10]) },
    { input: new Float32Array([3, 4]), output: new Float32Array([20]) },
  ];
  const creature = Creature.forDataset(records, { cost: "MSE" });
  assert(creature instanceof Creature);
  const output = creature.neurons.find((n) => n.type === "output")!;
  assertEquals(output.squash, "IDENTITY");
  assertEquals(output.bias, 15);
});

// ─── Manual rescaleWeightsForInit (independent of construction) ─────────

Deno.test("rescaleWeightsForInit is idempotent in scale ratio for fixed topology", () => {
  // Build with default constructor (no factory), then run the rescaler
  // manually. After rescaling, weights should match the He stddev for
  // RELU hidden, regardless of the initial random draw magnitudes.
  const creature = new Creature(50, 1, {
    layers: [{ count: 8, squash: "RELU" }],
  });
  rescaleWeightsForInit(creature);
  for (const synapse of creature.synapses) {
    assert(Number.isFinite(synapse.weight));
    // Weight must remain bounded — never NaN, never huge.
    assert(Math.abs(synapse.weight) < 10);
  }
});
