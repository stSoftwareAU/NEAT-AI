/**
 * FFI wrapper for the NEAT-AI-Discovery Rust library.
 *
 * This module provides a TypeScript interface to the Rust discovery recording
 * functionality via Deno's Foreign Function Interface (FFI).
 *
 * The Rust library must export a C-compatible function:
 * ```rust
 * #[no_mangle]
 * pub extern "C" fn record_discovery(input_json: *const c_char) -> *mut c_char
 * ```
 */

import { assert } from "@std/assert";

/**
 * Result of recording discovery data via Rust module.
 */
export interface RustRecordResult {
  success: boolean;
  "temp_dir"?: string;
  file?: string;
  error?: string;
}

/**
 * Input structure for Rust record_discovery function.
 * Matches the RecordDiscoveryInput struct in Rust.
 *
 * Note: The Rust module currently has TODOs for creature activation.
 * For now, we'll pass pre-computed neuron data along with training data.
 * The Rust module will use the pre-computed data if available.
 */
export interface RustRecordInput {
  creature: {
    neurons: Array<{
      uuid: string;
      type: string;
      squash: string;
      bias: number;
    }>;
    synapses: Array<{
      from_uuid: string;
      to_uuid: string;
      weight: number;
    }>;
    input: number;
    output: number;
  };
  "training_data": Array<{
    input: number[];
    output: number[];
    // Pre-computed neuron data (activations and errors)
    // This will be used by Rust instead of activating the creature
    neuron_data?: Array<{
      neuron_uuid: string;
      activation: number;
      value?: number;
      errors: number[]; // Array of error values
    }>;
  }>;
  "temp_dir": string;
  "binary_file_path"?: string;
  "record_indices"?: number[];
  "timeout_seconds"?: number;
}

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

/**
 * Platform-specific library file extension.
 */
