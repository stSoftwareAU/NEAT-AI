/**
 * Native `libneat_ai_backpropagation` for in-process `trainDir` (Issue #3765).
 *
 * Prefers Deno FFI over spawning the CLI (`RustTrainDirBridge.ts`). The C ABI
 * is owned by NEAT-AI-Backpropagation (issue #84): JSON request bytes in, an
 * owned {@link NeatBackpropBuffer} out. Resolution mirrors Discovery / native
 * core:
 *
 * 0. `NEAT_AI_BACKPROP_LIB_PATH` (file or directory)
 * 1. `~/.cargo/lib/`
 * 2. `./target/release/` (cwd)
 * 3. sibling `../NEAT-AI-Backpropagation/target/release/`
 *
 * The library is not opened at module load. Callers load it on first use so
 * the default TypeScript / WASM path (when Rust trainDir is disabled) never
 * `dlopen`s in every worker.
 */

import { fromFileUrl } from "@std/path/from-file-url";
import { join } from "@std/path/join";
import { getLogger } from "@utils/Logger.ts";

/** Matches `NEAT_BACKPROP_ABI_VERSION` / header revision 1. */
export const NEAT_BACKPROP_ABI_VERSION = 1;

/** Matches `NEAT_BACKPROP_OK`. */
export const NEAT_BACKPROP_OK = 0;
/** Matches `NEAT_BACKPROP_ERR_INVALID_ARGUMENT`. */
export const NEAT_BACKPROP_ERR_INVALID_ARGUMENT = 1;
/** Matches `NEAT_BACKPROP_ERR_TRAIN_FAILED`. */
export const NEAT_BACKPROP_ERR_TRAIN_FAILED = 2;
/** Matches `NEAT_BACKPROP_ERR_PANIC`. */
export const NEAT_BACKPROP_ERR_PANIC = 3;

/** `NeatBackpropBuffer` on 64-bit: data*, len, capacity. */
const BACKPROP_BUFFER_BYTES = 24;

type NativeBackpropSymbols = {
  "neat_backprop_abi_version": {
    parameters: [];
    result: "u32";
    nonblocking: false;
  };
  "neat_backprop_version": {
    parameters: [];
    result: "pointer";
    nonblocking: false;
  };
  "neat_backprop_train": {
    parameters: ["buffer", "usize", "buffer"];
    result: "i32";
    nonblocking: false;
  };
  "neat_backprop_buffer_free": {
    parameters: ["buffer"];
    result: "void";
    nonblocking: false;
  };
};

const NATIVE_BACKPROP_SYMBOLS: NativeBackpropSymbols = {
  "neat_backprop_abi_version": {
    parameters: [],
    result: "u32",
    nonblocking: false,
  },
  "neat_backprop_version": {
    parameters: [],
    result: "pointer",
    nonblocking: false,
  },
  "neat_backprop_train": {
    parameters: ["buffer", "usize", "buffer"],
    result: "i32",
    nonblocking: false,
  },
  "neat_backprop_buffer_free": {
    parameters: ["buffer"],
    result: "void",
    nonblocking: false,
  },
};

/** Inputs for {@link findNativeBackpropLibraryFromOptions} (tests inject these). */
export interface NativeBackpropSearchOptions {
  overridePath?: string;
  homeDir?: string;
  cwd?: string;
  siblingDir?: string;
}

/** JSON request for `neat_backprop_train` (camelCase wire, deny unknown). */
export interface NativeBackpropTrainRequest {
  creatureJson: string;
  trainingData: string;
  outputDir: string;
  epochs: number;
  maxRecords?: number | null;
  seed: number;
  disableRandomSamples: boolean;
  learningRate: number;
  learningRateStrategy: "fixed" | "decay" | "adaptive" | "warmRestart";
  learningRateDecay: number;
  normaliseGradients: boolean;
  maximumBiasAdjustmentScale: number;
  maximumWeightAdjustmentScale: number;
  stepScale: number;
  outputsOnly?: boolean;
  hiddenOnly?: boolean;
  acceptAlways?: boolean;
  maxBacktracks?: number;
  scorer?: string | null;
  traceStore?: string | null;
}

