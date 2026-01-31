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
let mseSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let maeSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let crossEntropySumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let mapeSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let msleSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let hingeSumBatchPackedFn:
  | ((
    network: unknown,
    records: Float32Array,
    inputSize: number,
    numOutputs: number,
    forwardOnly: boolean,
  ) => number)
  | null = null;
let getRangeFn: ((squashType: number) => Float32Array) | null = null;
let validateRangeFn:
  | ((squashType: number, activation: number) => boolean)
  | null = null;
let limitRangeFn: ((squashType: number, value: number) => number) | null = null;
let versionFn: (() => string) | null = null;

/**
 * Load and initialise the WASM module. Internal implementation detail (Issue #1256).
 * Callers do not call this; the library initialises the backend automatically.
 */
export async function initWasmActivation(): Promise<boolean> {
  if (wasmModule !== null) {
    return true; // Already initialised
  }

  // If an init is already in flight, await it.
  if (initPromise) {
    return await initPromise;
  }

  initPromise = (async () => {
    try {
      // Canonical location: always resolve from this module's import.meta.url.
      // This works for both local `file:` and published `https:` (JSR) contexts.
      const modulePath =
        new URL("../../wasm_activation/pkg/wasm_activation.js", import.meta.url)
          .href;
      const module = await import(modulePath);

      // Initialize the WASM module
      // The default export is the init function
      await module.default();

      // Store references to the exports
      wasmModule = module;
      CompiledNetwork = module.CompiledNetwork;
      squashFn = module.squash;
      derivativeFn = module.derivative;
      unsquashFn = module.unsquash;
      safeZoneAdjustmentFn = module.safe_zone_adjustment;
      calculateErrorFn = module.calculate_error;
      mseSumBatchPackedFn = module.mse_sum_batch_packed;
      maeSumBatchPackedFn = module.mae_sum_batch_packed;
      crossEntropySumBatchPackedFn = module.cross_entropy_sum_batch_packed;
      mapeSumBatchPackedFn = module.mape_sum_batch_packed;
      msleSumBatchPackedFn = module.msle_sum_batch_packed;
      hingeSumBatchPackedFn = module.hinge_sum_batch_packed;
      getRangeFn = module.get_range;
      validateRangeFn = module.validate_range;
      limitRangeFn = module.limit_range;
      versionFn = module.version;

      return true;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const msg = (error as Error)?.message ?? String(error);
      const isNotFound = code === "ERR_MODULE_NOT_FOUND" ||
        /module not found/i.test(msg);
      if (isNotFound) {
        console.warn(
          "WASM activation: pkg not found at the canonical package location.",
        );
      } else {
        console.error("Failed to initialise WASM activation module:", error);
      }
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
 * Load and initialise the WASM module synchronously from binary data. Internal implementation detail (Issue #1256).
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
    // Initialize synchronously.
    //
    // wasm-bindgen recently changed the signature to prefer a single options object:
    //   initSync({ module: <bytes|WebAssembly.Module> })
    // Passing raw bytes triggers a deprecation warning in newer generated glue.
    //
    // We support both shapes for compatibility with older generated bindings.
    try {
      jsBindings.initSync({ module: wasmBinary });
    } catch {
      jsBindings.initSync(wasmBinary);
    }

    // Store references to the exports
    wasmModule = jsBindings;
    CompiledNetwork = jsBindings.CompiledNetwork;
    squashFn = jsBindings.squash;
    derivativeFn = jsBindings.derivative;
    unsquashFn = jsBindings.unsquash;
    safeZoneAdjustmentFn = jsBindings.safe_zone_adjustment;
    calculateErrorFn = jsBindings.calculate_error;
    mseSumBatchPackedFn = jsBindings.mse_sum_batch_packed;
    maeSumBatchPackedFn = jsBindings.mae_sum_batch_packed;
    crossEntropySumBatchPackedFn = jsBindings.cross_entropy_sum_batch_packed;
    mapeSumBatchPackedFn = jsBindings.mape_sum_batch_packed;
    msleSumBatchPackedFn = jsBindings.msle_sum_batch_packed;
    hingeSumBatchPackedFn = jsBindings.hinge_sum_batch_packed;
    getRangeFn = jsBindings.get_range;
    validateRangeFn = jsBindings.validate_range;
    limitRangeFn = jsBindings.limit_range;
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
  // When true, stateless activations must call reset_state() to avoid leaking
  // stale activations into backward/recurrent edges. For v4+ forward-only creatures
  // this can safely be disabled for performance.
  private needsResetWhenStateless = true;

  // deno-lint-ignore no-explicit-any
  private constructor(network: any, numInputs: number, numOutputs: number) {
    this.network = network;
    this.numInputs = numInputs;
    this.numOutputs = numOutputs;
  }

  /**
   * Configure whether stateless activation must reset internal state.
   *
   * When `needsResetWhenStateless=false`, `feedbackLoop=false` activations will
   * skip calling `reset_state()`. Only safe when the network is guaranteed
   * forward-only (no recurrent/back edges, no self loops) and the caller does
   * not rely on any internal state.
   */
  setNeedsResetWhenStateless(needsReset: boolean): void {
    this.needsResetWhenStateless = needsReset;
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

    // Call WASM activate (returns a fresh Float32Array copy).
    return this.network.activate(input, this.numOutputs);
  }

  /**
   * Activate the network and return a zero-copy view into WASM memory.
   *
   * WARNING: The returned Float32Array is overwritten on the next activation
   * of the same network instance. Only use this when you consume outputs
   * immediately and do not retain references.
   */
  activateView(input: Float32Array): Float32Array {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (input.length !== this.numInputs) {
      throw new Error(
        `Input length ${input.length} does not match expected ${this.numInputs}`,
      );
    }
    if (typeof this.network.activate_view !== "function") {
      // Fallback to safe copy if the export isn't present.
      return this.activate(input);
    }
    return this.network.activate_view(input, this.numOutputs);
  }

  /**
   * Activate the network with the given inputs, writing to a pre-allocated output buffer
   * Issue #1171 - Avoids per-call Float32Array allocation overhead
   *
   * This method writes directly to the caller's output buffer instead of allocating
   * a new Float32Array on each call. For repeated activations (e.g., scoring millions
   * of records), this eliminates allocation overhead and GC pressure.
   *
   * @param input - The input values
   * @param output - Pre-allocated output buffer to write results into
   */
  activateInto(input: Float32Array, output: Float32Array): void {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    // Ensure input is the right size
    if (input.length !== this.numInputs) {
      throw new Error(
        `Input length ${input.length} does not match expected ${this.numInputs}`,
      );
    }

    // Ensure output buffer is the right size
    if (output.length !== this.numOutputs) {
      throw new Error(
        `Output buffer length ${output.length} does not match expected ${this.numOutputs}`,
      );
    }

    // Call the WASM activate_into method
    this.network.activate_into(input, output);
  }

  /**
   * Activate with pre-allocated buffer and feedback loop control
   * Issue #1171 - Zero-allocation activation for high-throughput scoring
   *
   * @param input - The input values
   * @param output - Pre-allocated output buffer to write results into
   * @param feedbackLoop - Whether to preserve state between calls
   */
  activateIntoWithFeedback(
    input: Float32Array,
    output: Float32Array,
    feedbackLoop: boolean,
  ): void {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    if (
      !feedbackLoop && this.needsResetWhenStateless &&
      typeof this.network.reset_state === "function"
    ) {
      this.network.reset_state();
    }

    this.activateInto(input, output);
  }

  /**
   * Activate with state-control (stateless vs stateful).
   *
   * When `feedbackLoop=false` we must ensure the WASM activation buffer does not
   * carry state between calls. JS activation resets per-call unless feedbackLoop
   * is explicitly enabled.
   */
  activateWithState(
    input: Float32Array,
    feedbackLoop: boolean,
  ): Float32Array {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    if (
      !feedbackLoop && this.needsResetWhenStateless &&
      typeof this.network.reset_state === "function"
    ) {
      this.network.reset_state();
    }

    return this.activate(input);
  }

  /**
   * Backwards-compatible alias.
   *
   * NOTE: This name is misleading; it actually controls whether internal state
   * is reset when `feedbackLoop=false`.
   */
  activateWithFeedback(
    input: Float32Array,
    feedbackLoop: boolean,
  ): Float32Array {
    return this.activateWithState(input, feedbackLoop);
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

    // Extract outputs using bulk copy (Issue #1172)
    const outputs = new Float32Array(this.numOutputs);
    outputs.set(result.subarray(0, this.numOutputs));

    // Extract post-squash activations for all non-input neurons using bulk copy
    const activations = new Float32Array(numNonInputs);
    activations.set(
      result.subarray(this.numOutputs, this.numOutputs + numNonInputs),
    );

    // Extract pre-squash values (hintValues) for all non-input neurons using bulk copy
    const hintValues = new Float32Array(numNonInputs);
    hintValues.set(
      result.subarray(
        this.numOutputs + numNonInputs,
        this.numOutputs + 2 * numNonInputs,
      ),
    );

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

    if (
      !feedbackLoop && this.needsResetWhenStateless &&
      typeof this.network.reset_state === "function"
    ) {
      this.network.reset_state();
    }

    return this.activateAndTrace(input);
  }

  /**
   * Compute sum(MSE) across packed [inputs..., targets...] records in WASM.
   *
   * Returns the sum of per-record MSE values (divide by record count for average).
   *
   * This is intended for scoring workloads where:
   * - cost is MSE
   * - feedbackLoop is false (stateless)
   * - the creature is guaranteed forward-only (so we can skip per-record reset)
   */
  mseSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (!mseSumBatchPackedFn) {
      throw new Error("WASM module not initialised");
    }
    return mseSumBatchPackedFn(
      this.network,
      records,
      inputSize,
      this.numOutputs,
      forwardOnly,
    );
  }

  /**
   * Compute sum(MAE) across packed [inputs..., targets...] records in WASM.
   *
   * Returns the sum of per-record MAE values (divide by record count for average).
   */
  maeSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (!maeSumBatchPackedFn) {
      throw new Error("WASM module not initialised");
    }
    return maeSumBatchPackedFn(
      this.network,
      records,
      inputSize,
      this.numOutputs,
      forwardOnly,
    );
  }

  /**
   * Compute sum(Cross Entropy) across packed [inputs..., targets...] records in WASM.
   *
   * Returns the sum of per-record Cross Entropy values (divide by record count for average).
   */
  crossEntropySumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (!crossEntropySumBatchPackedFn) {
      throw new Error("WASM module not initialised");
    }
    return crossEntropySumBatchPackedFn(
      this.network,
      records,
      inputSize,
      this.numOutputs,
      forwardOnly,
    );
  }

  /**
   * Compute sum(MAPE) across packed [inputs..., targets...] records in WASM.
   *
   * Returns the sum of per-record MAPE values (divide by record count for average).
   */
  mapeSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (!mapeSumBatchPackedFn) {
      throw new Error("WASM module not initialised");
    }
    return mapeSumBatchPackedFn(
      this.network,
      records,
      inputSize,
      this.numOutputs,
      forwardOnly,
    );
  }

  /**
   * Compute sum(MSLE) across packed [inputs..., targets...] records in WASM.
   *
   * Returns the sum of per-record MSLE values (divide by record count for average).
   * Note: MSLE does not average per output within each record.
   */
  msleSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (!msleSumBatchPackedFn) {
      throw new Error("WASM module not initialised");
    }
    return msleSumBatchPackedFn(
      this.network,
      records,
      inputSize,
      this.numOutputs,
      forwardOnly,
    );
  }

  /**
   * Compute sum(Hinge Loss) across packed [inputs..., targets...] records in WASM.
   *
   * Returns the sum of per-record Hinge values (divide by record count for average).
   * Note: Hinge does not average per output within each record.
   */
  hingeSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (!hingeSumBatchPackedFn) {
      throw new Error("WASM module not initialised");
    }
    return hingeSumBatchPackedFn(
      this.network,
      records,
      inputSize,
      this.numOutputs,
      forwardOnly,
    );
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
 * Range information for an activation function.
 * Issue #1142 - WASM Migration Phase 10: Implement range validation in Rust/WASM
 */
