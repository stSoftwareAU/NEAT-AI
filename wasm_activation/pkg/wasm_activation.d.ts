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
     * Issue #1212 - Batch activate and trace for 4 records simultaneously.
     *
     * Processes 4 input records through the network in parallel, capturing trace
     * data for backpropagation. Uses SIMD via `weighted_sum_simd_4records()` for
     * standard squash functions.
     *
     * # Arguments
     * * `inputs` - Packed input array: [input0..., input1..., input2..., input3...]
     * * `input_size` - Number of input values per record
     * * `num_outputs` - Number of output neurons
     *
     * # Returns
     * Four Vec<f32>, one per record. Each has the same format as `activate_and_trace`:
     * [outputs..., activations..., hints..., trace_data...]
     */
    activate_and_trace_batch_4way(inputs: Float32Array, input_size: number, num_outputs: number): Float32Array;
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
 * Issue #1213 - Batch error calculation for 4 records simultaneously.
 *
 * Returns a Float32Array with 4 error values computed for backpropagation.
 * This provides significant performance improvements during mini-batch training.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `current_activations` - Float32Array of 4 current activation values
 * * `target_activations` - Float32Array of 4 target activation values
 * * `current_values` - Float32Array of 4 pre-squash values (hints for unSquash)
 */
export function calculate_error_batch_4way(squash_type: number, current_activations: Float32Array, target_activations: Float32Array, current_values: Float32Array): Float32Array;

/**
 * Fused activate + Cross Entropy calculation for batch scoring.
 *
 * Cross Entropy formula per record: -(1/n) * Σ(t * log(o) + (1-t) * log(1-o))
 * Output values are clamped to [1e-15, 1-1e-15] to prevent log(0).
 *
 * # Arguments
 * * `network` - The compiled network to activate
 * * `records` - Packed array of `[inputs..., targets...]` records
 * * `input_size` - Number of inputs per record
 * * `num_outputs` - Number of outputs per record
 * * `forward_only` - If true, skip reset_state() (for forward-only networks)
 *
 * # Returns
 * Sum of per-record Cross Entropy errors (divide by record count for mean)
 */
export function cross_entropy_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

/**
 * Standalone derivative function for testing
 * Issue #1138 - WASM Migration Phase 6
 */
export function derivative(squash_type: number, value: number): number;

/**
 * Issue #1213 - Batch derivative computation for 4 values simultaneously.
 *
 * Returns a Float32Array with 4 derivative values computed in parallel using SIMD.
 * This provides significant performance improvements during backpropagation.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `x0, x1, x2, x3` - The 4 input values to compute derivatives for
 */
export function derivative_batch_4way(squash_type: number, x0: number, x1: number, x2: number, x3: number): Float32Array;

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
 * Fused activate + Hinge Loss calculation for batch scoring.
 *
 * Hinge formula per record: Σmax(0, 1 - target * output)
 * Note: Unlike MSE/MAE, Hinge does NOT divide by number of outputs per record.
 *
 * # Arguments
 * * `network` - The compiled network to activate
 * * `records` - Packed array of `[inputs..., targets...]` records
 * * `input_size` - Number of inputs per record
 * * `num_outputs` - Number of outputs per record
 * * `forward_only` - If true, skip reset_state() (for forward-only networks)
 *
 * # Returns
 * Sum of per-record Hinge errors (divide by record count for mean)
 */
export function hinge_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

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
 * Fused activate + MAE (Mean Absolute Error) calculation for batch scoring.
 *
 * Like `mse_sum_batch_packed`, this processes a batch of `[inputs..., targets...]` records
 * in a single WASM call, returning the sum of per-record MAE errors.
 *
 * MAE formula per record: (1/n) * Σ|target - output|
 *
 * # Arguments
 * * `network` - The compiled network to activate
 * * `records` - Packed array of `[inputs..., targets...]` records
 * * `input_size` - Number of inputs per record
 * * `num_outputs` - Number of outputs per record
 * * `forward_only` - If true, skip reset_state() (for forward-only networks)
 *
 * # Returns
 * Sum of per-record MAE errors (divide by record count for mean)
 */
