/**
 * WASM Activation module for NEAT-AI
 *
 * Issue #1116 - WASM prototype for creature activation
 *
 * This module provides a WASM-based implementation of creature activation
 * that can be compared against the existing JS-based activation for
 * performance benchmarking.
 */

import type { Creature } from "../Creature.ts";
import {
  compileCreatureToWasm,
  type CompiledCreatureData,
} from "./CompileToWasm.ts";

// Import types from the generated WASM bindings
// The actual module is loaded dynamically to handle the async initialization

// deno-lint-ignore no-explicit-any
type WasmModule = any;
// deno-lint-ignore no-explicit-any
type CompiledNetworkClass = any;

/**
 * Trace entry from WASM activation
 * Issue #1121 - WASM Migration Phase 4: activateAndTrace
 */
export interface WasmTraceEntry {
  /** Neuron index relative to input count (0 = first non-input neuron) */
  neuronRelativeIndex: number;
  /**
   * Trace information:
   * - For MINIMUM/MAXIMUM: local synapse index of the winning synapse
   * - For IF: 1.0 = positive branch taken, 0.0 = negative branch taken
   */
  traceInfo: number;
}

/**
 * Result from WASM activateAndTrace
 * Issue #1121 - WASM Migration Phase 4: activateAndTrace
 */
export interface WasmTraceResult {
  /** Output activation values */
  outputs: Float32Array;
  /** Post-squash activations for all non-input neurons (for state.activations) */
  activations: Float32Array;
  /**
   * Pre-squash values (hintValues) for all non-input neurons.
   * For standard squash functions, this is the weighted sum + bias before applying squash.
   * For aggregate functions (MINIMUM, MAXIMUM, IF), this is the same as the activation.
   */
  hintValues: Float32Array;
  /** Trace entries for aggregate functions */
  traceEntries: WasmTraceEntry[];
}

// WASM module state
let wasmModule: WasmModule | null = null;
let CompiledNetwork: CompiledNetworkClass | null = null;
// Guard against concurrent initialisation (common under `deno test --parallel`)
let initPromise: Promise<boolean> | null = null;
let activateBatchFn:
  | ((
    network: unknown,
    inputs: Float32Array,
    inputSize: number,
    numOutputs: number,
  ) => Float32Array)
  | null = null;
let squashFn: ((squashType: number, value: number) => number) | null = null;
let derivativeFn: ((squashType: number, value: number) => number) | null = null;
let unsquashFn:
  | ((squashType: number, activation: number, hint: number) => number)
  | null = null;
let safeZoneAdjustmentFn:
  | ((
    squashType: number,
    rawInput: number,
    error: number,
    weight: number,
  ) => number)
  | null = null;
let calculateErrorFn:
  | ((
    squashType: number,
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ) => number)
  | null = null;
let versionFn: (() => string) | null = null;

/**
 * Load and initialise the WASM module
 *
 * @param wasmPath - Path to the WASM directory containing pkg/wasm_activation.js
 */
export async function initWasmActivation(
  wasmPath: string = "./wasm_activation/pkg",
): Promise<boolean> {
  if (wasmModule !== null) {
    return true; // Already initialised
  }

  // If an init is already in flight, await it.
  if (initPromise) {
    return await initPromise;
  }

  initPromise = (async () => {
    try {
      // Import the generated JS bindings
      const modulePath = `${wasmPath}/wasm_activation.js`;
      const module = await import(modulePath);

      // Initialize the WASM module
      // The default export is the init function
      await module.default();

      // Store references to the exports
      wasmModule = module;
      CompiledNetwork = module.CompiledNetwork;
      activateBatchFn = module.activate_batch;
      squashFn = module.squash;
      derivativeFn = module.derivative;
      unsquashFn = module.unsquash;
      safeZoneAdjustmentFn = module.safe_zone_adjustment;
      calculateErrorFn = module.calculate_error;
      versionFn = module.version;

      return true;
    } catch (error) {
      console.error("Failed to initialise WASM activation module:", error);
      return false;
    } finally {
      // If init succeeded, wasmModule is set and future calls will fast-path.
      // If init failed, allow retries in a future call.
      initPromise = null;
    }
  })();

  return await initPromise;
}

