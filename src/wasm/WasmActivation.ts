/**
 * WASM Creature Activation
 *
 * Issue #1116 - WASM prototype for creature activation
 * Issue #1405 - Refactored: module loading moved to WasmModuleLoader.ts,
 *   standalone functions moved to WasmStandaloneFunctions.ts,
 *   auto-init moved to WasmAutoInit.ts.
 *
 * This module contains the WasmCreatureActivation class (the compiled network
 * wrapper) and associated trace types. It delegates to function pointers
 * obtained from WasmModuleLoader.
 */

import type { Creature } from "../Creature.ts";
import { WasmError } from "../errors/WasmError.ts";
import { getLogger } from "../utils/Logger.ts";
import { compileCreatureToWasm } from "./CompileToWasm.ts";
import type { CompiledCreatureData } from "./CompileToWasm.ts";
import type { WasmCompiledNetwork } from "./WasmCompiledNetwork.ts";
import {
  getCompiledNetworkClass,
  getCrossEntropySumBatchPackedFn,
  getHingeSumBatchPackedFn,
  getMaeSumBatchPackedFn,
  getMapeSumBatchPackedFn,
  getMseSumBatchPackedFn,
  getMsleSumBatchPackedFn,
} from "./WasmModuleLoader.ts";

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

/**
 * WASM-based creature activation wrapper
 *
 * This class wraps a compiled network in WASM and provides an activate()
 * method compatible with the JS-based activation.
 */
export class WasmCreatureActivation {
  private network: WasmCompiledNetwork;
  private numInputs: number;
  private numOutputs: number;
  private freed = false;
  private needsResetWhenStateless = true;

  private constructor(
    network: WasmCompiledNetwork,
    numInputs: number,
    numOutputs: number,
  ) {
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
    const CompiledNetwork = getCompiledNetworkClass();
    if (!CompiledNetwork) {
      getLogger().error("WASM module not initialised");
      return null;
    }

    try {
      const network = new CompiledNetwork(compiled.data);
      return new WasmCreatureActivation(
        network,
        compiled.numInputs,
        compiled.numOutputs,
      );
    } catch (error) {
      getLogger().error("Failed to create WASM activation:", error);
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
   * Activate the network with the given inputs.
   * Returns the output values as a Float32Array.
   */
  activate(input: Float32Array): Float32Array {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (input.length !== this.numInputs) {
      throw new Error(
        `Input length ${input.length} does not match expected ${this.numInputs}`,
      );
    }
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
      return this.activate(input);
    }
    return this.network.activate_view(input, this.numOutputs);
  }

  /**
   * Activate the network with the given inputs, writing to a pre-allocated output buffer.
   * Issue #1171 - Avoids per-call Float32Array allocation overhead.
   */
  activateInto(input: Float32Array, output: Float32Array): void {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (input.length !== this.numInputs) {
      throw new Error(
        `Input length ${input.length} does not match expected ${this.numInputs}`,
      );
    }
    if (output.length !== this.numOutputs) {
      throw new Error(
        `Output buffer length ${output.length} does not match expected ${this.numOutputs}`,
      );
    }
    this.network.activate_into(input, output);
  }

  /**
   * Activate with pre-allocated buffer and feedback loop control.
   * Issue #1171 - Zero-allocation activation for high-throughput scoring.
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
   */
  activateWithFeedback(
    input: Float32Array,
    feedbackLoop: boolean,
  ): Float32Array {
    return this.activateWithState(input, feedbackLoop);
  }

  /**
   * Activate the network with tracing support for backpropagation.
   * Issue #1121 - WASM Migration Phase 4: activateAndTrace
   */
  activateAndTrace(input: Float32Array): WasmTraceResult {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (input.length !== this.numInputs) {
      throw new Error(
        `Input length ${input.length} does not match expected ${this.numInputs}`,
      );
    }

    const result = this.network.activate_and_trace(input, this.numOutputs);
    const numNonInputs = this.network.num_neurons - this.numInputs;

    const outputs = new Float32Array(this.numOutputs);
    outputs.set(result.subarray(0, this.numOutputs));

    const activations = new Float32Array(numNonInputs);
    activations.set(
      result.subarray(this.numOutputs, this.numOutputs + numNonInputs),
    );

    const hintValues = new Float32Array(numNonInputs);
    hintValues.set(
      result.subarray(
        this.numOutputs + numNonInputs,
        this.numOutputs + 2 * numNonInputs,
      ),
    );

    const traceEntries: WasmTraceEntry[] = [];
    let offset = this.numOutputs + (numNonInputs * 2);
    while (offset < result.length) {
      const neuronRelativeIdx = result[offset];
      if (neuronRelativeIdx < 0) break;
      const traceInfo = result[offset + 1];
      traceEntries.push({
        neuronRelativeIndex: Math.round(neuronRelativeIdx),
        traceInfo: traceInfo,
      });
      offset += 2;
    }

    return { outputs, activations, hintValues, traceEntries };
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
   * Issue #1212 - Batch activate and trace for 4 records simultaneously.
   */
  activateAndTraceBatch4Way(
    inputs: [Float32Array, Float32Array, Float32Array, Float32Array],
  ): [WasmTraceResult, WasmTraceResult, WasmTraceResult, WasmTraceResult] {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }

    for (let i = 0; i < 4; i++) {
      if (inputs[i].length !== this.numInputs) {
        throw new Error(
          `Input ${i} length ${
            inputs[i].length
          } does not match expected ${this.numInputs}`,
        );
      }
    }

    const packedInput = new Float32Array(this.numInputs * 4);
    for (let i = 0; i < 4; i++) {
      packedInput.set(inputs[i], i * this.numInputs);
    }

    const result = this.network.activate_and_trace_batch_4way(
      packedInput,
      this.numInputs,
      this.numOutputs,
    );

    const len0 = result[0] as number;
    const len1 = result[1] as number;
    const len2 = result[2] as number;
    const len3 = result[3] as number;

    const start0 = 4;
    const start1 = start0 + len0;
    const start2 = start1 + len1;
    const start3 = start2 + len2;

    const numNonInputs = this.network.num_neurons - this.numInputs;

    const parseRecord = (
      data: Float32Array,
      offset: number,
      len: number,
    ): WasmTraceResult => {
      const recordData = data.subarray(offset, offset + len);

      const outputs = new Float32Array(this.numOutputs);
      outputs.set(recordData.subarray(0, this.numOutputs));

      const activations = new Float32Array(numNonInputs);
      activations.set(
        recordData.subarray(this.numOutputs, this.numOutputs + numNonInputs),
      );

      const hintValues = new Float32Array(numNonInputs);
      hintValues.set(
        recordData.subarray(
          this.numOutputs + numNonInputs,
          this.numOutputs + 2 * numNonInputs,
        ),
      );

      const traceEntries: WasmTraceEntry[] = [];
      let traceOffset = this.numOutputs + numNonInputs * 2;
      while (traceOffset < len) {
        const neuronRelativeIdx = recordData[traceOffset];
        if (neuronRelativeIdx < 0) break;
        traceEntries.push({
          neuronRelativeIndex: Math.round(neuronRelativeIdx),
          traceInfo: recordData[traceOffset + 1],
        });
        traceOffset += 2;
      }

      return { outputs, activations, hintValues, traceEntries };
    };

    return [
      parseRecord(result, start0, len0),
      parseRecord(result, start1, len1),
      parseRecord(result, start2, len2),
      parseRecord(result, start3, len3),
    ];
  }

  /**
   * Issue #1212 - Batch activate and trace with feedback loop control.
   */
  activateAndTraceBatch4WayWithFeedback(
    inputs: [Float32Array, Float32Array, Float32Array, Float32Array],
    feedbackLoop: boolean,
  ): [WasmTraceResult, WasmTraceResult, WasmTraceResult, WasmTraceResult] {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    if (
      !feedbackLoop && this.needsResetWhenStateless &&
      typeof this.network.reset_state === "function"
    ) {
      this.network.reset_state();
    }
    return this.activateAndTraceBatch4Way(inputs);
  }

  /**
   * Compute sum(MSE) across packed [inputs..., targets...] records in WASM.
   */
  mseSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    const fn = getMseSumBatchPackedFn();
    if (!fn) {
      throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
    }
    return fn(this.network, records, inputSize, this.numOutputs, forwardOnly);
  }

