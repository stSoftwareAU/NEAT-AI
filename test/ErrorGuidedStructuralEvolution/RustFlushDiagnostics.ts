/**
 * Tests for the extracted RustFlushDiagnostics module.
 *
 * Verifies that the standalone functions produce correct metrics,
 * warnings, and errors when inspecting training data batches.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertThrows } from "@std/assert/throws";
import {
  computeRustFlushMetrics,
  createRustFlushAggregation,
  finalizeRustFlushDiagnostics,
  observeRustTrainingRecord,
  truncateForLogValue,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustFlushDiagnostics.ts";
import type { RustRecordInput } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test("truncateForLogValue leaves short strings unchanged", () => {
  assertEquals(truncateForLogValue("hello", 120), "hello");
  assertEquals(truncateForLogValue("", 10), "");
});

Deno.test("truncateForLogValue truncates long strings", () => {
  const long = "a".repeat(200);
  const result = truncateForLogValue(long, 50);
  assertEquals(result.length, 51); // 50 chars + ellipsis
  assertEquals(result.endsWith("…"), true);
});

Deno.test("truncateForLogValue uses default max of 120", () => {
  const exact = "b".repeat(120);
  assertEquals(truncateForLogValue(exact), exact);

  const over = "c".repeat(121);
  const result = truncateForLogValue(over);
  assertEquals(result.length, 121); // 120 + ellipsis
});

Deno.test("createRustFlushAggregation initialises metrics to zero", () => {
  const agg = createRustFlushAggregation(3, 2, 5);
  assertEquals(agg.expectedInputLength, 3);
  assertEquals(agg.expectedOutputLength, 2);
  assertEquals(agg.expectedNeuronCount, 5);
  assertEquals(agg.metrics.sampleCount, 0);
  assertEquals(agg.metrics.totalNeuronRecords, 0);
  assertEquals(agg.metrics.recordsWithNoNeuronData, 0);
  assertEquals(agg.metrics.missingUuidEntries, 0);
  assertEquals(agg.metrics.nonFiniteActivationCount, 0);
  assertEquals(agg.metrics.nonFiniteValueCount, 0);
  assertEquals(agg.metrics.nonFiniteErrorCount, 0);
});

Deno.test("observeRustTrainingRecord counts samples", () => {
  const agg = createRustFlushAggregation(2, 1, 1);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1, 0.2],
    output: [0.5],
    "neuron_data": [
      { "neuron_uuid": "n-1", activation: 0.3, errors: [0.01] },
    ],
  };
  observeRustTrainingRecord(agg, record, 0);
  assertEquals(agg.metrics.sampleCount, 1);
  observeRustTrainingRecord(agg, record, 1);
  assertEquals(agg.metrics.sampleCount, 2);
});

Deno.test("observeRustTrainingRecord detects input/output mismatches", () => {
  const agg = createRustFlushAggregation(2, 1, 1);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1], // expected 2
    output: [0.5, 0.6], // expected 1
    "neuron_data": [
      { "neuron_uuid": "n-1", activation: 0.3, errors: [0.01] },
    ],
  };
  observeRustTrainingRecord(agg, record, 0);
  assertEquals(agg.metrics.recordsWithInputMismatch, 1);
  assertEquals(agg.metrics.recordsWithOutputMismatch, 1);
});

Deno.test("observeRustTrainingRecord detects missing neuron data", () => {
  const agg = createRustFlushAggregation(1, 1, 3);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1],
    output: [0.5],
    "neuron_data": [],
  };
  observeRustTrainingRecord(agg, record, 0);
  assertEquals(agg.metrics.recordsWithNoNeuronData, 1);
  assertEquals(agg.metrics.recordsWithMismatchedNeuronCount, 1);
});

Deno.test("observeRustTrainingRecord detects missing UUIDs", () => {
  const agg = createRustFlushAggregation(1, 1, 1);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1],
    output: [0.5],
    "neuron_data": [
      { "neuron_uuid": "", activation: 0.3, errors: [0.01] },
    ],
  };
  observeRustTrainingRecord(agg, record, 42);
  assertEquals(agg.metrics.missingUuidEntries, 1);
  assertEquals(
    agg.metrics.firstMissingUuidLocation,
    "record 42, neuron 0",
  );
});

Deno.test("observeRustTrainingRecord detects non-finite activations", () => {
  const agg = createRustFlushAggregation(1, 1, 1);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1],
    output: [0.5],
    "neuron_data": [
      { "neuron_uuid": "n-1", activation: NaN, errors: [0.01] },
    ],
  };
  observeRustTrainingRecord(agg, record, 7);
  assertEquals(agg.metrics.nonFiniteActivationCount, 1);
  assertEquals(
    agg.metrics.firstNonFiniteActivationLocation,
    "record 7, neuron 0",
  );
});

Deno.test("observeRustTrainingRecord detects non-finite errors", () => {
  const agg = createRustFlushAggregation(1, 1, 1);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1],
    output: [0.5],
    "neuron_data": [
      { "neuron_uuid": "n-1", activation: 0.5, errors: [Infinity] },
    ],
  };
  observeRustTrainingRecord(agg, record, 3);
  assertEquals(agg.metrics.nonFiniteErrorCount, 1);
  assertEquals(
    agg.metrics.firstNonFiniteErrorLocation,
    "record 3, neuron 0, error 0",
  );
});

Deno.test("observeRustTrainingRecord throws on unreasonable error counts", () => {
  const agg = createRustFlushAggregation(1, 1, 1);
  const tooManyErrors = new Array(100).fill(0.01);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1],
    output: [0.5],
    "neuron_data": [
      { "neuron_uuid": "n-1", activation: 0.5, errors: tooManyErrors },
    ],
  };
  assertThrows(
    () => observeRustTrainingRecord(agg, record, 0),
    Error,
    "Data corruption detected",
  );
});

Deno.test("observeRustTrainingRecord tracks longest UUID", () => {
  const agg = createRustFlushAggregation(1, 1, 2);
  const record: RustRecordInput["training_data"][number] = {
    input: [0.1],
    output: [0.5],
    "neuron_data": [
      { "neuron_uuid": "short", activation: 0.5, errors: [0.01] },
      {
        "neuron_uuid": "much-longer-uuid-value",
        activation: 0.5,
        errors: [0.01],
      },
    ],
  };
  observeRustTrainingRecord(agg, record, 0);
  assertEquals(agg.metrics.longestNeuronUuid, "much-longer-uuid-value");
  assertEquals(
    agg.metrics.longestNeuronUuidLength,
    "much-longer-uuid-value".length,
  );
});

Deno.test("finalizeRustFlushDiagnostics produces summary and warnings", () => {
  const agg = createRustFlushAggregation(2, 1, 1);

  // Add a record with no neuron data to trigger warning
  observeRustTrainingRecord(agg, {
    input: [0.1, 0.2],
    output: [0.5],
    "neuron_data": [],
  }, 0);

  const diagnostics = finalizeRustFlushDiagnostics(
    agg,
    truncateForLogValue,
  );

  assertStringIncludes(diagnostics.summary, "samples=1");
  assertEquals(diagnostics.warnings.length, 2); // no neuron data + mismatched count
  assertStringIncludes(diagnostics.warnings[0], "without neuron data");
  assertEquals(diagnostics.errors.length, 0);
});

Deno.test("finalizeRustFlushDiagnostics reports errors for missing UUIDs", () => {
  const agg = createRustFlushAggregation(1, 1, 1);
  observeRustTrainingRecord(agg, {
    input: [0.1],
    output: [0.5],
    "neuron_data": [
      { "neuron_uuid": "", activation: 0.5, errors: [0.01] },
    ],
  }, 0);

  const diagnostics = finalizeRustFlushDiagnostics(agg, truncateForLogValue);
  assertEquals(diagnostics.errors.length, 1);
  assertStringIncludes(diagnostics.errors[0], "missing UUID");
});

Deno.test("computeRustFlushMetrics processes batch correctly", () => {
  const data: RustRecordInput["training_data"] = [
    {
      input: [0.1, 0.2],
      output: [0.5],
      "neuron_data": [
        { "neuron_uuid": "n-1", activation: 0.3, errors: [0.01] },
        { "neuron_uuid": "n-2", activation: 0.7, errors: [0.02] },
      ],
    },
    {
      input: [0.3, 0.4],
      output: [0.6],
      "neuron_data": [
        { "neuron_uuid": "n-1", activation: 0.4, errors: [0.03] },
        { "neuron_uuid": "n-2", activation: 0.8, errors: [0.04] },
      ],
    },
  ];

  const metrics = computeRustFlushMetrics(data, 2, 2, 1);
  assertEquals(metrics.sampleCount, 2);
  assertEquals(metrics.totalNeuronRecords, 4);
  assertEquals(metrics.recordsWithNoNeuronData, 0);
  assertEquals(metrics.recordsWithMismatchedNeuronCount, 0);
  assertEquals(metrics.recordsWithInputMismatch, 0);
  assertEquals(metrics.recordsWithOutputMismatch, 0);
  assertEquals(metrics.missingUuidEntries, 0);
  assertEquals(metrics.nonFiniteActivationCount, 0);
  assertEquals(metrics.nonFiniteErrorCount, 0);
});
