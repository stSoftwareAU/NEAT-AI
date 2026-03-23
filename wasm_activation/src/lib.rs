//! WASM Activation Module for NEAT-AI
//!
//! This module provides WebAssembly bindings for neural network activation
//! functions in the NEAT-AI project. All core computation is delegated to
//! the `neat-core` crate; this crate provides only `#[wasm_bindgen]` bindings
//! for JavaScript interoperability.
//!
//! Issue #1964 - Extracted shared library crate, this crate is now a thin
//! WASM binding layer over `neat-core`.

use js_sys::Float32Array;
use wasm_bindgen::prelude::*;

// Re-export core types so downstream WASM consumers see them
pub use neat_core::SquashType;
pub use neat_core::SynapseType;

// ---------------------------------------------------------------------------
// CompiledNetwork wrapper
// ---------------------------------------------------------------------------

/// WASM binding wrapper around `neat_core::CompiledNetwork`.
///
/// This struct holds the pure-Rust network and exposes its methods via
/// `#[wasm_bindgen]` for JavaScript consumption.
#[wasm_bindgen]
pub struct CompiledNetwork {
    inner: neat_core::CompiledNetwork,
}

#[wasm_bindgen]
impl CompiledNetwork {
    /// Create a new compiled network from serialised data.
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<CompiledNetwork, JsValue> {
        neat_core::CompiledNetwork::new(data)
            .map(|inner| CompiledNetwork { inner })
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Reset non-input activations to 0.0.
    #[wasm_bindgen]
    pub fn reset_state(&mut self) {
        self.inner.reset_state();
    }

    /// Activate the network with the given input values.
    #[wasm_bindgen]
    pub fn activate(&mut self, input: &[f32], num_outputs: usize) -> Vec<f32> {
        self.inner.activate(input, num_outputs)
    }

    /// Activate the network and return a zero-copy Float32Array view over WASM memory.
    ///
    /// IMPORTANT: The returned Float32Array aliases the network's internal activation buffer.
    /// It will be overwritten by subsequent activations of the same network instance.
    #[wasm_bindgen]
    pub fn activate_view(&mut self, input: &[f32], num_outputs: usize) -> Float32Array {
        let _ = self.inner.activate(input, num_outputs);
        let output_start = self.inner.num_neurons - num_outputs;
        let output_slice = &self.inner.activations[output_start..];
        // SAFETY: `output_slice` points into inner.activations, which is stable and
        // not reallocated after construction. JS must not hold the view across calls.
        unsafe { Float32Array::view(output_slice) }
    }

    /// Activate writing directly to a pre-allocated output buffer.
    #[wasm_bindgen]
    pub fn activate_into(&mut self, input: &[f32], output: &mut [f32]) {
        self.inner.activate_into(input, output);
    }

    /// Number of neurons (including input).
    #[wasm_bindgen(getter)]
    pub fn num_neurons(&self) -> usize {
        self.inner.num_neurons
    }

    /// Number of input neurons.
    #[wasm_bindgen(getter)]
    pub fn num_inputs(&self) -> usize {
        self.inner.num_inputs
    }

    /// Number of synapses.
    #[wasm_bindgen(getter)]
    pub fn num_synapses(&self) -> usize {
        self.inner.synapses.len()
    }

    /// Activate the network and return outputs + trace data.
    #[wasm_bindgen]
    pub fn activate_and_trace(
        &mut self,
        input: &[f32],
        num_outputs: usize,
    ) -> Vec<f32> {
        self.inner.activate_and_trace(input, num_outputs)
    }

    /// Batch activate 4 records simultaneously and return all outputs + trace data.
    #[wasm_bindgen]
    pub fn activate_and_trace_batch_4way(
        &self,
        inputs: &[f32],
        input_size: usize,
        num_outputs: usize,
    ) -> Vec<f32> {
        self.inner
            .activate_and_trace_batch_4way(inputs, input_size, num_outputs)
    }
}

// ---------------------------------------------------------------------------
// PredictiveCodingEngine wrapper
// ---------------------------------------------------------------------------

/// WASM binding wrapper around `neat_core::PredictiveCodingEngine`.
#[wasm_bindgen]
pub struct PredictiveCodingEngine {
    inner: neat_core::PredictiveCodingEngine,
}

#[wasm_bindgen]
impl PredictiveCodingEngine {
    /// Create a new Predictive Coding engine from serialised data.
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<PredictiveCodingEngine, JsValue> {
        neat_core::PredictiveCodingEngine::new(data)
            .map(|inner| PredictiveCodingEngine { inner })
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Run inference (iterative settling) and return packed results.
    #[wasm_bindgen]
    pub fn infer_wasm(
        &self,
        input: &[f32],
        targets: Option<Vec<f32>>,
    ) -> Vec<f32> {
        self.inner.infer_wasm(input, targets)
    }

    /// Batch inference for multiple samples.
    #[wasm_bindgen]
    pub fn infer_batch_wasm(
        &self,
        inputs: &[f32],
        input_size: usize,
        num_samples: usize,
        targets: Option<Vec<f32>>,
        target_size: usize,
    ) -> Vec<f32> {
        self.inner
            .infer_batch_wasm(inputs, input_size, num_samples, targets, target_size)
    }

    /// Compute gradients and return packed result.
    #[wasm_bindgen]
    pub fn compute_gradients_wasm(
        &self,
        latents: &[f32],
        errors: &[f32],
        learning_rate: f32,
    ) -> Vec<f32> {
        self.inner
            .compute_gradients_wasm(latents, errors, learning_rate)
    }

    #[wasm_bindgen(getter)]
    pub fn num_neurons(&self) -> usize {
        self.inner.num_neurons
    }

    #[wasm_bindgen(getter)]
    pub fn num_inputs(&self) -> usize {
        self.inner.num_inputs
    }

    #[wasm_bindgen(getter)]
    pub fn num_outputs(&self) -> usize {
        self.inner.num_outputs
    }
}

// ---------------------------------------------------------------------------
// Standalone functions — thin wrappers over neat-core
// ---------------------------------------------------------------------------

/// Standalone squash function for testing.
#[wasm_bindgen]
pub fn squash(squash_type: u8, value: f32) -> f32 {
    neat_core::apply_squash(SquashType::from(squash_type), value)
}

/// Standalone derivative function for testing.
#[wasm_bindgen]
pub fn derivative(squash_type: u8, value: f32) -> f32 {
    neat_core::apply_derivative(SquashType::from(squash_type), value)
}

/// Compute the inverse of the specified activation function.
#[wasm_bindgen]
pub fn unsquash(squash_type: u8, activation: f32, hint: f32) -> f32 {
    neat_core::apply_unsquash(SquashType::from(squash_type), activation, hint)
}

/// Safe zone adjustment for backpropagation saturation detection.
#[wasm_bindgen]
pub fn safe_zone_adjustment(squash_type: u8, raw_input: f32, error: f32, weight: f32) -> f32 {
    let safe_weight = if weight.is_finite() { weight } else { 1.0 };
    neat_core::apply_safe_zone_adjustment(
        SquashType::from(squash_type),
        raw_input,
        error,
        safe_weight,
    )
}

/// Batch safe zone adjustment.
#[wasm_bindgen]
pub fn safe_zone_adjustment_batch(
    squash_types: &[u8],
    raw_inputs: &[f32],
    error: f32,
    weights: &[f32],
) -> Vec<f32> {
    neat_core::apply_safe_zone_adjustment_batch(squash_types, raw_inputs, error, weights)
}

/// Fused backward pass error distribution.
#[wasm_bindgen]
pub fn fused_error_distribution(
    neuron_squash_type: u8,
    neuron_activation: f32,
    neuron_target_activation: f32,
    neuron_hint_value: f32,
    upstream_squash_types: &[u8],
    upstream_hint_values: &[f32],
    upstream_activations: &[f32],
    synapse_weights: &[f32],
) -> Vec<f32> {
    neat_core::apply_fused_error_distribution(
        SquashType::from(neuron_squash_type),
        neuron_activation,
        neuron_target_activation,
        neuron_hint_value,
        upstream_squash_types,
        upstream_hint_values,
        upstream_activations,
        synapse_weights,
    )
}

/// Calculate the error in value-space for backpropagation.
#[wasm_bindgen]
pub fn calculate_error(
    squash_type: u8,
    current_activation: f32,
    target_activation: f32,
    current_value: f32,
) -> f32 {
    neat_core::apply_calculate_error(
        SquashType::from(squash_type),
        current_activation,
        target_activation,
        current_value,
    )
}

/// Get the range (low, high) for an activation function.
#[wasm_bindgen]
pub fn get_range(squash_type: u8) -> js_sys::Float32Array {
    let (low, high) = neat_core::apply_get_range(SquashType::from(squash_type));
    let result = js_sys::Float32Array::new_with_length(2);
    result.set_index(0, low);
    result.set_index(1, high);
    result
}

/// Validate that an activation value is within the valid range.
#[wasm_bindgen]
pub fn validate_range(squash_type: u8, activation: f32) -> bool {
    neat_core::apply_validate_range(SquashType::from(squash_type), activation)
}

/// Clamp a value to the valid range for an activation function.
#[wasm_bindgen]
pub fn limit_range(squash_type: u8, value: f32) -> f32 {
    neat_core::apply_limit_range(SquashType::from(squash_type), value)
}

/// Batch derivative computation for 4 values simultaneously.
#[wasm_bindgen]
pub fn derivative_batch_4way(
    squash_type: u8,
    x0: f32,
    x1: f32,
    x2: f32,
    x3: f32,
) -> js_sys::Float32Array {
    let (d0, d1, d2, d3) =
        neat_core::apply_derivative_simd_4way(SquashType::from(squash_type), x0, x1, x2, x3);
    let result = js_sys::Float32Array::new_with_length(4);
    result.set_index(0, d0);
    result.set_index(1, d1);
    result.set_index(2, d2);
    result.set_index(3, d3);
    result
}

/// Batch error calculation for 4 records simultaneously.
#[wasm_bindgen]
pub fn calculate_error_batch_4way(
    squash_type: u8,
    current_activations: &js_sys::Float32Array,
    target_activations: &js_sys::Float32Array,
    current_values: &js_sys::Float32Array,
) -> js_sys::Float32Array {
    let curr_acts: [f32; 4] = [
        current_activations.get_index(0),
        current_activations.get_index(1),
        current_activations.get_index(2),
        current_activations.get_index(3),
    ];
    let tgt_acts: [f32; 4] = [
        target_activations.get_index(0),
        target_activations.get_index(1),
        target_activations.get_index(2),
        target_activations.get_index(3),
    ];
    let curr_vals: [f32; 4] = [
        current_values.get_index(0),
        current_values.get_index(1),
        current_values.get_index(2),
        current_values.get_index(3),
    ];

    let (e0, e1, e2, e3) = neat_core::apply_calculate_error_batch_4way(
        SquashType::from(squash_type),
        &curr_acts,
        &tgt_acts,
        &curr_vals,
    );

    let result = js_sys::Float32Array::new_with_length(4);
    result.set_index(0, e0);
    result.set_index(1, e1);
    result.set_index(2, e2);
    result.set_index(3, e3);
    result
}

/// Version information.
#[wasm_bindgen]
pub fn version() -> String {
    "0.1.0".to_string()
}

// ---------------------------------------------------------------------------
// Accumulation functions
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn accumulate_weight_batch_4way(
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) -> Vec<f64> {
    neat_core::accumulate_weight_batch_4way(
        current_weights,
        target_values,
        activations,
        plank_constant,
        learning_rate,
        max_weight_adj_scale,
        limit_weight_scale,
    )
}

#[wasm_bindgen]
pub fn accumulate_weight_batch_8way(
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) -> Vec<f64> {
    neat_core::accumulate_weight_batch_8way(
        current_weights,
        target_values,
        activations,
        plank_constant,
        learning_rate,
        max_weight_adj_scale,
        limit_weight_scale,
    )
}

#[wasm_bindgen]
pub fn accumulate_bias_batch_4way(
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) -> Vec<f64> {
    neat_core::accumulate_bias_batch_4way(
        target_pre_activations,
        pre_activations,
        current_biases,
        plank_constant,
        learning_rate,
        max_bias_adj_scale,
        limit_bias_scale,
    )
}

#[wasm_bindgen]
pub fn accumulate_bias_batch_8way(
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) -> Vec<f64> {
    neat_core::accumulate_bias_batch_8way(
        target_pre_activations,
        pre_activations,
        current_biases,
        plank_constant,
        learning_rate,
        max_bias_adj_scale,
        limit_bias_scale,
    )
}

#[wasm_bindgen]
pub fn calculate_weight(
    count: f64,
    total_positive_activation: f64,
    total_negative_activation: f64,
    count_positive: f64,
    count_negative: f64,
    total_positive_adjusted_value: f64,
    total_negative_adjusted_value: f64,
    current_weight: f64,
    generations: f64,
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) -> f64 {
    neat_core::calculate_weight(
        count,
        total_positive_activation,
        total_negative_activation,
        count_positive,
        count_negative,
        total_positive_adjusted_value,
        total_negative_adjusted_value,
        current_weight,
        generations,
        plank_constant,
        learning_rate,
        max_weight_adj_scale,
        limit_weight_scale,
    )
}

#[wasm_bindgen]
pub fn calculate_bias(
    count: f64,
    total_adjusted_bias: f64,
    current_bias: f64,
    no_change: bool,
    generations: f64,
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) -> f64 {
    neat_core::calculate_bias(
        count,
        total_adjusted_bias,
        current_bias,
        no_change,
        generations,
        plank_constant,
        learning_rate,
        max_bias_adj_scale,
        limit_bias_scale,
    )
}

// ---------------------------------------------------------------------------
// Elastic distribution
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn distribute_elastic_error(
    error: f32,
    activations: &[f32],
    safe_zone_factors: &[f32],
    weights: &[f32],
    plank_constant: f32,
) -> Vec<f32> {
    neat_core::distribute_elastic_error(error, activations, safe_zone_factors, weights, plank_constant)
}

// ---------------------------------------------------------------------------
// Loss functions
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn mse_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    neat_core::mse_sum_batch_packed(&mut network.inner, records, input_size, num_outputs, forward_only)
}

#[wasm_bindgen]
pub fn mae_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    neat_core::mae_sum_batch_packed(&mut network.inner, records, input_size, num_outputs, forward_only)
}

