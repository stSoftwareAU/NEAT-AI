/* tslint:disable */
/* eslint-disable */

/**
 * Compiled network data structure
 *
 * Format (Issue #1125 - updated to support aggregate functions):
 * - Header: [num_neurons: u32, num_inputs: u32]
 * - Neuron data: For each neuron after inputs:
 *   - [bias: f64, squash_type: u8, is_constant: u8, num_synapses: u16]
 *   - Connections: [from_index: u16, synapse_type: u8, padding: u8, weight: f64] * num_connections
 *
 * Synapse types (for IF activation):
 *   - 0: Standard/Positive (used in weighted sum or as positive branch for IF)
 *   - 1: Condition (for IF: summed to determine branch)
 *   - 2: Negative (for IF: used when condition <= 0)
 *   - 3: Positive (explicit, same as Standard for IF)
 *
 * This compact format minimises memory access and enables efficient iteration.
 * Issue #1175 - Uses typed structs for better cache locality and compiler optimisation.
 */
export class CompiledNetwork {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Activate the network with the given input values
     * Returns the output values
     * Issue #1175 - Uses typed structs for better cache locality
     * Issue #1177 - Inlines common squash functions to avoid function call overhead
     */
    activate(input: Float32Array, num_outputs: number): Float32Array;
    /**
     * Activate the network with tracing for backpropagation support
     * Issue #1121 - WASM Migration Phase 4: activateAndTrace
     * Issue #1173 - Pre-allocate Vec<f32> buffers in CompiledNetwork struct
     * Issue #1175 - Uses typed structs for better cache locality
     * Issue #1177 - Inlines common squash functions to avoid function call overhead
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
     * Activate the network with the given input values, writing to a pre-allocated output buffer
     * Issue #1171 - Avoids per-call Float32Array allocation overhead
     *
     * This method writes directly to the caller's output buffer instead of allocating
     * a new Float32Array on each call. For repeated activations (e.g., scoring millions
     * of records), this eliminates allocation overhead and GC pressure.
     *
     * # Arguments
     * * `input` - Input values slice
     * * `output` - Pre-allocated output buffer to write results into
     *
     * # Panics
     * Panics if the output buffer length doesn't match num_outputs
     */
    activate_into(input: Float32Array, output: Float32Array): void;
    /**
     * Activate the network and return a zero-copy Float32Array view over WASM memory.
     *
     * IMPORTANT: The returned Float32Array aliases the network's internal activation buffer.
     * It will be overwritten by subsequent activations of the same network instance.
     *
     * This is intended for high-throughput scoring where the caller consumes outputs
     * immediately and does not retain references across calls.
     */
    activate_view(input: Float32Array, num_outputs: number): Float32Array;
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
     *     - f64: weight
     */
    constructor(data: Uint8Array);
    /**
     * Reset non-input activations to 0.0.
     *
     * This is important for parity with the JS implementation when
     * `feedbackLoop=false` (stateless activation). Without this, the reused
     * activation buffer can leak state between calls, effectively behaving
     * like a feedback loop.
     */
    reset_state(): void;
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
 * Issue #1175 - Uses typed structs for better cache locality
 * Issue #1177 - Inlines common squash functions to avoid function call overhead
 */
export function activate_batch(network: CompiledNetwork, inputs: Float32Array, input_size: number, num_outputs: number): Float32Array;

/**
 * Standalone calculate error function for testing
 * Issue #1141 - WASM Migration Phase 9
 *
 * Calculates the error in value-space for backpropagation.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `current_activation` - The neuron's current output (after squash)
 * * `target_activation` - The desired output
 * * `current_value` - The pre-squash value (hint for unSquash)
 */
export function calculate_error(squash_type: number, current_activation: number, target_activation: number, current_value: number): number;

/**
 * Standalone derivative function for testing
 * Issue #1138 - WASM Migration Phase 6
 */
export function derivative(squash_type: number, value: number): number;

/**
 * Get the range (low, high) for an activation function
 * Issue #1142 - WASM Migration Phase 10
 *
 * Returns a Float32Array with two elements: [low, high]
 * representing the valid output range for the activation function.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 */
export function get_range(squash_type: number): Float32Array;

/**
 * Clamp a value to the valid range for an activation function
 * Issue #1142 - WASM Migration Phase 10
 *
 * Returns the value clamped to the valid range for the specified
 * activation function. Infinity values are clamped to the bounds.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `value` - The value to clamp
 */
export function limit_range(squash_type: number, value: number): number;

/**
 * Compute Mean Squared Error (MSE) over packed records in a single WASM call.
 *
 * This is a scoring fast-path designed to minimise JS/WASM boundary crossings:
 * - Each record is laid out as: [inputs..., targets...]
 * - `input_size` must match the number of input floats in each record.
 * - `num_outputs` must match the number of target/output floats in each record.
 *
 * Returns the **sum** of per-record MSE values (not averaged over records).
 *
 * When `forward_only=true`, we skip clearing `network.activations` between records
 * because v4+ forward-only creatures guarantee there are no recurrent/back edges.
 * When `forward_only=false`, we must call `reset_state()` each record to preserve
 * stateless semantics (`feedbackLoop=false`) and avoid state leakage.
 *
 * Issue #118x - Fuse activate + MSE for scoring performance.
 */
export function mse_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

/**
 * Standalone safe zone adjustment function for testing
 * Issue #1140 - WASM Migration Phase 8
 *
 * Returns a float from 0 (not safe) to 1 (fully safe) indicating how useful it is
 * to backpropagate through a neuron based on saturation levels.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `raw_input` - The raw input value before squashing
 * * `error` - The error value from backpropagation
 * * `weight` - The synapse weight (use NaN if not applicable)
 */
export function safe_zone_adjustment(squash_type: number, raw_input: number, error: number, weight: number): number;

/**
 * Standalone squash function for testing
 */
export function squash(squash_type: number, value: number): number;

/**
 * Standalone unsquash function for testing
 * Issue #1139 - WASM Migration Phase 7
 *
 * Computes the inverse of the specified activation function at the given activation value.
 * The hint parameter guides the inverse for ambiguous or non-invertible functions.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `activation` - The squashed activation value to invert
 * * `hint` - A hint value to guide the inverse (use NaN or pass the original input value)
 */
export function unsquash(squash_type: number, activation: number, hint: number): number;

/**
 * Validate that an activation value is within the valid range
 * Issue #1142 - WASM Migration Phase 10
 *
 * Returns true if the activation is within the valid range for the
 * specified activation function, false otherwise.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `activation` - The activation value to validate
 */
export function validate_range(squash_type: number, activation: number): boolean;

/**
 * Version information
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_compilednetwork_free: (a: number, b: number) => void;
    readonly compilednetwork_reset_state: (a: number) => void;
    readonly compilednetwork_new: (a: number, b: number) => [number, number, number];
    readonly compilednetwork_activate: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compilednetwork_activate_view: (a: number, b: number, c: number, d: number) => any;
    readonly compilednetwork_activate_into: (a: number, b: number, c: number, d: number, e: number, f: any) => void;
    readonly compilednetwork_num_neurons: (a: number) => number;
    readonly compilednetwork_num_inputs: (a: number) => number;
    readonly compilednetwork_num_synapses: (a: number) => number;
    readonly compilednetwork_activate_and_trace: (a: number, b: number, c: number, d: number) => [number, number];
    readonly activate_batch: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly mse_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly squash: (a: number, b: number) => number;
    readonly derivative: (a: number, b: number) => number;
    readonly unsquash: (a: number, b: number, c: number) => number;
    readonly safe_zone_adjustment: (a: number, b: number, c: number, d: number) => number;
    readonly calculate_error: (a: number, b: number, c: number, d: number) => number;
    readonly get_range: (a: number) => any;
    readonly validate_range: (a: number, b: number) => number;
    readonly limit_range: (a: number, b: number) => number;
    readonly version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
