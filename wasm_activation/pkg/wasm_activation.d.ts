/* tslint:disable */
/* eslint-disable */

/**
 * WASM binding wrapper around `neat_core::CompiledNetwork`.
 *
 * This struct holds the pure-Rust network and exposes its methods via
 * `#[wasm_bindgen]` for JavaScript consumption.
 */
export class CompiledNetwork {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Activate the network with the given input values.
     */
    activate(input: Float32Array, num_outputs: number): Float32Array;
    /**
     * Activate the network and return outputs + trace data.
     */
    activate_and_trace(input: Float32Array, num_outputs: number): Float32Array;
    /**
     * Batch activate 4 records simultaneously and return all outputs + trace data.
     */
    activate_and_trace_batch_4way(inputs: Float32Array, input_size: number, num_outputs: number): Float32Array;
    /**
     * Activate writing directly to a pre-allocated output buffer.
     */
    activate_into(input: Float32Array, output: Float32Array): void;
    /**
     * Activate the network and return a zero-copy Float32Array view over WASM memory.
     *
     * IMPORTANT: The returned Float32Array aliases the network's internal activation buffer.
     * It will be overwritten by subsequent activations of the same network instance.
     */
    activate_view(input: Float32Array, num_outputs: number): Float32Array;
    /**
     * Create a new compiled network from serialised data.
     */
    constructor(data: Uint8Array);
    /**
     * Reset non-input activations to 0.0.
     */
    reset_state(): void;
    /**
     * Number of input neurons.
     */
    readonly num_inputs: number;
    /**
     * Number of neurons (including input).
     */
    readonly num_neurons: number;
    /**
     * Number of synapses.
     */
    readonly num_synapses: number;
}

/**
 * WASM binding wrapper around `neat_core::PredictiveCodingEngine`.
 */
export class PredictiveCodingEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Compute gradients and return packed result.
     */
    compute_gradients_wasm(latents: Float32Array, errors: Float32Array, learning_rate: number): Float32Array;
    /**
     * Batch inference for multiple samples.
     */
    infer_batch_wasm(inputs: Float32Array, input_size: number, num_samples: number, targets: Float32Array | null | undefined, target_size: number): Float32Array;
    /**
     * Run inference (iterative settling) and return packed results.
     */
    infer_wasm(input: Float32Array, targets?: Float32Array | null): Float32Array;
    /**
     * Create a new Predictive Coding engine from serialised data.
     */
    constructor(data: Uint8Array);
    readonly num_inputs: number;
    readonly num_neurons: number;
    readonly num_outputs: number;
}

export function accumulate_bias_batch_4way(target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): Float64Array;

export function accumulate_bias_batch_8way(target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): Float64Array;

export function accumulate_bias_persistent_4way(start_index: number, target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): void;

export function accumulate_bias_persistent_8way(start_index: number, target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): void;

export function accumulate_weight_batch_4way(current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): Float64Array;

export function accumulate_weight_batch_8way(current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): Float64Array;

export function accumulate_weight_persistent_4way(start_index: number, current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): void;

export function accumulate_weight_persistent_8way(start_index: number, current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): void;

export function calculate_bias(count: number, total_adjusted_bias: number, current_bias: number, no_change: boolean, generations: number, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): number;

/**
 * Calculate the error in value-space for backpropagation.
 */
export function calculate_error(squash_type: number, current_activation: number, target_activation: number, current_value: number): number;

/**
 * Batch error calculation for 4 records simultaneously.
 */
export function calculate_error_batch_4way(squash_type: number, current_activations: Float32Array, target_activations: Float32Array, current_values: Float32Array): Float32Array;

export function calculate_weight(count: number, total_positive_activation: number, total_negative_activation: number, count_positive: number, count_negative: number, total_positive_adjusted_value: number, total_negative_adjusted_value: number, current_weight: number, generations: number, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): number;

export function compute_score_components(weights: Float64Array, biases: Float64Array): Float64Array;

export function cross_entropy_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

/**
 * Standalone derivative function for testing.
 */
export function derivative(squash_type: number, value: number): number;

/**
 * Batch derivative computation for 4 values simultaneously.
 */
export function derivative_batch_4way(squash_type: number, x0: number, x1: number, x2: number, x3: number): Float32Array;

export function distribute_elastic_error(error: number, activations: Float32Array, safe_zone_factors: Float32Array, weights: Float32Array, plank_constant: number): Float32Array;

