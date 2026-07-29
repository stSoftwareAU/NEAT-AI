/* tslint:disable */
/* eslint-disable */

/**
 * Compiled network data structure
 *
 * `Clone` is supported so native tools (for example the NEAT-AI scorer) can run
 * forward-only batch scoring on multiple threads, each with its own activation buffers.
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
     * Issue #1173 - Pre-allocate `Vec<f32>` buffers in CompiledNetwork struct
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
     * Four `Vec<f32>` values, one per record. Each has the same format as `activate_and_trace`:
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
     * Activate the network and return a freshly allocated `Vec<f32>` of outputs.
     *
     * On WASM this surfaces as `activate_view`. The original wrapper crate
     * returned a zero-copy view over the activations buffer; this safe variant
     * returns a copy to keep the surface safe (no `unsafe` blocks). The JS
     * signature is preserved so existing TS wrappers continue to compile.
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
     * Export this network as a DOT (Graphviz) string.
     *
     * See [`to_dot`] for format details and determinism guarantees.
     *
     * `num_outputs` is required because [`CompiledNetwork`] itself does not
     * record the output count — outputs are the last `num_outputs` neurons
     * by construction.
     */
    to_dot(num_outputs: number): string;
    /**
     * Export this network as a topology JSON string.
     *
     * See [`to_topology_json`] for format details and determinism guarantees.
     */
    to_topology_json(num_outputs: number): string;
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
 * Accumulate bias adjustments for 4 neurons into persistent state.
 *
 * Same arithmetic as `accumulate_bias_batch_4way`, but results are
 * accumulated directly into the persistent state buffer.
 *
 * # Arguments
 * * `start_index` - Index of the first neuron in the state buffer
 * * `target_pre_activations` - 4 target pre-activation values
 * * `pre_activations` - 4 current pre-activation values
 * * `current_biases` - 4 current neuron biases
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate for bias adjustment
 * * `max_bias_adj_scale` - Maximum bias adjustment scale
 * * `limit_bias_scale` - Global bias scale limit
 */
export function accumulate_bias_persistent_4way(start_index: number, target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): void;

/**
 * Accumulate bias adjustments for 8 neurons into persistent state.
 */
export function accumulate_bias_persistent_8way(start_index: number, target_pre_activations: Float64Array, pre_activations: Float64Array, current_biases: Float64Array, plank_constant: number, learning_rate: number, max_bias_adj_scale: number, limit_bias_scale: number): void;

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
 * Accumulate weight adjustments for 4 synapses into persistent state.
 *
 * Same arithmetic as `accumulate_weight_batch_4way`, but results are
 * accumulated directly into the persistent state buffer rather than
 * being returned to JavaScript.
 *
 * # Arguments
 * * `start_index` - Index of the first synapse in the state buffer
 * * `current_weights` - 4 current synapse weights
 * * `target_values` - 4 target values for weight calculation
 * * `activations` - 4 activation values from source neurons
 * * `plank_constant` - Minimum unit threshold
 * * `learning_rate` - Learning rate for weight adjustment
 * * `max_weight_adj_scale` - Maximum weight adjustment scale
 * * `limit_weight_scale` - Global weight scale limit
 */
export function accumulate_weight_persistent_4way(start_index: number, current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): void;

/**
 * Accumulate weight adjustments for 8 synapses into persistent state.
 */
export function accumulate_weight_persistent_8way(start_index: number, current_weights: Float64Array, target_values: Float64Array, activations: Float64Array, plank_constant: number, learning_rate: number, max_weight_adj_scale: number, limit_weight_scale: number): void;

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
 * JS `calculate_error(squash_type, current_activation, target_activation, current_value)`.
 */
export function calculate_error(squash_type: number, current_activation: number, target_activation: number, current_value: number): number;

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

