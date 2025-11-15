/**
 * Tests for error validation in Rust discovery recording.
 *
 * These tests ensure that the system detects and rejects corrupted data
 * with unreasonable error counts before sending to Rust.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  computeRustRecordStats,
  type RustRecordInput,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test({
  name:
    "computeRustRecordStats rejects neuron with excessive errors per neuron",
  fn() {
    // Create a creature with 10 hidden neurons
    const input: RustRecordInput = {
      creature: {
        neurons: Array.from({ length: 10 }, (_, i) => ({
          uuid: `hidden-${i}`,
          type: "hidden",
          squash: "TANH",
          bias: 0.0,
        })),
        synapses: [],
        input: 2,
        output: 1,
      },
      "training_data": [
        {
          input: [0.1, 0.2],
          output: [0.5],
          neuron_data: [
            {
              neuron_uuid: "hidden-0",
              activation: 0.5,
              value: 0.4,
              // 1000 errors is way too many! Max should be around max(100, 10*2) = 100
              errors: Array.from({ length: 1000 }, (_, i) => i * 0.001),
            },
          ],
        },
      ],
      "temp_dir": ".discovery/test",
    };

    // This should throw because hidden-0 has 1000 errors which exceeds the reasonable maximum
    assertThrows(
      () => computeRustRecordStats(input),
      Error,
      "Data corruption detected",
    );
  },
});

Deno.test({
  name: "computeRustRecordStats rejects excessive total errors",
  fn() {
    // Create a creature with 10 hidden neurons
    const neurons = Array.from({ length: 10 }, (_, i) => ({
      uuid: `hidden-${i}`,
      type: "hidden",
      squash: "TANH",
      bias: 0.0,
    }));

    const input: RustRecordInput = {
      creature: {
        neurons,
        synapses: [],
        input: 2,
        output: 1,
      },
      "training_data": [
        {
          input: [0.1, 0.2],
          output: [0.5],
          neuron_data: neurons.map((n, idx) => ({
            neuron_uuid: n.uuid,
            activation: 0.5,
            value: 0.4,
            // First neuron has way too many errors, rest have normal amounts
            // First: 150 errors (exceeds max(100, 10*2) = 100)
            // Total: 150 + 9*1 = 159 errors, max is 10 * 100 = 1000
            // So this will trigger the per-neuron validation
            errors: idx === 0
              ? Array.from({ length: 150 }, (_, i) => i * 0.001)
              : [0.001],
          })),
        },
      ],
      "temp_dir": ".discovery/test",
    };

    // This should throw because first neuron has 150 errors which exceeds max (100)
    assertThrows(
      () => computeRustRecordStats(input),
      Error,
      "Data corruption detected",
    );
  },
});

Deno.test({
  name: "computeRustRecordStats accepts reasonable error counts",
  fn() {
    // Create a creature with 10 hidden neurons
    const neurons = Array.from({ length: 10 }, (_, i) => ({
      uuid: `hidden-${i}`,
      type: "hidden",
      squash: "TANH",
      bias: 0.0,
    }));

    const input: RustRecordInput = {
      creature: {
        neurons,
        synapses: [],
        input: 2,
        output: 1,
      },
      "training_data": [
        {
          input: [0.1, 0.2],
          output: [0.5],
          neuron_data: neurons.map((n) => ({
            neuron_uuid: n.uuid,
            activation: 0.5,
            value: 0.4,
            // Each neuron has 1-3 errors (normal for multiple paths)
            errors: [0.01, 0.02, 0.03],
          })),
        },
      ],
      "temp_dir": ".discovery/test",
    };

    // This should NOT throw - reasonable error counts
    const stats = computeRustRecordStats(input);
    assertEquals(stats.sampleCount, 1);
    assertEquals(stats.expectedNeuronCount, 10);
    assertEquals(stats.totalNeuronRecords, 10);
    assertEquals(stats.totalErrorValues, 30); // 10 neurons * 3 errors each
    assertEquals(stats.maxErrorValuesPerNeuron, 3);
  },
});

Deno.test({
  name: "computeRustRecordStats accepts up to 50 errors per neuron (minimum)",
  fn() {
    // With only 1 sample and 1 output, max = max(50, 1*1*3) = 50
    const input: RustRecordInput = {
      creature: {
        neurons: [
          {
            uuid: "hidden-0",
            type: "hidden",
            squash: "TANH",
            bias: 0.0,
          },
        ],
        synapses: [],
        input: 2,
        output: 1,
      },
      "training_data": [
        {
          input: [0.1, 0.2],
          output: [0.5],
          neuron_data: [
            {
              neuron_uuid: "hidden-0",
              activation: 0.5,
              value: 0.4,
              // 50 errors should be accepted (at the threshold)
              errors: Array.from({ length: 50 }, (_, i) => i * 0.001),
            },
          ],
        },
      ],
      "temp_dir": ".discovery/test",
    };

    // This should NOT throw - 50 errors is the threshold
    const stats = computeRustRecordStats(input);
    assertEquals(stats.maxErrorValuesPerNeuron, 50);
  },
});

Deno.test({
  name: "computeRustRecordStats rejects 51 errors for small network",
  fn() {
    // Edge case: 51 errors should be rejected for a small network with 1 sample
    const input: RustRecordInput = {
      creature: {
        neurons: [
          {
            uuid: "hidden-0",
            type: "hidden",
            squash: "TANH",
            bias: 0.0,
          },
        ],
        synapses: [],
        input: 2,
        output: 1,
      },
      "training_data": [
        {
          input: [0.1, 0.2],
          output: [0.5],
          neuron_data: [
            {
              neuron_uuid: "hidden-0",
              activation: 0.5,
              value: 0.4,
              // 51 errors exceeds the max(50, 1*1*3) = 50 threshold
              errors: Array.from({ length: 51 }, (_, i) => i * 0.001),
            },
          ],
        },
      ],
      "temp_dir": ".discovery/test",
    };

    // This should throw because 51 > 50
    assertThrows(
      () => computeRustRecordStats(input),
      Error,
      "Data corruption detected",
    );
  },
});

Deno.test({
  name:
    "computeRustRecordStats accepts errors based on sample count and outputs",
  fn() {
    // With 50 samples and 2 outputs, we can have up to max(50, 50*2*3) = 300 errors per neuron
    // This reflects the fact that during backprop, record() is called once per sample per output
    const neurons = Array.from({ length: 200 }, (_, i) => ({
      uuid: `hidden-${i}`,
      type: "hidden",
      squash: "TANH",
      bias: 0.0,
    }));

    const input: RustRecordInput = {
      creature: {
        neurons,
        synapses: [],
        input: 2,
        output: 2,
      },
      "training_data": Array.from({ length: 50 }, (_, i) => ({
        input: [0.1 * i, 0.2 * i],
        output: [0.5, 0.6],
        neuron_data: i === 0
          ? [
            {
              neuron_uuid: "hidden-0",
              activation: 0.5,
              value: 0.4,
              // 250 errors: max(50, 50*2*3) = 300, so this should be accepted
              errors: Array.from({ length: 250 }, (_, j) => j * 0.001),
            },
          ]
          : [],
      })),
      "temp_dir": ".discovery/test",
    };

    // This should NOT throw - 250 errors is within max(50, 50*2*3) = 300
    const stats = computeRustRecordStats(input);
    assertEquals(stats.maxErrorValuesPerNeuron, 250);
  },
});
