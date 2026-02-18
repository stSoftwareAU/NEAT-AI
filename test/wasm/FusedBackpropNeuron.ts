/**
 * Issue #1520 - Tests for fused backprop inner loop WASM function.
 *
 * The fused function combines weight accumulation for all inbound synapses
 * and bias accumulation into a single WASM call, eliminating S+1 boundary
 * crossings per neuron. These tests verify that the fused results match
 * the separate TS approach exactly (both use f64 arithmetic).
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { ensureWasmActivation } from "../../src/wasm/EnsureWasmActivation.ts";
import { wasmFusedBackpropNeuron } from "../../src/wasm/WasmStandaloneFunctions.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { accumulateWeight } from "../../src/propagate/Weight.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";

await ensureWasmActivation();

/** f64 tolerance */
const TOLERANCE = 1e-10;

Deno.test("FusedBackpropNeuron: single synapse matches TS accumulateWeight", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.8,
    maximumWeightAdjustmentScale: 1.5,
    limitWeightScale: 50000,
    plankConstant: 1e-7,
    maximumBiasAdjustmentScale: 2.0,
    limitBiasScale: 8000,
  });

  const currentWeights = new Float64Array([0.5]);
  const targetValues = new Float64Array([2.0]);
  const activations = new Float64Array([1.0]);

  const result = wasmFusedBackpropNeuron(
    currentWeights,
    targetValues,
    activations,
    config,
    5.0, // targetPreActivation
    3.0, // preActivation
    0.7, // currentBias
  );

  // WASM should be available
  assertEquals(
    result !== undefined,
    true,
    "WASM fused backprop should be available",
  );

  if (!result) return;

  // Compare weight accumulation with TS
  const cs = new SynapseState();
  accumulateWeight(0.5, cs, 2.0, 1.0, config);

  const wd = result.weightDeltas;
  assertAlmostEquals(wd[0], cs.count, TOLERANCE, "count");
  assertAlmostEquals(wd[1], cs.totalPositiveActivation, TOLERANCE, "posAct");
  assertAlmostEquals(wd[2], cs.totalNegativeActivation, TOLERANCE, "negAct");
  assertAlmostEquals(wd[3], cs.countPositiveActivations, TOLERANCE, "cntPos");
  assertAlmostEquals(wd[4], cs.countNegativeActivations, TOLERANCE, "cntNeg");
  assertAlmostEquals(wd[5], cs.totalPositiveAdjustedValue, TOLERANCE, "posAdj");
  assertAlmostEquals(wd[6], cs.totalNegativeAdjustedValue, TOLERANCE, "negAdj");
});

Deno.test("FusedBackpropNeuron: multiple synapses match individual calls", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.5,
    maximumWeightAdjustmentScale: 2.0,
    limitWeightScale: 100000,
    plankConstant: 1e-7,
    maximumBiasAdjustmentScale: 1.0,
    limitBiasScale: 10000,
  });

  const weights = [0.5, -0.3, 1.2, 0.0];
  const targets = [2.0, -1.5, 0.8, 3.0];
  const acts = [1.0, 0.5, -0.8, 2.0];

  const result = wasmFusedBackpropNeuron(
    new Float64Array(weights),
    new Float64Array(targets),
    new Float64Array(acts),
    config,
    4.0, // targetPreActivation
    2.5, // preActivation
    0.3, // currentBias
  );

  assertEquals(result !== undefined, true);
  if (!result) return;

  // Compare each synapse
  for (let i = 0; i < 4; i++) {
    const cs = new SynapseState();
    accumulateWeight(weights[i], cs, targets[i], acts[i], config);

    const base = i * 7;
    const wd = result.weightDeltas;
    assertAlmostEquals(wd[base], cs.count, TOLERANCE, `synapse ${i} count`);
    assertAlmostEquals(
      wd[base + 1],
      cs.totalPositiveActivation,
      TOLERANCE,
      `synapse ${i} posAct`,
    );
    assertAlmostEquals(
      wd[base + 2],
      cs.totalNegativeActivation,
      TOLERANCE,
      `synapse ${i} negAct`,
    );
    assertAlmostEquals(
      wd[base + 3],
      cs.countPositiveActivations,
      TOLERANCE,
      `synapse ${i} cntPos`,
    );
    assertAlmostEquals(
      wd[base + 4],
      cs.countNegativeActivations,
      TOLERANCE,
      `synapse ${i} cntNeg`,
    );
    assertAlmostEquals(
      wd[base + 5],
      cs.totalPositiveAdjustedValue,
      TOLERANCE,
      `synapse ${i} posAdj`,
    );
    assertAlmostEquals(
      wd[base + 6],
      cs.totalNegativeAdjustedValue,
      TOLERANCE,
      `synapse ${i} negAdj`,
    );
  }
});

