/**
 * Rust discovery FFI operations: recording, analysis, reading, and merging.
 *
 * These functions call the Rust library via FFI to perform discovery
 * data operations.
 */

import { assert } from "@std/assert";
import type {
  RustMergeParquetInput,
  RustMergeParquetResult,
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
  RustRankFocusInput,
  RustRankFocusResult,
  RustReadInput,
  RustReadResult,
  RustRecordErrorDetails,
  RustRecordFailureStage,
  RustRecordInput,
  RustRecordResult,
} from "./RustDiscoveryTypes.ts";
import { computeRustRecordStats } from "./RustDiscoveryInput.ts";
import {
  getRustLibSymbols,
  isRustLibraryAvailable,
  readCString,
} from "./RustDiscoveryLibrary.ts";

/**
 * Reads discovery records from a Parquet file for a specific neuron.
 *
 * @param input - Input containing parquet file path and neuron UUID
 * @returns The read records or null if Rust library is not available
 */
export function readDiscoveryRecords(
  input: RustReadInput,
): RustReadResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  const symbols = getRustLibSymbols();

  try {
    // Serialize input to JSON
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);

    // Allocate memory for input string (C string - null terminated)
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0; // Null terminator

    const inputPtr = Deno.UnsafePointer.of(inputBuffer);

    // Call Rust function
    const resultPtr = symbols["read_discovery_records_ffi"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    // Read the result string from the pointer
    const resultJson = readCString(resultPtr);

    // Free the memory allocated by Rust
    symbols["free_discovery_result"](resultPtr);

    // Parse the JSON result
    const result = JSON.parse(resultJson) as RustReadResult;

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function rankFocusNeurons(
  input: RustRankFocusInput,
): RustRankFocusResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  const symbols = getRustLibSymbols();

  try {
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0;

    const inputPtr = Deno.UnsafePointer.of(inputBuffer);
    const resultPtr = symbols["rank_focus_neurons"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    const resultJson = readCString(resultPtr);
    symbols["free_discovery_result"](resultPtr);

    const result = JSON.parse(resultJson) as RustRankFocusResult;
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function mergeDiscoveryParquet(
  input: RustMergeParquetInput,
): RustMergeParquetResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  const symbols = getRustLibSymbols();

  try {
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0;

    const inputPtr = Deno.UnsafePointer.of(inputBuffer);
    const resultPtr = symbols["merge_discovery_parquet"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    const resultJson = readCString(resultPtr);
    symbols["free_discovery_result"](resultPtr);

    const result = JSON.parse(resultJson) as RustMergeParquetResult;
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Records discovery data using the Rust module.
 *
 * @param input - The discovery input data.
 * @returns The recording result, or null if the Rust library is unavailable.
 */
export function recordDiscovery(
  input: RustRecordInput,
): RustRecordResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  const symbols = getRustLibSymbols();
  assert(symbols !== null, "Rust library should be loaded");

  const stats = computeRustRecordStats(input);

  let inputJson: string | undefined;
  let inputBytes: Uint8Array | undefined;

  const buildFailure = (
    stage: RustRecordFailureStage,
    message: string,
    overrides: Partial<RustRecordErrorDetails> = {},
  ): RustRecordResult => {
    const details: RustRecordErrorDetails = {
      stage,
      stats,
      ...(overrides.stats ? { stats: overrides.stats } : {}),
      ...overrides,
    };

    if (
      details.inputJsonLength === undefined && typeof inputJson === "string"
    ) {
      details.inputJsonLength = inputJson.length;
    }

    if (
      details.inputBytesLength === undefined && inputBytes !== undefined
    ) {
      details.inputBytesLength = inputBytes.length;
    }

    return {
      success: false,
      error: message,
      errorDetails: details,
    };
  };

  try {
    inputJson = JSON.stringify(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure("stringify", message);
  }

  try {
    inputBytes = new TextEncoder().encode(inputJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure("encode", message, {
      inputJsonLength: inputJson.length,
    });
  }

  // Allocate memory for input string (C string - null terminated)
  const inputBuffer = new Uint8Array(inputBytes.length + 1);
  inputBuffer.set(inputBytes);
  inputBuffer[inputBytes.length] = 0; // Null terminator

  const inputPtr = Deno.UnsafePointer.of(inputBuffer);

  let resultPtr: Deno.PointerValue | null = null;
  let currentStage: RustRecordFailureStage = "ffi";

  try {
    resultPtr = symbols["record_discovery"](inputPtr);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure(currentStage, message);
  }

  if (resultPtr === null) {
    return buildFailure("ffi", "Rust function returned null pointer");
  }

  try {
    const resultJson = readCString(resultPtr);
    currentStage = "parse";
    const parsed = JSON.parse(resultJson) as RustRecordResult;

    if (
      !parsed.success &&
      parsed.error?.includes("Invalid string length") &&
      !parsed.errorDetails
    ) {
      return {
        ...parsed,
        errorDetails: {
          stage: "rust",
          inputJsonLength: inputJson.length,
          inputBytesLength: inputBytes.length,
          stats,
        },
      };
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildFailure(currentStage, message);
  } finally {
    symbols["free_discovery_result"](resultPtr);
  }
}

export function analyzeParallel(
  input: RustParallelAnalysisInput,
): RustParallelAnalysisResult | null {
  if (!isRustLibraryAvailable()) {
    return null;
  }

  const symbols = getRustLibSymbols();

  try {
    const inputJson = JSON.stringify(input);
    const inputBytes = new TextEncoder().encode(inputJson);
    const inputBuffer = new Uint8Array(inputBytes.length + 1);
    inputBuffer.set(inputBytes);
    inputBuffer[inputBytes.length] = 0;
    const inputPtr = Deno.UnsafePointer.of(inputBuffer);
    const resultPtr = symbols["analyze_parallel"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    const resultJson = readCString(resultPtr);
    symbols["free_discovery_result"](resultPtr);
    const result = JSON.parse(resultJson) as RustParallelAnalysisResult;
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
