/**
 * Tests for WASM Predictive Coding serialisation and parsing utilities.
 * Issue #1560: Rust/WASM Predictive Coding inference engine.
 *
 * These tests verify the TypeScript serialisation/parsing functions
 * that bridge between creature topology and the WASM binary format.
 * The WASM engine itself is tested in Rust (cargo test).
 */
import { assertEquals } from "@std/assert";
import { assert } from "@std/assert";
import {
  parseGradientResult,
  parseInferenceResult,
  serialisePcTopology,
} from "../../src/wasm/WasmPredictiveCoding.ts";

Deno.test(
  "WasmPredictiveCoding: serialisePcTopology produces correct binary format",
  () => {
    const data = serialisePcTopology(
      2, // numInputs
      1, // numOutputs
      4, // numNeuronsTotal
      50, // inferenceSteps
      0.05, // inferenceRate
      1e-6, // energyThreshold
      [
        {
          bias: 0.1,
          squashType: 7, // Tanh
          isHidden: true,
          connections: [
            { from: 0, weight: 0.5 },
            { from: 1, weight: 0.3 },
          ],
        },
        {
          bias: 0.0,
          squashType: 0, // Identity
          isHidden: false,
          connections: [{ from: 2, weight: 1.0 }],
        },
      ],
    );

    // Verify header
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    assertEquals(view.getUint32(0, true), 2, "num_inputs");
    assertEquals(view.getUint32(4, true), 1, "num_outputs");
    assertEquals(view.getUint32(8, true), 4, "num_neurons_total");
    assertEquals(view.getUint32(12, true), 50, "inference_steps");
    assert(
      Math.abs(view.getFloat32(16, true) - 0.05) < 1e-6,
      "inference_rate",
    );

    // Verify first neuron header (offset 24)
    assert(
      Math.abs(view.getFloat32(24, true) - 0.1) < 1e-6,
      "neuron0 bias",
    );
    assertEquals(view.getUint8(28), 7, "neuron0 squash_type (Tanh)");
    assertEquals(view.getUint8(29), 1, "neuron0 is_hidden");
    assertEquals(view.getUint16(30, true), 2, "neuron0 num_connections");

    // Verify first connection of first neuron (offset 32)
    assertEquals(view.getUint16(32, true), 0, "conn0 from_index");
    assert(
      Math.abs(view.getFloat32(34, true) - 0.5) < 1e-6,
      "conn0 weight",
    );

    // Total size should be 24 (header) + 8 (neuron0) + 12 (2 conns) + 8 (neuron1) + 6 (1 conn) = 58
    assertEquals(data.byteLength, 58, "total serialised size");
  },
);

Deno.test(
  "WasmPredictiveCoding: parseInferenceResult correctly unpacks data",
  () => {
    // Build a mock packed result matching the WASM output format.
    const numNeurons = 4;
    const numNonInputs = 2;
    const energyHistoryLen = 3;

    const packed = new Float32Array([
      // Header
      10, // steps_used
      0.001, // final_energy
      1.0, // converged
      numNeurons, // num_neurons
      numNonInputs, // num_non_inputs
      energyHistoryLen, // energy_history_length
      // Latents (4 values)
      1.0,
      0.5,
      0.7,
      0.3,
      // Predictions (2 values)
      0.65,
      0.28,
      // Errors (2 values)
      0.05,
      0.02,
      // Energy history (3 values)
      0.5,
      0.1,
      0.001,
    ]);

    const result = parseInferenceResult(packed);

    assertEquals(result.stepsUsed, 10);
    assert(Math.abs(result.finalEnergy - 0.001) < 1e-6);
    assertEquals(result.converged, true);
    assertEquals(result.latents.length, 4);
    assertEquals(result.predictions.length, 2);
    assertEquals(result.errors.length, 2);
    assertEquals(result.energyHistory.length, 3);

    // Verify specific values
    assert(Math.abs(result.latents[0] - 1.0) < 1e-6);
    assert(Math.abs(result.latents[2] - 0.7) < 1e-6);
    assert(Math.abs(result.predictions[0] - 0.65) < 1e-6);
    assert(Math.abs(result.errors[0] - 0.05) < 1e-6);
    assert(Math.abs(result.energyHistory[0] - 0.5) < 1e-6);
    assert(Math.abs(result.energyHistory[2] - 0.001) < 1e-6);
  },
);

Deno.test(
  "WasmPredictiveCoding: parseInferenceResult handles non-converged result",
  () => {
    const packed = new Float32Array([
      50, // steps_used
      0.1, // final_energy
      0.0, // converged = false
      3, // num_neurons
      1, // num_non_inputs
      2, // energy_history_length
      // Latents
      1.0,
      0.5,
      0.8,
      // Predictions
      0.75,
      // Errors
      0.05,
      // Energy history
      0.5,
      0.1,
    ]);

    const result = parseInferenceResult(packed);
    assertEquals(result.converged, false);
    assertEquals(result.stepsUsed, 50);
  },
);