export function mae_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

/**
 * Fused activate + MAPE (Mean Absolute Percentage Error) calculation for batch scoring.
 *
 * MAPE formula per record: (1/n) * Σ|(output - target) / max(target, ε)|
 *
 * # Arguments
 * * `network` - The compiled network to activate
 * * `records` - Packed array of `[inputs..., targets...]` records
 * * `input_size` - Number of inputs per record
 * * `num_outputs` - Number of outputs per record
 * * `forward_only` - If true, skip reset_state() (for forward-only networks)
 *
 * # Returns
 * Sum of per-record MAPE errors (divide by record count for mean)
 */
export function mape_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

/**
 * Fused activate + MSE (Mean Squared Error) calculation for batch scoring.
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
 * Issue #1202 - Use 4-record SIMD batching for forward-only networks.
 */
export function mse_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

/**
 * Fused activate + MSLE (Mean Squared Logarithmic Error) calculation for batch scoring.
 *
 * MSLE formula per record: Σ(log(max(target, ε)) - log(max(output, ε)))
 * Note: Unlike MSE/MAE, MSLE does NOT divide by number of outputs per record.
 *
 * # Arguments
 * * `network` - The compiled network to activate
 * * `records` - Packed array of `[inputs..., targets...]` records
 * * `input_size` - Number of inputs per record
 * * `num_outputs` - Number of outputs per record
 * * `forward_only` - If true, skip reset_state() (for forward-only networks)
 *
 * # Returns
 * Sum of per-record MSLE errors (divide by record count for mean)
 */
export function msle_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

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
 * Issue #1376 - Batch safe zone adjustment for backward pass inner loop.
 *
 * Processes multiple safe zone adjustments in a single WASM call, eliminating
 * per-synapse boundary crossing overhead (~8.7ns each).
 *
 * # Arguments
 * * `squash_types` - Packed u8 array of squash type enum values
 * * `raw_inputs` - Float32Array of pre-squash values for upstream neurons
 * * `error` - The provisional error per link (same for all synapses)
 * * `weights` - Float32Array of synapse weights
 *
 * # Returns
 * Float32Array of safe zone factors (0.0 to 1.0), one per synapse
 */
export function safe_zone_adjustment_batch(squash_types: Uint8Array, raw_inputs: Float32Array, error: number, weights: Float32Array): Float32Array;

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
    readonly compilednetwork_activate: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compilednetwork_activate_and_trace: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compilednetwork_activate_and_trace_batch_4way: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly compilednetwork_activate_into: (a: number, b: number, c: number, d: number, e: number, f: any) => void;
    readonly compilednetwork_activate_view: (a: number, b: number, c: number, d: number) => any;
    readonly compilednetwork_new: (a: number, b: number) => [number, number, number];
    readonly compilednetwork_num_inputs: (a: number) => number;
    readonly compilednetwork_num_neurons: (a: number) => number;
    readonly compilednetwork_num_synapses: (a: number) => number;
    readonly compilednetwork_reset_state: (a: number) => void;
    readonly cross_entropy_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly hinge_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mae_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mape_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mse_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly msle_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly calculate_error: (a: number, b: number, c: number, d: number) => number;
    readonly calculate_error_batch_4way: (a: number, b: any, c: any, d: any) => any;
    readonly derivative: (a: number, b: number) => number;
    readonly derivative_batch_4way: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly get_range: (a: number) => any;
    readonly limit_range: (a: number, b: number) => number;
    readonly safe_zone_adjustment: (a: number, b: number, c: number, d: number) => number;
    readonly safe_zone_adjustment_batch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly squash: (a: number, b: number) => number;
    readonly unsquash: (a: number, b: number, c: number) => number;
    readonly validate_range: (a: number, b: number) => number;
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
