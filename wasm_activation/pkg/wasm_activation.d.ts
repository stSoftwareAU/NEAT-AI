/* tslint:disable */
/* eslint-disable */

/**
 * Compiled network data structure
 *
 * Format (Issue #1125 - updated to support aggregate functions):
 * - Header: [num_neurons: u32, num_inputs: u32]
 * - Neuron data: For each neuron after inputs:
 *   - [bias: f32, squash_type: u8, is_constant: u8, num_synapses: u16]
 *   - Connections: [from_index: u16, synapse_type: u8, padding: u8, weight: f32] * num_connections
 *
 * Synapse types (for IF activation):
 *   - 0: Standard/Positive (used in weighted sum or as positive branch for IF)
 *   - 1: Condition (for IF: summed to determine branch)
 *   - 2: Negative (for IF: used when condition <= 0)
 *   - 3: Positive (explicit, same as Standard for IF)
 *
 * This compact format minimises memory access and enables efficient iteration.
 */
export class CompiledNetwork {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Activate the network with the given input values
   * Returns the output values
   */
  activate(input: Float32Array, num_outputs: number): Float32Array;
  /**
   * Activate the network with tracing for backpropagation support
   * Issue #1121 - WASM Migration Phase 4: activateAndTrace
   *
   * Returns a combined result containing:
   * - Output activation values (num_outputs floats)
   * - All non-input neuron activations (for state.activations)
   * - Pre-squash values (hintValues) for all non-input neurons
   * - Trace data for aggregate functions
   *
   * The result format is a Float32Array:
   * - [0..num_outputs): output activation values
   * - [num_outputs..num_outputs+num_non_inputs): post-squash activations
   * - [num_outputs+num_non_inputs..num_outputs+2*num_non_inputs): pre-squash values (hintValues)
   * - [num_outputs+2*num_non_inputs..]: trace data encoded as:
   *   - For each non-input neuron with aggregate squash:
   *     - neuron_index (as f32, relative to input count)
   *     - For MINIMUM/MAXIMUM: winning_local_synapse_index (as f32)
   *     - For IF: branch_taken (1.0 = positive, 0.0 = negative)
   *   - Terminated by -1.0
   */
  activate_and_trace(input: Float32Array, num_outputs: number): Float32Array;
  /**
   * Create a new compiled network from serialised data
   *
   * Data format (all values little-endian):
   * - u32: num_neurons
   * - u32: num_inputs
   * - For each non-input neuron:
   *   - f32: bias
   *   - u8: squash_type
   *   - u8: is_constant (0 or 1)
   *   - u16: num_synapses
   *   - For each synapse:
   *     - u16: from_index
   *     - u8: synapse_type
   *     - u8: padding
   *     - f32: weight
   */
  constructor(data: Uint8Array);
  /**
   * Get the number of input neurons
   */
  readonly num_inputs: number;
  /**
   * Get the number of neurons in the network
   */
  readonly num_neurons: number;
  /**
   * Get the number of synapses in the network
   */
  readonly num_synapses: number;
}

/**
 * Batch activation - activate the network with multiple inputs at once
 * This reduces JS/WASM boundary crossing overhead for batch processing
 * Updated for Issue #1125 to support aggregate functions (MINIMUM, MAXIMUM, IF)
 */
export function activate_batch(
  network: CompiledNetwork,
  inputs: Float32Array,
  input_size: number,
  num_outputs: number,
): Float32Array;

/**
 * Standalone derivative function for testing
 * Issue #1138 - WASM Migration Phase 6
 */
export function derivative(squash_type: number, value: number): number;

/**
 * Standalone squash function for testing
 */
export function squash(squash_type: number, value: number): number;

/**
 * Version information
 */
export function version(): string;

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_compilednetwork_free: (a: number, b: number) => void;
  readonly activate_batch: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
  ) => any;
  readonly compilednetwork_activate: (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => any;
  readonly compilednetwork_activate_and_trace: (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => any;
  readonly compilednetwork_new: (
    a: number,
    b: number,
  ) => [number, number, number];
  readonly compilednetwork_num_inputs: (a: number) => number;
  readonly compilednetwork_num_neurons: (a: number) => number;
  readonly compilednetwork_num_synapses: (a: number) => number;
  readonly derivative: (a: number, b: number) => number;
  readonly squash: (a: number, b: number) => number;
  readonly version: () => [number, number];
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(
  module: { module: SyncInitInput } | SyncInitInput,
): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>;