/**
 * Load and initialise the WASM module synchronously from binary data
 *
 * @param jsBindings - The JS bindings module
 * @param wasmBinary - The WASM binary data
 */
export function initWasmActivationSync(
  jsBindings: WasmModule,
  wasmBinary: Uint8Array,
): boolean {
  if (wasmModule !== null) {
    return true; // Already initialised
  }

  // Sync init should not run concurrently with async init; if async is in-flight,
  // fail fast to avoid re-entrancy into wasm-bindgen initialisation.
  if (initPromise) {
    console.error(
      "Failed to initialise WASM activation module sync: async init in progress",
    );
    return false;
  }

  try {
    // Initialize synchronously
    jsBindings.initSync(wasmBinary);

    // Store references to the exports
    wasmModule = jsBindings;
    CompiledNetwork = jsBindings.CompiledNetwork;
    activateBatchFn = jsBindings.activate_batch;
    squashFn = jsBindings.squash;
    derivativeFn = jsBindings.derivative;
    unsquashFn = jsBindings.unsquash;
    safeZoneAdjustmentFn = jsBindings.safe_zone_adjustment;
    calculateErrorFn = jsBindings.calculate_error;
    versionFn = jsBindings.version;

    return true;
  } catch (error) {
    console.error("Failed to initialise WASM activation module sync:", error);
    return false;
  }
}

/**
 * Check if WASM activation is available
 */
export function isWasmActivationAvailable(): boolean {
  return wasmModule !== null && CompiledNetwork !== null;
}

/**
 * WASM-based creature activation wrapper
 *
 * This class wraps a compiled network in WASM and provides an activate()
 * method compatible with the JS-based activation.
 */
export class WasmCreatureActivation {
  // deno-lint-ignore no-explicit-any
  private network: any;
  private numInputs: number;
  private numOutputs: number;
  private freed = false;

  // deno-lint-ignore no-explicit-any
  private constructor(network: any, numInputs: number, numOutputs: number) {
    this.network = network;
    this.numInputs = numInputs;
    this.numOutputs = numOutputs;
  }

  /**
   * Create a WASM activation wrapper from a compiled creature
   */
  static create(compiled: CompiledCreatureData): WasmCreatureActivation | null {
    if (!CompiledNetwork) {
      console.error("WASM module not initialised");
      return null;
    }

    try {
      // Create the CompiledNetwork instance using the wasm-bindgen generated class
      const network = new CompiledNetwork(compiled.data);

      return new WasmCreatureActivation(
        network,
        compiled.numInputs,
        compiled.numOutputs,
      );
    } catch (error) {
      console.error("Failed to create WASM activation:", error);
      return null;
    }
  }

  /**
   * Create a WASM activation wrapper directly from a Creature
   */
  static fromCreature(creature: Creature): WasmCreatureActivation | null {
    const compiled = compileCreatureToWasm(creature);
    return WasmCreatureActivation.create(compiled);
  }

  /**
   * Activate the network with the given inputs
   * Returns the output values as a Float32Array
   */
  activate(input: Float32Array): Float32Array {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    // Ensure input is the right size
    if (input.length !== this.numInputs) {
      throw new Error(
        `Input length ${input.length} does not match expected ${this.numInputs}`,
      );
    }

    // Call the WASM activate method
    return this.network.activate(input, this.numOutputs);
  }

  /**
   * Stateless activation helper.
   *
   * When feedbackLoop=false we must ensure the WASM activation buffer does not
   * carry state between calls. JS activation resets per-call unless feedbackLoop
   * is explicitly enabled.
   */
  activateWithFeedback(
    input: Float32Array,
    feedbackLoop: boolean,
  ): Float32Array {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    if (!feedbackLoop && typeof this.network.reset_state === "function") {
      this.network.reset_state();
    }

    return this.activate(input);
  }

