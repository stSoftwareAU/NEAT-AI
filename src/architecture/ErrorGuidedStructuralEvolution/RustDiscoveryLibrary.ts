/**
 * Rust discovery library loading, resolution, and availability checks.
 *
 * Manages the lifecycle of the Rust FFI library: finding, loading,
 * closing, and checking availability of both the library and GPU.
 */

import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path/from-file-url";
import { join } from "@std/path/join";
import { DiscoveryError } from "@errors/DiscoveryError.ts";
import { getLogger } from "@utils/Logger.ts";
import type {
  RustCheckGpuResult,
  RustGetVersionResult,
  RustLibrarySearchOptions,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscoveryTypes.ts";

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
 * Analysis-memory FFI symbols (Issue #3432).
 *
 * These live on a **separate** `Deno.dlopen` handle deliberately: `dlopen`
 * fails the whole call when any requested symbol is missing, so folding them
 * into {@link RustDiscoverySymbols} would make an older NEAT-AI-Discovery
 * build disable discovery entirely. Loading them separately lets the core
 * symbols keep working while the memory controls report themselves as
 * unavailable (loudly, via a one-time warning) rather than silently.
 */
type RustMemorySymbols = {
  "discovery_memory_usage_bytes": {
    parameters: [];
    result: "u64";
    nonblocking: false;
  };
  "cancel_analysis_memory_pressure": {
    parameters: [];
    result: "void";
    nonblocking: false;
  };
};

/**
 * Loaded Rust library instance.
 */
let rustLib: Deno.DynamicLibrary<RustDiscoverySymbols> | null = null;

/** Optional analysis-memory handle (Issue #3432); null until probed/loaded. */
let rustMemoryLib: Deno.DynamicLibrary<RustMemorySymbols> | null = null;

/** True once the optional memory-symbol load has been attempted. */
let rustMemoryLibProbed = false;

/** One-time warning latch for a missing analysis-memory FFI surface. */
let rustMemoryWarningEmitted = false;

let rustGpuWarningEmitted = false;

/** Cached NEAT-AI-Discovery library version (null = not yet fetched, undefined = fetch failed) */
let cachedDiscoveryVersion: string | null | undefined = null;

/**
 * Tristate for rust discovery availability.
 * - "unknown": Not yet checked
 * - true: Library is available (GPU is optional — provides acceleration)
 * - false: Library is not available
 */
type RustDiscoveryEnabledState = "unknown" | true | false;

let rustDiscoveryEnabledState: RustDiscoveryEnabledState = "unknown";

/** Cached GPU backend information from the last successful probe. */
let cachedGpuBackendInfo: GpuBackendInfo | null = null;

/**
 * Describes the GPU backend selected by wgpu (if any).
 */
export interface GpuBackendInfo {
  /** Whether a usable GPU was detected. */
  available: boolean;
  /** wgpu backend name, e.g. "Metal", "Vulkan", "Dx12", "Gl". */
  backendName?: string;
  /** GPU adapter/device name, e.g. "Apple M1 Pro". */
  adapterName?: string;
  /** Reason GPU is unavailable (when `available` is false). */
  reason?: string;
}

/**
 * Infers the wgpu backend name from the current platform when the Rust
 * library does not report it explicitly.
 */
function inferPlatformBackend(): string | undefined {
  switch (Deno.build.os) {
    case "darwin":
      return "Metal";
    case "linux":
      return "Vulkan";
    case "windows":
      return "Dx12";
    default:
      return undefined;
  }
}

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
    cachedGpuBackendInfo = null;
  }
  if (rustMemoryLib !== null) {
    rustMemoryLib.close();
    rustMemoryLib = null;
  }
  rustMemoryLibProbed = false;
  rustMemoryWarningEmitted = false;
  // Reset cached discovery state so it will be re-checked on next call
  rustDiscoveryEnabledState = "unknown";
}

/**
 * Loads (once) the optional analysis-memory FFI symbols (Issue #3432).
 *
 * Returns `null` when the library cannot be resolved or the build predates the
 * memory API. The first failure emits a single warning so a stale library is
 * visible in the log rather than degrading silently.
 */