/** Successful JSON response from `neat_backprop_train`. */
export interface NativeBackpropTrainResponse {
  abiVersion: number;
  version: string;
  bestCreatureJson: string;
  baselineMse: number;
  bestMse: number;
  acceptedEpochs: number;
  epochs: number;
  bestPath: string;
  journalPath: string;
  bestTracePath?: string | null;
  failedTraceDir?: string | null;
  baselineScore?: unknown;
  bestScore?: unknown;
}

let nativeLib: Deno.DynamicLibrary<NativeBackpropSymbols> | null = null;
let loadAttempted = false;
let loggedAvailability = false;

function readEnvString(key: string): string | undefined {
  try {
    const v = Deno.env.get(key);
    if (v === undefined || v.trim() === "") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

/**
 * Platform-specific `libneat_ai_backpropagation` file name.
 */
export function nativeBackpropLibFileName(): string {
  switch (Deno.build.os) {
    case "windows":
      return "neat_ai_backpropagation.dll";
    case "darwin":
      return "libneat_ai_backpropagation.dylib";
    default:
      return "libneat_ai_backpropagation.so";
  }
}

function resolveLibraryCandidate(
  candidate: string,
  libName: string,
): string | null {
  try {
    const stat = Deno.statSync(candidate);
    if (stat.isFile) return candidate;
    if (stat.isDirectory) {
      const nestedPath = join(candidate, libName);
      if (Deno.statSync(nestedPath).isFile) return nestedPath;
    }
  } catch {
    // Candidate path is not viable.
  }
  return null;
}

function siblingReleaseDir(): string {
  return fromFileUrl(
    new URL(
      "../../../../NEAT-AI-Backpropagation/target/release",
      import.meta.url,
    ),
  );
}

/**
 * Resolve `libneat_ai_backpropagation` from explicit search inputs.
 */
export function findNativeBackpropLibraryFromOptions(
  options: NativeBackpropSearchOptions,
): string | null {
  const libName = nativeBackpropLibFileName();

  const overridePath = options.overridePath?.trim();
  if (overridePath) {
    const resolved = resolveLibraryCandidate(overridePath, libName);
    if (resolved) return resolved;
  }

  if (options.homeDir) {
    const cargoLib = resolveLibraryCandidate(
      join(options.homeDir, ".cargo", "lib"),
      libName,
    );
    if (cargoLib) return cargoLib;
  }

  const cwd = options.cwd ?? Deno.cwd();
  const localTarget = resolveLibraryCandidate(
    join(cwd, "target", "release"),
    libName,
  );
  if (localTarget) return localTarget;

  const sibling = options.siblingDir ?? siblingReleaseDir();
  const siblingTarget = resolveLibraryCandidate(sibling, libName);
  if (siblingTarget) return siblingTarget;

  const cwdSibling = resolveLibraryCandidate(
    join(cwd, "..", "NEAT-AI-Backpropagation", "target", "release"),
    libName,
  );
  if (cwdSibling) return cwdSibling;

  return null;
}

/**
 * Resolve `libneat_ai_backpropagation` from the environment and well-known
 * locations.
 */
export function findNativeBackpropLibrary(): string | null {
  let homeDir: string | undefined;
  try {
    homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? undefined;
  } catch {
    homeDir = undefined;
  }
  return findNativeBackpropLibraryFromOptions({
    overridePath: readEnvString("NEAT_AI_BACKPROP_LIB_PATH"),
    homeDir,
  });
}

function loadNativeBackpropLibrary(): boolean {
  if (nativeLib !== null) return true;
  if (loadAttempted) return false;
  loadAttempted = true;

  const libPath = findNativeBackpropLibrary();
  if (!libPath) return false;

  try {
    nativeLib = Deno.dlopen(libPath, NATIVE_BACKPROP_SYMBOLS);
    const abi = nativeLib.symbols["neat_backprop_abi_version"]();
    if (abi !== NEAT_BACKPROP_ABI_VERSION) {
      nativeLib.close();
      nativeLib = null;
      getLogger().warn(
        `[NEAT-AI] libneat_ai_backpropagation at ${libPath} reports ABI ` +
          `${abi}; expected ${NEAT_BACKPROP_ABI_VERSION}.`,
      );
      return false;
    }
    if (!loggedAvailability) {
      loggedAvailability = true;
      getLogger().info(
        `[NEAT-AI] trainDir FFI libneat_ai_backpropagation loaded from ${libPath}`,
      );
    }
    return true;
  } catch (error) {
    nativeLib = null;
    getLogger().warn(
      `[NEAT-AI] Failed to load libneat_ai_backpropagation at ${libPath}.`,
      error,
    );
    return false;
  }
}

/**
 * Close the native library. Tests that reopen the handle should call this
 * in `finally` so `--trace-leaks` stays happy.
 */
export function closeNativeBackpropLibrary(): void {
  if (nativeLib !== null) {
    nativeLib.close();
    nativeLib = null;
  }
  loadAttempted = false;
  loggedAvailability = false;
}

/**
 * True when the native library is loaded (or can be loaded) in this isolate.
 */
export function isNativeBackpropAvailable(): boolean {
  return loadNativeBackpropLibrary();
}

/**
 * Crate version from `neat_backprop_version`, or `undefined` when unavailable.
 */
export function getNativeBackpropVersion(): string | undefined {
  if (!loadNativeBackpropLibrary() || nativeLib === null) return undefined;
  try {
    const ptr = nativeLib.symbols["neat_backprop_version"]();
    if (ptr === null) return undefined;
    return new Deno.UnsafePointerView(ptr).getCString();
  } catch (error) {
    getLogger().warn("[NEAT-AI] neat_backprop_version probe failed:", error);
    return undefined;
  }
}

function readOwnedUtf8(structBytes: Uint8Array): string {
  const view = new DataView(
    structBytes.buffer,
    structBytes.byteOffset,
    structBytes.byteLength,
  );
  const dataAddr = view.getBigUint64(0, true);
  const len = Number(view.getBigUint64(8, true));
  if (dataAddr === 0n || len <= 0) return "";
  const ptr = Deno.UnsafePointer.create(dataAddr);
  if (ptr === null) return "";
  const out = new Uint8Array(len);
  new Deno.UnsafePointerView(ptr).copyInto(out);
  return new TextDecoder().decode(out);
}

/**
 * Run one `trainDir` via the C ABI.
 *
 * @throws when the library is missing, the ABI rejects the request, or the
 *         trainer fails — callers must not fall back to WASM for a claimed
 *         native request.
 */
export function nativeBackpropTrain(
  request: NativeBackpropTrainRequest,
): NativeBackpropTrainResponse {
  if (!loadNativeBackpropLibrary() || nativeLib === null) {
    throw new Error(
      "libneat_ai_backpropagation was not found or failed to load",
    );
  }

  const requestBytes = new TextEncoder().encode(JSON.stringify(request));
  const outStruct = new Uint8Array(BACKPROP_BUFFER_BYTES);
  try {
    const status = nativeLib.symbols["neat_backprop_train"](
      requestBytes,
      BigInt(requestBytes.byteLength),
      outStruct,
    );
    const payload = readOwnedUtf8(outStruct);
    if (status !== NEAT_BACKPROP_OK) {
      throw new Error(
        `neat_backprop_train failed (status ${status}): ${
          payload || "(empty)"
        }`,
      );
    }
    return JSON.parse(payload) as NativeBackpropTrainResponse;
  } finally {
    try {
      nativeLib.symbols["neat_backprop_buffer_free"](outStruct);
    } catch {
      // Best-effort free if the call partially populated the buffer.
    }
  }
}

globalThis.addEventListener("unload", () => {
  closeNativeBackpropLibrary();
});