Deno.test("FusedBackpropNeuron: bias accumulation matches TS accumulateBias", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.8,
    maximumWeightAdjustmentScale: 1.5,
    limitWeightScale: 50000,
    plankConstant: 1e-7,
    maximumBiasAdjustmentScale: 2.0,
    limitBiasScale: 8000,
  });

  const result = wasmFusedBackpropNeuron(
    new Float64Array([0.5]),
    new Float64Array([2.0]),
    new Float64Array([1.0]),
    config,
    5.0, // targetPreActivation
    3.0, // preActivation
    0.7, // currentBias
  );

  assertEquals(result !== undefined, true);
  if (!result) return;

  // Compare with TS bias accumulation
  // accumulateBias computes: biasDelta = target - pre = 5.0 - 3.0 = 2.0
  // targetBias = currentBias + biasDelta = 0.7 + 2.0 = 2.7
  // Then limitBias is applied
  assertAlmostEquals(result.biasCount, 1, TOLERANCE, "bias count");
  assertAlmostEquals(result.biasTotalBias, 2.7, TOLERANCE, "total bias");
  // totalAdjustedBias should be finite
  assertEquals(
    Number.isFinite(result.biasTotalAdjustedBias),
    true,
    "adjusted bias should be finite",
  );
});

Deno.test("FusedBackpropNeuron: empty synapses produces only bias result", () => {
  const config = createBackPropagationConfig({
    learningRate: 1.0,
    plankConstant: 1e-7,
    maximumBiasAdjustmentScale: 1.0,
    limitBiasScale: 10000,
  });

  const result = wasmFusedBackpropNeuron(
    new Float64Array(0),
    new Float64Array(0),
    new Float64Array(0),
    config,
    2.0,
    1.0,
    0.5,
  );

  assertEquals(result !== undefined, true);
  if (!result) return;

  assertAlmostEquals(result.biasCount, 1, TOLERANCE, "bias count");
  assertAlmostEquals(result.biasTotalBias, 1.5, TOLERANCE, "total bias");
});

Deno.test("FusedBackpropNeuron: non-finite inputs are skipped", () => {
  const config = createBackPropagationConfig({
    learningRate: 1.0,
    plankConstant: 1e-7,
  });

  const result = wasmFusedBackpropNeuron(
    new Float64Array([NaN, 0.5]),
    new Float64Array([2.0, Infinity]),
    new Float64Array([1.0, 1.0]),
    config,
    NaN, // non-finite target → bias should be skipped
    1.0,
    0.5,
  );

  assertEquals(result !== undefined, true);
  if (!result) return;

  // Both synapses should be skipped
  assertAlmostEquals(
    result.weightDeltas[0],
    0,
    TOLERANCE,
    "NaN weight → skipped",
  );
  assertAlmostEquals(
    result.weightDeltas[7],
    0,
    TOLERANCE,
    "Inf target → skipped",
  );
  // Bias: NaN target → skipped
  assertAlmostEquals(
    result.biasCount,
    0,
    TOLERANCE,
    "NaN bias target → skipped",
  );
});

Deno.test("FusedBackpropNeuron: negative activations tracked correctly", () => {
  const config = createBackPropagationConfig({
    learningRate: 1.0,
    maximumWeightAdjustmentScale: 10.0,
    limitWeightScale: 100000,
    plankConstant: 1e-7,
  });

  const result = wasmFusedBackpropNeuron(
    new Float64Array([1.0]),
    new Float64Array([2.0]),
    new Float64Array([-0.5]),
    config,
    2.0,
    1.0,
    0.5,
  );

  assertEquals(result !== undefined, true);
  if (!result) return;

  const cs = new SynapseState();
  accumulateWeight(1.0, cs, 2.0, -0.5, config);

  const wd = result.weightDeltas;
  assertAlmostEquals(wd[0], cs.count, TOLERANCE, "count");
  assertAlmostEquals(wd[1], cs.totalPositiveActivation, TOLERANCE, "posAct");
  assertAlmostEquals(wd[2], cs.totalNegativeActivation, TOLERANCE, "negAct");
  assertAlmostEquals(wd[3], cs.countPositiveActivations, TOLERANCE, "cntPos");
  assertAlmostEquals(wd[4], cs.countNegativeActivations, TOLERANCE, "cntNeg");
});

Deno.test("FusedBackpropNeuron: large batch matches individual calls", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.3,
    maximumWeightAdjustmentScale: 5.0,
    limitWeightScale: 100000,
    plankConstant: 1e-7,
    maximumBiasAdjustmentScale: 3.0,
    limitBiasScale: 10000,
  });

  const n = 50;
  const weights = new Float64Array(n);
  const targets = new Float64Array(n);
  const acts = new Float64Array(n);

  // Deterministic test data
  for (let i = 0; i < n; i++) {
    weights[i] = (i * 0.13 - 3.25) % 5;
    targets[i] = (i * 0.07 + 0.5) % 4 - 2;
    acts[i] = (i * 0.11 - 2.75) % 3;
  }

  const result = wasmFusedBackpropNeuron(
    weights,
    targets,
    acts,
    config,
    6.0,
    4.0,
    1.0,
  );

  assertEquals(result !== undefined, true);
  if (!result) return;

  for (let i = 0; i < n; i++) {
    const cs = new SynapseState();
    accumulateWeight(weights[i], cs, targets[i], acts[i], config);

    const base = i * 7;
    const wd = result.weightDeltas;
    assertAlmostEquals(wd[base], cs.count, TOLERANCE, `synapse ${i} count`);
    assertAlmostEquals(
      wd[base + 1],
      cs.totalPositiveActivation,
      TOLERANCE,
      `synapse ${i} posAct`,
    );
    assertAlmostEquals(
      wd[base + 2],
      cs.totalNegativeActivation,
      TOLERANCE,
      `synapse ${i} negAct`,
    );
  }
});