function getRustMemorySymbols(
  loadIfNeeded: boolean,
):
  | Deno.DynamicLibrary<RustMemorySymbols>["symbols"]
  | null {
  if (rustMemoryLib !== null) {
    return rustMemoryLib.symbols;
  }
  if (rustMemoryLibProbed) {
    return null;
  }
  // Passive callers (diagnostics) must not force a library load; they only
  // report what an already-loaded library says.
  if (!loadIfNeeded && rustLib === null) {
    return null;
  }
  rustMemoryLibProbed = true;

  const libPath = findRustLibrary();
  if (!libPath) {
    return null;
  }

  try {
    rustMemoryLib = Deno.dlopen(
      libPath,
      {
        "discovery_memory_usage_bytes": {
          parameters: [],
          result: "u64",
          nonblocking: false,
        },
        "cancel_analysis_memory_pressure": {
          parameters: [],
          result: "void",
          nonblocking: false,
        },
      } as const satisfies RustMemorySymbols,
    );
    return rustMemoryLib.symbols;
  } catch (error) {
    if (!rustMemoryWarningEmitted) {
      rustMemoryWarningEmitted = true;
      getLogger().warn(
        "[RustDiscovery] Analysis-memory FFI symbols " +
          "(discovery_memory_usage_bytes / cancel_analysis_memory_pressure) " +
          `are unavailable in ${libPath}. Analysis memory usage cannot be ` +
          "observed and in-flight analysis cannot be cancelled under memory " +
          "pressure — rebuild NEAT-AI-Discovery to restore them.",
        error,
      );
    }
    return null;
  }
}

/**
 * Returns the Rust-side allocator footprint of NEAT-AI-Discovery in bytes
 * (Discovery #1027), or `undefined` when the FFI surface is unavailable.
 *
 * The value covers memory allocated through Rust's global allocator only — it
 * does **not** include the V8 heap. Combine it with `Deno.memoryUsage()` for a
 * whole-process view.
 *
 * This is a **passive** read: it never loads the discovery library, so calling
 * it from a diagnostic path cannot open an FFI handle as a side effect. When
 * the library is not loaded in this isolate the answer is `undefined`.
 */
export function getDiscoveryMemoryUsageBytes(): number | undefined {
  const symbols = getRustMemorySymbols(false);
  if (symbols === null) {
    return undefined;
  }
  try {
    return Number(symbols["discovery_memory_usage_bytes"]());
  } catch (error) {
    getLogger().warn(
      "[RustDiscovery] discovery_memory_usage_bytes threw:",
      error,
    );
    return undefined;
  }
}

/**
 * Asks NEAT-AI-Discovery to abort an in-flight analysis because the host is
 * under CRITICAL memory pressure (Discovery #1099).
 *
 * Discovery's cancellation flag is process-wide, so a host isolate that is not
 * itself blocked inside `analyze_parallel` can use this to stop an analysis
 * running on another thread of the same process. For that reason — unlike
 * {@link getDiscoveryMemoryUsageBytes} — this call *will* load the library if
 * it is not yet open in this isolate; it only ever runs under genuine memory
 * pressure, so the one-off load is a fair price for being able to stop the
 * analysis at all.
 *
 * @returns true when the cancellation was signalled, false when the FFI
 *          surface is unavailable or the call failed.
 */