/**
 * Fused activate + Categorical Error (argmax misclassification) for batch scoring.
 *
 * Reference TypeScript: `NEAT-AI/src/costs/CategoricalError.ts`. For each
 * record, this compares the index of the largest target value (the true
 * class) with the index of the largest output value (the predicted class).
 * Each record contributes `0` for a correct prediction or `1` for an
 * incorrect one. The returned sum is therefore the **count of
 * misclassified records**; divide by `record_count` to obtain the mean
 * error rate (`1 - accuracy`).
 *
 * Ties resolve to the first index (standard argmax convention) on both the
 * target and output sides, matching the TS reference.
 *
 * This metric is intentionally **non-differentiable** — it is intended as a
 * scoring / early-stop signal, not a gradient source.
 *
 * # Arguments
 * * `network` - The compiled network to activate
 * * `records` - Packed array of `[inputs..., targets...]` records
 * * `input_size` - Number of inputs per record
 * * `num_outputs` - Number of outputs per record
 * * `forward_only` - If true, skip reset_state() (for forward-only networks)
 *
 * # Returns
 * Count of misclassified records (divide by record count for mean error
 * rate). Returns `0.0` when the record set is empty or `input_size +
 * num_outputs == 0`.
 *
 * Issue stSoftwareAU/NEAT-AI-core#88 — extend native scorer with the last
 * remaining built-in NEAT-AI cost function.
 */
export function categorical_error_sum_batch_packed(network: CompiledNetwork, records: Float32Array, input_size: number, num_outputs: number, forward_only: boolean): number;

/**
 * Compute reverse topological order for backpropagation.
 *
 * Uses Kahn's algorithm on the forward connection graph. Returns neuron
 * indices ordered with output neurons first, then hidden neurons after
 * their downstream consumers. Input neurons are excluded. Neurons remaining
 * in cycles are appended at the end.
 */
export function compute_reverse_topological_order(from_indices: Uint32Array, to_indices: Uint32Array, num_neurons: number, num_inputs: number): Uint32Array;

/**
 * JS `compute_score_components(weights, biases) -> Float64Array of length 4`.
 */
export function compute_score_components(weights: Float64Array, biases: Float64Array): Float64Array;

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
 * JS `derivative(squash_type, value)`.
 */
export function derivative(squash_type: number, value: number): number;

/**
 * Detect whether the topology contains cycles among non-input neurons.
 *
 * Uses Kahn's algorithm on non-input neurons. Self-loops are explicitly
 * detected as cycles.
 *
 * # Returns
 * `0` if acyclic, `1` if a cycle is detected.
 */
export function detect_cycles(from_indices: Uint32Array, to_indices: Uint32Array, num_neurons: number, num_inputs: number): number;

/**
 * Issue #1519 - WASM-exported standalone elastic error distribution.
 *
 * Distributes `error` across links proportional to activation² × safeZoneFactor,
 * with weight-based fallback when activations are near zero, and equal split
 * as a last resort.
 *
 * # Arguments
 * * `error` - The error value to distribute
 * * `activations` - Float32Array of link activation values
 * * `safe_zone_factors` - Float32Array of safe zone factors (0-1)
 * * `weights` - Float32Array of synapse weights (for fallback)
 * * `plank_constant` - Threshold for floating-point comparisons
 *
 * # Returns
 * `Vec<f32>` of error shares, one per link. Sum equals `error`.
 */
export function distribute_elastic_error(error: number, activations: Float32Array, safe_zone_factors: Float32Array, weights: Float32Array, plank_constant: number): Float32Array;

/**
 * Free all training state memory.
 *
 * Call this when training is complete to release WASM linear memory.
 */
export function free_training_state(): void;

/**
 * JS `fused_error_distribution(...)`.
 */
export function fused_error_distribution(neuron_squash_type: number, neuron_activation: number, neuron_target_activation: number, neuron_hint_value: number, upstream_squash_types: Uint8Array, upstream_hint_values: Float32Array, upstream_activations: Float32Array, synapse_weights: Float32Array): Float32Array;

/**
 * JS `get_range(squash_type) -> Float32Array of [low, high]`.
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
 * Initialise persistent training state for an epoch.
 *
 * Allocates and zeroes the synapse and neuron state arrays in WASM linear
 * memory. Call this once at the start of each training epoch.
 *
 * # Arguments
 * * `num_synapses` - Number of synapses in the network
 * * `num_neurons` - Number of neurons in the network
 */
export function init_training_state(num_synapses: number, num_neurons: number): void;

/**
 * JS `limit_range(squash_type, value) -> number`.
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
 * JS `propagate_topological(data: Uint8Array) -> Float64Array`.
 *
 * Decodes the byte-packed buffer, runs the reverse-topological backprop
 * loop, and re-encodes the result with the TS↔WASM sentinel contract.
 */
export function propagate_topological(data: Uint8Array): Float64Array;

