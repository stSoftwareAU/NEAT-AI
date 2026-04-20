/* @ts-self-types="./wasm_activation.d.ts" */

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
 * @returns {boolean}
 */
export function core_wasm_wrapper_ready() {
    const ret = wasm.core_wasm_wrapper_ready();
    return ret !== 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
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

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
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

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
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