  /**
   * Activate the network with tracing support for backpropagation
   * Issue #1121 - WASM Migration Phase 4: activateAndTrace
   *
   * Returns the output values and trace data for setting synapse usage flags.
   * The trace data indicates which synapses were "used" during activation:
   * - For MINIMUM/MAXIMUM: only the winning synapse is used
   * - For IF: condition + active branch synapses are used
   * - For standard squash: all synapses are used (default behaviour)
   *
   * @param input - The input values
   * @returns Object containing outputs, neuron activations (hintValues), and trace data
   */
  activateAndTrace(input: Float32Array): WasmTraceResult {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    // Ensure input is the right size
    if (input.length !== this.numInputs) {
      throw new Error(
        `Input length ${input.length} does not match expected ${this.numInputs}`,
      );
    }

    // Call the WASM activate_and_trace method
    const result = this.network.activate_and_trace(input, this.numOutputs);

    // Parse the result:
    // - [0..numOutputs): output values
    // - [numOutputs..numOutputs+numNonInputs): post-squash activations
    // - [numOutputs+numNonInputs..numOutputs+2*numNonInputs): pre-squash hintValues
    // - [numOutputs+2*numNonInputs..]: trace data pairs, terminated by -1.0
    const numNonInputs = this.network.num_neurons - this.numInputs;

    // Extract outputs
    const outputs = new Float32Array(this.numOutputs);
    for (let i = 0; i < this.numOutputs; i++) {
      outputs[i] = result[i];
    }

    // Extract post-squash activations for all non-input neurons
    const activations = new Float32Array(numNonInputs);
    for (let i = 0; i < numNonInputs; i++) {
      activations[i] = result[this.numOutputs + i];
    }

    // Extract pre-squash values (hintValues) for all non-input neurons
    const hintValues = new Float32Array(numNonInputs);
    for (let i = 0; i < numNonInputs; i++) {
      hintValues[i] = result[this.numOutputs + numNonInputs + i];
    }

    // Parse trace data
    // Format: pairs of (neuron_relative_index, trace_info), terminated by -1.0
    // - For MINIMUM/MAXIMUM: trace_info is the local synapse index of the winning synapse
    // - For IF: trace_info is 1.0 for positive branch, 0.0 for negative branch
    const traceEntries: WasmTraceEntry[] = [];
    let offset = this.numOutputs + (numNonInputs * 2);

    while (offset < result.length) {
      const neuronRelativeIdx = result[offset];
      if (neuronRelativeIdx < 0) {
        // Terminator
        break;
      }
      const traceInfo = result[offset + 1];
      traceEntries.push({
        neuronRelativeIndex: Math.round(neuronRelativeIdx),
        traceInfo: traceInfo,
      });
      offset += 2;
    }

    return {
      outputs,
      activations,
      hintValues,
      traceEntries,
    };
  }

  activateAndTraceWithFeedback(
    input: Float32Array,
    feedbackLoop: boolean,
  ): WasmTraceResult {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    if (!feedbackLoop && typeof this.network.reset_state === "function") {
      this.network.reset_state();
    }

    return this.activateAndTrace(input);
  }

  /**
   * Activate the network with multiple inputs at once (batch mode)
   * This reduces JS/WASM boundary crossing overhead
   *
   * @param inputs - Flat array of all input values
   * @param inputSize - Number of inputs per sample (should equal numInputs)
   * @returns Flat array of all output values
   */
  activateBatch(inputs: Float32Array, inputSize: number): Float32Array {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    if (!activateBatchFn) {
      throw new Error("WASM module not initialised");
    }

    const numSamples = Math.floor(inputs.length / inputSize);
    if (numSamples === 0) {
      throw new Error("No complete samples in input array");
    }

    return activateBatchFn(this.network, inputs, inputSize, this.numOutputs);
  }

  activateBatchWithFeedback(
    inputs: Float32Array,
    inputSize: number,
    feedbackLoop: boolean,
  ): Float32Array {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    if (!feedbackLoop && typeof this.network.reset_state === "function") {
      this.network.reset_state();
    }

    return this.activateBatch(inputs, inputSize);
  }

