/**
 * Rust discovery library loading, resolution, and availability checks.
 *
 * Manages the lifecycle of the Rust FFI library: finding, loading,
 * closing, and checking availability of both the library and GPU.
 */

import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path/from-file-url";
import { join } from "@std/path/join";
import { DiscoveryError } from "../../errors/DiscoveryError.ts";
import { getLogger } from "../../utils/Logger.ts";
import type {
  RustCheckGpuResult,
  RustGetVersionResult,
  RustLibrarySearchOptions,
} from "./RustDiscoveryTypes.ts";

const MAX_C_STRING_BYTES = 128 * 1024 * 1024; // 128 MiB guard for FFI strings

/**
 * FFI symbols for the Rust library.
 */
type RustDiscoverySymbols = {
  "record_discovery": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "analyze_parallel": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "read_discovery_records_ffi": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "merge_discovery_parquet": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "rank_focus_neurons": {
    parameters: ["pointer"];
    result: "pointer";
    nonblocking: false;
  };
  "check_gpu_available": {
    parameters: [];
    result: "pointer";
    nonblocking: false;
  };
  "get_library_version": {
    parameters: [];
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

let rustGpuWarningEmitted = false;

/** Cached NEAT-AI-Discovery library version (null = not yet fetched, undefined = fetch failed) */
let cachedDiscoveryVersion: string | null | undefined = null;

/**
 * Tristate for rust discovery availability.
 * - "unknown": Not yet checked
 * - true: Library is available AND GPU is available
 * - false: Library is not available OR GPU is not available
 */
type RustDiscoveryEnabledState = "unknown" | true | false;

let rustDiscoveryEnabledState: RustDiscoveryEnabledState = "unknown";

/**
 * Returns the internal Rust library symbols for FFI calls.
 * Only call this after verifying `isRustLibraryAvailable()`.
 */
export function getRustLibSymbols(): Deno.DynamicLibrary<
  RustDiscoverySymbols
>["symbols"] {
  assert(rustLib !== null, "Rust library should be loaded");
  return rustLib.symbols;
}

/**
 * Helper to read a C string from a pointer.
 * Reads until null terminator.
 */
export function readCString(ptr: Deno.PointerValue): string {
  if (ptr === null) {
    return "";
  }

  const view = new Deno.UnsafePointerView(ptr);
  let length = 0;

  // Find null terminator
  while (view.getUint8(length) !== 0) {
    length++;
    if (length >= MAX_C_STRING_BYTES) {
      throw new DiscoveryError(
        `C string exceeded ${MAX_C_STRING_BYTES} bytes without null terminator`,
        "FFI_CRASH",
      );
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
      throw new DiscoveryError(
        `Unsupported platform: ${platform}`,
        "LIBRARY_NOT_FOUND",
      );
  }
}

function resolveLibraryCandidate(
  candidate: string,
  libName: string,
): string | null {
  try {
    const stat = Deno.statSync(candidate);
    if (stat.isFile) {
      return candidate;
    }

    if (stat.isDirectory) {
      const nestedPath = join(candidate, libName);
      const nestedStat = Deno.statSync(nestedPath);
      if (nestedStat.isFile) {
        return nestedPath;
      }
    }
  } catch {
    // Candidate path is not viable
  }

  return null;
}

function resolveOverridePath(libName: string): string | null {
  try {
    const override = Deno.env.get("NEAT_AI_DISCOVERY_LIB_PATH");
    if (!override || override.trim() === "") {
      return null;
    }

    return resolveLibraryCandidate(override, libName);
  } catch {
    // --allow-env not granted, ignore override
    return null;
  }
}

/**
 * Resolves the path to the Rust library.
 *
 * Checks in order:
 * 0. NEAT_AI_DISCOVERY_LIB_PATH override (file or directory)
 * 1. ~/.cargo/lib/ (from runlib.sh installation)
 * 2. ./target/release/ (local build artefacts)
 * 3. ../NEAT-AI-Discovery/target/release/ (for development)
 *
 * @returns The library path if found, null otherwise.
 */
export function findRustLibrary(): string | null {
  const libName = `libneat_ai_discovery${getLibraryExtension()}`;

  // Read override/home from environment (best effort).
  const overridePath = resolveOverridePath(libName) ?? undefined;

  let homeDir: string | undefined;
  try {
    homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || undefined;
  } catch {
    homeDir = undefined;
  }

  return findRustLibraryFromOptions({ overridePath, homeDir });
}

/**
 * Same resolution logic as `findRustLibrary()`, but driven by explicit inputs.
 *
 * This exists so tests can validate override precedence without mutating global
 * process environment variables (which are shared across parallel tests).
 */
export function findRustLibraryFromOptions(
  options: RustLibrarySearchOptions,
): string | null {
  const libName = `libneat_ai_discovery${getLibraryExtension()}`;

  const overridePath = options.overridePath?.trim();
  if (overridePath) {
    const overrideResolved = resolveLibraryCandidate(overridePath, libName);
    if (overrideResolved) {
      return overrideResolved;
    }
  }

  const homeDir = options.homeDir;
  if (homeDir) {
    const cargoLibPath = resolveLibraryCandidate(
      join(homeDir, ".cargo", "lib"),
      libName,
    );
    if (cargoLibPath) {
      return cargoLibPath;
    }
  }

  const cwd = options.cwd ?? Deno.cwd();
  const localTargetPath = resolveLibraryCandidate(
    join(cwd, "target", "release"),
    libName,
  );
  if (localTargetPath) {
    return localTargetPath;
  }

  const siblingDir = fromFileUrl(
    new URL(
      "../../../NEAT-AI-Discovery/target/release",
      import.meta.url,
    ),
  );
  const siblingTargetPath = resolveLibraryCandidate(siblingDir, libName);
  if (siblingTargetPath) {
    return siblingTargetPath;
  }

  return null;
}

/**
 * Closes the Rust library if it's loaded.
 * This is useful for test cleanup to avoid leak detection warnings.
 */
export function closeRustLibrary(): void {
  if (rustLib !== null) {
    rustLib.close();
    rustLib = null;
    rustGpuWarningEmitted = false;
    cachedDiscoveryVersion = null;
  }
  // Reset cached discovery state so it will be re-checked on next call
  rustDiscoveryEnabledState = "unknown";
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
    // Ensure the process has FFI access to the discovery library before loading.
    if (typeof Deno.permissions?.querySync === "function") {
      const permission = Deno.permissions.querySync({
        name: "ffi",
        path: libPath,
      });
      if (permission.state !== "granted") {
        getLogger().warn(
          `FFI permission denied for discovery library at ${libPath}. ` +
            "Run with --allow-ffi to enable Rust discovery.",
        );
        return false;
      }
    }

    const symbols: RustDiscoverySymbols = {
      "record_discovery": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "analyze_parallel": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "read_discovery_records_ffi": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "merge_discovery_parquet": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "rank_focus_neurons": {
        parameters: ["pointer"],
        result: "pointer",
        nonblocking: false,
      },
      "check_gpu_available": {
        parameters: [],
        result: "pointer",
        nonblocking: false,
      },
      "get_library_version": {
        parameters: [],
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
    getLogger().warn(
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
 * Returns the NEAT-AI-Discovery library version.
 * The version is fetched once and cached for the lifetime of the library.
 *
 * @returns The version string (e.g., "0.1.151"), or undefined if unavailable.
 */
export function getDiscoveryVersion(): string | undefined {
  // Return cached result if already fetched
  if (cachedDiscoveryVersion !== null) {
    return cachedDiscoveryVersion ?? undefined;
  }

  if (!isRustLibraryAvailable()) {
    cachedDiscoveryVersion = undefined;
    return undefined;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    const resultPtr = rustLib.symbols["get_library_version"]();
    if (resultPtr === null) {
      getLogger().warn(
        "[RustDiscovery] get_library_version returned null pointer.",
      );
      cachedDiscoveryVersion = undefined;
      return undefined;
    }

    const resultJson = readCString(resultPtr);
    rustLib.symbols["free_discovery_result"](resultPtr);

    const parsed = JSON.parse(resultJson) as RustGetVersionResult;
    if (parsed.success && parsed.version) {
      cachedDiscoveryVersion = parsed.version;
      return parsed.version;
    }

    getLogger().warn(
      "[RustDiscovery] get_library_version failed:",
      parsed.error ?? "unknown error",
    );
    cachedDiscoveryVersion = undefined;
    return undefined;
  } catch (error) {
    getLogger().warn("[RustDiscovery] get_library_version threw:", error);
    cachedDiscoveryVersion = undefined;
    return undefined;
  }
}

/**
 * Checks whether the loaded Rust discovery library reports a usable GPU.
 *
 * Returns false (and logs a warning once) when the probe fails or reports
 * that no GPU is available on this worker.
 */
export function isRustGpuAvailable(): boolean {
  if (!isRustLibraryAvailable()) {
    return false;
  }

  assert(rustLib !== null, "Rust library should be loaded");

  try {
    const resultPtr = rustLib.symbols["check_gpu_available"]();
    if (resultPtr === null) {
      if (!rustGpuWarningEmitted) {
        rustGpuWarningEmitted = true;
        getLogger().warn(
          "⚠️  Discovery GPU probe returned a null pointer. " +
            "Discovery will be disabled on this worker.",
        );
      }
      return false;
    }

    const resultJson = readCString(resultPtr);
    rustLib.symbols["free_discovery_result"](resultPtr);

    let parsed: RustCheckGpuResult;
    try {
      parsed = JSON.parse(resultJson) as RustCheckGpuResult;
    } catch {
      if (!rustGpuWarningEmitted) {
        rustGpuWarningEmitted = true;
        getLogger().warn(
          "⚠️  Discovery GPU probe returned invalid JSON. " +
            "Discovery will be disabled on this worker.",
          resultJson,
        );
      }
      return false;
    }

    if (!parsed.success || !parsed.gpuAvailable) {
      if (!rustGpuWarningEmitted) {
        rustGpuWarningEmitted = true;
        const detail = parsed.error ?? "no usable GPU detected";
        getLogger().warn(
          "🚧 Discovery disabled: Rust discovery library is loaded but no usable GPU " +
            `was reported for this worker (${detail}).`,
        );
      }
      return false;
    }

    return true;
  } catch (error) {
    if (!rustGpuWarningEmitted) {
      rustGpuWarningEmitted = true;
      getLogger().warn(
        "⚠️  Discovery GPU probe threw an error. Discovery will be disabled " +
          "on this worker.",
        error,
      );
    }
    return false;
  }
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

const RUST_DISCOVERY_OPTIONAL_ENV = "NEAT_RUST_DISCOVERY_OPTIONAL";

/**
 * Checks if the Rust discovery module is enabled and available.
 * Discovery is an extension that requires both the Rust library AND a GPU.
 * This function caches the result after the first check for low overhead.
 *
 * @returns true if both library and GPU are available, false otherwise.
 */
export function isRustDiscoveryEnabled(): boolean {
  // Return cached result if already checked
  if (rustDiscoveryEnabledState !== "unknown") {
    return rustDiscoveryEnabledState === true;
  }

  try {
    // First check: Library must be available
    if (!isRustLibraryAvailable()) {
      rustDiscoveryEnabledState = false;
      return false;
    }

    // Second check: GPU must be available (discovery requires GPU)
    const gpuAvailable = isRustGpuAvailable();
    rustDiscoveryEnabledState = gpuAvailable;
    return gpuAvailable;
  } catch {
    // FFI not allowed or library not available
    rustDiscoveryEnabledState = false;
    return false;
  }
}

/**
 * Returns true when discovery tests should be skipped (Rust library absent and
 * not explicitly required), false otherwise.
 */
export function shouldSkipRustDiscoveryTests(): boolean {
  const optional = (() => {
    try {
      const value = Deno.env.get(RUST_DISCOVERY_OPTIONAL_ENV);
      if (!value) {
        return false;
      }
      const normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true" ||
        normalized === "yes";
    } catch {
      return false;
    }
  })();

  if (!optional) {
    return false;
  }
  // Check for availability (library + GPU) for discovery tests
  return !isRustDiscoveryEnabled();
}

/**
 * Throws an explicit error when discovery is required but unavailable.
 * Provides specific guidance based on the failure mode:
 * - Library file not found
 * - FFI permission denied
 * - Library loading failed
 */
export function assertRustDiscoveryAvailable(): void {
  if (isRustDiscoveryEnabled()) {
    return; // All good
  }

  // Determine the specific failure reason
  const exists = rustLibraryExists();

  if (!exists) {
    throw new DiscoveryError(
      "Rust discovery library not available: Library file not found. " +
        "Install it into ~/.cargo/lib or set NEAT_AI_DISCOVERY_LIB_PATH environment variable.",
      "LIBRARY_NOT_FOUND",
    );
  }

  // Library exists but couldn't be loaded - check FFI permissions
  const libPath = findRustLibrary();
  if (libPath) {
    try {
      if (typeof Deno.permissions?.querySync === "function") {
        const permission = Deno.permissions.querySync({
          name: "ffi",
          path: libPath,
        });
        if (permission.state !== "granted") {
          throw new DiscoveryError(
            "Rust discovery library not available: FFI permission denied. " +
              "Run with --allow-ffi flag to enable discovery.",
            "FFI_CRASH",
          );
        }
      }
    } catch (error) {
      if (error instanceof DiscoveryError) {
        throw error;
      }
      // Permission check failed, but might be for other reasons
    }
  }

  // Library exists and FFI is allowed, but still not enabled
  throw new DiscoveryError(
    "Rust discovery library not available: Library found but could not be loaded. " +
      "Rebuild the library via the NEAT-AI-Discovery project.",
    "FFI_CRASH",
  );
}