Deno.test(
  "WasmPredictiveCoding: parseGradientResult correctly unpacks data",
  () => {
    const packed = new Float32Array([
      2, // num_non_inputs
      3, // num_weight_entries
      // Bias deltas
      0.005,
      0.01,
      // Weight deltas (3 triples)
      0,
      0,
      0.015, // neuron 0, conn 0, delta 0.015
      0,
      1,
      0.009, // neuron 0, conn 1, delta 0.009
      1,
      0,
      0.02, // neuron 1, conn 0, delta 0.02
    ]);

    const result = parseGradientResult(packed);

    assertEquals(result.biasDeltas.length, 2);
    assert(Math.abs(result.biasDeltas[0] - 0.005) < 1e-6);
    assert(Math.abs(result.biasDeltas[1] - 0.01) < 1e-6);

    assertEquals(result.weightDeltas.length, 3);
    assertEquals(result.weightDeltas[0].neuronIdx, 0);
    assertEquals(result.weightDeltas[0].connIdx, 0);
    assert(Math.abs(result.weightDeltas[0].delta - 0.015) < 1e-6);

    assertEquals(result.weightDeltas[2].neuronIdx, 1);
    assertEquals(result.weightDeltas[2].connIdx, 0);
    assert(Math.abs(result.weightDeltas[2].delta - 0.02) < 1e-6);
  },
);

Deno.test(
  "WasmPredictiveCoding: serialisePcTopology handles empty connections",
  () => {
    const data = serialisePcTopology(
      1, // numInputs
      1, // numOutputs
      2, // numNeuronsTotal
      10, // inferenceSteps
      0.1, // inferenceRate
      1e-4, // energyThreshold
      [
        {
          bias: 0.5,
          squashType: 0, // Identity
          isHidden: false,
          connections: [],
        },
      ],
    );

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    assertEquals(view.getUint32(0, true), 1, "num_inputs");
    assertEquals(view.getUint32(4, true), 1, "num_outputs");
    // Header (24) + neuron header (8) + 0 connections = 32
    assertEquals(data.byteLength, 32, "total size with empty connections");
    assertEquals(view.getUint16(30, true), 0, "num_connections = 0");
  },
);

Deno.test(
  "WasmPredictiveCoding: serialisation roundtrip preserves topology values",
  () => {
    const neurons = [
      {
        bias: -0.5,
        squashType: 1, // Relu
        isHidden: true,
        connections: [
          { from: 0, weight: 1.5 },
          { from: 1, weight: -0.7 },
        ],
      },
      {
        bias: 0.2,
        squashType: 6, // Logistic
        isHidden: true,
        connections: [{ from: 2, weight: 0.9 }],
      },
      {
        bias: 0.0,
        squashType: 0, // Identity
        isHidden: false,
        connections: [
          { from: 2, weight: 0.4 },
          { from: 3, weight: -0.3 },
        ],
      },
    ];

    const data = serialisePcTopology(2, 1, 5, 100, 0.02, 1e-8, neurons);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Re-read header values
    assertEquals(view.getUint32(0, true), 2);
    assertEquals(view.getUint32(4, true), 1);
    assertEquals(view.getUint32(8, true), 5);
    assertEquals(view.getUint32(12, true), 100);
    assert(Math.abs(view.getFloat32(16, true) - 0.02) < 1e-6);

    // Read first neuron
    let offset = 24;
    assert(
      Math.abs(view.getFloat32(offset, true) - (-0.5)) < 1e-6,
      "neuron0 bias",
    );
    assertEquals(view.getUint8(offset + 4), 1, "neuron0 squash (Relu)");
    assertEquals(view.getUint8(offset + 5), 1, "neuron0 is_hidden");
    assertEquals(view.getUint16(offset + 6, true), 2, "neuron0 conns");
    offset += 8;

    // First connection
    assertEquals(view.getUint16(offset, true), 0, "conn0 from");
    assert(
      Math.abs(view.getFloat32(offset + 2, true) - 1.5) < 1e-6,
      "conn0 weight",
    );
    offset += 6;

    // Second connection
    assertEquals(view.getUint16(offset, true), 1, "conn1 from");
    assert(
      Math.abs(view.getFloat32(offset + 2, true) - (-0.7)) < 1e-6,
      "conn1 weight",
    );
    offset += 6;

    // Second neuron
    assert(
      Math.abs(view.getFloat32(offset, true) - 0.2) < 1e-6,
      "neuron1 bias",
    );
    assertEquals(view.getUint8(offset + 4), 6, "neuron1 squash (Logistic)");
    assertEquals(view.getUint8(offset + 5), 1, "neuron1 is_hidden");
    assertEquals(view.getUint16(offset + 6, true), 1, "neuron1 conns");
  },
);
