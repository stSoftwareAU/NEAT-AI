/**
 * Input conversion and validation for Rust discovery data.
 *
 * Converts creatures to the Rust FFI format and computes statistics
 * for recording batches.
 */

import { DiscoveryError } from "../../errors/DiscoveryError.ts";
import { getLogger } from "../../utils/Logger.ts";
import type {
  RustRecordBatchStats,
  RustRecordInput,
} from "./RustDiscoveryTypes.ts";

/**
 * Converts a Creature to the Rust format expected by the discovery module.
 *
 * @param creature - The creature to convert
 * @returns The creature in Rust format
 */
export function creatureToRustFormat(creature: {
  neurons: Array<{
    uuid?: string;
    type: string;
    squash?: string;
    bias?: number;
  }>;
  synapses: Array<{
    fromUUID: string;
    toUUID: string;
    weight: number;
  }>;
  input: number;
  output: number;
}): RustRecordInput["creature"] {
  return {
    neurons: creature.neurons.map((n) => ({
      uuid: n.uuid || "unknown",
      type: n.type,
      squash: n.squash || "IDENTITY",
      bias: n.bias || 0,
    })),
    synapses: creature.synapses.map((s) => ({
      from_uuid: s.fromUUID,
      to_uuid: s.toUUID,
      weight: s.weight,
    })),
    input: creature.input,
    output: creature.output,
  };
}

export function computeRustRecordStats(
  input: RustRecordInput,
): RustRecordBatchStats {
  const sampleCount = input.training_data.length;
  const expectedNeuronCount =
    input.creature.neurons.filter((neuron) => neuron.type !== "input").length;

  let totalNeuronRecords = 0;
  let totalNeuronUuidBytes = 0;
  let totalErrorValues = 0;
  let maxErrorValuesPerNeuron = 0;
  let longestNeuronUuid = "";
  let longestNeuronUuidLength = 0;
  let inputLength: number | undefined;
  let outputLength: number | undefined;

  for (const record of input.training_data) {
    if (inputLength === undefined) {
      inputLength = record.input.length;
    }
    if (outputLength === undefined) {
      outputLength = record.output.length;
    }

    const neuronData = record.neuron_data ?? [];
    totalNeuronRecords += neuronData.length;

    for (const neuron of neuronData) {
      const uuid = typeof neuron.neuron_uuid === "string"
        ? neuron.neuron_uuid
        : "";
      const uuidLength = uuid.length;
      totalNeuronUuidBytes += uuidLength;

      if (uuidLength > longestNeuronUuidLength) {
        longestNeuronUuid = uuid;
        longestNeuronUuidLength = uuidLength;
      }

      const errors = neuron.errors ?? [];
      const errorCount = errors.length;
      totalErrorValues += errorCount;

      if (errorCount > maxErrorValuesPerNeuron) {
        maxErrorValuesPerNeuron = errorCount;
      }

      // VALIDATION: Check for unreasonable error counts
      // During backpropagation, each neuron records ONE error per sample
      // - Expected: sampleCount errors (one per sample)
      // - Multiplier of 2 provides buffer for edge cases
      // - Minimum threshold of 50 for small sample sizes
      const outputCount = outputLength ?? 1;
      const maxReasonableErrorsPerNeuron = Math.max(
        50,
        sampleCount * outputCount * 2,
      );

      if (errorCount > maxReasonableErrorsPerNeuron) {
        getLogger().error(
          `❌ CRITICAL: Neuron ${uuid} has ${errorCount} errors, which exceeds reasonable maximum (${maxReasonableErrorsPerNeuron})!`,
        );
        getLogger().error(
          `This indicates data corruption in the TypeScript logic.`,
        );
        getLogger().error(
          `Samples: ${sampleCount}, Outputs: ${outputCount}, Max per neuron: ${maxReasonableErrorsPerNeuron}`,
        );
        getLogger().error(
          `Errors array sample (first 10):`,
          errors.slice(0, 10),
        );
        throw new DiscoveryError(
          `Data corruption detected: neuron ${uuid} has ${errorCount} errors, ` +
            `which far exceeds reasonable maximum (${maxReasonableErrorsPerNeuron}). ` +
            `With ${sampleCount} samples and ${outputCount} outputs, this is impossible and indicates a bug in error recording.`,
          "DATA_CORRUPTION",
        );
      }

      // LOG WARNING: Log if we're seeing unusually high error counts
      // This helps identify potential issues early
      const warningThreshold = Math.max(
        20,
        Math.ceil(sampleCount * outputCount * 1.5),
      );
      if (errorCount > warningThreshold) {
        getLogger().warn(
          `⚠️  Neuron ${uuid} has ${errorCount} errors (expected ≤${warningThreshold} for ${sampleCount} samples × ${outputCount} outputs). ` +
            `During backprop, record() should be called once per sample per output. Multiple calls suggest a logic error.`,
        );
      }
    }
  }

  // VALIDATION: Total error values sanity check
  // Maximum possible: each neuron record could have up to max(50, sampleCount * outputCount * 3) errors
  // This is consistent with the per-neuron validation above.
  const outputCount = outputLength ?? 1;
  const maxReasonableErrorsPerRecord = Math.max(
    50,
    sampleCount * outputCount * 3,
  );
  const maxReasonableErrors = totalNeuronRecords * maxReasonableErrorsPerRecord;
  if (totalErrorValues > maxReasonableErrors) {
    getLogger().error(
      `❌ CRITICAL: Total error values (${totalErrorValues}) exceeds reasonable maximum (${maxReasonableErrors})!`,
    );
    getLogger().error(
      `With ${sampleCount} samples and ${expectedNeuronCount} neurons (${totalNeuronRecords} neuron records), this is impossible.`,
    );
    getLogger().error(
      `Average errors per neuron record: ${
        (totalErrorValues / totalNeuronRecords).toFixed(2)
      }`,
    );
    getLogger().error(
      `Max reasonable per record: ${maxReasonableErrorsPerRecord}`,
    );
    throw new DiscoveryError(
      `Data corruption detected: ${totalErrorValues} total error values for ${totalNeuronRecords} neuron records ` +
        `(max ${maxReasonableErrors}). This suggests a critical bug in the error accumulation logic.`,
      "DATA_CORRUPTION",
    );
  }

  return {
    sampleCount,
    expectedNeuronCount,
    totalNeuronRecords,
    totalNeuronUuidBytes,
    longestNeuronUuid: longestNeuronUuidLength > 0
      ? longestNeuronUuid
      : undefined,
    longestNeuronUuidLength,
    totalErrorValues,
    maxErrorValuesPerNeuron,
    inputLength,
    outputLength,
  };
}
