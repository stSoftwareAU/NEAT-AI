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
 *
 * Deadline capability (Issue #4119; NEAT-AI-Backpropagation issue #214, ABI
 * version stays 1): `neat_backprop_capabilities` advertises the per-task
 * deadline. A library without the symbol, or one advertising a version other
 * than 1, is legacy for this purpose and must never receive `deadlineEpochMs`,
 * because its request parser rejects unknown fields. A deadline-capable
 * library always returns the `timedOut` / `timeout` / `completedEpochs` /
 * `*Measure` fields, and a malformed response fails loudly rather than being
 * read as a legacy one.
 */

import { join } from "@std/path/join";
import { getLogger } from "@utils/Logger.ts";
import { pathFromModuleUrl } from "@utils/ModuleSiblingPath.ts";

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

/** Symbol table for `Deno.dlopen`. Keep in step with the header. */
export type NativeBackpropSymbols = {
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
  /** Optional: absent from libraries built before issue #214. */
  "neat_backprop_capabilities": {
    parameters: [];
    result: "pointer";
    nonblocking: false;
    optional: true;
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
  "neat_backprop_capabilities": {
    parameters: [],
    result: "pointer",
    nonblocking: false,
    optional: true,
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

/** The subset of a loaded library this module uses; tests inject doubles. */
export type NativeBackpropHandle = Pick<
  Deno.DynamicLibrary<NativeBackpropSymbols>,
  "symbols" | "close"
>;

/** Inputs for {@link findNativeBackpropLibraryFromOptions} (tests inject these). */
export interface NativeBackpropSearchOptions {
  overridePath?: string;
  homeDir?: string;
  cwd?: string;
  siblingDir?: string;
}

/** Deadline contract advertised by a library that supports `deadlineEpochMs`. */
export interface NativeBackpropDeadlineCapability {
  version: 1;
  requestField: string;
  cliFlag: string;
  unit: string;
  resultFile: string;
}

/** Parsed `neat_backprop_capabilities` (or `capabilities` CLI) payload. */
export interface NativeBackpropCapabilities {
  abiVersion: number;
  version: string;
  /** `undefined` when the library advertises no deadline, or an unsupported version. */
  deadline: NativeBackpropDeadlineCapability | undefined;
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
  /**
   * Absolute deadline: whole milliseconds since the Unix epoch, a non-negative
   * safe integer. It MUST be omitted (not `null`) unless the loaded library
   * advertises the deadline capability; {@link nativeBackpropTrain} refuses it
   * otherwise.
   */
  deadlineEpochMs?: number;
}

/** A measure of MSE over the selection (`baselineMeasure` / `bestMeasure`). */
export type NativeBackpropMeasure =
  | { kind: "full"; mse: number; records: number }
  | { kind: "partial"; mse: number; records: number }
  | { kind: "unmeasured" };

/** Set only when the run timed out (`timeout` in the response). */
export interface NativeBackpropTimeout {
  phase: string;
  completedEpochs: number;
  weightsChanged: boolean;
  deadlineEpochMs: number;
}

/**
 * Successful JSON response from `neat_backprop_train`. The deadline fields are
 * optional here because a legacy engine omits them; the parser guarantees them
 * for a deadline-capable library. `baselineMse` / `bestMse` are a number only
 * when their measure is `full`, and `null` otherwise.
 */
export interface NativeBackpropTrainResponse {
  abiVersion: number;
  version: string;
  bestCreatureJson: string;
  baselineMse: number | null;
  bestMse: number | null;
  acceptedEpochs: number;
  epochs: number;
  bestPath: string;
  journalPath: string;
  bestTracePath?: string | null;
  failedTraceDir?: string | null;
  baselineScore?: unknown;
  bestScore?: unknown;
  timedOut?: boolean;
  timeout?: NativeBackpropTimeout | null;
  completedEpochs?: number;
  baselineMeasure?: NativeBackpropMeasure;
  bestMeasure?: NativeBackpropMeasure;
}

let nativeLib: NativeBackpropHandle | null = null;
let loadAttempted = false;
let loggedAvailability = false;
/** Capability of the currently loaded handle; `null` until first probed. */
let deadlineCapabilityCache: {
  capability: NativeBackpropDeadlineCapability | undefined;
} | null = null;

const MISSING_LIBRARY_MESSAGE =
  "libneat_ai_backpropagation was not found or failed to load";

/** Phases `timeout.phase` may report (contract of issue #214). */
const TIMEOUT_PHASES: readonly string[] = [
  "start",
  "baselineEvaluation",
  "epochStart",
  "accumulation",
  "candidateEvaluation",
  "backtracking",
  "scoring",
];

/** The version-1 deadline contract; any other value is refused. */
const DEADLINE_CONTRACT_V1 = {
  requestField: "deadlineEpochMs",
  cliFlag: "--deadline-epoch-ms",
  unit: "epochMilliseconds",
  resultFile: "result.json",
} as const;

const CAPABILITIES_SCOPE = "libneat_ai_backpropagation capabilities";
const RESPONSE_SCOPE = "libneat_ai_backpropagation train response";

function readEnvString(key: string): string | undefined {
  try {
    const v = Deno.env.get(key);
    if (v === undefined || v.trim() === "") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function fieldError(scope: string, field: string, reason: string): Error {
  return new Error(`${scope}: field "${field}" ${reason}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Strict parse of the capability JSON (FFI symbol or CLI `capabilities`
 * stdout).
 *
 * @throws when the JSON is malformed or a field has the wrong shape. A
 *         `deadline` entry at version 1 must carry the exact version-1
 *         contract. A `deadline` entry at any other version yields
 *         `deadline: undefined`.
 */
export function parseNativeBackpropCapabilities(
  raw: string,
): NativeBackpropCapabilities {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${CAPABILITIES_SCOPE}: not valid JSON (${errorText(error)})`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`${CAPABILITIES_SCOPE}: expected a JSON object`);
  }
  const abiVersion = parsed.abiVersion;
  if (!isNonNegativeSafeInteger(abiVersion)) {
    throw fieldError(CAPABILITIES_SCOPE, "abiVersion", "must be an integer");
  }
  const version = parsed.version;
  if (typeof version !== "string") {
    throw fieldError(CAPABILITIES_SCOPE, "version", "must be a string");
  }
  const capabilities = parsed.capabilities;
  if (!isRecord(capabilities)) {
    throw fieldError(CAPABILITIES_SCOPE, "capabilities", "must be an object");
  }
  const deadlineRaw = capabilities.deadline;
  if (deadlineRaw === undefined) {
    return { abiVersion, version, deadline: undefined };
  }
  if (!isRecord(deadlineRaw)) {
    throw fieldError(
      CAPABILITIES_SCOPE,
      "capabilities.deadline",
      "must be an object when present",
    );
  }
  const contractVersion = deadlineRaw.version;
  if (typeof contractVersion !== "number") {
    throw fieldError(
      CAPABILITIES_SCOPE,
      "capabilities.deadline.version",
      "must be a number",
    );
  }
  if (contractVersion !== 1) {
    return { abiVersion, version, deadline: undefined };
  }
  for (const [field, expected] of Object.entries(DEADLINE_CONTRACT_V1)) {
    const actual = deadlineRaw[field];
    if (actual !== expected) {
      throw fieldError(
        CAPABILITIES_SCOPE,
        `capabilities.deadline.${field}`,
        `must be ${JSON.stringify(expected)} for deadline version 1 (got ${
          JSON.stringify(actual)
        })`,
      );
    }
  }
  return {
    abiVersion,
    version,
    deadline: { version: 1, ...DEADLINE_CONTRACT_V1 },
  };
}

function parseMeasure(
  value: unknown,
  field: string,
): NativeBackpropMeasure {
  if (!isRecord(value)) {
    throw fieldError(RESPONSE_SCOPE, field, "must be an object");
  }
  const kind = value.kind;
  if (kind === "unmeasured") return { kind: "unmeasured" };
  if (kind !== "full" && kind !== "partial") {
    throw fieldError(
      RESPONSE_SCOPE,
      `${field}.kind`,
      `must be "full", "partial" or "unmeasured" (got ${JSON.stringify(kind)})`,
    );
  }
  const mse = value.mse;
  if (typeof mse !== "number" || !Number.isFinite(mse)) {
    throw fieldError(RESPONSE_SCOPE, `${field}.mse`, "must be a finite number");
  }
  const records = value.records;
  if (!isNonNegativeSafeInteger(records)) {
    throw fieldError(
      RESPONSE_SCOPE,
      `${field}.records`,
      "must be a non-negative integer",
    );
  }
  return { kind, mse, records };
}

/**
 * `baselineMse` / `bestMse` is a number only when its measure is `full` (and
 * equal to that measure's `mse`), and `null` for `partial` or `unmeasured`.
 */
function checkMse(
  parsed: Record<string, unknown>,
  field: "baselineMse" | "bestMse",
  measureField: "baselineMeasure" | "bestMeasure",
  measure: NativeBackpropMeasure,
): void {
  const value = parsed[field];
  if (measure.kind === "full") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw fieldError(
        RESPONSE_SCOPE,
        field,
        `must be a finite number when ${measureField} is full`,
      );
    }
    if (value !== measure.mse) {
      throw fieldError(
        RESPONSE_SCOPE,
        field,
        `must equal ${measureField}.mse (${measure.mse})`,
      );
    }
    return;
  }
  if (value !== null) {
    throw fieldError(
      RESPONSE_SCOPE,
      field,
      `must be null unless ${measureField} is full (its kind is ${measure.kind})`,
    );
  }
}

/**
 * Parse a `neat_backprop_train` response.
 *
 * With `deadlineCapable` the deadline fields are required and validated. The
 * legacy shape is then rejected at its first missing field. Without it, only
 * the legacy numeric `baselineMse` / `bestMse` are required.
 *
 * @throws when a required field is missing or has the wrong shape. The message
 *         names the offending field.
 */
export function parseNativeBackpropTrainResponse(
  payload: string,
  deadlineCapable: boolean,
): NativeBackpropTrainResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(`${RESPONSE_SCOPE}: not valid JSON (${errorText(error)})`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${RESPONSE_SCOPE}: expected a JSON object`);
  }
  if (typeof parsed.bestCreatureJson !== "string") {
    throw fieldError(RESPONSE_SCOPE, "bestCreatureJson", "must be a string");
  }

  if (!deadlineCapable) {
    for (const field of ["baselineMse", "bestMse"] as const) {
      if (typeof parsed[field] !== "number") {
        throw fieldError(
          RESPONSE_SCOPE,
          field,
          "must be a number from a legacy engine",
        );
      }
    }
    return parsed as unknown as NativeBackpropTrainResponse;
  }

  if (typeof parsed.timedOut !== "boolean") {
    throw fieldError(RESPONSE_SCOPE, "timedOut", "must be a boolean");
  }
  const timeout = parsed.timeout;
  if (parsed.timedOut) {
    if (!isRecord(timeout)) {
      throw fieldError(
        RESPONSE_SCOPE,
        "timeout",
        "must be an object when timedOut is true",
      );
    }
    const phase = timeout.phase;
    if (typeof phase !== "string" || !TIMEOUT_PHASES.includes(phase)) {
      throw fieldError(
        RESPONSE_SCOPE,
        "timeout.phase",
        `must be one of ${TIMEOUT_PHASES.join(", ")}`,
      );
    }
    if (!isNonNegativeSafeInteger(timeout.completedEpochs)) {
      throw fieldError(
        RESPONSE_SCOPE,
        "timeout.completedEpochs",
        "must be a non-negative integer",
      );
    }
    if (typeof timeout.weightsChanged !== "boolean") {
      throw fieldError(
        RESPONSE_SCOPE,
        "timeout.weightsChanged",
        "must be a boolean",
      );
    }
    if (!isNonNegativeSafeInteger(timeout.deadlineEpochMs)) {
      throw fieldError(
        RESPONSE_SCOPE,
        "timeout.deadlineEpochMs",
        "must be a non-negative integer",
      );
    }
  } else if (timeout !== null) {
    throw fieldError(
      RESPONSE_SCOPE,
      "timeout",
      "must be null when timedOut is false",
    );
  }

  if (!isNonNegativeSafeInteger(parsed.completedEpochs)) {
    throw fieldError(
      RESPONSE_SCOPE,
      "completedEpochs",
      "must be a non-negative integer",
    );
  }
  const baselineMeasure = parseMeasure(
    parsed.baselineMeasure,
    "baselineMeasure",
  );
  const bestMeasure = parseMeasure(parsed.bestMeasure, "bestMeasure");
  checkMse(parsed, "baselineMse", "baselineMeasure", baselineMeasure);
  checkMse(parsed, "bestMse", "bestMeasure", bestMeasure);

  return parsed as unknown as NativeBackpropTrainResponse;
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

/** Sibling-crate release dir beside a local checkout; null under JSR HTTPS. */
function siblingReleaseDir(): string | null {
  return pathFromModuleUrl(
    "../../../../NEAT-AI-Backpropagation/target/release",
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
  if (sibling) {
    const siblingTarget = resolveLibraryCandidate(sibling, libName);
    if (siblingTarget) return siblingTarget;
  }

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
  deadlineCapabilityCache = null;
}

/**
 * Test seam: adopt a double as the loaded library, through the same ABI check
 * as a real `dlopen`. Closes any library already loaded. Undo with
 * {@link closeNativeBackpropLibrary}.
 *
 * @returns `false` when the double reports an ABI other than
 *          {@link NEAT_BACKPROP_ABI_VERSION}; the double is then closed.
 */
export function __installNativeBackpropLibraryForTests(
  lib: NativeBackpropHandle,
): boolean {
  closeNativeBackpropLibrary();
  loadAttempted = true;
  const abi = lib.symbols["neat_backprop_abi_version"]();
  if (abi !== NEAT_BACKPROP_ABI_VERSION) {
    lib.close();
    return false;
  }
  nativeLib = lib;
  return true;
}

/**
 * True when the native library is loaded (or can be loaded) in this isolate.
 */
export function isNativeBackpropAvailable(): boolean {
  return loadNativeBackpropLibrary();
}

/**
 * Deadline capability of the loaded library.
 *
 * @returns `undefined` for a legacy library (no `neat_backprop_capabilities`
 *          symbol) or one advertising an unsupported version.
 * @throws when the symbol exists but returns malformed JSON, or when no
 *         library can be loaded. Cached per loaded handle.
 */
export function nativeBackpropDeadlineCapability():
  | NativeBackpropDeadlineCapability
  | undefined {
  if (!loadNativeBackpropLibrary() || nativeLib === null) {
    throw new Error(MISSING_LIBRARY_MESSAGE);
  }
  if (deadlineCapabilityCache !== null) {
    return deadlineCapabilityCache.capability;
  }
  const probe = nativeLib.symbols["neat_backprop_capabilities"];
  let capability: NativeBackpropDeadlineCapability | undefined;
  if (probe !== null) {
    const ptr = probe();
    if (ptr === null) {
      throw new Error(
        "libneat_ai_backpropagation: neat_backprop_capabilities returned a NULL pointer",
      );
    }
    const raw = new Deno.UnsafePointerView(ptr).getCString();
    capability = parseNativeBackpropCapabilities(raw).deadline;
  }
  deadlineCapabilityCache = { capability };
  return capability;
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
 * `request.deadlineEpochMs` is forwarded only to a deadline-capable library.
 * For any other library it is refused before the native call.
 *
 * @throws when the library is missing, the request is invalid, the library
 *         lacks the deadline capability but a deadline was set, the ABI rejects
 *         the request, the trainer fails, or the response is malformed for the
 *         library's contract. Callers must not fall back to WASM for a claimed
 *         native request.
 */
export function nativeBackpropTrain(
  request: NativeBackpropTrainRequest,
): NativeBackpropTrainResponse {
  if (!loadNativeBackpropLibrary() || nativeLib === null) {
    throw new Error(MISSING_LIBRARY_MESSAGE);
  }
  const deadlineCapable = nativeBackpropDeadlineCapability() !== undefined;

  if (request.deadlineEpochMs !== undefined) {
    if (!isNonNegativeSafeInteger(request.deadlineEpochMs)) {
      throw new Error(
        `deadlineEpochMs must be a non-negative safe integer (whole ms since the Unix epoch); got ${
          String(request.deadlineEpochMs)
        }`,
      );
    }
    if (!deadlineCapable) {
      throw new Error(
        "request sets deadlineEpochMs but the loaded libneat_ai_backpropagation has no deadline capability " +
          "(neat_backprop_capabilities is absent or advertises an unsupported version); " +
          "the per-task deadline is not enforced natively and deadlineEpochMs must not be sent to a legacy library",
      );
    }
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
    return parseNativeBackpropTrainResponse(payload, deadlineCapable);
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