  /**
   * Get the number of neurons in the network
   */
  get neurons(): number {
    if (this.freed) return 0;
    return this.network.num_neurons;
  }

  /**
   * Get the number of input neurons
   */
  get inputs(): number {
    return this.numInputs;
  }

  /**
   * Get the number of output neurons
   */
  get outputs(): number {
    return this.numOutputs;
  }

  /**
   * Get the number of synapses
   */
  get synapses(): number {
    if (this.freed) return 0;
    return this.network.num_synapses;
  }

  /**
   * Free the WASM resources
   */
  free(): void {
    if (this.freed) return;

    if (this.network) {
      this.network.free();
    }

    this.freed = true;
  }

  /**
   * Dispose method for use with `using` keyword
   */
  [Symbol.dispose](): void {
    this.free();
  }
}

/**
 * Standalone squash function test (for verification)
 */
export function wasmSquash(squashType: number, value: number): number {
  if (!squashFn) {
    throw new Error("WASM module not initialised");
  }
  return squashFn(squashType, value);
}

/**
 * Standalone derivative function
 * Issue #1138 - WASM Migration Phase 6: Implement derivative() in Rust/WASM
 *
 * Computes the derivative of the specified activation function at the given value.
 *
 * @param squashType - The SquashType enum value
 * @param value - The input value at which to compute the derivative
 * @returns The derivative value
 */
export function wasmDerivative(squashType: number, value: number): number {
  if (!derivativeFn) {
    throw new Error("WASM module not initialised");
  }
  return derivativeFn(squashType, value);
}

/**
 * Standalone unsquash function
 * Issue #1139 - WASM Migration Phase 7: Implement unSquash() in Rust/WASM
 *
 * Computes the inverse of the specified activation function at the given activation value.
 * The unsquash function converts activation-space values back to value-space.
 *
 * For non-invertible functions (like Step, Bipolar) or functions with domain
 * restrictions, the hint parameter guides the inverse when the result is ambiguous.
 *
 * @param squashType - The SquashType enum value
 * @param activation - The squashed activation value to invert
 * @param hint - An optional hint value to guide the inverse for ambiguous cases
 * @returns The unsquashed value
 */
export function wasmUnSquash(
  squashType: number,
  activation: number,
  hint?: number,
): number {
  if (!unsquashFn) {
    throw new Error("WASM module not initialised");
  }
  // Use NaN as the hint when not provided, WASM will check for is_finite
  return unsquashFn(squashType, activation, hint ?? Number.NaN);
}

/**
 * Standalone safe zone adjustment function
 * Issue #1140 - WASM Migration Phase 8: Implement safeZoneAdjustment() in Rust/WASM
 *
 * Returns a float from 0 (not safe) to 1 (fully safe) indicating how useful it is
 * to backpropagate through a neuron based on saturation levels.
 *
 * - 1.0: Fully in safe zone, gradient flows freely
 * - 0.0: Completely saturated, no gradient should flow
 * - 0.0-1.0: Partial safety, used for gradual fade-out
 *
 * @param squashType - The SquashType enum value
 * @param rawInput - The raw input value before squashing
 * @param error - The error value from backpropagation
 * @param weight - An optional synapse weight (defaults to 1.0)
 * @returns A value between 0 and 1 indicating backpropagation safety
 */
export function wasmSafeZoneAdjustment(
  squashType: number,
  rawInput: number,
  error: number,
  weight?: number,
): number {
  if (!safeZoneAdjustmentFn) {
    throw new Error("WASM module not initialised");
  }
  // Use NaN as the weight when not provided, WASM will check for is_finite
  // and default to 1.0
  return safeZoneAdjustmentFn(
    squashType,
    rawInput,
    error,
    weight ?? Number.NaN,
  );
}