export interface WasmActivationRange {
  low: number;
  high: number;
}

/**
 * Get the valid output range for an activation function.
 * Returns { low, high }.
 */
export function wasmGetRange(squashType: number): WasmActivationRange {
  if (!getRangeFn) {
    throw new Error("WASM module not initialised");
  }
  const arr = getRangeFn(squashType);
  return { low: arr[0], high: arr[1] };
}

/**
 * Validate that an activation value is within the valid range.
 */
export function wasmValidateRange(
  squashType: number,
  activation: number,
): boolean {
  if (!validateRangeFn) {
    throw new Error("WASM module not initialised");
  }
  return validateRangeFn(squashType, activation);
}

/**
 * Clamp a value to the valid range for an activation function.
 */
export function wasmLimitRange(squashType: number, value: number): number {
  if (!limitRangeFn) {
    throw new Error("WASM module not initialised");
  }
  return limitRangeFn(squashType, value);
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
// Auto-initialisation (Issue #1256: WASM and backends are implementation details)
// -----------------------------------------------------------------------------
//
// Initialise the WASM module at module load time on the main thread so callers
// use the best available backend with no code changes or env vars required.
// - WASM is loaded from the NEAT-AI package (JSR URL or cache path).
// - WASM activation is mandatory (Issue #1263).
//
// Workers receive the WASM payload from the parent and initialise internally.

export function isProbablyWorkerScope(): boolean {
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
  // deno-lint-ignore no-explicit-any
  const g: any = globalThis;
  const hasDocument = typeof g.document !== "undefined";
  const hasPostMessage = typeof g.postMessage === "function";
  const hasClose = typeof g.close === "function";
  const hasOnMessage = typeof g.onmessage !== "undefined";
  return !hasDocument && hasPostMessage && hasClose && hasOnMessage;
}

try {
  // Issue #1258: Auto-init in both main thread and workers. When a Deno Worker
  // imports NEAT-AI independently (not via the library's own worker system),
  // WASM should load transparently.
  //
  // Issue #1263: WASM is mandatory. However, for the library's own worker
  // system, workers receive a preloaded WASM payload from the parent and
  // initialise from that payload during the worker init handshake. In that case
  // we intentionally avoid auto-init at module-evaluation time in that worker,
  // to prevent duplicate loads and reduce worker start flakiness. Internal
  // worker entrypoints set a global flag before importing NEAT-AI modules.
  // deno-lint-ignore no-explicit-any
  const g: any = globalThis;
  const shouldAutoInit = !isWasmActivationAvailable() &&
    g.__NEAT_AI_SKIP_WASM_AUTO_INIT !== true;

  if (shouldAutoInit) {
    await initWasmActivation();
  }
} catch {
  // Ignore env permission errors; auto-init stays disabled.
}
