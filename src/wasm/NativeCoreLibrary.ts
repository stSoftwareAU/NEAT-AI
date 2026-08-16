/**
 * Native `neat-core` library for topological backpropagation (Issue #3741).
 *
 * Default on: when `libneat_core` resolves, the reverse-topological loop uses
 * native `neat_propagate_topological`. Set `NEAT_AI_NATIVE_CORE_BACKPROP=0`
 * to force the WASM packed loop. The packed buffer and `±Infinity` sentinels
 * match WASM `propagate_topological`, so IF/MIN/MAX still fall back to
 * TypeScript. Missing library or a native error returns `undefined` and the
 * caller falls back to WASM.
 *
 * Resolution (first match wins), same idea as Discovery:
 * 0. `NEAT_AI_CORE_LIB_PATH` (file or directory)
 * 1. `~/.cargo/lib/`
 * 2. `./target/release/` (cwd)
 * 3. sibling `../NEAT-AI-core/target/release/`
 *
 * The library is not opened at module load — first use `dlopen`s so hosts
 * without a sibling build keep the WASM fallback path clean.
 */

import { fromFileUrl } from "@std/path/from-file-url";
import { join } from "@std/path/join";
import { getLogger } from "@utils/Logger.ts";

/** Matches `NEAT_PROPAGATE_NULL_PTR` in neat-core `native_exports.rs`. */
export const NEAT_PROPAGATE_NULL_PTR = -1;
/** Matches `NEAT_PROPAGATE_DECODE_ERROR`. */
export const NEAT_PROPAGATE_DECODE_ERROR = -2;
/** Matches `NEAT_PROPAGATE_OUTPUT_TOO_SMALL`. */
export const NEAT_PROPAGATE_OUTPUT_TOO_SMALL = -3;

const HEADER_MIN_BYTES = 16;
const H_NEURON_COUNT = 0;
const H_SYNAPSE_COUNT = 12;
const PER_NEURON_OUT_F64S = 7;
const PER_SYNAPSE_OUT_F64S = 7;
const MAX_PACKED_F64S = 50_000_000;

type NativeCoreSymbols = {
  "neat_propagate_topological": {
    parameters: ["pointer", "usize", "pointer", "usize"];
    result: "i32";
    nonblocking: false;
  };
  "neat_core_version": {
    parameters: [];
    result: "pointer";
    nonblocking: false;
  };
};

const NATIVE_CORE_SYMBOLS: NativeCoreSymbols = {
  "neat_propagate_topological": {
    parameters: ["pointer", "usize", "pointer", "usize"],
    result: "i32",
    nonblocking: false,
  },
  "neat_core_version": {
    parameters: [],
    result: "pointer",
    nonblocking: false,
  },
};

/** Inputs for {@link findNativeCoreLibraryFromOptions} (tests inject these). */
export interface NativeCoreSearchOptions {
  overridePath?: string;
  homeDir?: string;
  cwd?: string;
  siblingDir?: string;
}

let nativeLib: Deno.DynamicLibrary<NativeCoreSymbols> | null = null;
let loadAttempted = false;
let loggedAvailability = false;

/**
 * Platform-specific `neat-core` cdylib file name.
 */
export function nativeCoreLibFileName(): string {
  switch (Deno.build.os) {
    case "darwin":
      return "libneat_core.dylib";
    case "windows":
      return "neat_core.dll";
    default:
      return "libneat_core.so";
  }
}

function readEnvString(key: string): string | undefined {
  try {
    const v = Deno.env.get(key);
    if (v === undefined || v.trim() === "") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

/** True when an env flag is an explicit off value (`0` / `false` / `no` / `off`). */
function envFlagDisabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * True when native `libneat_core` backprop should be attempted.
 *
 * Default is on. Set `NEAT_AI_NATIVE_CORE_BACKPROP=0` to force WASM.
 */
export function isNativeCoreBackpropEnabled(): boolean {
  return !envFlagDisabled(readEnvString("NEAT_AI_NATIVE_CORE_BACKPROP"));
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
    // Candidate path is not viable.
  }
  return null;
}

function siblingReleaseDir(): string {
  return fromFileUrl(
    new URL("../../../NEAT-AI-core/target/release", import.meta.url),
  );
}

/**
 * Resolve `libneat_core` from explicit search inputs.
 *
 * Exists so tests can check override precedence without mutating the
 * process-global environment (shared across parallel `deno test` workers).
 */
export function findNativeCoreLibraryFromOptions(
  options: NativeCoreSearchOptions,
): string | null {
  const libName = nativeCoreLibFileName();

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
    join(cwd, "..", "NEAT-AI-core", "target", "release"),
    libName,
  );
  if (cwdSibling) return cwdSibling;

  return null;
}