/**
 * Standalone calculate error function
 * Issue #1141 - WASM Migration Phase 9: Implement calculateError() in Rust/WASM
 *
 * Calculates the error in value-space for backpropagation.
 * This function combines derivative and unSquash to compute the error gradient.
 *
 * The basic algorithm:
 * 1. Compute raw error: rawError = targetActivation - currentActivation
 * 2. If raw error is tiny (< ERROR_EPSILON), return 0
 * 3. If derivative (slope) is strong: error = rawError / slope
 * 4. Otherwise fall back to: error = unSquash(targetActivation) - currentValue
 * 5. Clamp error to prevent weight explosion
 *
 * @param squashType - The SquashType enum value
 * @param currentActivation - The neuron's current output (after squash)
 * @param targetActivation - The desired output
 * @param currentValue - The pre-squash value (hint for unSquash)
 * @returns The calculated error value, clamped to ±100
 */
export function wasmCalculateError(
  squashType: number,
  currentActivation: number,
  targetActivation: number,
  currentValue: number,
): number {
  if (!calculateErrorFn) {
    throw new Error("WASM module not initialised");
  }
  return calculateErrorFn(
    squashType,
    currentActivation,
    targetActivation,
    currentValue,
  );
}

/**
 * Get WASM module version
 */
export function wasmVersion(): string {
  if (!versionFn) {
    return "not loaded";
  }
  return versionFn();
}

// -----------------------------------------------------------------------------
// Optional auto-initialisation for test/CI runs
// -----------------------------------------------------------------------------
//
// When `NEAT_AI_WASM_AUTO_INIT=1|true|yes|on` is set, initialise the WASM module
// at module load time so the rest of the codebase can use WASM without each test
// calling initWasmActivation() explicitly.
//
// This is intentionally opt-in and best-effort. If the module can't be loaded,
// we log and continue (JS fallback still works).
//
// IMPORTANT: Avoid auto-initialising inside Deno Workers by default.
// Some environments end up spawning multiple workers (e.g. default `threads`
// based on `navigator.hardwareConcurrency`). Auto-initialising WASM in every
// worker can cause test runs to stall. If you explicitly want auto-init in
// workers, set `NEAT_AI_WASM_AUTO_INIT_WORKERS=1|true|yes|on`.

function isProbablyWorkerScope(): boolean {
  // Most reliable when available.
  try {
    // deno-lint-ignore no-explicit-any
    const g: any = globalThis;
    if (typeof g.DedicatedWorkerGlobalScope === "function") {
      return g instanceof g.DedicatedWorkerGlobalScope;
    }
  } catch {
    // Ignore
  }

  // Heuristic fallback.
  // In workers there is no `document`, but there is usually `postMessage` and `close`.
  // (Deno module workers typically do not expose `importScripts`.)
  // deno-lint-ignore no-explicit-any
  const g: any = globalThis;
  const hasDocument = typeof g.document !== "undefined";
  const hasPostMessage = typeof g.postMessage === "function";
  const hasClose = typeof g.close === "function";
  const hasOnMessage = typeof g.onmessage !== "undefined";
  return !hasDocument && hasPostMessage && hasClose && hasOnMessage;
}

try {
  const v = Deno.env.get("NEAT_AI_WASM_AUTO_INIT")?.trim().toLowerCase();
  const shouldAutoInit = v === "1" || v === "true" || v === "yes" || v === "on";

  const workerV = Deno.env.get("NEAT_AI_WASM_AUTO_INIT_WORKERS")?.trim()
    .toLowerCase();
  const allowInWorkers = workerV === "1" || workerV === "true" ||
    workerV === "yes" || workerV === "on";
  const isWorker = isProbablyWorkerScope();

  if (
    shouldAutoInit && (!isWorker || allowInWorkers) &&
    !isWasmActivationAvailable()
  ) {
    // repoRoot = <repo>/
    const repoRoot = new URL("../../", import.meta.url).pathname;
    const wasmPath = `${repoRoot}wasm_activation/pkg`;
    await initWasmActivation(wasmPath);
  }
} catch {
  // Ignore env permission errors; auto-init stays disabled.
}