export function cancelAnalysisMemoryPressure(): boolean {
  const symbols = getRustMemorySymbols(true);
  if (symbols === null) {
    return false;
  }
  try {
    symbols["cancel_analysis_memory_pressure"]();
    return true;
  } catch (error) {
    getLogger().warn(
      "[RustDiscovery] cancel_analysis_memory_pressure threw:",
      error,
    );
    return false;
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
 * Returns false (and logs an info message once) when the probe fails or reports
 * that no GPU is available on this worker. Discovery will still function via
 * CPU fallback — GPU accelerates analysis but is not required.
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
        cachedGpuBackendInfo = { available: false, reason: "null pointer" };
        getLogger().info(
          "ℹ️  Discovery GPU probe returned a null pointer. " +
            "Discovery will use CPU fallback on this worker.",
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
        cachedGpuBackendInfo = { available: false, reason: "invalid JSON" };
        getLogger().info(
          "ℹ️  Discovery GPU probe returned invalid JSON. " +
            "Discovery will use CPU fallback on this worker.",
        );
      }
      return false;
    }

    if (!parsed.success || !parsed.gpuAvailable) {
      if (!rustGpuWarningEmitted) {
        rustGpuWarningEmitted = true;
        const detail = parsed.error ?? "no usable GPU detected";
        cachedGpuBackendInfo = { available: false, reason: detail };
        getLogger().info(
          "ℹ️  No GPU detected — discovery will use CPU fallback " +
            `(${detail}). GPU accelerates analysis but is not required.`,
        );
      }
      return false;
    }

    // Cache the backend info from a successful probe.
    // The Rust library may return the backend name as "backendName", "backend",
    // or omit it entirely. When omitted, infer from the platform since wgpu
    // uses a predictable default backend per OS.
    const resolvedBackendName = parsed.backendName ?? parsed.backend ??
      inferPlatformBackend();
    cachedGpuBackendInfo = {
      available: true,
      backendName: resolvedBackendName,
      adapterName: parsed.adapterName,
    };

    if (!rustGpuWarningEmitted) {
      rustGpuWarningEmitted = true;
      const backendDesc = resolvedBackendName
        ? ` via ${resolvedBackendName}`
        : "";
      const adapterDesc = parsed.adapterName ? ` (${parsed.adapterName})` : "";
      getLogger().info(
        `✅ GPU acceleration enabled${backendDesc}${adapterDesc}.`,
      );
    }

    return true;
  } catch (error) {
    if (!rustGpuWarningEmitted) {
      rustGpuWarningEmitted = true;
      cachedGpuBackendInfo = {
        available: false,
        reason: String(error),
      };
      getLogger().info(
        "ℹ️  Discovery GPU probe threw an error. " +
          "Discovery will use CPU fallback on this worker.",
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

/**
 * Checks if the Rust discovery module is enabled and available.
 *
 * Discovery requires the Rust library. GPU acceleration is optional —
 * when no GPU is detected, the Rust library falls back to CPU computation.
 * This enables cross-platform discovery on macOS (Metal), Linux (Vulkan),
 * and Windows (DX12) via the wgpu abstraction layer, with automatic CPU
 * fallback when no compatible GPU is present.
 *
 * This function caches the result after the first check for low overhead.
 *
 * @returns true if the Rust library is available, false otherwise.
 */
export function isRustDiscoveryEnabled(): boolean {
  // Return cached result if already checked
  if (rustDiscoveryEnabledState !== "unknown") {
    return rustDiscoveryEnabledState === true;
  }

  try {
    // Library must be available — GPU is optional (provides acceleration)
    if (!isRustLibraryAvailable()) {
      rustDiscoveryEnabledState = false;
      return false;
    }

    // Probe GPU availability for logging/telemetry — result does not gate
    // discovery enablement. The Rust library handles CPU fallback internally.
    isRustGpuAvailable();

    rustDiscoveryEnabledState = true;
    return true;
  } catch {
    // FFI not allowed or library not available
    rustDiscoveryEnabledState = false;
    return false;
  }
}

/**
 * Returns true when discovery tests should be skipped (Rust library absent),
 * false otherwise.
 *
 * Discovery is always optional — the Rust library already probes for GPU
 * availability internally. When the library is not present, tests are
 * skipped gracefully without requiring any environment variable.
 */
export function shouldSkipRustDiscoveryTests(): boolean {
  return !isRustDiscoveryEnabled();
}

/**
 * Returns information about the GPU backend selected by wgpu.
 *
 * Call this after `isRustDiscoveryEnabled()` to learn which GPU backend
 * (Metal, Vulkan, DX12, OpenGL) was selected, or whether CPU fallback is
 * being used. The result is cached after the first GPU probe.
 *
 * @returns GPU backend information, or a "not probed" result if the library
 *          has not been loaded yet.
 */
export function getGpuBackendInfo(): GpuBackendInfo {
  if (cachedGpuBackendInfo !== null) {
    return cachedGpuBackendInfo;
  }

  // If the library isn't available, return unavailable
  if (!isRustLibraryAvailable()) {
    return { available: false, reason: "Rust library not loaded" };
  }

  // Trigger GPU probe (which populates the cache)
  isRustGpuAvailable();

  return cachedGpuBackendInfo ?? {
    available: false,
    reason: "GPU probe did not populate cache",
  };
}

/**
 * Returns the lowercase wgpu backend name (e.g. "metal", "vulkan", "dx12",
 * "gl") when a GPU is available, or `undefined` otherwise.
 */
export function getRustGpuBackend(): string | undefined {
  const info = getGpuBackendInfo();
  if (!info.available || !info.backendName) {
    return undefined;
  }
  return info.backendName.toLowerCase();
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