export function free_training_state(): void;

/**
 * Fused backward pass error distribution.
 */
export function fused_error_distribution(neuron_squash_type: number, neuron_activation: number, neuron_target_activation: number, neuron_hint_value: number, upstream_squash_types: Uint8Array, upstream_hint_values: Float32Array, upstream_activations: Float32Array, synapse_weights: Float32Array): Float32Array;

/**
 * Get the range (low, high) for an activation function.
 */
export function get_range(squash_type: number): Float32Array;

export function get_training_state_num_neurons(): number;

export function get_training_state_num_synapses(): number;

export function hinge_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

export function init_training_state(num_synapses: number, num_neurons: number): void;

/**
 * Clamp a value to the valid range for an activation function.
 */
export function limit_range(squash_type: number, value: number): number;

export function mae_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

export function mape_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

export function mse_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

export function msle_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

export function read_all_neuron_state(): Float64Array;

export function read_all_synapse_state(): Float64Array;

export function read_neuron_state(index: number): Float64Array;

export function read_synapse_state(index: number): Float64Array;

export function reset_training_state(): void;

/**
 * Safe zone adjustment for backpropagation saturation detection.
 */
export function safe_zone_adjustment(squash_type: number, raw_input: number, error: number, weight: number): number;

/**
 * Batch safe zone adjustment.
 */
export function safe_zone_adjustment_batch(squash_types: Uint8Array, raw_inputs: Float32Array, error: number, weights: Float32Array): Float32Array;

export function scan_max_bias(weights: Float64Array, biases: Float64Array, exclude_idx: number, new_bias: number): Float64Array;

export function scan_max_weight(weights: Float64Array, biases: Float64Array, exclude_idx: number, new_weight: number): Float64Array;

/**
 * Standalone squash function for testing.
 */
export function squash(squash_type: number, value: number): number;

/**
 * Compute the inverse of the specified activation function.
 */
export function unsquash(squash_type: number, activation: number, hint: number): number;

/**
 * Validate that an activation value is within the valid range.
 */
export function validate_range(squash_type: number, activation: number): boolean;

/**
 * Version information.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_compilednetwork_free: (a: number, b: number) => void;
    readonly __wbg_predictivecodingengine_free: (a: number, b: number) => void;
    readonly accumulate_bias_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_bias_batch_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_bias_persistent_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly accumulate_bias_persistent_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly accumulate_weight_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_weight_batch_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_weight_persistent_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly accumulate_weight_persistent_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly calculate_bias: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => number;
    readonly calculate_error: (a: number, b: number, c: number, d: number) => number;
    readonly calculate_error_batch_4way: (a: number, b: any, c: any, d: any) => any;
    readonly calculate_weight: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => number;
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
    readonly compute_score_components: (a: number, b: number, c: number, d: number) => any;
    readonly cross_entropy_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly derivative: (a: number, b: number) => number;
    readonly derivative_batch_4way: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly distribute_elastic_error: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly free_training_state: () => void;
    readonly fused_error_distribution: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
    readonly get_range: (a: number) => any;
    readonly get_training_state_num_neurons: () => number;
    readonly get_training_state_num_synapses: () => number;
    readonly hinge_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly init_training_state: (a: number, b: number) => void;
    readonly limit_range: (a: number, b: number) => number;
    readonly mae_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mape_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mse_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly msle_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly predictivecodingengine_compute_gradients_wasm: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly predictivecodingengine_infer_batch_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly predictivecodingengine_infer_wasm: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly predictivecodingengine_new: (a: number, b: number) => [number, number, number];
    readonly predictivecodingengine_num_inputs: (a: number) => number;
    readonly predictivecodingengine_num_neurons: (a: number) => number;
    readonly predictivecodingengine_num_outputs: (a: number) => number;
    readonly read_all_neuron_state: () => [number, number];
    readonly read_all_synapse_state: () => [number, number];
    readonly read_neuron_state: (a: number) => [number, number];
    readonly read_synapse_state: (a: number) => [number, number];
    readonly reset_training_state: () => void;
    readonly safe_zone_adjustment: (a: number, b: number, c: number, d: number) => number;
    readonly safe_zone_adjustment_batch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly scan_max_bias: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly scan_max_weight: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
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
