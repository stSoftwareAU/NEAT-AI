/* @ts-self-types="./wasm_activation.d.ts" */

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CompiledNetworkFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_compilednetwork_free(ptr, 0);
    }
    /**
     * Activate the network with the given input values
     * Returns the output values
     * Issue #1175 - Uses typed structs for better cache locality
     * Issue #1177 - Inlines common squash functions to avoid function call overhead
     * @param {Float32Array} input
     * @param {number} num_outputs
     * @returns {Float32Array}
     */
    activate(input, num_outputs) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compilednetwork_activate(this.__wbg_ptr, ptr0, len0, num_outputs);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {Float32Array} input
     * @param {number} num_outputs
     * @returns {Float32Array}
     */
    activate_and_trace(input, num_outputs) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compilednetwork_activate_and_trace(this.__wbg_ptr, ptr0, len0, num_outputs);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {Float32Array} inputs
     * @param {number} input_size
     * @param {number} num_outputs
     * @returns {Float32Array}
     */
    activate_and_trace_batch_4way(inputs, input_size, num_outputs) {
        const ptr0 = passArrayF32ToWasm0(inputs, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compilednetwork_activate_and_trace_batch_4way(this.__wbg_ptr, ptr0, len0, input_size, num_outputs);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {Float32Array} input
     * @param {Float32Array} output
     */
    activate_into(input, output) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = passArrayF32ToWasm0(output, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        wasm.compilednetwork_activate_into(this.__wbg_ptr, ptr0, len0, ptr1, len1, output);
    }
    /**
     * Activate the network and return a zero-copy Float32Array view over WASM memory.
     *
     * IMPORTANT: The returned Float32Array aliases the network's internal activation buffer.
     * It will be overwritten by subsequent activations of the same network instance.
     *
     * This is intended for high-throughput scoring where the caller consumes outputs
     * immediately and does not retain references across calls.
     * @param {Float32Array} input
     * @param {number} num_outputs
     * @returns {Float32Array}
     */
    activate_view(input, num_outputs) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compilednetwork_activate_view(this.__wbg_ptr, ptr0, len0, num_outputs);
        return ret;
    }
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
     * @param {Uint8Array} data
     */
    constructor(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.compilednetwork_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        CompiledNetworkFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get the number of input neurons
     * @returns {number}
     */
    get num_inputs() {
        const ret = wasm.compilednetwork_num_inputs(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the number of neurons in the network
     * @returns {number}
     */
    get num_neurons() {
        const ret = wasm.compilednetwork_num_neurons(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the number of synapses in the network
     * @returns {number}
     */
    get num_synapses() {
        const ret = wasm.compilednetwork_num_synapses(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reset non-input activations to 0.0.
     *
     * This is important for parity with the JS implementation when
     * `feedbackLoop=false` (stateless activation). Without this, the reused
     * activation buffer can leak state between calls, effectively behaving
     * like a feedback loop.
     */
    reset_state() {
        wasm.compilednetwork_reset_state(this.__wbg_ptr);
    }
}
if (Symbol.dispose) CompiledNetwork.prototype[Symbol.dispose] = CompiledNetwork.prototype.free;

/**
 * The Predictive Coding inference engine.
 *
 * Holds the network topology and configuration for running the iterative
 * inference (settling) loop. The engine is constructed once from a creature's
 * topology and can be reused for multiple inference calls.
 */
export class PredictiveCodingEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PredictiveCodingEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_predictivecodingengine_free(ptr, 0);
    }
    /**
     * Computes weight and bias gradients from settled inference state.
     *
     * # Arguments
     * * `latents` - Float32Array of settled latent values (length = num_neurons).
     * * `errors` - Float32Array of prediction errors for non-input neurons.
     * * `learning_rate` - The learning rate for weight updates.
     *
     * # Returns
     * Packed Float32Array:
     * - [0]: num_non_inputs (number of bias deltas)
     * - [1]: num_weight_entries (number of weight delta triples)
     * - [2..2+num_non_inputs): bias deltas
     * - [2+num_non_inputs..]: weight delta triples (neuron_rel_idx, conn_local_idx, delta)
     * @param {Float32Array} latents
     * @param {Float32Array} errors
     * @param {number} learning_rate
     * @returns {Float32Array}
     */
    compute_gradients_wasm(latents, errors, learning_rate) {
        const ptr0 = passArrayF32ToWasm0(latents, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(errors, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.predictivecodingengine_compute_gradients_wasm(this.__wbg_ptr, ptr0, len0, ptr1, len1, learning_rate);
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * Runs inference on a batch of samples.
     *
     * Input format: packed Float32Array [input0..., input1..., ...]
     * Each input has `input_size` elements.
     *
     * Result format: packed with per-record length headers (same as
     * activate_and_trace_batch_4way pattern):
     * - [0..num_samples): per-record lengths
     * - Then each record in infer_wasm format
     * @param {Float32Array} inputs
     * @param {number} input_size
     * @param {number} num_samples
     * @param {Float32Array | null | undefined} targets
     * @param {number} target_size
     * @returns {Float32Array}
     */
    infer_batch_wasm(inputs, input_size, num_samples, targets, target_size) {
        const ptr0 = passArrayF32ToWasm0(inputs, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(targets) ? 0 : passArrayF32ToWasm0(targets, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.predictivecodingengine_infer_batch_wasm(this.__wbg_ptr, ptr0, len0, input_size, num_samples, ptr1, len1, target_size);
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * Runs inference and returns a packed result array.
     *
     * Input format: Float32Array of input values.
     * Optional targets: Float32Array of target values for output neurons.
     *
     * Result format (Float32Array):
     * - [0]: steps_used (as f32)
     * - [1]: final_energy
     * - [2]: converged (1.0 = true, 0.0 = false)
     * - [3]: num_neurons
     * - [4]: num_non_inputs
     * - [5]: energy_history_length
     * - [6..6+num_neurons): latent values
     * - [6+num_neurons..6+num_neurons+num_non_inputs): predictions
     * - [6+num_neurons+num_non_inputs..6+num_neurons+2*num_non_inputs): errors
     * - [remaining]: energy history
     * @param {Float32Array} input
     * @param {Float32Array | null} [targets]
     * @returns {Float32Array}
     */
    infer_wasm(input, targets) {
        const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(targets) ? 0 : passArrayF32ToWasm0(targets, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.predictivecodingengine_infer_wasm(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * Creates a new PredictiveCodingEngine from serialised topology data.
     *
     * Data format (all values little-endian):
     * - u32: num_inputs
     * - u32: num_outputs
     * - u32: num_neurons_total (including inputs)
     * - u32: inference_steps
     * - f32: inference_rate
     * - f32: energy_threshold
     * - For each non-input neuron:
     *   - f32: bias
     *   - u8: squash_type
     *   - u8: is_hidden (1 = hidden, 0 = output)
     *   - u16: num_connections
     *   - For each connection:
     *     - u16: from_index
     *     - f32: weight (as 4 bytes, little-endian)
     * @param {Uint8Array} data
     */
    constructor(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.predictivecodingengine_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        PredictiveCodingEngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get the number of input neurons.
     * @returns {number}
     */
    get num_inputs() {
        const ret = wasm.predictivecodingengine_num_inputs(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the number of neurons in the engine.
     * @returns {number}
     */
    get num_neurons() {
        const ret = wasm.predictivecodingengine_num_neurons(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the number of output neurons.
     * @returns {number}
     */
    get num_outputs() {
        const ret = wasm.predictivecodingengine_num_outputs(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) PredictiveCodingEngine.prototype[Symbol.dispose] = PredictiveCodingEngine.prototype.free;

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
 * @param {Float64Array} target_pre_activations
 * @param {Float64Array} pre_activations
 * @param {Float64Array} current_biases
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_bias_adj_scale
 * @param {number} limit_bias_scale
 * @returns {Float64Array}
 */
export function accumulate_bias_batch_4way(target_pre_activations, pre_activations, current_biases, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale) {
    const ptr0 = passArrayF64ToWasm0(target_pre_activations, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(pre_activations, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(current_biases, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.accumulate_bias_batch_4way(ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * Issue #1518 - Batch bias accumulation for 8 neurons.
 *
 * Same as 4-way but processes 8 neurons. Returns 24 f64 values.
 * @param {Float64Array} target_pre_activations
 * @param {Float64Array} pre_activations
 * @param {Float64Array} current_biases
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_bias_adj_scale
 * @param {number} limit_bias_scale
 * @returns {Float64Array}
 */
export function accumulate_bias_batch_8way(target_pre_activations, pre_activations, current_biases, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale) {
    const ptr0 = passArrayF64ToWasm0(target_pre_activations, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(pre_activations, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(current_biases, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.accumulate_bias_batch_8way(ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

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
 * @param {number} start_index
 * @param {Float64Array} target_pre_activations
 * @param {Float64Array} pre_activations
 * @param {Float64Array} current_biases
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_bias_adj_scale
 * @param {number} limit_bias_scale
 */
export function accumulate_bias_persistent_4way(start_index, target_pre_activations, pre_activations, current_biases, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale) {
    const ptr0 = passArrayF64ToWasm0(target_pre_activations, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(pre_activations, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(current_biases, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    wasm.accumulate_bias_persistent_4way(start_index, ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale);
}

/**
 * Accumulate bias adjustments for 8 neurons into persistent state.
 * @param {number} start_index
 * @param {Float64Array} target_pre_activations
 * @param {Float64Array} pre_activations
 * @param {Float64Array} current_biases
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_bias_adj_scale
 * @param {number} limit_bias_scale
 */
export function accumulate_bias_persistent_8way(start_index, target_pre_activations, pre_activations, current_biases, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale) {
    const ptr0 = passArrayF64ToWasm0(target_pre_activations, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(pre_activations, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(current_biases, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    wasm.accumulate_bias_persistent_8way(start_index, ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale);
}

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
 * @param {Float64Array} current_weights
 * @param {Float64Array} target_values
 * @param {Float64Array} activations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_weight_adj_scale
 * @param {number} limit_weight_scale
 * @returns {Float64Array}
 */
export function accumulate_weight_batch_4way(current_weights, target_values, activations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale) {
    const ptr0 = passArrayF64ToWasm0(current_weights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(target_values, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(activations, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.accumulate_weight_batch_4way(ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * Issue #1518 - Batch weight accumulation for 8 synapses.
 *
 * Same as 4-way but processes 8 synapses. Returns 56 f64 values.
 * @param {Float64Array} current_weights
 * @param {Float64Array} target_values
 * @param {Float64Array} activations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_weight_adj_scale
 * @param {number} limit_weight_scale
 * @returns {Float64Array}
 */
export function accumulate_weight_batch_8way(current_weights, target_values, activations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale) {
    const ptr0 = passArrayF64ToWasm0(current_weights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(target_values, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(activations, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.accumulate_weight_batch_8way(ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

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
 * @param {number} start_index
 * @param {Float64Array} current_weights
 * @param {Float64Array} target_values
 * @param {Float64Array} activations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_weight_adj_scale
 * @param {number} limit_weight_scale
 */
export function accumulate_weight_persistent_4way(start_index, current_weights, target_values, activations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale) {
    const ptr0 = passArrayF64ToWasm0(current_weights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(target_values, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(activations, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    wasm.accumulate_weight_persistent_4way(start_index, ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale);
}

/**
 * Accumulate weight adjustments for 8 synapses into persistent state.
 * @param {number} start_index
 * @param {Float64Array} current_weights
 * @param {Float64Array} target_values
 * @param {Float64Array} activations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_weight_adj_scale
 * @param {number} limit_weight_scale
 */
export function accumulate_weight_persistent_8way(start_index, current_weights, target_values, activations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale) {
    const ptr0 = passArrayF64ToWasm0(current_weights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(target_values, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(activations, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    wasm.accumulate_weight_persistent_8way(start_index, ptr0, len0, ptr1, len1, ptr2, len2, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale);
}

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
 * @param {number} count
 * @param {number} total_adjusted_bias
 * @param {number} current_bias
 * @param {boolean} no_change
 * @param {number} generations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_bias_adj_scale
 * @param {number} limit_bias_scale
 * @param {number} l1_bias_decay
 * @param {number} l2_bias_decay
 * @returns {number}
 */
export function calculate_bias(count, total_adjusted_bias, current_bias, no_change, generations, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale, l1_bias_decay, l2_bias_decay) {
    const ret = wasm.calculate_bias(count, total_adjusted_bias, current_bias, no_change, generations, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale, l1_bias_decay, l2_bias_decay);
    return ret;
}

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
 * @param {Float64Array} packed_state
 * @param {Uint8Array} no_change_flags
 * @param {number} generations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_bias_adj_scale
 * @param {number} limit_bias_scale
 * @param {number} l1_bias_decay
 * @param {number} l2_bias_decay
 * @returns {Float64Array}
 */
export function calculate_bias_batch_4way(packed_state, no_change_flags, generations, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale, l1_bias_decay, l2_bias_decay) {
    const ptr0 = passArrayF64ToWasm0(packed_state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(no_change_flags, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.calculate_bias_batch_4way(ptr0, len0, ptr1, len1, generations, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale, l1_bias_decay, l2_bias_decay);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
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
 * @param {number} squash_type
 * @param {number} current_activation
 * @param {number} target_activation
 * @param {number} current_value
 * @returns {number}
 */
export function calculate_error(squash_type, current_activation, target_activation, current_value) {
    const ret = wasm.calculate_error(squash_type, current_activation, target_activation, current_value);
    return ret;
}

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
 * @param {number} squash_type
 * @param {Float32Array} current_activations
 * @param {Float32Array} target_activations
 * @param {Float32Array} current_values
 * @returns {Float32Array}
 */
export function calculate_error_batch_4way(squash_type, current_activations, target_activations, current_values) {
    const ret = wasm.calculate_error_batch_4way(squash_type, current_activations, target_activations, current_values);
    return ret;
}

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
 * @param {number} count
 * @param {number} total_positive_activation
 * @param {number} total_negative_activation
 * @param {number} count_positive
 * @param {number} count_negative
 * @param {number} total_positive_adjusted_value
 * @param {number} total_negative_adjusted_value
 * @param {number} current_weight
 * @param {number} generations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_weight_adj_scale
 * @param {number} limit_weight_scale
 * @param {number} l1_weight_decay
 * @param {number} l2_weight_decay
 * @returns {number}
 */
export function calculate_weight(count, total_positive_activation, total_negative_activation, count_positive, count_negative, total_positive_adjusted_value, total_negative_adjusted_value, current_weight, generations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale, l1_weight_decay, l2_weight_decay) {
    const ret = wasm.calculate_weight(count, total_positive_activation, total_negative_activation, count_positive, count_negative, total_positive_adjusted_value, total_negative_adjusted_value, current_weight, generations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale, l1_weight_decay, l2_weight_decay);
    return ret;
}

/**
 * Issue #1960 - Batch calculate_weight for 4 synapses in a single WASM call.
 *
 * Amortises boundary crossing overhead by processing 4 weight calculations
 * at once. Each synapse provides 8 state values (count through currentWeight)
 * packed into a single Float64Array, plus shared config scalars.
 *
 * # Arguments
 * * `packed_state` - 32 f64 values: 8 per synapse ×4
 *   Per synapse: [count, totalPosAct, totalNegAct, countPos, countNeg,
 *                 totalPosAdj, totalNegAdj, currentWeight]
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
 * @param {Float64Array} packed_state
 * @param {number} generations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_weight_adj_scale
 * @param {number} limit_weight_scale
 * @param {number} l1_weight_decay
 * @param {number} l2_weight_decay
 * @returns {Float64Array}
 */
export function calculate_weight_batch_4way(packed_state, generations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale, l1_weight_decay, l2_weight_decay) {
    const ptr0 = passArrayF64ToWasm0(packed_state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.calculate_weight_batch_4way(ptr0, len0, generations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale, l1_weight_decay, l2_weight_decay);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * Issue #1959 - Compute reverse topological order for backpropagation.
 *
 * Uses Kahn's algorithm on the forward connection graph. Returns neuron
 * indices ordered with output neurons first, hidden neurons after their
 * downstream consumers. Input and constant neurons are excluded.
 *
 * For recurrent networks with cycles, neurons remaining after the
 * topological sort are appended at the end.
 *
 * # Arguments
 * * `from_indices` - Uint32Array of synapse source indices
 * * `to_indices` - Uint32Array of synapse destination indices
 * * `num_neurons` - Total number of neurons
 * * `num_inputs` - Number of input neurons
 *
 * # Returns
 * Uint32Array of neuron indices in reverse topological order
 * @param {Uint32Array} from_indices
 * @param {Uint32Array} to_indices
 * @param {number} num_neurons
 * @param {number} num_inputs
 * @returns {Uint32Array}
 */
export function compute_reverse_topological_order(from_indices, to_indices, num_neurons, num_inputs) {
    const ptr0 = passArray32ToWasm0(from_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(to_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compute_reverse_topological_order(ptr0, len0, ptr1, len1, num_neurons, num_inputs);
    var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * Batch-compute abs-sum, max, and second-max over weight and bias arrays.
 *
 * Returns a `Float64Array` with 4 elements:
 *   [total_abs, count, max_abs, second_max_abs]
 *
 * The caller provides flat arrays of synapse weights and non-input neuron
 * biases. This replaces the inner loops of `computeAndCacheScoreComponents`
 * in `Score.ts`.
 *
 * # Arguments
 * * `weights` - flat f64 array of synapse weights
 * * `biases` - flat f64 array of non-input neuron biases
 * @param {Float64Array} weights
 * @param {Float64Array} biases
 * @returns {Float64Array}
 */
export function compute_score_components(weights, biases) {
    const ptr0 = passArrayF64ToWasm0(weights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(biases, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compute_score_components(ptr0, len0, ptr1, len1);
    return ret;
}

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
 * @param {CompiledNetwork} network
 * @param {Float32Array} records
 * @param {number} input_size
 * @param {number} num_outputs
 * @param {boolean} forward_only
 * @returns {number}
 */
export function cross_entropy_sum_batch_packed(network, records, input_size, num_outputs, forward_only) {
    _assertClass(network, CompiledNetwork);
    const ptr0 = passArrayF32ToWasm0(records, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cross_entropy_sum_batch_packed(network.__wbg_ptr, ptr0, len0, input_size, num_outputs, forward_only);
    return ret;
}

/**
 * Standalone derivative function for testing
 * Issue #1138 - WASM Migration Phase 6
 * @param {number} squash_type
 * @param {number} value
 * @returns {number}
 */
export function derivative(squash_type, value) {
    const ret = wasm.derivative(squash_type, value);
    return ret;
}

/**
 * Issue #1213 - Batch derivative computation for 4 values simultaneously.
 *
 * Returns a Float32Array with 4 derivative values computed in parallel using SIMD.
 * This provides significant performance improvements during backpropagation.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * * `x0, x1, x2, x3` - The 4 input values to compute derivatives for
 * @param {number} squash_type
 * @param {number} x0
 * @param {number} x1
 * @param {number} x2
 * @param {number} x3
 * @returns {Float32Array}
 */
export function derivative_batch_4way(squash_type, x0, x1, x2, x3) {
    const ret = wasm.derivative_batch_4way(squash_type, x0, x1, x2, x3);
    return ret;
}

/**
 * Issue #1961 — Detect whether the topology contains cycles among non-input neurons.
 *
 * Uses Kahn's algorithm: if after processing all zero-in-degree neurons
 * some non-input neurons remain unprocessed, a cycle exists.
 *
 * Self-loops are explicitly detected as cycles.
 *
 * # Arguments
 * * `from_indices` - Synapse source indices
 * * `to_indices` - Synapse destination indices
 * * `num_neurons` - Total number of neurons
 * * `num_inputs` - Number of input neurons
 *
 * # Returns
 * 0 if acyclic, 1 if cycles detected
 * @param {Uint32Array} from_indices
 * @param {Uint32Array} to_indices
 * @param {number} num_neurons
 * @param {number} num_inputs
 * @returns {number}
 */
export function detect_cycles(from_indices, to_indices, num_neurons, num_inputs) {
    const ptr0 = passArray32ToWasm0(from_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(to_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.detect_cycles(ptr0, len0, ptr1, len1, num_neurons, num_inputs);
    return ret >>> 0;
}

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
 * Vec<f32> of error shares, one per link. Sum equals `error`.
 * @param {number} error
 * @param {Float32Array} activations
 * @param {Float32Array} safe_zone_factors
 * @param {Float32Array} weights
 * @param {number} plank_constant
 * @returns {Float32Array}
 */
export function distribute_elastic_error(error, activations, safe_zone_factors, weights, plank_constant) {
    const ptr0 = passArrayF32ToWasm0(activations, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(safe_zone_factors, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(weights, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.distribute_elastic_error(error, ptr0, len0, ptr1, len1, ptr2, len2, plank_constant);
    var v4 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}

/**
 * Free all training state memory.
 *
 * Call this when training is complete to release WASM linear memory.
 */
export function free_training_state() {
    wasm.free_training_state();
}

/**
 * Issue #1377 - Fused backward pass error distribution.
 *
 * Combines calculateError + safeZoneAdjustment + elastic error distribution
 * into a single WASM call, eliminating S+1 boundary crossings per neuron.
 *
 * # Arguments
 * * `neuron_squash_type` - The SquashType of the neuron being propagated through
 * * `neuron_activation` - The neuron's current output (after squash)
 * * `neuron_target_activation` - The desired output for this neuron
 * * `neuron_hint_value` - The pre-squash value for this neuron
 * * `upstream_squash_types` - Packed u8 array of upstream neuron squash types
 * * `upstream_hint_values` - Float32Array of upstream pre-squash values
 * * `upstream_activations` - Float32Array of upstream neuron activations
 * * `synapse_weights` - Float32Array of inbound synapse weights
 *
 * # Returns
 * Float32Array with layout: [error, safeZone_0..N, perLinkError_0..N]
 * Total length: 1 + 2*N where N is the number of synapses.
 * @param {number} neuron_squash_type
 * @param {number} neuron_activation
 * @param {number} neuron_target_activation
 * @param {number} neuron_hint_value
 * @param {Uint8Array} upstream_squash_types
 * @param {Float32Array} upstream_hint_values
 * @param {Float32Array} upstream_activations
 * @param {Float32Array} synapse_weights
 * @returns {Float32Array}
 */
export function fused_error_distribution(neuron_squash_type, neuron_activation, neuron_target_activation, neuron_hint_value, upstream_squash_types, upstream_hint_values, upstream_activations, synapse_weights) {
    const ptr0 = passArray8ToWasm0(upstream_squash_types, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(upstream_hint_values, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(upstream_activations, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF32ToWasm0(synapse_weights, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.fused_error_distribution(neuron_squash_type, neuron_activation, neuron_target_activation, neuron_hint_value, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    var v5 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v5;
}

/**
 * Get the range (low, high) for an activation function
 * Issue #1142 - WASM Migration Phase 10
 *
 * Returns a Float32Array with two elements: [low, high]
 * representing the valid output range for the activation function.
 *
 * # Arguments
 * * `squash_type` - The SquashType enum value (u8)
 * @param {number} squash_type
 * @returns {Float32Array}
 */
export function get_range(squash_type) {
    const ret = wasm.get_range(squash_type);
    return ret;
}

/**
 * Get the number of neurons in the current training state.
 * @returns {number}
 */
export function get_training_state_num_neurons() {
    const ret = wasm.get_training_state_num_neurons();
    return ret >>> 0;
}

/**
 * Get the number of synapses in the current training state.
 * @returns {number}
 */
export function get_training_state_num_synapses() {
    const ret = wasm.get_training_state_num_synapses();
    return ret >>> 0;
}

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
 * @param {CompiledNetwork} network
 * @param {Float32Array} records
 * @param {number} input_size
 * @param {number} num_outputs
 * @param {boolean} forward_only
 * @returns {number}
 */
export function hinge_sum_batch_packed(network, records, input_size, num_outputs, forward_only) {
    _assertClass(network, CompiledNetwork);
    const ptr0 = passArrayF32ToWasm0(records, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hinge_sum_batch_packed(network.__wbg_ptr, ptr0, len0, input_size, num_outputs, forward_only);
    return ret;
}

/**
 * Initialise persistent training state for an epoch.
 *
 * Allocates and zeroes the synapse and neuron state arrays in WASM linear
 * memory. Call this once at the start of each training epoch.
 *
 * # Arguments
 * * `num_synapses` - Number of synapses in the network
 * * `num_neurons` - Number of neurons in the network
 * @param {number} num_synapses
 * @param {number} num_neurons
 */
export function init_training_state(num_synapses, num_neurons) {
    wasm.init_training_state(num_synapses, num_neurons);
}

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
 * @param {number} squash_type
 * @param {number} value
 * @returns {number}
 */
export function limit_range(squash_type, value) {
    const ret = wasm.limit_range(squash_type, value);
    return ret;
}

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
 * @param {CompiledNetwork} network
 * @param {Float32Array} records
 * @param {number} input_size
 * @param {number} num_outputs
 * @param {boolean} forward_only
 * @returns {number}
 */
export function mae_sum_batch_packed(network, records, input_size, num_outputs, forward_only) {
    _assertClass(network, CompiledNetwork);
    const ptr0 = passArrayF32ToWasm0(records, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.mae_sum_batch_packed(network.__wbg_ptr, ptr0, len0, input_size, num_outputs, forward_only);
    return ret;
}

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
 * @param {CompiledNetwork} network
 * @param {Float32Array} records
 * @param {number} input_size
 * @param {number} num_outputs
 * @param {boolean} forward_only
 * @returns {number}
 */
export function mape_sum_batch_packed(network, records, input_size, num_outputs, forward_only) {
    _assertClass(network, CompiledNetwork);
    const ptr0 = passArrayF32ToWasm0(records, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.mape_sum_batch_packed(network.__wbg_ptr, ptr0, len0, input_size, num_outputs, forward_only);
    return ret;
}

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
 * @param {CompiledNetwork} network
 * @param {Float32Array} records
 * @param {number} input_size
 * @param {number} num_outputs
 * @param {boolean} forward_only
 * @returns {number}
 */
export function mse_sum_batch_packed(network, records, input_size, num_outputs, forward_only) {
    _assertClass(network, CompiledNetwork);
    const ptr0 = passArrayF32ToWasm0(records, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.mse_sum_batch_packed(network.__wbg_ptr, ptr0, len0, input_size, num_outputs, forward_only);
    return ret;
}

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
 * @param {CompiledNetwork} network
 * @param {Float32Array} records
 * @param {number} input_size
 * @param {number} num_outputs
 * @param {boolean} forward_only
 * @returns {number}
 */
export function msle_sum_batch_packed(network, records, input_size, num_outputs, forward_only) {
    _assertClass(network, CompiledNetwork);
    const ptr0 = passArrayF32ToWasm0(records, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.msle_sum_batch_packed(network.__wbg_ptr, ptr0, len0, input_size, num_outputs, forward_only);
    return ret;
}

/**
 * Issue #1954 - Run the full topological backpropagation loop in WASM.
 *
 * This replaces ~N per-neuron WASM calls with a single call that processes
 * all neurons in reverse topological order.
 *
 * # Binary input format (packed into `data`)
 *
 * ```text
 * Header (40 bytes):
 *   u32: neuronCount
 *   u32: inputCount
 *   u32: outputCount
 *   u32: synapseCount
 *   u32: orderLength
 *   u32: totalInwardEntries
 *   f64: plankConstant
 *   u8:  normaliseGradients (0 or 1)
 *   [3 bytes padding]
 *
 * Per neuron (neuronCount × 20 bytes):
 *   u8:  squashType
 *   u8:  neuronType (0=input, 1=hidden, 2=output, 3=constant)
 *   u8:  propagateNeeded (0 or 1)
 *   u8:  updateNeeded (0 or 1)
 *   f32: hintValue
 *   f32: rangeLow
 *   f32: rangeHigh
 *   f32: adjustedActivation
 *   f32: adjustedBias (for non-input neurons)
 *
 * Per synapse (synapseCount × 20 bytes):
 *   u32: from
 *   u32: to
 *   f32: originalWeight
 *   f32: adjustedWeight
 *   u8:  isSelfLoop (0 or 1)
 *   [3 bytes padding]
 *
 * Inward mapping (neuronCount × 8 bytes):
 *   u32: start index into inwardIndices
 *   u32: count of inward connections
 *
 * Inward indices (totalInwardEntries × 4 bytes):
 *   u32[]: synapse indices
 *
 * Reverse topological order (orderLength × 4 bytes):
 *   u32[]: neuron indices
 *
 * Expected outputs (outputCount × 4 bytes):
 *   f32[]: expected values
 * ```
 *
 * # Return format (packed f64 array)
 *
 * ```text
 * Section 1: Per-neuron results (neuronCount × 7 f64s):
 *   f64: totalErrorAbsoluteDelta
 *   f64: cachedActivation (NaN if not set)
 *   f64: noChange (1.0 = true, 0.0 = false)
 *   f64: biasCountDelta
 *   f64: totalBiasDelta
 *   f64: totalAdjustedBiasDelta
 *   f64: traceActivation (NaN if not traced)
 *
 * Section 2: Per-synapse results (synapseCount × 7 f64s):
 *   f64: countDelta
 *   f64: totalPositiveActivation
 *   f64: totalNegativeActivation
 *   f64: countPositiveActivations
 *   f64: countNegativeActivations
 *   f64: totalPositiveAdjustedValue
 *   f64: totalNegativeAdjustedValue
 * ```
 * @param {Uint8Array} data
 * @returns {Float64Array}
 */
export function propagate_topological(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.propagate_topological(ptr0, len0);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * Read all neuron state as a bulk f64 array.
 *
 * Returns the entire neuron state buffer (num_neurons × 3 values).
 * More efficient than calling `read_neuron_state` per neuron.
 * @returns {Float64Array}
 */
export function read_all_neuron_state() {
    const ret = wasm.read_all_neuron_state();
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * Read all synapse state as a bulk f64 array.
 *
 * Returns the entire synapse state buffer (num_synapses × 7 values).
 * More efficient than calling `read_synapse_state` per synapse.
 * @returns {Float64Array}
 */
export function read_all_synapse_state() {
    const ret = wasm.read_all_synapse_state();
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * Read the persistent state for a single neuron.
 *
 * Returns a packed f64 array with 3 values:
 *   [count, totalBias, totalAdjustedBias]
 * @param {number} index
 * @returns {Float64Array}
 */
export function read_neuron_state(index) {
    const ret = wasm.read_neuron_state(index);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * Read the persistent state for a single synapse.
 *
 * Returns a packed f64 array with 7 values:
 *   [count, totalPositiveActivation, totalNegativeActivation,
 *    countPositiveActivations, countNegativeActivations,
 *    totalPositiveAdjustedValue, totalNegativeAdjustedValue]
 * @param {number} index
 * @returns {Float64Array}
 */
export function read_synapse_state(index) {
    const ret = wasm.read_synapse_state(index);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * Reset all training state to zero without deallocating.
 *
 * More efficient than `init_training_state` when the network size
 * hasn't changed — avoids reallocation.
 */
export function reset_training_state() {
    wasm.reset_training_state();
}

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
 * @param {number} squash_type
 * @param {number} raw_input
 * @param {number} error
 * @param {number} weight
 * @returns {number}
 */
export function safe_zone_adjustment(squash_type, raw_input, error, weight) {
    const ret = wasm.safe_zone_adjustment(squash_type, raw_input, error, weight);
    return ret;
}

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
 * @param {Uint8Array} squash_types
 * @param {Float32Array} raw_inputs
 * @param {number} error
 * @param {Float32Array} weights
 * @returns {Float32Array}
 */
export function safe_zone_adjustment_batch(squash_types, raw_inputs, error, weights) {
    const ptr0 = passArray8ToWasm0(squash_types, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(raw_inputs, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF32ToWasm0(weights, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.safe_zone_adjustment_batch(ptr0, len0, ptr1, len1, error, ptr2, len2);
    var v4 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}

/**
 * Issue #1959 - Scan for available forward-only connection slots.
 *
 * Computes all `(from, to)` pairs where `from < to`, `to >= num_inputs`,
 * the target neuron is not constant, and no connection already exists.
 *
 * Uses a flat boolean array for O(1) connection existence checks,
 * which is more cache-friendly than a hash set for WASM linear memory.
 *
 * # Arguments
 * * `from_indices` - Uint32Array of existing synapse source indices
 * * `to_indices` - Uint32Array of existing synapse destination indices
 * * `is_constant` - Uint8Array flag per neuron (1 = constant, 0 = not)
 * * `num_neurons` - Total number of neurons
 * * `num_inputs` - Number of input neurons
 *
 * # Returns
 * Uint32Array of flattened `[from, to, from, to, ...]` pairs
 * @param {Uint32Array} from_indices
 * @param {Uint32Array} to_indices
 * @param {Uint8Array} is_constant
 * @param {number} num_neurons
 * @param {number} num_inputs
 * @returns {Uint32Array}
 */
export function scan_available_connections(from_indices, to_indices, is_constant, num_neurons, num_inputs) {
    const ptr0 = passArray32ToWasm0(from_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(to_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(is_constant, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.scan_available_connections(ptr0, len0, ptr1, len1, ptr2, len2, num_neurons, num_inputs);
    var v4 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}

/**
 * Scan all weights and biases to find the new max and second-max after a
 * bias change. The bias at `exclude_idx` is excluded (it is being
 * replaced); `new_bias` is included instead.
 *
 * Returns a `Float64Array` with 2 elements: [max, second_max].
 *
 * # Arguments
 * * `weights` - flat f64 array of all synapse weights
 * * `biases` - flat f64 array of all non-input neuron biases
 * * `exclude_idx` - index in `biases` to skip (the old bias)
 * * `new_bias` - the replacement bias value
 * @param {Float64Array} weights
 * @param {Float64Array} biases
 * @param {number} exclude_idx
 * @param {number} new_bias
 * @returns {Float64Array}
 */
export function scan_max_bias(weights, biases, exclude_idx, new_bias) {
    const ptr0 = passArrayF64ToWasm0(weights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(biases, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.scan_max_bias(ptr0, len0, ptr1, len1, exclude_idx, new_bias);
    return ret;
}

/**
 * Scan all weights and biases to find the new max and second-max after a
 * weight change. The weight at `exclude_idx` is excluded (it is being
 * replaced); `new_weight` is included instead.
 *
 * Returns a `Float64Array` with 2 elements: [max, second_max].
 *
 * # Arguments
 * * `weights` - flat f64 array of all synapse weights
 * * `biases` - flat f64 array of all non-input neuron biases
 * * `exclude_idx` - index in `weights` to skip (the old weight)
 * * `new_weight` - the replacement weight value
 * @param {Float64Array} weights
 * @param {Float64Array} biases
 * @param {number} exclude_idx
 * @param {number} new_weight
 * @returns {Float64Array}
 */
export function scan_max_weight(weights, biases, exclude_idx, new_weight) {
    const ptr0 = passArrayF64ToWasm0(weights, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(biases, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.scan_max_weight(ptr0, len0, ptr1, len1, exclude_idx, new_weight);
    return ret;
}

/**
 * Standalone squash function for testing
 * @param {number} squash_type
 * @param {number} value
 * @returns {number}
 */
export function squash(squash_type, value) {
    const ret = wasm.squash(squash_type, value);
    return ret;
}

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
 * @param {number} squash_type
 * @param {number} activation
 * @param {number} hint
 * @returns {number}
 */
export function unsquash(squash_type, activation, hint) {
    const ret = wasm.unsquash(squash_type, activation, hint);
    return ret;
}

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
 * @param {number} squash_type
 * @param {number} activation
 * @returns {boolean}
 */
export function validate_range(squash_type, activation) {
    const ret = wasm.validate_range(squash_type, activation);
    return ret !== 0;
}

/**
 * Issue #1961 — Validate structural integrity of a typed topology.
 *
 * Checks:
 * - No synapse targets an input neuron
 * - Constant neurons have no inward connections
 * - Hidden neurons have at least 1 inward and 1 outward connection
 * - Non-input neuron biases are finite
 * - IF neurons have at least 3 inward connections with
 *   condition, positive (or standard), and negative synapse types
 *
 * # Arguments
 * * `from_indices` - Synapse source indices
 * * `to_indices` - Synapse destination indices
 * * `is_constant` - Per-neuron constant flag (1 = constant)
 * * `squash_types` - Per-neuron squash type code
 * * `biases` - Per-neuron bias values (f64)
 * * `num_inputs` - Number of input neurons
 * * `num_outputs` - Number of output neurons
 * * `synapse_types` - Per-synapse type code (condition/positive/negative/standard)
 *
 * # Returns
 * Int32Array of length 2: `[error_code, neuron_or_synapse_index]`
 * @param {Uint32Array} from_indices
 * @param {Uint32Array} to_indices
 * @param {Uint8Array} is_constant
 * @param {Uint8Array} squash_types
 * @param {Float64Array} biases
 * @param {number} num_inputs
 * @param {number} num_outputs
 * @param {Uint8Array} synapse_types
 * @returns {Int32Array}
 */
export function validate_structural_integrity(from_indices, to_indices, is_constant, squash_types, biases, num_inputs, num_outputs, synapse_types) {
    const ptr0 = passArray32ToWasm0(from_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(to_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(is_constant, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(squash_types, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArrayF64ToWasm0(biases, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArray8ToWasm0(synapse_types, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    const ret = wasm.validate_structural_integrity(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, num_inputs, num_outputs, ptr5, len5);
    var v7 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v7;
}

/**
 * Issue #1959 - Validate topology synapse ordering and forward-only constraints.
 *
 * Checks that synapses are sorted (ascending from, then ascending to within
 * the same from), contain no self-connections, and contain no backward
 * connections (from > to).
 *
 * Operates directly on typed arrays from TypedTopology without custom
 * binary serialisation — wasm-bindgen passes the arrays as slices.
 *
 * # Arguments
 * * `from_indices` - Uint32Array of source neuron indices per synapse
 * * `to_indices` - Uint32Array of destination neuron indices per synapse
 *
 * # Returns
 * Int32Array of length 2: `[error_code, synapse_index]`
 * - error_code 0 = valid topology
 * - error_code 1 = self-connection at synapse_index
 * - error_code 2 = backward connection at synapse_index
 * - error_code 3 = from indices not sorted at synapse_index
 * - error_code 4 = to indices not sorted within same from at synapse_index
 * - error_code 5 = duplicate connection at synapse_index
 * @param {Uint32Array} from_indices
 * @param {Uint32Array} to_indices
 * @returns {Int32Array}
 */
export function validate_topology(from_indices, to_indices) {
    const ptr0 = passArray32ToWasm0(from_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(to_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.validate_topology(ptr0, len0, ptr1, len1);
    var v3 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * Issue #1960 - Batch topology validation for multiple creatures.
 *
 * Validates multiple topologies in a single WASM call to amortise boundary
 * crossing overhead. Each topology's from/to indices are concatenated, with
 * a lengths array specifying where each topology's data ends.
 *
 * # Arguments
 * * `all_from_indices` - Concatenated from indices for all topologies
 * * `all_to_indices` - Concatenated to indices for all topologies
 * * `lengths` - Number of synapses per topology (used to split the arrays)
 *
 * # Returns
 * Int32Array of length 2×N (N = number of topologies):
 *   `[error_code_0, synapse_index_0, error_code_1, synapse_index_1, ...]`
 * @param {Uint32Array} all_from_indices
 * @param {Uint32Array} all_to_indices
 * @param {Uint32Array} lengths
 * @returns {Int32Array}
 */
export function validate_topology_batch(all_from_indices, all_to_indices, lengths) {
    const ptr0 = passArray32ToWasm0(all_from_indices, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(all_to_indices, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray32ToWasm0(lengths, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.validate_topology_batch(ptr0, len0, ptr1, len1, ptr2, len2);
    var v4 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}

/**
 * Version information
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_copy_to_typed_array_2f7503a7f71d6632: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_5549492daedad139: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_get_index_91aa96adddf17439: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_new_with_length_3301eabff12dda6d: function(arg0) {
            const ret = new Float32Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_4295fc6d4f8fdbb6: function(arg0) {
            const ret = new Float64Array(arg0 >>> 0);
            return ret;
        },
        __wbg_set_index_798d032904959949: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_index_aba8326dc4ba779d: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(F32)) -> NamedExternref("Float32Array")`.
            const ret = getArrayF32FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./wasm_activation_bg.js": import0,
    };
}

const CompiledNetworkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_compilednetwork_free(ptr >>> 0, 1));
const PredictiveCodingEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_predictivecodingengine_free(ptr >>> 0, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('wasm_activation_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
