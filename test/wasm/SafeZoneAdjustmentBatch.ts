/**
 * Issue #1376 - Tests for batch safe zone adjustment WASM function.
 *
 * Verifies that the batch `safe_zone_adjustment_batch()` WASM function produces
 * identical results to calling `safe_zone_adjustment()` individually for each
 * synapse. This is the core correctness guarantee for the fused backward pass
 * inner loop optimisation.
 */

import { assert, assertAlmostEquals } from "@std/assert";
import {
  getSquashType,
  initWasmActivation,
  isWasmActivationAvailable,
  safeZoneAdjustment,
  safeZoneAdjustmentBatch,
  SquashType,
  wasmSafeZoneAdjustment,
  wasmSafeZoneAdjustmentBatch,
} from "../../src/wasm/mod.ts";

// f32 tolerance for WASM comparisons
const TOLERANCE = 1e-6;

// Initialise WASM before tests
Deno.test({
  name: "SafeZoneAdjustmentBatch: WASM initialisation",
  async fn() {
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

Deno.test({
  name: "SafeZoneAdjustmentBatch: empty batch returns empty result",
  fn() {
    const result = wasmSafeZoneAdjustmentBatch(
      new Uint8Array(0),
      new Float32Array(0),
      0.1,
      new Float32Array(0),
    );
    assert(result.length === 0, "Empty batch should return empty result");
  },
});

Deno.test({
  name: "SafeZoneAdjustmentBatch: single element matches scalar",
  fn() {
    const squashType = SquashType.Relu;
    const rawInput = 1.5;
    const error = 0.3;
    const weight = 0.8;

    const scalar = wasmSafeZoneAdjustment(squashType, rawInput, error, weight);
    const batch = wasmSafeZoneAdjustmentBatch(
      new Uint8Array([squashType]),
      new Float32Array([rawInput]),
      error,
      new Float32Array([weight]),
    );

    assert(batch.length === 1, "Single-element batch should have length 1");
    assertAlmostEquals(batch[0], scalar, TOLERANCE, "Single-element mismatch");
  },
});

Deno.test({
  name: "SafeZoneAdjustmentBatch: mixed squash types match scalar calls",
  fn() {
    // Simulate a realistic backward pass scenario: a neuron with inbound
    // connections from neurons using different activation functions
    const squashTypes = new Uint8Array([
      SquashType.Relu,
      SquashType.Tanh,
      SquashType.Logistic,
      SquashType.Identity,
      SquashType.LeakyRelu,
      SquashType.Gelu,
      SquashType.Selu,
      SquashType.Elu,
    ]);
    const rawInputs = new Float32Array([
      1.0,
      -3.0,
      0.5,
      100.0,
      -60.0,
      2.0,
      -8.0,
      5.0,
    ]);
    const error = 0.15;
    const weights = new Float32Array([
      0.5,
      1.0,
      -0.3,
      0.001,
      2.0,
      -1.5,
      0.7,
      0.01,
    ]);

    const batchResults = wasmSafeZoneAdjustmentBatch(
      squashTypes,
      rawInputs,
      error,
      weights,
    );

    assert(
      batchResults.length === squashTypes.length,
      `Batch length mismatch: got ${batchResults.length}, expected ${squashTypes.length}`,
    );

    for (let i = 0; i < squashTypes.length; i++) {
      const scalar = wasmSafeZoneAdjustment(
        squashTypes[i],
        rawInputs[i],
        error,
        weights[i],
      );
      assertAlmostEquals(
        batchResults[i],
        scalar,
        TOLERANCE,
        `Index ${i} (squash=${squashTypes[i]}): batch=${
          batchResults[i]
        }, scalar=${scalar}`,
      );
    }
  },
});

Deno.test({
  name: "SafeZoneAdjustmentBatch: aggregate functions return zero",
  fn() {
    const squashTypes = new Uint8Array([
      SquashType.Minimum,
      SquashType.Maximum,
      SquashType.If,
    ]);
    const rawInputs = new Float32Array([1.0, 2.0, 3.0]);
    const weights = new Float32Array([1.0, 1.0, 1.0]);

    const results = wasmSafeZoneAdjustmentBatch(
      squashTypes,
      rawInputs,
      0.5,
      weights,
    );

    for (let i = 0; i < results.length; i++) {
      assertAlmostEquals(
        results[i],
        0.0,
        TOLERANCE,
        `Aggregate function at index ${i} should return 0`,
      );
    }
  },
});

Deno.test({
  name:
    "SafeZoneAdjustmentBatch: high-level wrapper matches low-level for all common squash types",
  fn() {
    const squashNames = [
      "IDENTITY",
      "ReLU",
      "TANH",
      "LOGISTIC",
      "LeakyReLU",
      "GELU",
      "SELU",
      "ELU",
      "Mish",
      "Swish",
      "ArcTan",
      "SINE",
    ];

    const rawInputs = [
      0.0,
      -5.0,
      3.0,
      -0.5,
      1.0,
      -15.0,
      7.0,
      -1.0,
      0.1,
      2.5,
      -3.0,
      0.8,
    ];
    const error = 0.2;
    const weights = [
      1.0,
      0.5,
      -0.3,
      2.0,
      0.01,
      1.5,
      -1.0,
      0.8,
      0.1,
      3.0,
      -0.5,
      1.0,
    ];

    // Build batch arrays
    const batchSquashTypes = new Uint8Array(squashNames.length);
    const batchRawInputs = new Float32Array(rawInputs);
    const batchWeights = new Float32Array(weights);

    for (let i = 0; i < squashNames.length; i++) {
      batchSquashTypes[i] = getSquashType(squashNames[i]);
    }

    const batchResults = safeZoneAdjustmentBatch(
      batchSquashTypes,
      batchRawInputs,
      error,
      batchWeights,
    );

    for (let i = 0; i < squashNames.length; i++) {
      const scalar = safeZoneAdjustment(
        squashNames[i],
        rawInputs[i],
        error,
        weights[i],
      );
      assertAlmostEquals(
        batchResults[i],
        scalar,
        TOLERANCE,
        `${squashNames[i]} at index ${i}: batch=${
          batchResults[i]
        }, scalar=${scalar}`,
      );
    }
  },
});

Deno.test({
  name: "SafeZoneAdjustmentBatch: non-finite raw input returns zero",
  fn() {
    const squashTypes = new Uint8Array([SquashType.Tanh, SquashType.Relu]);
    const rawInputs = new Float32Array([Infinity, -Infinity]);
    const weights = new Float32Array([1.0, 1.0]);

    const results = wasmSafeZoneAdjustmentBatch(
      squashTypes,
      rawInputs,
      0.1,
      weights,
    );

    for (let i = 0; i < results.length; i++) {
      assertAlmostEquals(
        results[i],
        0.0,
        TOLERANCE,
        `Non-finite input at index ${i} should return 0`,
      );
    }
  },
});

Deno.test({
  name: "SafeZoneAdjustmentBatch: negative error with saturated neurons",
  fn() {
    // Test recovery logic: when a neuron is saturated (e.g., TANH at raw_input=5)
    // but the error direction would push it back, some recovery is allowed
    const squashTypes = new Uint8Array([
      SquashType.Tanh,
      SquashType.Tanh,
      SquashType.Logistic,
      SquashType.Logistic,
    ]);
    // raw_input > safe_high for TANH (2.0) and LOGISTIC (6.0)
    const rawInputs = new Float32Array([5.0, 5.0, 8.0, 8.0]);
    const weights = new Float32Array([1.0, 1.0, 1.0, 1.0]);

    // Negative error should trigger recovery for saturated-positive neurons
    const resultsNeg = wasmSafeZoneAdjustmentBatch(
      squashTypes,
      rawInputs,
      -0.5, // negative error
      weights,
    );

    // Positive error should not trigger recovery for saturated-positive neurons
    const resultsPos = wasmSafeZoneAdjustmentBatch(
      squashTypes,
      rawInputs,
      0.5, // positive error
      weights,
    );

    // Verify each matches scalar calls
    for (let i = 0; i < squashTypes.length; i++) {
      const scalarNeg = wasmSafeZoneAdjustment(
        squashTypes[i],
        rawInputs[i],
        -0.5,
        weights[i],
      );
      const scalarPos = wasmSafeZoneAdjustment(
        squashTypes[i],
        rawInputs[i],
        0.5,
        weights[i],
      );
      assertAlmostEquals(resultsNeg[i], scalarNeg, TOLERANCE);
      assertAlmostEquals(resultsPos[i], scalarPos, TOLERANCE);
    }
  },
});

Deno.test({
  name: "SafeZoneAdjustmentBatch: large batch (100 synapses) matches scalar",
  fn() {
    // Simulate a neuron with 100 inbound connections - realistic for NEAT networks
    const count = 100;
    const squashTypes = new Uint8Array(count);
    const rawInputs = new Float32Array(count);
    const weights = new Float32Array(count);

    // Seeded pseudo-random for reproducibility
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };

    const allSquashTypes = [
      SquashType.Identity,
      SquashType.Relu,
      SquashType.Tanh,
      SquashType.Logistic,
      SquashType.LeakyRelu,
      SquashType.Gelu,
      SquashType.Selu,
      SquashType.Elu,
    ];

    for (let i = 0; i < count; i++) {
      squashTypes[i] =
        allSquashTypes[Math.floor(Math.abs(random()) * allSquashTypes.length)];
      rawInputs[i] = random() * 10;
      weights[i] = random() * 2;
    }

    const error = 0.05;
    const batchResults = wasmSafeZoneAdjustmentBatch(
      squashTypes,
      rawInputs,
      error,
      weights,
    );

    assert(batchResults.length === count, "Batch length should match input");

    for (let i = 0; i < count; i++) {
      const scalar = wasmSafeZoneAdjustment(
        squashTypes[i],
        rawInputs[i],
        error,
        weights[i],
      );
      assertAlmostEquals(
        batchResults[i],
        scalar,
        TOLERANCE,
        `Index ${i}: batch=${batchResults[i]}, scalar=${scalar}`,
      );
    }
  },
});