/**
 * Resolve `libneat_core` from the environment and well-known locations.
 */
export function findNativeCoreLibrary(): string | null {
  let homeDir: string | undefined;
  try {
    homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? undefined;
  } catch {
    homeDir = undefined;
  }
  return findNativeCoreLibraryFromOptions({
    overridePath: readEnvString("NEAT_AI_CORE_LIB_PATH"),
    homeDir,
  });
}

function loadNativeCoreLibrary(): boolean {
  if (nativeLib !== null) return true;
  if (loadAttempted) return false;
  loadAttempted = true;

  const libPath = findNativeCoreLibrary();
  if (!libPath) return false;

  try {
    nativeLib = Deno.dlopen(libPath, NATIVE_CORE_SYMBOLS);
    if (!loggedAvailability) {
      loggedAvailability = true;
      getLogger().info(
        `[NEAT-AI] Native neat-core backprop loaded from ${libPath}`,
      );
    }
    return true;
  } catch (error) {
    nativeLib = null;
    getLogger().warn(
      `[NEAT-AI] Failed to load native neat-core at ${libPath}; ` +
        "topological backprop stays on WASM.",
      error,
    );
    return false;
  }
}

/**
 * Close the native library. Tests that reopen the handle should call this
 * in `finally` so `--trace-leaks` stays happy.
 */
export function closeNativeCoreLibrary(): void {
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
export function isNativeCoreAvailable(): boolean {
  return loadNativeCoreLibrary();
}

/**
 * Crate version reported by `neat_core_version`, or `undefined` when native
 * is unavailable.
 */
export function getNativeCoreVersion(): string | undefined {
  if (!loadNativeCoreLibrary() || nativeLib === null) return undefined;
  try {
    const ptr = nativeLib.symbols["neat_core_version"]();
    if (ptr === null) return undefined;
    return new Deno.UnsafePointerView(ptr).getCString();
  } catch (error) {
    getLogger().warn("[NEAT-AI] neat_core_version probe failed:", error);
    return undefined;
  }
}

/**
 * Run topological backpropagation via native `neat-core`.
 *
 * @returns packed neuron/synapse `f64` result, or `undefined` to fall back
 *          to WASM (library missing, decode error, or FFI failure).
 */
export function nativePropagateTopological(
  data: Uint8Array,
): Float64Array | undefined {
  if (!loadNativeCoreLibrary() || nativeLib === null) return undefined;
  if (data.byteLength < HEADER_MIN_BYTES) return undefined;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const neuronCount = view.getUint32(H_NEURON_COUNT, true);
  const synapseCount = view.getUint32(H_SYNAPSE_COUNT, true);
  const outLen = neuronCount * PER_NEURON_OUT_F64S +
    synapseCount * PER_SYNAPSE_OUT_F64S;
  if (!Number.isFinite(outLen) || outLen < 0 || outLen > MAX_PACKED_F64S) {
    return undefined;
  }

  const out = new Float64Array(outLen);
  const dataPtr = Deno.UnsafePointer.of(data);
  const outPtr = Deno.UnsafePointer.of(out);
  if (dataPtr === null || outPtr === null) return undefined;

  try {
    const rc = nativeLib.symbols["neat_propagate_topological"](
      dataPtr,
      BigInt(data.byteLength),
      outPtr,
      BigInt(out.length),
    );
    if (rc < 0) return undefined;
    if (rc === outLen) return out;
    return out.subarray(0, rc);
  } catch (error) {
    getLogger().warn(
      "[NEAT-AI] native neat_propagate_topological failed; falling back to WASM.",
      error,
    );
    return undefined;
  }
}

globalThis.addEventListener("unload", () => {
  closeNativeCoreLibrary();
});
