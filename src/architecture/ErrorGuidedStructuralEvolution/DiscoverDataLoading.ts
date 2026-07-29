/**
 * File I/O and data loading for DiscoverStructure.
 *
 * Issue #1472: Extract DiscoverStructure.ts into focused modules.
 *
 * Handles loading neuron records from Parquet files (via Rust FFI) and
 * binary files, with retry logic for file descriptor limits.
 */
import { getLogger } from "@utils/Logger.ts";
import { appendAll } from "@utils/ArrayAppend.ts";
import { DiscoveryError } from "@errors/DiscoveryError.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import type {
  BinaryRecordIndices,
  DiscoverRecord,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import type { DiscoverStructureDeps } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

/**
 * Opens a file with exponential backoff retry for "Too many open files" errors.
 */
async function openFileWithRetry(
  file: string,
  maxRetries = 5,
  initialDelay = 200,
): Promise<Deno.FsFile> {
  let retries = 0;
  let delay = initialDelay;

  while (true) {
    try {
      // deno-lint-ignore no-await-in-loop
      return await Deno.open(file);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Too many open files") && retries < maxRetries
      ) {
        getLogger().warn(
          `Too many open files, retrying in ${delay}ms (attempt ${
            retries + 1
          }/${maxRetries})`,
        );
        // deno-lint-ignore no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
        retries++;
        continue;
      }
      throw error; // Re-throw if it's not a "Too many open files" error or we've exhausted retries
    }
  }
}

/**
 * Loads input neuron activation data directly from binary files using stored indices.
 * Input neurons are stored in binary format as they are not written to Parquet.
 */
async function loadInputNeuronFromBinary(
  neuronIndex: number,
  indicesFilePath: string,
  inputCount: number,
  outputCount: number,
): Promise<DiscoverRecord[]> {
  // Read the selected indices from JSON file
  const indicesContent = await Deno.readTextFile(indicesFilePath);
  const indices: BinaryRecordIndices = JSON.parse(indicesContent);

  const records: DiscoverRecord[] = [];
  const BYTES_PER_RECORD = (inputCount + outputCount) * 4;

  // Process each binary file that has selected indices
  // Collect file reading promises to avoid await in loop
  const fileReadPromises = Object.entries(indices).map(
    async ([binaryFile, recordIndices]) => {
      const file = await openFileWithRetry(binaryFile);
      const fileRecords: DiscoverRecord[] = [];

      try {
        const recordBuffer = new Uint8Array(BYTES_PER_RECORD);
        const recordArray = new Float32Array(recordBuffer.buffer);

        for (const recordIndex of recordIndices) {
          // Seek to the record position
          const targetPosition = recordIndex * BYTES_PER_RECORD;
          file.seekSync(targetPosition, Deno.SeekMode.Start);

          // Read the record
          const bytesRead = file.readSync(recordBuffer);
          if (bytesRead === null || bytesRead !== BYTES_PER_RECORD) {
            getLogger().warn(
              `Failed to read record ${recordIndex} from ${binaryFile}`,
            );
            continue;
          }

          // Extract the input value at the specified index
          // Binary format: [input0, input1, ..., inputN, output0, ..., outputM]
          const activation = recordArray[neuronIndex];

          fileRecords.push({
            activation,
            errors: [], // Input neurons don't have errors
          });
        }
      } finally {
        file.close();
      }

      return fileRecords;
    },
  );

  // Wait for all file reads to complete
  const allFileRecords = await Promise.all(fileReadPromises);

  // Flatten the results into a single array
  for (const fileRecords of allFileRecords) {
    // Issue #2900: stack-safe append; fileRecords scales with the dataset
    // record count for a binary file, so spreading risks RangeError.
    appendAll(records, fileRecords);
  }

  return records;
}

/**
 * Loads discovery records for a neuron from Parquet storage via Rust.
 * Note: Input neurons are read from binary files as they are never written to Parquet.
 */
export async function loadNeuronRecords(
  neuronIdentifier: string,
  parquetFilePath: string | null,
  indicesFilePath: string,
  inputCount: number,
  outputCount: number,
  deps: DiscoverStructureDeps,
): Promise<DiscoverRecord[]> {
  // Check if this is an input neuron - always read from binary files
  const fileName = neuronIdentifier.split("/").pop();
  if (fileName && fileName.startsWith("input-")) {
    // Extract neuron index from filename like "input-5.csv" (legacy naming)
    const match = fileName.match(/^input-(\d+)(?:\.csv)?$/);
    if (match) {
      const neuronIndex = parseInt(match[1], 10);

      // Always read from binary files (input neurons are never in Parquet)
      try {
        const indicesContent = await Deno.readTextFile(indicesFilePath);
        const indices: BinaryRecordIndices = JSON.parse(indicesContent);

        // If we have binary indices, use them
        if (Object.keys(indices).length > 0) {
          return await loadInputNeuronFromBinary(
            neuronIndex,
            indicesFilePath,
            inputCount,
            outputCount,
          );
        }
      } catch {
        // No indices file or empty - return empty
        return [];
      }
    }
  }

  // For non-input neurons, read from Parquet (Rust is required)
  if (!parquetFilePath) {
    throw new DiscoveryError(
      "Parquet file path not set. Discovery requires the NEAT-AI-Discovery Rust library.",
      "LIBRARY_NOT_FOUND",
    );
  }

  // Extract neuron id string from identifier (strip .csv extension if present)
  const match = fileName?.match(/^(.+?)(?:\.csv)?$/);
  if (!match) {
    throw new TopologyError(
      `Invalid neuron identifier: ${fileName}`,
      "INVALID_STATE",
    );
  }
  const neuronIdStr = match[1];

  // Verify Parquet file exists before reading
  try {
    await Deno.stat(parquetFilePath);
  } catch {
    throw new DiscoveryError(
      `Parquet file does not exist: ${parquetFilePath}`,
      "LIBRARY_NOT_FOUND",
    );
  }

  // Read from Parquet via Rust FFI
  const readResult = deps.readDiscoveryRecords({
    parquet_file: parquetFilePath,
    neuron_uuid: neuronIdStr,
  });

  if (readResult && readResult.success && readResult.records) {
    // Convert Rust records to TypeScript format
    // Sort by obs_index to ensure records are in the same order as they were written
    const sortedRecords = [...readResult.records].sort(
      (a, b) => a.obs_index - b.obs_index,
    );
    const converted = sortedRecords.map((r) => ({
      activation: r.activation,
      value: r.value ?? r.activation, // Use activation as fallback for value
      errors: [...r.errors],
    }));

    return converted;
  } else {
    // Rust reading failed
    throw new DiscoveryError(
      `Failed to read discovery records from Parquet: ${
        readResult?.error || "Unknown error"
      }`,
      "FFI_CRASH",
    );
  }
}
