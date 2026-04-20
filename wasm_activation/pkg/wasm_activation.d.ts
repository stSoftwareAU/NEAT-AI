/* tslint:disable */
/* eslint-disable */

/**
 * Issue #1518 - Batch bias accumulation for 4 neurons.
 *
 * Processes 4 neurons in a single WASM call, returning a packed f64 array
 * with 3 values per neuron (12 total). The caller unpacks these into the
 * corresponding NeuronState objects.
 *
 * # Arguments
 * * `target_pre_activations` - 4 target pre-activation values
 * * `pre_activations` - 4 current pre-activation values
 * * `current_biases` - 4 current neuron biases
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate for bias adjustment
 * * `max_bias_adj_scale` - Maximum bias adjustment scale
 * * `limit_bias_scale` - Global bias scale limit
 *
 * # Returns
 * Float64Array with 12 values (3 per neuron):
 *   [count, totalBias, totalAdjustedBias] × 4
 */
export function accumulate_bias_batch_4way(target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): Float64Array;

/**
 * Issue #1518 - Batch bias accumulation for 8 neurons.
 *
 * Same as 4-way but processes 8 neurons. Returns 24 f64 values.
 */
export function accumulate_bias_batch_8way(target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): Float64Array;

/**
 * Issue #1518 - Batch weight accumulation for 4 synapses.
 *
 * Processes 4 synapses in a single WASM call, returning a packed f64 array
 * with 7 values per synapse (28 total). The caller unpacks these into the
 * corresponding SynapseState objects.
 *
 * # Arguments
 * * `current_weights` - 4 current synapse weights
 * * `target_values` - 4 target values for weight calculation
 * * `activations` - 4 activation values from source neurons
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate for weight adjustment
 * * `max_weight_adj_scale` - Maximum weight adjustment scale
 * * `limit_weight_scale` - Global weight scale limit
 *
 * # Returns
 * Float64Array with 28 values (7 per synapse):
 *   [count, totalPositiveActivation, totalNegativeActivation,
 *    countPositiveActivations, countNegativeActivations,
 *    totalPositiveAdjustedValue, totalNegativeAdjustedValue] × 4
 */
export function accumulate_weight_batch_4way(current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): Float64Array;

/**
 * Issue #1518 - Batch weight accumulation for 8 synapses.
 *
 * Same as 4-way but processes 8 synapses. Returns 56 f64 values.
 */
export function accumulate_weight_batch_8way(current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): Float64Array;

/**
 * Issue #1518 - Calculate the finalised bias after accumulation.
 *
 * Mirrors the TypeScript `calculateBias()` function.
 *
 * # Arguments
 * * `count` - Total accumulation count
 * * `total_adjusted_bias` - Sum of limited biases
 * * `current_bias` - The neuron's current bias
 * * `no_change` - Whether the neuron has flagged no change
 * * `generations` - Config generations value
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate
 * * `max_bias_adj_scale` - Maximum bias adjustment scale
 * * `limit_bias_scale` - Global bias scale limit
 * * `l1_bias_decay` - L1 regularisation strength (Issue #1953)
 * * `l2_bias_decay` - L2 regularisation strength (Issue #1953)
 *
 * # Returns
 * The calculated bias
 */
export function calculate_bias(count: number, total_adjusted_bias: number, current_bias: number, no_change: boolean, generations: number, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number, l1_bias_decay: number, l2_bias_decay: number): number;

/**
 * Issue #1960 - Batch calculate_bias for 4 neurons in a single WASM call.
 *
 * Amortises boundary crossing overhead by processing 4 bias calculations
 * at once. Each neuron provides 4 state values packed into a single
 * Float64Array, plus shared config scalars. The noChange flags are passed
 * as a separate Uint8Array (0 = false, nonzero = true).
 *
 * # Arguments
 * * `packed_state` - 12 f64 values: 3 per neuron ×4
 *   Per neuron: [count, totalAdjustedBias, currentBias]
 * * `no_change_flags` - 4 u8 values: 0 = false, nonzero = true
 * * `generations` - Config generations value
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate
 * * `max_bias_adj_scale` - Maximum bias adjustment scale
 * * `limit_bias_scale` - Global bias scale limit
 * * `l1_bias_decay` - L1 regularisation strength
 * * `l2_bias_decay` - L2 regularisation strength
 *
 * # Returns
 * Float64Array with 4 calculated biases
 */
export function calculate_bias_batch_4way(packed_state: Float64Array, no_change_flags: Uint8Array, generations: number, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number, l1_bias_decay: number, l2_bias_decay: number): Float64Array;

/**
 * Issue #1518 - Calculate the finalised weight after accumulation.
 *
 * Mirrors the TypeScript `calculateWeight()` function. Performs the
 * weighted averaging with positive/negative tracking and generation-based
 * inertia.
 *
 * # Arguments
 * * `count` - Total accumulation count
 * * `total_positive_activation` - Sum of positive activations
 * * `total_negative_activation` - Sum of |negative activations|
 * * `count_positive` - Number of positive activations
 * * `count_negative` - Number of negative activations
 * * `total_positive_adjusted_value` - Sum of limited weight × positive activation
 * * `total_negative_adjusted_value` - Sum of limited weight × negative activation
 * * `current_weight` - The synapse's current weight
 * * `generations` - Config generations value
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate
 * * `max_weight_adj_scale` - Maximum weight adjustment scale
 * * `limit_weight_scale` - Global weight scale limit
 * * `l1_weight_decay` - L1 regularisation strength (Issue #1953)
 * * `l2_weight_decay` - L2 regularisation strength (Issue #1953)
 *
 * # Returns
 * The calculated average weight
 */
export function calculate_weight(count: number, total_positive_activation: number, total_negative_activation: number, count_positive: number, count_negative: number, total_positive_adjusted_value: number, total_negative_adjusted_value: number, current_weight: number, generations: number, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number, l1_weight_decay: number, l2_weight_decay: number): number;

/**
 * Issue #1960 - Batch calculate_weight for 4 synapses in a single WASM call.
 *
 * Amortises boundary crossing overhead by processing 4 weight calculations
 * at once. Each synapse provides 8 state values (count through currentWeight)
 * packed into a single Float64Array, plus shared config scalars.
 *
 * # Arguments
 * * `packed_state` — 32 f64 values (8 per synapse × 4): for each synapse,
 *   `[count, totalPosAct, totalNegAct, countPos, countNeg, totalPosAdj, totalNegAdj, currentWeight]`
 * * `generations` - Config generations value
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate
 * * `max_weight_adj_scale` - Maximum weight adjustment scale
 * * `limit_weight_scale` - Global weight scale limit
 * * `l1_weight_decay` - L1 regularisation strength
 * * `l2_weight_decay` - L2 regularisation strength
 *
 * # Returns
 * Float64Array with 4 calculated weights
 */
export function calculate_weight_batch_4way(packed_state: Float64Array, generations: number, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number, l1_weight_decay: number, l2_weight_decay: number): Float64Array;

export function core_wasm_wrapper_ready(): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly core_wasm_wrapper_ready: () => number;
    readonly accumulate_bias_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_bias_batch_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_weight_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_weight_batch_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly calculate_bias: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly calculate_bias_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
    readonly calculate_weight: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => number;
    readonly calculate_weight_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
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