#[wasm_bindgen]
pub fn cross_entropy_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    neat_core::cross_entropy_sum_batch_packed(
        &mut network.inner,
        records,
        input_size,
        num_outputs,
        forward_only,
    )
}

#[wasm_bindgen]
pub fn mape_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    neat_core::mape_sum_batch_packed(&mut network.inner, records, input_size, num_outputs, forward_only)
}

#[wasm_bindgen]
pub fn msle_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    neat_core::msle_sum_batch_packed(&mut network.inner, records, input_size, num_outputs, forward_only)
}

#[wasm_bindgen]
pub fn hinge_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    neat_core::hinge_sum_batch_packed(&mut network.inner, records, input_size, num_outputs, forward_only)
}

// ---------------------------------------------------------------------------
// Score scan functions
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn compute_score_components(weights: &[f64], biases: &[f64]) -> js_sys::Float64Array {
    let (max_weight, max_weight_idx, max_bias, total_weight) =
        neat_core::compute_score_components(weights, biases);
    let result = js_sys::Float64Array::new_with_length(4);
    result.set_index(0, max_weight);
    result.set_index(1, max_weight_idx as f64);
    result.set_index(2, max_bias);
    result.set_index(3, total_weight);
    result
}

#[wasm_bindgen]
pub fn scan_max_weight(
    weights: &[f64],
    biases: &[f64],
    exclude_idx: usize,
    new_weight: f64,
) -> js_sys::Float64Array {
    let (max_weight, total_weight) =
        neat_core::scan_max_weight(weights, biases, exclude_idx, new_weight);
    let result = js_sys::Float64Array::new_with_length(2);
    result.set_index(0, max_weight);
    result.set_index(1, total_weight);
    result
}

