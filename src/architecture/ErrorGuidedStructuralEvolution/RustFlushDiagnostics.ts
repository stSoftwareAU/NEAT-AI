/**
 * Rust flush diagnostics: validation and metrics for discovery recording batches.
 *
 * These static utilities inspect training data batches before they are sent to
 * the Rust discovery library, detecting malformed records and collecting metrics
 * for monitoring and debugging.
 */

import type { RustRecordInput } from "./RustDiscovery.ts";
import type {
  RustFlushAggregation,
  RustFlushDiagnostics,
  RustFlushMetrics,
} from "./DiscoverStructureTypes.ts";
import { getLogger } from "../../utils/Logger.ts";

/**
 * Truncates a string for log output.
 */
export function truncateForLogValue(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

/**
 * Creates a fresh aggregation object for accumulating flush diagnostics.
 */
export function createRustFlushAggregation(
  expectedInputLength: number,
  expectedOutputLength: number,
  expectedNeuronCount: number,
): RustFlushAggregation {
  return {
    expectedInputLength,
    expectedOutputLength,
    expectedNeuronCount,
    metrics: {
      sampleCount: 0,
      expectedNeuronCount,
      totalNeuronRecords: 0,
      totalNeuronUuidBytes: 0,
      longestNeuronUuidLength: 0,
      longestNeuronUuid: undefined,
      totalErrorValues: 0,
      maxErrorValuesPerNeuron: 0,
      inputLength: undefined,
      outputLength: undefined,
      recordsWithNoNeuronData: 0,
      recordsWithMismatchedNeuronCount: 0,
      recordsWithInputMismatch: 0,
      recordsWithOutputMismatch: 0,
      missingUuidEntries: 0,
      nonFiniteActivationCount: 0,
      nonFiniteValueCount: 0,
      nonFiniteErrorCount: 0,
      firstMissingUuidLocation: undefined,
      firstNonFiniteActivationLocation: undefined,
      firstNonFiniteValueLocation: undefined,
      firstNonFiniteErrorLocation: undefined,
    },
  };
}

/**
 * Observes a single training record, updating the aggregation metrics.
 * Throws if the record contains an unreasonable number of errors per neuron (data corruption).
 */
export function observeRustTrainingRecord(
  aggregation: RustFlushAggregation,
  record: RustRecordInput["training_data"][number],
  globalSampleIndex: number,
): void {
  const metrics = aggregation.metrics;
  metrics.sampleCount += 1;

  if (metrics.inputLength === undefined) {
    metrics.inputLength = record.input.length;
  }
  if (metrics.outputLength === undefined) {
    metrics.outputLength = record.output.length;
  }

  if (record.input.length !== aggregation.expectedInputLength) {
    metrics.recordsWithInputMismatch += 1;
  }

  if (record.output.length !== aggregation.expectedOutputLength) {
    metrics.recordsWithOutputMismatch += 1;
  }

  const neuronData = record.neuron_data ?? [];
  metrics.totalNeuronRecords += neuronData.length;

  if (neuronData.length === 0) {
    metrics.recordsWithNoNeuronData += 1;
  }
  if (neuronData.length !== aggregation.expectedNeuronCount) {
    metrics.recordsWithMismatchedNeuronCount += 1;
  }

  neuronData.forEach((neuron, neuronIndex) => {
    const uuid = typeof neuron.neuron_uuid === "string"
      ? neuron.neuron_uuid
      : "";
    const uuidLength = uuid.length;
    metrics.totalNeuronUuidBytes += uuidLength;

    if (uuidLength === 0) {
      metrics.missingUuidEntries += 1;
      if (!metrics.firstMissingUuidLocation) {
        metrics.firstMissingUuidLocation =
          `record ${globalSampleIndex}, neuron ${neuronIndex}`;
      }
    } else if (uuidLength > metrics.longestNeuronUuidLength) {
      metrics.longestNeuronUuidLength = uuidLength;
      metrics.longestNeuronUuid = uuid;
    }

    if (!Number.isFinite(neuron.activation)) {
      metrics.nonFiniteActivationCount += 1;
      if (!metrics.firstNonFiniteActivationLocation) {
        metrics.firstNonFiniteActivationLocation =
          `record ${globalSampleIndex}, neuron ${neuronIndex}`;
      }
    }

    const value = (neuron as { value?: number }).value;
    if (value !== undefined && value !== null && !Number.isFinite(value)) {
      metrics.nonFiniteValueCount += 1;
      if (!metrics.firstNonFiniteValueLocation) {
        metrics.firstNonFiniteValueLocation =
          `record ${globalSampleIndex}, neuron ${neuronIndex}`;
      }
    }

    const errors = Array.isArray(neuron.errors) ? neuron.errors : [];
    const errorCount = errors.length;
    metrics.totalErrorValues += errorCount;
    if (errorCount > metrics.maxErrorValuesPerNeuron) {
      metrics.maxErrorValuesPerNeuron = errorCount;
    }

    // VALIDATION: Check for unreasonable error counts
    // This is per-record (per-sample) validation.
    // During backpropagation for ONE sample, each neuron records ONE error
    // - Expected: 1 error per neuron per sample
    // - Multiplier of 2 provides buffer for edge cases
    // - Minimum threshold of 10 for safety
    const outputCount = aggregation.expectedOutputLength;
    const maxReasonableErrorsPerNeuronPerRecord = Math.max(
      10,
      outputCount * 2,
    );

    if (errorCount > maxReasonableErrorsPerNeuronPerRecord) {
      getLogger().error(
        `❌ CRITICAL: Neuron ${uuid} has ${errorCount} errors in record ${globalSampleIndex}, ` +
          `which exceeds reasonable maximum (${maxReasonableErrorsPerNeuronPerRecord})!`,
      );
      getLogger().error(
        `Record ${globalSampleIndex}, Neuron ${neuronIndex}`,
      );
      getLogger().error(
        `Outputs: ${outputCount} (expected ≤${
          outputCount * 2
        } errors per neuron per sample)`,
      );
      getLogger().error(`Errors array sample (first 10):`, errors.slice(0, 10));
      throw new Error(
        `Data corruption detected: neuron ${uuid} has ${errorCount} errors in a single record, ` +
          `which far exceeds reasonable maximum (${maxReasonableErrorsPerNeuronPerRecord}). ` +
          `During backprop, each neuron should record ONE error per sample. This indicates record() is being called too many times.`,
      );
    }

    // LOG WARNING: Log if we're seeing unusually high error counts per sample
    const warningThreshold = Math.max(5, Math.ceil(outputCount * 1.5));
    if (errorCount > warningThreshold) {
      getLogger().warn(
        `⚠️  Record ${globalSampleIndex}: Neuron ${uuid} has ${errorCount} errors ` +
          `(expected ≤${warningThreshold} for ${outputCount} outputs). ` +
          `During backprop, record() should be called once per output. Multiple calls suggest a logic error.`,
      );
    }

    errors.forEach((errorValue, errorIndex) => {
      if (!Number.isFinite(errorValue)) {
        metrics.nonFiniteErrorCount += 1;
        if (!metrics.firstNonFiniteErrorLocation) {
          metrics.firstNonFiniteErrorLocation =
            `record ${globalSampleIndex}, neuron ${neuronIndex}, error ${errorIndex}`;
        }
      }
    });
  });
}

/**
 * Finalises flush diagnostics from the accumulated aggregation, producing
 * a human-readable summary, warnings, and errors.
 */
export function finalizeRustFlushDiagnostics(
  aggregation: RustFlushAggregation,
  truncate: (value: string, max?: number) => string,
): RustFlushDiagnostics {
  const { metrics } = aggregation;
  const summaryParts = [
    `samples=${metrics.sampleCount}`,
    `expectedNeuronCount=${aggregation.expectedNeuronCount}`,
    `recordsWithNoNeuronData=${metrics.recordsWithNoNeuronData}`,
    `recordsWithMismatchedNeuronCount=${metrics.recordsWithMismatchedNeuronCount}`,
    `recordsWithInputMismatch=${metrics.recordsWithInputMismatch}`,
    `recordsWithOutputMismatch=${metrics.recordsWithOutputMismatch}`,
    `missingUuidEntries=${metrics.missingUuidEntries}`,
    `nonFiniteActivationValues=${metrics.nonFiniteActivationCount}`,
    `nonFiniteNeuronValues=${metrics.nonFiniteValueCount}`,
    `nonFiniteErrorValues=${metrics.nonFiniteErrorCount}`,
  ];

  if (metrics.longestNeuronUuid && metrics.longestNeuronUuidLength > 0) {
    summaryParts.push(
      `longestUuid="${
        truncate(metrics.longestNeuronUuid)
      }" (${metrics.longestNeuronUuidLength})`,
    );
  }

  const warnings: string[] = [];
  if (metrics.recordsWithNoNeuronData > 0) {
    warnings.push(
      `Rust flush detected ${metrics.recordsWithNoNeuronData} record(s) without neuron data.`,
    );
  }
  if (metrics.recordsWithMismatchedNeuronCount > 0) {
    warnings.push(
      `Rust flush detected ${metrics.recordsWithMismatchedNeuronCount} record(s) with neuron count mismatch (expected ${aggregation.expectedNeuronCount}).`,
    );
  }
  if (metrics.recordsWithInputMismatch > 0) {
    warnings.push(
      `Rust flush detected ${metrics.recordsWithInputMismatch} record(s) where input length != expected ${aggregation.expectedInputLength}.`,
    );
  }
  if (metrics.recordsWithOutputMismatch > 0) {
    warnings.push(
      `Rust flush detected ${metrics.recordsWithOutputMismatch} record(s) where output length != expected ${aggregation.expectedOutputLength}.`,
    );
  }

  const errors: string[] = [];
  if (metrics.missingUuidEntries > 0) {
    const location = metrics.firstMissingUuidLocation
      ? ` (first observed at ${metrics.firstMissingUuidLocation})`
      : "";
    errors.push(
      `Rust flush encountered ${metrics.missingUuidEntries} neuron entries with missing UUID${location}.`,
    );
  }
  if (metrics.nonFiniteActivationCount > 0) {
    errors.push(
      `Rust flush encountered ${metrics.nonFiniteActivationCount} non-finite activation value(s)${
        metrics.firstNonFiniteActivationLocation
          ? ` (first observed at ${metrics.firstNonFiniteActivationLocation})`
          : ""
      }.`,
    );
  }
  if (metrics.nonFiniteValueCount > 0) {
    errors.push(
      `Rust flush encountered ${metrics.nonFiniteValueCount} non-finite optional neuron value(s)${
        metrics.firstNonFiniteValueLocation
          ? ` (first observed at ${metrics.firstNonFiniteValueLocation})`
          : ""
      }.`,
    );
  }
  if (metrics.nonFiniteErrorCount > 0) {
    errors.push(
      `Rust flush encountered ${metrics.nonFiniteErrorCount} non-finite error value(s)${
        metrics.firstNonFiniteErrorLocation
          ? ` (first observed at ${metrics.firstNonFiniteErrorLocation})`
          : ""
      }.`,
    );
  }

  return {
    summary: `Rust flush diagnostics: ${summaryParts.join(", ")}`,
    warnings,
    errors,
    metrics,
  };
}

/**
 * Computes flush metrics for a complete training-data batch.
 * This is the public entry point used by the static `computeRustFlushMetrics` on DiscoverStructure.
 */
export function computeRustFlushMetrics(
  data: RustRecordInput["training_data"],
  expectedNeuronCount: number,
  expectedInputLength: number,
  expectedOutputLength: number,
): RustFlushMetrics {
  const aggregation = createRustFlushAggregation(
    expectedInputLength,
    expectedOutputLength,
    expectedNeuronCount,
  );
  data.forEach((record, recordIndex) => {
    observeRustTrainingRecord(aggregation, record, recordIndex);
  });
  const diagnostics = finalizeRustFlushDiagnostics(
    aggregation,
    truncateForLogValue,
  );
  return diagnostics.metrics;
}