/**
 * Read all neuron state as a bulk f64 array.
 *
 * Returns the entire neuron state buffer (num_neurons × 3 values).
 * More efficient than calling `read_neuron_state` per neuron.
 */
export function read_all_neuron_state(): Float64Array;

/**
 * Read all synapse state as a bulk f64 array.
 *
 * Returns the entire synapse state buffer (num_synapses × 7 values).
 * More efficient than calling `read_synapse_state` per synapse.
 */
export function read_all_synapse_state(): Float64Array;

/**
 * Read the persistent state for a single neuron.
 *
 * Returns a packed f64 array with 3 values:
 *   [count, totalBias, totalAdjustedBias]
 */
export function read_neuron_state(index: number): Float64Array;

/**
 * Read the persistent state for a single synapse.
 *
 * Returns a packed f64 array with 7 values:
 *   [count, totalPositiveActivation, totalNegativeActivation,
 *    countPositiveActivations, countNegativeActivations,
 *    totalPositiveAdjustedValue, totalNegativeAdjustedValue]
 */
export function read_synapse_state(index: number): Float64Array;

/**
 * Reset all training state to zero without deallocating.
 *
 * More efficient than `init_training_state` when the network size
 * hasn't changed — avoids reallocation.
 */
export function reset_training_state(): void;

/**
 * JS `safe_zone_adjustment(squash_type, raw_input, error, weight)`.
 */
export function safe_zone_adjustment(squash_type: number, raw_input: number, error: number, weight: number): number;

/**
 * JS `safe_zone_adjustment_batch(squash_types, raw_inputs, error, weights)`.
 */
export function safe_zone_adjustment_batch(squash_types: Uint8Array, raw_inputs: Float32Array, error: number, weights: Float32Array): Float32Array;

/**
 * Scan for available forward-only connection slots.
 *
 * Returns all `(from, to)` pairs where `from < to`, `to >= num_inputs`, the
 * target neuron is not constant, and no connection already exists.
 *
 * Issue #387 — existence is answered from a compressed per-`from` run of
 * existing targets (an `O(n + synapses)` adjacency built once), merge-walked
 * against the candidate range. The previous implementation allocated a dense
 * `n × n` boolean matrix for the same answer: 2.78 MB zeroed per call on the
 * production topology to record ~21.5k synapses, a fill factor under 0.8%.
 * The candidate count is also computed up front so the result vector is
 * allocated exactly once at its final size instead of growing through a
 * realloc chain. Output — pairs and their order — is unchanged.
 *
 * Sorted input is *not* required: each per-`from` run is sorted on build, so
 * an unsorted or duplicate-bearing edge list yields the same answer.
 *
 * # Returns
 * Flattened `[from, to, from, to, ...]` pairs. Returns an empty vector for
 * malformed input — mismatched `from`/`to` lengths, an implausibly large
 * `num_neurons`, or a candidate count whose result vector could not be
 * addressed — rather than panicking (which would trap under WASM).
 */
export function scan_available_connections(from_indices: Uint32Array, to_indices: Uint32Array, is_constant: Uint8Array, num_neurons: number, num_inputs: number): Uint32Array;

/**
 * JS `scan_max_bias(weights, biases, exclude_idx, new_bias) -> Float64Array of [max, second_max]`.
 */
export function scan_max_bias(weights: Float64Array, biases: Float64Array, exclude_idx: number, new_bias: number): Float64Array;

/**
 * JS `scan_max_weight(weights, biases, exclude_idx, new_weight) -> Float64Array of [max, second_max]`.
 */
export function scan_max_weight(weights: Float64Array, biases: Float64Array, exclude_idx: number, new_weight: number): Float64Array;

/**
 * JS `squash(squash_type, value)` → `apply_squash(SquashType, f32)`.
 */
export function squash(squash_type: number, value: number): number;

/**
 * JS `unsquash(squash_type, activation, hint)`.
 */
export function unsquash(squash_type: number, activation: number, hint: number): number;

/**
 * JS `validate_range(squash_type, activation) -> boolean`.
 */
export function validate_range(squash_type: number, activation: number): boolean;

/**
 * Validate structural integrity of a typed topology.
 *
 * Checks:
 * - No synapse targets an input neuron.
 * - Constant neurons have no inward connections.
 * - Hidden neurons have at least 1 inward and 1 outward connection.
 * - Non-input neuron biases are finite.
 * - IF neurons have at least 3 inward connections with condition,
 *   positive (or standard), and negative synapse types.
 */