#[wasm_bindgen]
pub fn scan_max_bias(
    weights: &[f64],
    biases: &[f64],
    exclude_idx: usize,
    new_bias: f64,
) -> js_sys::Float64Array {
    let (max_bias, total_weight) =
        neat_core::scan_max_bias(weights, biases, exclude_idx, new_bias);
    let result = js_sys::Float64Array::new_with_length(2);
    result.set_index(0, max_bias);
    result.set_index(1, total_weight);
    result
}

// ---------------------------------------------------------------------------
// Training state functions
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn init_training_state(num_synapses: usize, num_neurons: usize) {
    neat_core::init_training_state(num_synapses, num_neurons);
}

#[wasm_bindgen]
pub fn reset_training_state() {
    neat_core::reset_training_state();
}

#[wasm_bindgen]
pub fn free_training_state() {
    neat_core::free_training_state();
}

#[wasm_bindgen]
pub fn read_synapse_state(index: usize) -> Vec<f64> {
    neat_core::read_synapse_state(index)
}

#[wasm_bindgen]
pub fn read_neuron_state(index: usize) -> Vec<f64> {
    neat_core::read_neuron_state(index)
}

#[wasm_bindgen]
pub fn read_all_synapse_state() -> Vec<f64> {
    neat_core::read_all_synapse_state()
}

