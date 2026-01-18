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

// WASM module state
let wasmModule: WasmModule | null = null;
let CompiledNetwork: CompiledNetworkClass | null = null;
let activateBatchFn:
  | ((
    network: unknown,
    inputs: Float32Array,
    inputSize: number,
    numOutputs: number,
  ) => Float32Array)
  | null = null;
let squashFn: ((squashType: number, value: number) => number) | null = null;
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
    versionFn = module.version;

    return true;
  } catch (error) {
    console.error("Failed to initialise WASM activation module:", error);
    return false;
  }
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

  try {
    // Initialize synchronously
    jsBindings.initSync(wasmBinary);

    // Store references to the exports
    wasmModule = jsBindings;
    CompiledNetwork = jsBindings.CompiledNetwork;
    activateBatchFn = jsBindings.activate_batch;
    squashFn = jsBindings.squash;
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
 * Get WASM module version
 */
export function wasmVersion(): string {
  if (!versionFn) {
    return "not loaded";
  }
  return versionFn();
}
