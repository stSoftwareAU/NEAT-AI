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
        __wbg___wbindgen_copy_to_typed_array_fc0809a4dec43528: function(arg0, arg1, arg2) {
            new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_get_index_80a69050a46aaf91: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_new_with_length_63f2683cc2521026: function(arg0) {
            const ret = new Float32Array(arg0 >>> 0);
            return ret;
        },
        __wbg_set_index_41955224420ba3c6: function(arg0, arg1, arg2) {
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

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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