function getLibraryExtension(): string {
  const platform = Deno.build.os;
  switch (platform) {
    case "darwin":
      return ".dylib";
    case "linux":
      return ".so";
    case "windows":
      return ".dll";
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Resolves the path to the Rust library.
 *
 * Checks in order:
 * 1. ~/.cargo/lib/ (from runlib.sh installation)
 * 2. ../NEAT-AI-Discovery/target/release/ (for development)
 *
 * @returns The library path if found, null otherwise.
 */
export function findRustLibrary(): string | null {
  const libName = `libneat_ai_discovery${getLibraryExtension()}`;

  // Try to get home directory, but handle gracefully if --allow-env is not granted
  let homeDir: string | undefined;
  try {
    homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  } catch {
    // --allow-env not granted, skip HOME directory check
    homeDir = undefined;
  }

  // Check ~/.cargo/lib/ first (production installation)
  if (homeDir) {
    const cargoLibPath = `${homeDir}/.cargo/lib/${libName}`;
    try {
      const stat = Deno.statSync(cargoLibPath);
      if (stat.isFile) {
        return cargoLibPath;
      }
    } catch {
      // File doesn't exist, continue to next check
    }
  }

  // Check ../NEAT-AI-Discovery/target/release/ (development)
  try {
    const devPath = new URL(
      `../../NEAT-AI-Discovery/target/release/${libName}`,
      import.meta.url,
    ).pathname;
    const stat = Deno.statSync(devPath);
    if (stat.isFile) {
      return devPath;
    }
  } catch {
    // File doesn't exist, continue
  }

  // Also check absolute path if we're in the workspace
  try {
    const absDevPath =
      "/Users/nigelleck/Develop/NEAT-AI-Discovery/target/release/" +
      libName;
    const stat = Deno.statSync(absDevPath);
    if (stat.isFile) {
      return absDevPath;
    }
  } catch {
    // File doesn't exist
  }

  return null;
}

/**
 * FFI symbols for the Rust library.
 *
 * The Rust function should be exported as:
 * ```rust
 * #[no_mangle]
 * pub extern "C" fn record_discovery(input_json: *const c_char) -> *mut c_char
 * ```
 */
type RustDiscoverySymbols = {
  "record_discovery": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "read_discovery_records_ffi": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "free_discovery_result": {
    parameters: ["pointer"];
    result: "void";
    nonblocking: false;
  };
};

/**
 * Loaded Rust library instance.
 */
let rustLib: Deno.DynamicLibrary<RustDiscoverySymbols> | null = null;

/**
 * Closes the Rust library if it's loaded.
 * This is useful for test cleanup to avoid leak detection warnings.
 */
export function closeRustLibrary(): void {
  if (rustLib !== null) {
    rustLib.close();
    rustLib = null;
  }
}

/**
 * Loads the Rust discovery library.
 *
 * @returns true if the library was loaded successfully, false otherwise.
 */
export function loadRustLibrary(): boolean {
  if (rustLib !== null) {
    return true; // Already loaded
  }

  const libPath = findRustLibrary();
  if (!libPath) {
    return false;
  }

  try {
    const symbols: RustDiscoverySymbols = {
      "record_discovery": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "read_discovery_records_ffi": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "free_discovery_result": {
        parameters: ["pointer"],
        result: "void",
        nonblocking: false,
      },
    };
    rustLib = Deno.dlopen(libPath, symbols);
    return true;
  } catch (error) {
    console.warn(
      `Failed to load Rust discovery library from ${libPath}:`,
      error,
    );
    return false;
  }
}

/**
 * Checks if the Rust library file exists without loading it.
 * This is useful for checking availability without causing memory leaks in tests.
 *
 * @returns true if the library file exists, false otherwise.
 */
export function rustLibraryExists(): boolean {
  return findRustLibrary() !== null;
}

/**
 * Checks if the Rust library is available (loaded or can be loaded).
 *
 * @returns true if available, false otherwise.
 */
export function isRustLibraryAvailable(): boolean {
  if (rustLib !== null) {
    return true;
  }
  return loadRustLibrary();
}

/**
 * Checks if the Rust discovery module is enabled and available.
 * This is the main function to use before attempting discovery operations.
 *
 * @returns true if Rust module is enabled and available, false otherwise.
 */
export function isRustDiscoveryEnabled(): boolean {
  try {
    return isRustLibraryAvailable();
  } catch {
    // FFI not allowed or library not available
    return false;
  }
}

/**
 * Input for reading discovery records from Parquet.
 */
export interface RustReadInput {
  "parquet_file": string;
  "neuron_uuid": string;
}

/**
 * Result of reading discovery records from Parquet.
 */
export interface RustReadResult {
  success: boolean;
  records?: Array<{
    obs_index: number;
    neuron_uuid: string;
    value: number | null;
    activation: number;
    errors: number[];
  }>;
  error?: string;
}

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

  assert(rustLib !== null, "Rust library should be loaded");

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
    const resultPtr = rustLib.symbols["read_discovery_records_ffi"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    // Read the result string from the pointer
    const resultJson = readCString(resultPtr);

    // Free the memory allocated by Rust
    rustLib.symbols["free_discovery_result"](resultPtr);

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

/**
 * Helper to read a C string from a pointer.
 * Reads until null terminator.
 */
function readCString(ptr: Deno.PointerValue): string {
  if (ptr === null) {
    return "";
  }

  const view = new Deno.UnsafePointerView(ptr);
  let length = 0;

  // Find null terminator
  while (view.getUint8(length) !== 0) {
    length++;
    if (length > 1000000) { // Safety limit
      throw new Error("C string too long or not null-terminated");
    }
  }

  // Read the string
  const buffer = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    buffer[i] = view.getUint8(i);
  }

  return new TextDecoder().decode(buffer);
}

/**
 * Records discovery data using the Rust module.
 *
 * NOTE: This requires the Rust library to export a C-compatible function:
 * ```rust
 * #[no_mangle]
 * pub extern "C" fn record_discovery(input_json: *const c_char) -> *mut c_char
 * ```
 * The function should allocate the result string and return a pointer to it.
 * The caller is responsible for freeing the memory (Rust should provide a free function).
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

  assert(rustLib !== null, "Rust library should be loaded");

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
    // Note: The Rust function signature should be:
    // extern "C" fn record_discovery(input: *const c_char) -> *mut c_char
    // The function reads the C string until null terminator
    const resultPtr = rustLib.symbols["record_discovery"](inputPtr);

    if (resultPtr === null) {
      return {
        success: false,
        error: "Rust function returned null pointer",
      };
    }

    // Read the result string from the pointer
    const resultJson = readCString(resultPtr);

    // Free the memory allocated by Rust
    rustLib.symbols["free_discovery_result"](resultPtr);

    // Parse the JSON result
    const result = JSON.parse(resultJson) as RustRecordResult;

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
