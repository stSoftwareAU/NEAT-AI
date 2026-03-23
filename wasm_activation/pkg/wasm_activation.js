/* @ts-self-types="./wasm_activation.d.ts" */

/**
 * WASM binding wrapper around `neat_core::CompiledNetwork`.
 *
 * This struct holds the pure-Rust network and exposes its methods via
 * `#[wasm_bindgen]` for JavaScript consumption.
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
     * Activate the network with the given input values.
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
     * Activate the network and return outputs + trace data.
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
     * Batch activate 4 records simultaneously and return all outputs + trace data.
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
     * Activate writing directly to a pre-allocated output buffer.
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
     * Create a new compiled network from serialised data.
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
     * Number of input neurons.
     * @returns {number}
     */
    get num_inputs() {
        const ret = wasm.compilednetwork_num_inputs(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of neurons (including input).
     * @returns {number}
     */
    get num_neurons() {
        const ret = wasm.compilednetwork_num_neurons(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of synapses.
     * @returns {number}
     */
    get num_synapses() {
        const ret = wasm.compilednetwork_num_synapses(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Reset non-input activations to 0.0.
     */
    reset_state() {
        wasm.compilednetwork_reset_state(this.__wbg_ptr);
    }
}
if (Symbol.dispose) CompiledNetwork.prototype[Symbol.dispose] = CompiledNetwork.prototype.free;

/**
 * WASM binding wrapper around `neat_core::PredictiveCodingEngine`.
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
     * Compute gradients and return packed result.
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
     * Batch inference for multiple samples.
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
     * Run inference (iterative settling) and return packed results.
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
     * Create a new Predictive Coding engine from serialised data.
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
     * @returns {number}
     */
    get num_inputs() {
        const ret = wasm.predictivecodingengine_num_inputs(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get num_neurons() {
        const ret = wasm.predictivecodingengine_num_neurons(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get num_outputs() {
        const ret = wasm.predictivecodingengine_num_outputs(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) PredictiveCodingEngine.prototype[Symbol.dispose] = PredictiveCodingEngine.prototype.free;

/**
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
 * @param {number} count
 * @param {number} total_adjusted_bias
 * @param {number} current_bias
 * @param {boolean} no_change
 * @param {number} generations
 * @param {number} plank_constant
 * @param {number} learning_rate
 * @param {number} max_bias_adj_scale
 * @param {number} limit_bias_scale
 * @returns {number}
 */
export function calculate_bias(count, total_adjusted_bias, current_bias, no_change, generations, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale) {
    const ret = wasm.calculate_bias(count, total_adjusted_bias, current_bias, no_change, generations, plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale);
    return ret;
}

/**
 * Calculate the error in value-space for backpropagation.
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
 * Batch error calculation for 4 records simultaneously.
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
 * @returns {number}
 */
export function calculate_weight(count, total_positive_activation, total_negative_activation, count_positive, count_negative, total_positive_adjusted_value, total_negative_adjusted_value, current_weight, generations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale) {
    const ret = wasm.calculate_weight(count, total_positive_activation, total_negative_activation, count_positive, count_negative, total_positive_adjusted_value, total_negative_adjusted_value, current_weight, generations, plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale);
    return ret;
}

/**
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
 * Standalone derivative function for testing.
 * @param {number} squash_type
 * @param {number} value
 * @returns {number}
 */
export function derivative(squash_type, value) {
    const ret = wasm.derivative(squash_type, value);
    return ret;
}

/**
 * Batch derivative computation for 4 values simultaneously.
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

export function free_training_state() {
    wasm.free_training_state();
}

/**
 * Fused backward pass error distribution.
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
 * Get the range (low, high) for an activation function.
 * @param {number} squash_type
 * @returns {Float32Array}
 */
export function get_range(squash_type) {
    const ret = wasm.get_range(squash_type);
    return ret;
}

/**
 * @returns {number}
 */
export function get_training_state_num_neurons() {
    const ret = wasm.get_training_state_num_neurons();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function get_training_state_num_synapses() {
    const ret = wasm.get_training_state_num_synapses();
    return ret >>> 0;
}

/**
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
 * @param {number} num_synapses
 * @param {number} num_neurons
 */
export function init_training_state(num_synapses, num_neurons) {
    wasm.init_training_state(num_synapses, num_neurons);
}

/**
 * Clamp a value to the valid range for an activation function.
 * @param {number} squash_type
 * @param {number} value
 * @returns {number}
 */
export function limit_range(squash_type, value) {
    const ret = wasm.limit_range(squash_type, value);
    return ret;
}

/**
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
 * @returns {Float64Array}
 */
export function read_all_neuron_state() {
    const ret = wasm.read_all_neuron_state();
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @returns {Float64Array}
 */
export function read_all_synapse_state() {
    const ret = wasm.read_all_synapse_state();
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
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
 * @param {number} index
 * @returns {Float64Array}
 */
export function read_synapse_state(index) {
    const ret = wasm.read_synapse_state(index);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

export function reset_training_state() {
    wasm.reset_training_state();
}

/**
 * Safe zone adjustment for backpropagation saturation detection.
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
 * Batch safe zone adjustment.
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
 * Standalone squash function for testing.
 * @param {number} squash_type
 * @param {number} value
 * @returns {number}
 */
export function squash(squash_type, value) {
    const ret = wasm.squash(squash_type, value);
    return ret;
}

/**
 * Compute the inverse of the specified activation function.
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
 * Validate that an activation value is within the valid range.
 * @param {number} squash_type
 * @param {number} activation
 * @returns {boolean}
 */
export function validate_range(squash_type, activation) {
    const ret = wasm.validate_range(squash_type, activation);
    return ret !== 0;
}

/**
 * Version information.
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
        __wbg___wbindgen_copy_to_typed_array_d2f20acdab8e0740: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_get_index_03c5ff6f16397dda: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_new_with_length_81c1c31d4432cb9f: function(arg0) {
            const ret = new Float32Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_eae667475c36c4e4: function(arg0) {
            const ret = new Float64Array(arg0 >>> 0);
            return ret;
        },
        __wbg_set_index_a56629feb5ac0ffa: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_index_f66997fc93f75edc: function(arg0, arg1, arg2) {
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

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
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