#[wasm_bindgen]
pub fn read_all_neuron_state() -> Vec<f64> {
    neat_core::read_all_neuron_state()
}

#[wasm_bindgen]
pub fn accumulate_weight_persistent_4way(
    start_index: usize,
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) {
    neat_core::accumulate_weight_persistent_4way(
        start_index,
        current_weights,
        target_values,
        activations,
        plank_constant,
        learning_rate,
        max_weight_adj_scale,
        limit_weight_scale,
    );
}

#[wasm_bindgen]
pub fn accumulate_weight_persistent_8way(
    start_index: usize,
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) {
    neat_core::accumulate_weight_persistent_8way(
        start_index,
        current_weights,
        target_values,
        activations,
        plank_constant,
        learning_rate,
        max_weight_adj_scale,
        limit_weight_scale,
    );
}

#[wasm_bindgen]
pub fn accumulate_bias_persistent_4way(
    start_index: usize,
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) {
    neat_core::accumulate_bias_persistent_4way(
        start_index,
        target_pre_activations,
        pre_activations,
        current_biases,
        plank_constant,
        learning_rate,
        max_bias_adj_scale,
        limit_bias_scale,
    );
}

#[wasm_bindgen]
pub fn accumulate_bias_persistent_8way(
    start_index: usize,
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) {
    neat_core::accumulate_bias_persistent_8way(
        start_index,
        target_pre_activations,
        pre_activations,
        current_biases,
        plank_constant,
        learning_rate,
        max_bias_adj_scale,
        limit_bias_scale,
    );
}

#[wasm_bindgen]
pub fn get_training_state_num_synapses() -> usize {
    neat_core::get_training_state_num_synapses()
}

#[wasm_bindgen]
pub fn get_training_state_num_neurons() -> usize {
    neat_core::get_training_state_num_neurons()
}