  /**
   * Compute sum(MAE) across packed [inputs..., targets...] records in WASM.
   */
  maeSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    const fn = getMaeSumBatchPackedFn();
    if (!fn) {
      throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
    }
    return fn(this.network, records, inputSize, this.numOutputs, forwardOnly);
  }

  /**
   * Compute sum(Cross Entropy) across packed [inputs..., targets...] records in WASM.
   */
  crossEntropySumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    const fn = getCrossEntropySumBatchPackedFn();
    if (!fn) {
      throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
    }
    return fn(this.network, records, inputSize, this.numOutputs, forwardOnly);
  }

  /**
   * Compute sum(MAPE) across packed [inputs..., targets...] records in WASM.
   */
  mapeSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    const fn = getMapeSumBatchPackedFn();
    if (!fn) {
      throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
    }
    return fn(this.network, records, inputSize, this.numOutputs, forwardOnly);
  }

  /**
   * Compute sum(MSLE) across packed [inputs..., targets...] records in WASM.
   */
  msleSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    const fn = getMsleSumBatchPackedFn();
    if (!fn) {
      throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
    }
    return fn(this.network, records, inputSize, this.numOutputs, forwardOnly);
  }

  /**
   * Compute sum(Hinge Loss) across packed [inputs..., targets...] records in WASM.
   */
  hingeSumBatchPacked(
    records: Float32Array,
    inputSize: number,
    forwardOnly: boolean,
  ): number {
    if (this.freed) {
      throw new Error("WasmCreatureActivation has been freed");
    }
    const fn = getHingeSumBatchPackedFn();
    if (!fn) {
      throw new WasmError("WASM module not initialised", "MODULE_NOT_LOADED");
    }
    return fn(this.network, records, inputSize, this.numOutputs, forwardOnly);
  }

  get neurons(): number {
    if (this.freed) return 0;
    return this.network.num_neurons;
  }

  get inputs(): number {
    return this.numInputs;
  }

  get outputs(): number {
    return this.numOutputs;
  }

  get synapses(): number {
    if (this.freed) return 0;
    return this.network.num_synapses;
  }

  free(): void {
    if (this.freed) return;
    if (this.network) {
      this.network.free();
    }
    this.freed = true;
  }

  [Symbol.dispose](): void {
    this.free();
  }
}