export function validate_structural_integrity(from_indices: Uint32Array, to_indices: Uint32Array, is_constant: Uint8Array, squash_types: Uint8Array, biases: Float64Array, num_inputs: number, num_outputs: number, synapse_types: Uint8Array): Int32Array;

/**
 * Validate topology synapse ordering and forward-only constraints.
 *
 * Checks that synapses are sorted (ascending `from`, then ascending `to`
 * within the same `from`), contain no self-connections, and contain no
 * backward connections (`from > to`).
 *
 * # Arguments
 * * `from_indices` - source neuron index per synapse
 * * `to_indices` - destination neuron index per synapse
 *
 * # Returns
 * A two-element vector `[error_code, synapse_index]`.
 */
export function validate_topology(from_indices: Uint32Array, to_indices: Uint32Array): Int32Array;

/**
 * Batch topology validation for multiple creatures.
 *
 * Validates multiple topologies in a single call to amortise WASM boundary
 * crossing. Each topology's `from`/`to` indices are concatenated; the
 * `lengths` array specifies per-topology synapse counts.
 *
 * # Returns
 * `[error_code_0, synapse_index_0, error_code_1, synapse_index_1, ...]`.
 */
export function validate_topology_batch(all_from_indices: Uint32Array, all_to_indices: Uint32Array, lengths: Uint32Array): Int32Array;

/**
 * JS `version() -> string` — returns the `neat-core` Cargo package version.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_compilednetwork_free: (a: number, b: number) => void;
    readonly accumulate_bias_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_bias_batch_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_bias_persistent_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly accumulate_bias_persistent_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly accumulate_weight_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_weight_batch_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly accumulate_weight_persistent_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly accumulate_weight_persistent_8way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly calculate_bias: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly calculate_bias_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
    readonly calculate_error: (a: number, b: number, c: number, d: number) => number;
    readonly calculate_weight: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => number;
    readonly calculate_weight_batch_4way: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly categorical_error_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly compilednetwork_activate: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compilednetwork_activate_and_trace: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compilednetwork_activate_and_trace_batch_4way: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly compilednetwork_activate_into: (a: number, b: number, c: number, d: number, e: number, f: any) => void;
    readonly compilednetwork_activate_view: (a: number, b: number, c: number, d: number) => [number, number];
    readonly compilednetwork_new: (a: number, b: number) => [number, number, number];
    readonly compilednetwork_num_inputs: (a: number) => number;
    readonly compilednetwork_num_neurons: (a: number) => number;
    readonly compilednetwork_num_synapses: (a: number) => number;
    readonly compilednetwork_reset_state: (a: number) => void;
    readonly compilednetwork_to_dot: (a: number, b: number) => [number, number];
    readonly compilednetwork_to_topology_json: (a: number, b: number) => [number, number];
    readonly compute_reverse_topological_order: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly compute_score_components: (a: number, b: number, c: number, d: number) => [number, number];
    readonly cross_entropy_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly derivative: (a: number, b: number) => number;
    readonly detect_cycles: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly distribute_elastic_error: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly free_training_state: () => void;
    readonly fused_error_distribution: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
    readonly get_range: (a: number) => [number, number];
    readonly hinge_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly init_training_state: (a: number, b: number) => void;
    readonly limit_range: (a: number, b: number) => number;
    readonly mae_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mape_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mse_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly msle_sum_batch_packed: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly propagate_topological: (a: number, b: number) => [number, number];
    readonly read_all_neuron_state: () => [number, number];
    readonly read_all_synapse_state: () => [number, number];
    readonly read_neuron_state: (a: number) => [number, number];
    readonly read_synapse_state: (a: number) => [number, number];
    readonly reset_training_state: () => void;
    readonly safe_zone_adjustment: (a: number, b: number, c: number, d: number) => number;
    readonly safe_zone_adjustment_batch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly scan_available_connections: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly scan_max_bias: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly scan_max_weight: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly squash: (a: number, b: number) => number;
    readonly unsquash: (a: number, b: number, c: number) => number;
    readonly validate_range: (a: number, b: number) => number;
    readonly validate_structural_integrity: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number];
    readonly validate_topology: (a: number, b: number, c: number, d: number) => [number, number];
    readonly validate_topology_batch: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
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
