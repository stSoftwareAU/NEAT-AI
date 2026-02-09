//! Compiled neural network data structures and activation.
//!
//! This module provides the CompiledNetwork struct which represents a neural network
//! compiled for efficient activation in WASM. Issue #1116, #1121, #1125, #1173, #1175, #1177.

use js_sys::Float32Array;
use wasm_bindgen::prelude::*;

use crate::range::apply_limit_range;
use crate::simd::{
    weighted_sum_no_bias_simd, weighted_sum_of_squares_simd, weighted_sum_of_squares_v2_simd,
    weighted_sum_simd, weighted_sum_simd_4records,
};
use crate::squash::{apply_squash, SquashType};
use crate::synapse_type::SynapseType;

/// Neuron data structure for cache-efficient access
/// Issue #1175 - Use typed structs instead of tuples for neuron/synapse data
#[derive(Clone, Copy)]
#[repr(C)]
pub struct NeuronData {
    /// Bias value for the neuron
    pub bias: f32,
    /// Starting index in the synapses array
    pub start_synapse: u32,
    /// Number of synapses for this neuron
    pub num_synapses: u16,
    /// Squash function type
    pub squash_type: u8,
    /// Whether this is a constant neuron
    pub is_constant: bool,
}

/// Synapse data structure for cache-efficient access
/// Issue #1175 - Use typed structs instead of tuples for neuron/synapse data
#[derive(Clone, Copy)]
#[repr(C)]
pub struct SynapseData {
    /// Weight of the synapse
    pub weight: f32,
    /// Index of the source neuron
    pub from_index: u32,
    /// Synapse type (for IF activation)
    pub synapse_type: u8,
    /// Padding for alignment
    pub _padding: [u8; 3],
}

/// Compiled network data structure
///
/// Format (Issue #1125 - updated to support aggregate functions):
/// - Header: [num_neurons: u32, num_inputs: u32]
/// - Neuron data: For each neuron after inputs:
///   - [bias: f64, squash_type: u8, is_constant: u8, num_synapses: u16]
///   - Connections: [from_index: u16, synapse_type: u8, padding: u8, weight: f64] * num_connections
///
/// Synapse types (for IF activation):
///   - 0: Standard/Positive (used in weighted sum or as positive branch for IF)
///   - 1: Condition (for IF: summed to determine branch)
///   - 2: Negative (for IF: used when condition <= 0)
///   - 3: Positive (explicit, same as Standard for IF)
///
/// This compact format minimises memory access and enables efficient iteration.
/// Issue #1175 - Uses typed structs for better cache locality and compiler optimisation.
#[wasm_bindgen]
pub struct CompiledNetwork {
    /// Total number of neurons (including input)
    pub(crate) num_neurons: usize,
    /// Number of input neurons
    pub(crate) num_inputs: usize,
    /// Neuron metadata using typed struct for cache efficiency
    pub(crate) neurons: Vec<NeuronData>,
    /// Synapse data using typed struct for cache efficiency
    pub(crate) synapses: Vec<SynapseData>,
    /// Activation buffer - reused across calls
    pub(crate) activations: Vec<f32>,
    /// Pre-allocated buffer for hint values in activate_and_trace
    /// Issue #1173 - Pre-allocate Vec<f32> buffers in CompiledNetwork struct
    pub(crate) hint_values_buffer: Vec<f32>,
    /// Pre-allocated buffer for trace data in activate_and_trace
    /// Issue #1173 - Eliminates heap allocation per call
    pub(crate) trace_data_buffer: Vec<f32>,
}

#[wasm_bindgen]
impl CompiledNetwork {
    /// Reset non-input activations to 0.0.
    ///
    /// This is important for parity with the JS implementation when
    /// `feedbackLoop=false` (stateless activation). Without this, the reused
    /// activation buffer can leak state between calls, effectively behaving
    /// like a feedback loop.
    #[wasm_bindgen]
    pub fn reset_state(&mut self) {
        for i in self.num_inputs..self.num_neurons {
            self.activations[i] = 0.0;
        }
    }

    /// Create a new compiled network from serialised data
    ///
    /// Data format (all values little-endian):
    /// - u32: num_neurons
    /// - u32: num_inputs
    /// - For each non-input neuron:
    ///   - f32: bias
    ///   - u8: squash_type
    ///   - u8: is_constant (0 or 1)
    ///   - u16: num_synapses
    ///   - For each synapse:
    ///     - u16: from_index
    ///     - u8: synapse_type
    ///     - u8: padding
    ///     - f64: weight
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<CompiledNetwork, JsValue> {
        if data.len() < 8 {
            return Err(JsValue::from_str("Data too short for header"));
        }

        let num_neurons = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let num_inputs = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let num_non_inputs = num_neurons - num_inputs;

        let mut neurons = Vec::with_capacity(num_non_inputs);
        let mut synapses = Vec::new();
        let mut offset = 8;

        for _ in num_inputs..num_neurons {
            // Neuron header is 12 bytes with f64 bias.
            if offset + 12 > data.len() {
                return Err(JsValue::from_str("Data too short for neuron"));
            }

            let bias = f64::from_le_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
                data[offset + 4],
                data[offset + 5],
                data[offset + 6],
                data[offset + 7],
            ]);
            let squash_type = data[offset + 8];
            let is_constant = data[offset + 9] != 0;
            let num_synapse = u16::from_le_bytes([data[offset + 10], data[offset + 11]]);
            offset += 12;

            let start_synapse_idx = synapses.len() as u32;

            for _ in 0..num_synapse {
                // Synapse record is 12 bytes with f64 weight.
                if offset + 12 > data.len() {
                    return Err(JsValue::from_str("Data too short for synapse"));
                }

                let from_index = u16::from_le_bytes([data[offset], data[offset + 1]]) as u32;
                let synapse_type = data[offset + 2];
                // offset + 3 is padding
                let weight = f64::from_le_bytes([
                    data[offset + 4],
                    data[offset + 5],
                    data[offset + 6],
                    data[offset + 7],
                    data[offset + 8],
                    data[offset + 9],
                    data[offset + 10],
                    data[offset + 11],
                ]);
                offset += 12;

                synapses.push(SynapseData {
                    weight: weight as f32,
                    from_index,
                    synapse_type,
                    _padding: [0; 3],
                });
            }

            neurons.push(NeuronData {
                bias: bias as f32,
                start_synapse: start_synapse_idx,
                num_synapses: num_synapse,
                squash_type,
                is_constant,
            });
        }

        // Issue #1173 - Pre-allocate trace data buffer with estimated capacity
        // Estimate ~10% of neurons have aggregate functions (MINIMUM, MAXIMUM, IF)
        // Each aggregate records 2 floats (neuron_idx, trace_info), plus -1.0 terminator
        let estimated_trace_size = (num_non_inputs / 10).max(1) * 2 + 1;

        Ok(CompiledNetwork {
            num_neurons,
            num_inputs,
            neurons,
            synapses,
            activations: vec![0.0; num_neurons],
            // Issue #1173 - Pre-allocate hint values buffer
            hint_values_buffer: vec![0.0; num_non_inputs],
            // Issue #1173 - Pre-allocate trace data buffer
            trace_data_buffer: Vec::with_capacity(estimated_trace_size),
        })
    }

    /// Activate the network with the given input values
    /// Returns the output values
    /// Issue #1175 - Uses typed structs for better cache locality
    /// Issue #1177 - Inlines common squash functions to avoid function call overhead
    #[wasm_bindgen]
    pub fn activate(&mut self, input: &[f32], num_outputs: usize) -> Vec<f32> {
        // Copy input values to activation buffer
        let input_len = input.len().min(self.num_inputs);
        self.activations[..input_len].copy_from_slice(&input[..input_len]);

        // Process each neuron in order
        for (neuron_idx, neuron) in self.neurons.iter().enumerate() {
            let actual_idx = self.num_inputs + neuron_idx;

            if neuron.is_constant {
                // Constant neuron - just set the bias value
                self.activations[actual_idx] = apply_limit_range(SquashType::Identity, neuron.bias);
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let end_synapse = start_synapse + neuron.num_synapses as usize;

                // Handle aggregate functions differently (Issue #1125)
                let activation = match squash {
                    SquashType::Minimum => {
                        // MINIMUM: take the minimum of all weighted inputs + bias
                        let mut min_val = f32::INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;
                            if val < min_val {
                                min_val = val;
                            }
                        }
                        if min_val == f32::INFINITY {
                            neuron.bias
                        } else {
                            min_val + neuron.bias
                        }
                    }
                    SquashType::Maximum => {
                        // MAXIMUM: take the maximum of all weighted inputs + bias
                        let mut max_val = f32::NEG_INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;
                            if val > max_val {
                                max_val = val;
                            }
                        }
                        if max_val == f32::NEG_INFINITY {
                            neuron.bias
                        } else {
                            max_val + neuron.bias
                        }
                    }
                    SquashType::If => {
                        // IF: sum condition inputs, then use positive or negative branch
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;

                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;

                            match SynapseType::from(synapse.synapse_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => {
                                    positive_sum += val
                                }
                            }
                        }

                        if condition_sum > 0.0 {
                            positive_sum + neuron.bias
                        } else {
                            negative_sum + neuron.bias
                        }
                    }
                    SquashType::Hypotenuse => {
                        // Issue #1178 - Use SIMD-optimised sum of squares
                        let sum_sq = weighted_sum_of_squares_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                        );
                        sum_sq.sqrt() + neuron.bias
                    }
                    SquashType::HypotenuseV2 => {
                        // Issue #1178 - Use SIMD-optimised sum of squares V2
                        let sum_sq = weighted_sum_of_squares_v2_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );
                        sum_sq.sqrt()
                    }
                    SquashType::Mean => {
                        let n = (end_synapse - start_synapse) as f32;
                        if n <= 0.0 {
                            neuron.bias
                        } else {
                            // Issue #1178 - Use SIMD-optimised weighted sum for Mean
                            let sum = weighted_sum_no_bias_simd(
                                &self.synapses,
                                &self.activations,
                                start_synapse,
                                end_synapse,
                            );
                            sum / n + neuron.bias
                        }
                    }
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        // Issue #1178 - Use SIMD-optimised weighted sum
                        let sum = weighted_sum_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );
                        // Issue #1177 - Inline common squash functions for performance
                        // These 4 functions cover ~80% of typical networks
                        match neuron.squash_type {
                            0 => sum,                        // IDENTITY
                            1 => sum.max(0.0),               // ReLU
                            6 => 1.0 / (1.0 + (-sum).exp()), // LOGISTIC
                            7 => sum.tanh(),                 // TANH
                            _ => apply_squash(squash, sum),  // Other (fallback)
                        }
                    }
                };

                // Clamp to the activation's expected output range to avoid NaN/Inf
                // propagation and to match the JS implementation's range limiting.
                self.activations[actual_idx] = apply_limit_range(squash, activation);
            }
        }

        // Extract outputs from the end of the activation buffer
        let output_start = self.num_neurons - num_outputs;
        let output_slice = &self.activations[output_start..];

        output_slice.to_vec()
    }

    /// Activate the network and return a zero-copy Float32Array view over WASM memory.
    ///
    /// IMPORTANT: The returned Float32Array aliases the network's internal activation buffer.
    /// It will be overwritten by subsequent activations of the same network instance.
    ///
    /// This is intended for high-throughput scoring where the caller consumes outputs
    /// immediately and does not retain references across calls.
    #[wasm_bindgen]
    pub fn activate_view(&mut self, input: &[f32], num_outputs: usize) -> Float32Array {
        // Reuse the normal activation path (f32 accumulation)
        let _ = self.activate(input, num_outputs);

        let output_start = self.num_neurons - num_outputs;
        let output_slice = &self.activations[output_start..];
        // SAFETY: `output_slice` points into self.activations, which is stable and
        // not reallocated after construction. JS must not hold the view across calls.
        unsafe { Float32Array::view(output_slice) }
    }

    /// Activate the network with the given input values, writing to a pre-allocated output buffer
    /// Issue #1171 - Avoids per-call Float32Array allocation overhead
    ///
    /// This method writes directly to the caller's output buffer instead of allocating
    /// a new Float32Array on each call. For repeated activations (e.g., scoring millions
    /// of records), this eliminates allocation overhead and GC pressure.
    ///
    /// # Arguments
    /// * `input` - Input values slice
    /// * `output` - Pre-allocated output buffer to write results into
    ///
    /// # Panics
    /// Panics if the output buffer length doesn't match num_outputs
    #[wasm_bindgen]
    pub fn activate_into(&mut self, input: &[f32], output: &mut [f32]) {
        let num_outputs = output.len();

        // Copy input values to activation buffer
        let input_len = input.len().min(self.num_inputs);
        self.activations[..input_len].copy_from_slice(&input[..input_len]);

        // Process each neuron in order
        for (neuron_idx, neuron) in self.neurons.iter().enumerate() {
            let actual_idx = self.num_inputs + neuron_idx;

            if neuron.is_constant {
                // Constant neuron - just set the bias value
                self.activations[actual_idx] = apply_limit_range(SquashType::Identity, neuron.bias);
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let end_synapse = start_synapse + neuron.num_synapses as usize;

                // Handle aggregate functions differently (Issue #1125)
                let activation = match squash {
                    SquashType::Minimum => {
                        // MINIMUM: take the minimum of all weighted inputs + bias
                        let mut min_val = f32::INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;
                            if val < min_val {
                                min_val = val;
                            }
                        }
                        if min_val == f32::INFINITY {
                            neuron.bias
                        } else {
                            min_val + neuron.bias
                        }
                    }
                    SquashType::Maximum => {
                        // MAXIMUM: take the maximum of all weighted inputs + bias
                        let mut max_val = f32::NEG_INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;
                            if val > max_val {
                                max_val = val;
                            }
                        }
                        if max_val == f32::NEG_INFINITY {
                            neuron.bias
                        } else {
                            max_val + neuron.bias
                        }
                    }
                    SquashType::If => {
                        // IF: sum condition inputs, then use positive or negative branch
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;

                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;

                            match SynapseType::from(synapse.synapse_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => {
                                    positive_sum += val
                                }
                            }
                        }

                        if condition_sum > 0.0 {
                            positive_sum + neuron.bias
                        } else {
                            negative_sum + neuron.bias
                        }
                    }
                    SquashType::Hypotenuse => {
                        // Issue #1178 - Use SIMD-optimised sum of squares
                        let sum_sq = weighted_sum_of_squares_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                        );
                        sum_sq.sqrt() + neuron.bias
                    }
                    SquashType::HypotenuseV2 => {
                        // Issue #1178 - Use SIMD-optimised sum of squares V2
                        let sum_sq = weighted_sum_of_squares_v2_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );
                        sum_sq.sqrt()
                    }
                    SquashType::Mean => {
                        let n = (end_synapse - start_synapse) as f32;
                        if n <= 0.0 {
                            neuron.bias
                        } else {
                            // Issue #1178 - Use SIMD-optimised weighted sum for Mean
                            let sum = weighted_sum_no_bias_simd(
                                &self.synapses,
                                &self.activations,
                                start_synapse,
                                end_synapse,
                            );
                            sum / n + neuron.bias
                        }
                    }
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        // Issue #1178 - Use SIMD-optimised weighted sum
                        let sum = weighted_sum_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );
                        // Issue #1177 - Inline common squash functions for performance
                        // These 4 functions cover ~80% of typical networks
                        match neuron.squash_type {
                            0 => sum,                        // IDENTITY
                            1 => sum.max(0.0),               // ReLU
                            6 => 1.0 / (1.0 + (-sum).exp()), // LOGISTIC
                            7 => sum.tanh(),                 // TANH
                            _ => apply_squash(squash, sum),  // Other (fallback)
                        }
                    }
                };

                // Clamp to the activation's expected output range to avoid NaN/Inf
                // propagation and to match the JS implementation's range limiting.
                self.activations[actual_idx] = apply_limit_range(squash, activation);
            }
        }

        // Extract outputs from the end of the activation buffer
        // and copy directly to the caller's output buffer
        let output_start = self.num_neurons - num_outputs;
        output.copy_from_slice(&self.activations[output_start..output_start + num_outputs]);
    }

    /// Get the number of neurons in the network
    #[wasm_bindgen(getter)]
    pub fn num_neurons(&self) -> usize {
        self.num_neurons
    }

    /// Get the number of input neurons
    #[wasm_bindgen(getter)]
    pub fn num_inputs(&self) -> usize {
        self.num_inputs
    }

    /// Get the number of synapses in the network
    #[wasm_bindgen(getter)]
    pub fn num_synapses(&self) -> usize {
        self.synapses.len()
    }

    /// Activate the network with tracing for backpropagation support
    /// Issue #1121 - WASM Migration Phase 4: activateAndTrace
    /// Issue #1173 - Pre-allocate Vec<f32> buffers in CompiledNetwork struct
    /// Issue #1175 - Uses typed structs for better cache locality
    /// Issue #1177 - Inlines common squash functions to avoid function call overhead
    ///
    /// Returns a combined result containing:
    /// - Output activation values (num_outputs floats)
    /// - All non-input neuron activations (for state.activations)
    /// - Pre-squash values (hintValues) for all non-input neurons
    /// - Trace data for aggregate functions
    ///
    /// The result format is a Float32Array:
    /// - [0..num_outputs): output activation values
    /// - [num_outputs..num_outputs+num_non_inputs): post-squash activations
    /// - [num_outputs+num_non_inputs..num_outputs+2*num_non_inputs): pre-squash values (hintValues)
    /// - [num_outputs+2*num_non_inputs..]: trace data encoded as:
    ///   - For each non-input neuron with aggregate squash:
    ///     - neuron_index (as f32, relative to input count)
    ///     - For MINIMUM/MAXIMUM: winning_local_synapse_index (as f32)
    ///     - For IF: branch_taken (1.0 = positive, 0.0 = negative)
    ///   - Terminated by -1.0
    #[wasm_bindgen]
    pub fn activate_and_trace(&mut self, input: &[f32], num_outputs: usize) -> Vec<f32> {
        // Copy input values to activation buffer
        let input_len = input.len().min(self.num_inputs);
        self.activations[..input_len].copy_from_slice(&input[..input_len]);

        // Issue #1173 - Reuse pre-allocated trace data buffer instead of allocating
        // Track trace data for aggregate functions
        // Format: pairs of (neuron_relative_index, trace_info), terminated by -1.0
        self.trace_data_buffer.clear();

        // Use pre-allocated hint values buffer (Issue #1173)
        let num_non_inputs = self.num_neurons - self.num_inputs;
        // Issue #1173 - Use fill(0.0) instead of loop for better performance
        self.hint_values_buffer.fill(0.0);

        // Process each neuron in order
        for (neuron_idx, neuron) in self.neurons.iter().enumerate() {
            let actual_idx = self.num_inputs + neuron_idx;

            if neuron.is_constant {
                // Constant neuron - just set the bias value
                let b = neuron.bias;
                self.activations[actual_idx] = b;
                self.hint_values_buffer[neuron_idx] = b;
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let num_synapse = neuron.num_synapses as usize;
                let end_synapse = start_synapse + num_synapse;

                // Handle aggregate functions differently (Issue #1125)
                let (activation, hint_value) = match squash {
                    SquashType::Minimum => {
                        // MINIMUM: take the minimum of all weighted inputs + bias
                        // Track which synapse provided the minimum value
                        let mut min_val = f32::INFINITY;
                        let mut min_local_idx: usize = 0;
                        for local_idx in 0..num_synapse {
                            let synapse_idx = start_synapse + local_idx;
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;
                            if val < min_val {
                                min_val = val;
                                min_local_idx = local_idx;
                            }
                        }
                        // Record trace: neuron index and winning synapse local index
                        self.trace_data_buffer.push(neuron_idx as f32);
                        self.trace_data_buffer.push(min_local_idx as f32);

                        let result = if min_val == f32::INFINITY {
                            neuron.bias
                        } else {
                            min_val + neuron.bias
                        };
                        // For aggregate functions, hintValue is the same as activation
                        (result, result)
                    }
                    SquashType::Maximum => {
                        // MAXIMUM: take the maximum of all weighted inputs + bias
                        // Track which synapse provided the maximum value
                        let mut max_val = f32::NEG_INFINITY;
                        let mut max_local_idx: usize = 0;
                        for local_idx in 0..num_synapse {
                            let synapse_idx = start_synapse + local_idx;
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;
                            if val > max_val {
                                max_val = val;
                                max_local_idx = local_idx;
                            }
                        }
                        // Record trace: neuron index and winning synapse local index
                        self.trace_data_buffer.push(neuron_idx as f32);
                        self.trace_data_buffer.push(max_local_idx as f32);

                        let result = if max_val == f32::NEG_INFINITY {
                            neuron.bias
                        } else {
                            max_val + neuron.bias
                        };
                        // For aggregate functions, hintValue is the same as activation
                        (result, result)
                    }
                    SquashType::If => {
                        // IF: sum condition inputs, then use positive or negative branch
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;

                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &self.synapses[synapse_idx];
                            let val =
                                self.activations[synapse.from_index as usize] * synapse.weight;

                            match SynapseType::from(synapse.synapse_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => {
                                    positive_sum += val
                                }
                            }
                        }

                        // Record trace: neuron index and branch taken (1.0 = positive, 0.0 = negative)
                        let branch_taken = if condition_sum > 0.0 { 1.0f32 } else { 0.0f32 };
                        self.trace_data_buffer.push(neuron_idx as f32);
                        self.trace_data_buffer.push(branch_taken);

                        let result = if condition_sum > 0.0 {
                            positive_sum + neuron.bias
                        } else {
                            negative_sum + neuron.bias
                        };
                        // For aggregate functions, hintValue is the same as activation
                        (result, result)
                    }
                    SquashType::Hypotenuse => {
                        // Issue #1178 - Use SIMD-optimised sum of squares
                        let sum_sq = weighted_sum_of_squares_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                        );
                        let result = sum_sq.sqrt() + neuron.bias;
                        self.trace_data_buffer.push(neuron_idx as f32);
                        self.trace_data_buffer.push(0.0f32);
                        (result, result)
                    }
                    SquashType::HypotenuseV2 => {
                        // Issue #1178 - Use SIMD-optimised sum of squares V2
                        let sum_sq = weighted_sum_of_squares_v2_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );
                        let result = sum_sq.sqrt();
                        self.trace_data_buffer.push(neuron_idx as f32);
                        self.trace_data_buffer.push(0.0f32);
                        (result, result)
                    }
                    SquashType::Mean => {
                        let n = num_synapse as f32;
                        let result = if n <= 0.0 {
                            neuron.bias
                        } else {
                            // Issue #1178 - Use SIMD-optimised weighted sum for Mean
                            let sum = weighted_sum_no_bias_simd(
                                &self.synapses,
                                &self.activations,
                                start_synapse,
                                end_synapse,
                            );
                            sum / n + neuron.bias
                        };
                        self.trace_data_buffer.push(neuron_idx as f32);
                        self.trace_data_buffer.push(0.0f32);
                        (result, result)
                    }
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        // Issue #1178 - Use SIMD-optimised weighted sum
                        let sum = weighted_sum_simd(
                            &self.synapses,
                            &self.activations,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );
                        // Issue #1177 - Inline common squash functions for performance
                        let squashed = match neuron.squash_type {
                            0 => sum,                        // IDENTITY
                            1 => sum.max(0.0),               // ReLU
                            6 => 1.0 / (1.0 + (-sum).exp()), // LOGISTIC
                            7 => sum.tanh(),                 // TANH
                            _ => apply_squash(squash, sum),  // Other (fallback)
                        };
                        // For standard squash, hintValue is the pre-squash value (sum)
                        (squashed, sum)
                    }
                };

                // Clamp activation output to match JS range limiting and prevent
                // NaN/Inf propagation through the network.
                let activation_limited = apply_limit_range(squash, activation);

                self.activations[actual_idx] = activation_limited;

                // hintValues: for aggregate functions we expect hint==activation.
                // For standard squashes keep the pre-squash value.
                self.hint_values_buffer[neuron_idx] = match squash {
                    SquashType::Minimum
                    | SquashType::Maximum
                    | SquashType::If
                    | SquashType::Hypotenuse
                    | SquashType::HypotenuseV2
                    | SquashType::Mean => activation_limited,
                    _ => hint_value,
                };
            }
        }

        // Terminate trace data
        self.trace_data_buffer.push(-1.0);

        // Build result array:
        // - Output values (num_outputs)
        // - All non-input neuron activations (num_non_inputs)
        // - Pre-squash values / hintValues (num_non_inputs)
        // - Trace data
        let output_start = self.num_neurons - num_outputs;
        let result_len = num_outputs + (num_non_inputs * 2) + self.trace_data_buffer.len();
        let mut result: Vec<f32> = Vec::with_capacity(result_len);
        result.extend_from_slice(&self.activations[output_start..output_start + num_outputs]);
        result.extend_from_slice(&self.activations[self.num_inputs..]);
        result.extend_from_slice(&self.hint_values_buffer[..num_non_inputs]);
        result.extend_from_slice(&self.trace_data_buffer);
        result
    }

    /// Issue #1212 - Batch activate and trace for 4 records simultaneously.
    ///
    /// Processes 4 input records through the network in parallel, capturing trace
    /// data for backpropagation. Uses SIMD via `weighted_sum_simd_4records()` for
    /// standard squash functions.
    ///
    /// # Arguments
    /// * `inputs` - Packed input array: [input0..., input1..., input2..., input3...]
    /// * `input_size` - Number of input values per record
    /// * `num_outputs` - Number of output neurons
    ///
    /// # Returns
    /// Four Vec<f32>, one per record. Each has the same format as `activate_and_trace`:
    /// [outputs..., activations..., hints..., trace_data...]
    #[wasm_bindgen]
    pub fn activate_and_trace_batch_4way(
        &self,
        inputs: &[f32],
        input_size: usize,
        num_outputs: usize,
    ) -> Vec<f32> {
        let num_non_inputs = self.num_neurons - self.num_inputs;
        let effective_input_len = input_size.min(self.num_inputs);

        // Allocate 4 separate activation buffers
        let mut act0 = vec![0.0f32; self.num_neurons];
        let mut act1 = vec![0.0f32; self.num_neurons];
        let mut act2 = vec![0.0f32; self.num_neurons];
        let mut act3 = vec![0.0f32; self.num_neurons];

        // Copy inputs for each record
        act0[..effective_input_len]
            .copy_from_slice(&inputs[..effective_input_len]);
        act1[..effective_input_len]
            .copy_from_slice(&inputs[input_size..input_size + effective_input_len]);
        act2[..effective_input_len]
            .copy_from_slice(&inputs[2 * input_size..2 * input_size + effective_input_len]);
        act3[..effective_input_len]
            .copy_from_slice(&inputs[3 * input_size..3 * input_size + effective_input_len]);

        // Allocate 4 sets of hint values and trace data buffers
        let mut hints0 = vec![0.0f32; num_non_inputs];
        let mut hints1 = vec![0.0f32; num_non_inputs];
        let mut hints2 = vec![0.0f32; num_non_inputs];
        let mut hints3 = vec![0.0f32; num_non_inputs];

        let mut trace0: Vec<f32> = Vec::new();
        let mut trace1: Vec<f32> = Vec::new();
        let mut trace2: Vec<f32> = Vec::new();
        let mut trace3: Vec<f32> = Vec::new();

        // Process each neuron for all 4 records
        for (neuron_idx, neuron) in self.neurons.iter().enumerate() {
            let actual_idx = self.num_inputs + neuron_idx;

            if neuron.is_constant {
                let b = neuron.bias;
                act0[actual_idx] = b;
                act1[actual_idx] = b;
                act2[actual_idx] = b;
                act3[actual_idx] = b;
                hints0[neuron_idx] = b;
                hints1[neuron_idx] = b;
                hints2[neuron_idx] = b;
                hints3[neuron_idx] = b;
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let num_synapse = neuron.num_synapses as usize;
                let end_synapse = start_synapse + num_synapse;

                match squash {
                    SquashType::Minimum => {
                        // Process each record independently for MINIMUM aggregate
                        Self::process_minimum_4way(
                            &self.synapses,
                            &mut act0,
                            &mut act1,
                            &mut act2,
                            &mut act3,
                            actual_idx,
                            neuron_idx,
                            neuron.bias,
                            start_synapse,
                            num_synapse,
                            &mut hints0,
                            &mut hints1,
                            &mut hints2,
                            &mut hints3,
                            &mut trace0,
                            &mut trace1,
                            &mut trace2,
                            &mut trace3,
                        );
                    }
                    SquashType::Maximum => {
                        // Process each record independently for MAXIMUM aggregate
                        Self::process_maximum_4way(
                            &self.synapses,
                            &mut act0,
                            &mut act1,
                            &mut act2,
                            &mut act3,
                            actual_idx,
                            neuron_idx,
                            neuron.bias,
                            start_synapse,
                            num_synapse,
                            &mut hints0,
                            &mut hints1,
                            &mut hints2,
                            &mut hints3,
                            &mut trace0,
                            &mut trace1,
                            &mut trace2,
                            &mut trace3,
                        );
                    }
                    SquashType::If => {
                        // Process each record independently for IF aggregate
                        Self::process_if_4way(
                            &self.synapses,
                            &mut act0,
                            &mut act1,
                            &mut act2,
                            &mut act3,
                            actual_idx,
                            neuron_idx,
                            neuron.bias,
                            start_synapse,
                            end_synapse,
                            &mut hints0,
                            &mut hints1,
                            &mut hints2,
                            &mut hints3,
                            &mut trace0,
                            &mut trace1,
                            &mut trace2,
                            &mut trace3,
                        );
                    }
                    SquashType::Hypotenuse => {
                        // Hypotenuse needs per-record processing (sum of squares)
                        Self::process_hypotenuse_4way(
                            &self.synapses,
                            &mut act0,
                            &mut act1,
                            &mut act2,
                            &mut act3,
                            actual_idx,
                            neuron_idx,
                            neuron.bias,
                            start_synapse,
                            end_synapse,
                            &mut hints0,
                            &mut hints1,
                            &mut hints2,
                            &mut hints3,
                            &mut trace0,
                            &mut trace1,
                            &mut trace2,
                            &mut trace3,
                        );
                    }
                    SquashType::HypotenuseV2 => {
                        Self::process_hypotenuse_v2_4way(
                            &self.synapses,
                            &mut act0,
                            &mut act1,
                            &mut act2,
                            &mut act3,
                            actual_idx,
                            neuron_idx,
                            neuron.bias,
                            start_synapse,
                            end_synapse,
                            &mut hints0,
                            &mut hints1,
                            &mut hints2,
                            &mut hints3,
                            &mut trace0,
                            &mut trace1,
                            &mut trace2,
                            &mut trace3,
                        );
                    }
                    SquashType::Mean => {
                        Self::process_mean_4way(
                            &self.synapses,
                            &mut act0,
                            &mut act1,
                            &mut act2,
                            &mut act3,
                            actual_idx,
                            neuron_idx,
                            neuron.bias,
                            start_synapse,
                            end_synapse,
                            num_synapse,
                            &mut hints0,
                            &mut hints1,
                            &mut hints2,
                            &mut hints3,
                            &mut trace0,
                            &mut trace1,
                            &mut trace2,
                            &mut trace3,
                        );
                    }
                    _ => {
                        // Standard squash: use SIMD 4-record weighted sum
                        let (s0, s1, s2, s3) = weighted_sum_simd_4records(
                            &self.synapses,
                            &act0,
                            &act1,
                            &act2,
                            &act3,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );

                        // Apply squash to all 4 records
                        let sq0 = Self::apply_inline_squash(neuron.squash_type, squash, s0);
                        let sq1 = Self::apply_inline_squash(neuron.squash_type, squash, s1);
                        let sq2 = Self::apply_inline_squash(neuron.squash_type, squash, s2);
                        let sq3 = Self::apply_inline_squash(neuron.squash_type, squash, s3);

                        let a0 = apply_limit_range(squash, sq0);
                        let a1 = apply_limit_range(squash, sq1);
                        let a2 = apply_limit_range(squash, sq2);
                        let a3 = apply_limit_range(squash, sq3);

                        act0[actual_idx] = a0;
                        act1[actual_idx] = a1;
                        act2[actual_idx] = a2;
                        act3[actual_idx] = a3;

                        // Pre-squash values as hints for standard squash
                        hints0[neuron_idx] = s0;
                        hints1[neuron_idx] = s1;
                        hints2[neuron_idx] = s2;
                        hints3[neuron_idx] = s3;
                    }
                }
            }
        }

        // Terminate trace data for all 4 records
        trace0.push(-1.0);
        trace1.push(-1.0);
        trace2.push(-1.0);
        trace3.push(-1.0);

        // Build packed result: 4 records concatenated
        // Each record: [outputs..., activations..., hints..., trace_data...]
        // Prefix with per-record length so TypeScript can unpack
        let output_start = self.num_neurons - num_outputs;
        let record0_len = num_outputs + (num_non_inputs * 2) + trace0.len();
        let record1_len = num_outputs + (num_non_inputs * 2) + trace1.len();
        let record2_len = num_outputs + (num_non_inputs * 2) + trace2.len();
        let record3_len = num_outputs + (num_non_inputs * 2) + trace3.len();
        let total_len = 4 + record0_len + record1_len + record2_len + record3_len;

        let mut result: Vec<f32> = Vec::with_capacity(total_len);

        // Write 4 record lengths as header
        result.push(record0_len as f32);
        result.push(record1_len as f32);
        result.push(record2_len as f32);
        result.push(record3_len as f32);

        // Record 0
        result.extend_from_slice(&act0[output_start..output_start + num_outputs]);
        result.extend_from_slice(&act0[self.num_inputs..]);
        result.extend_from_slice(&hints0[..num_non_inputs]);
        result.extend_from_slice(&trace0);

        // Record 1
        result.extend_from_slice(&act1[output_start..output_start + num_outputs]);
        result.extend_from_slice(&act1[self.num_inputs..]);
        result.extend_from_slice(&hints1[..num_non_inputs]);
        result.extend_from_slice(&trace1);

        // Record 2
        result.extend_from_slice(&act2[output_start..output_start + num_outputs]);
        result.extend_from_slice(&act2[self.num_inputs..]);
        result.extend_from_slice(&hints2[..num_non_inputs]);
        result.extend_from_slice(&trace2);

        // Record 3
        result.extend_from_slice(&act3[output_start..output_start + num_outputs]);
        result.extend_from_slice(&act3[self.num_inputs..]);
        result.extend_from_slice(&hints3[..num_non_inputs]);
        result.extend_from_slice(&trace3);

        result
    }
}

/// Issue #1212 - Helper methods for batch activate_and_trace processing
impl CompiledNetwork {
    /// Apply inline squash optimisation for common activation functions
    #[inline]
    fn apply_inline_squash(squash_type: u8, squash: SquashType, sum: f32) -> f32 {
        match squash_type {
            0 => sum,                        // IDENTITY
            1 => sum.max(0.0),               // ReLU
            6 => 1.0 / (1.0 + (-sum).exp()), // LOGISTIC
            7 => sum.tanh(),                 // TANH
            _ => apply_squash(squash, sum),  // Other (fallback)
        }
    }

    /// Process MINIMUM aggregate for 4 records
    #[allow(clippy::too_many_arguments)]
    fn process_minimum_4way(
        synapses: &[SynapseData],
        act0: &mut [f32],
        act1: &mut [f32],
        act2: &mut [f32],
        act3: &mut [f32],
        actual_idx: usize,
        neuron_idx: usize,
        bias: f32,
        start_synapse: usize,
        num_synapse: usize,
        hints0: &mut [f32],
        hints1: &mut [f32],
        hints2: &mut [f32],
        hints3: &mut [f32],
        trace0: &mut Vec<f32>,
        trace1: &mut Vec<f32>,
        trace2: &mut Vec<f32>,
        trace3: &mut Vec<f32>,
    ) {
        let mut min0 = f32::INFINITY;
        let mut min1 = f32::INFINITY;
        let mut min2 = f32::INFINITY;
        let mut min3 = f32::INFINITY;
        let mut idx0: usize = 0;
        let mut idx1: usize = 0;
        let mut idx2: usize = 0;
        let mut idx3: usize = 0;

        for local_idx in 0..num_synapse {
            let synapse = &synapses[start_synapse + local_idx];
            let from = synapse.from_index as usize;
            let w = synapse.weight;

            let v0 = act0[from] * w;
            let v1 = act1[from] * w;
            let v2 = act2[from] * w;
            let v3 = act3[from] * w;

            if v0 < min0 {
                min0 = v0;
                idx0 = local_idx;
            }
            if v1 < min1 {
                min1 = v1;
                idx1 = local_idx;
            }
            if v2 < min2 {
                min2 = v2;
                idx2 = local_idx;
            }
            if v3 < min3 {
                min3 = v3;
                idx3 = local_idx;
            }
        }

        let results = [
            if min0 == f32::INFINITY { bias } else { min0 + bias },
            if min1 == f32::INFINITY { bias } else { min1 + bias },
            if min2 == f32::INFINITY { bias } else { min2 + bias },
            if min3 == f32::INFINITY { bias } else { min3 + bias },
        ];

        let squash = SquashType::Minimum;
        act0[actual_idx] = apply_limit_range(squash, results[0]);
        act1[actual_idx] = apply_limit_range(squash, results[1]);
        act2[actual_idx] = apply_limit_range(squash, results[2]);
        act3[actual_idx] = apply_limit_range(squash, results[3]);

        hints0[neuron_idx] = act0[actual_idx];
        hints1[neuron_idx] = act1[actual_idx];
        hints2[neuron_idx] = act2[actual_idx];
        hints3[neuron_idx] = act3[actual_idx];

        trace0.push(neuron_idx as f32);
        trace0.push(idx0 as f32);
        trace1.push(neuron_idx as f32);
        trace1.push(idx1 as f32);
        trace2.push(neuron_idx as f32);
        trace2.push(idx2 as f32);
        trace3.push(neuron_idx as f32);
        trace3.push(idx3 as f32);
    }

    /// Process MAXIMUM aggregate for 4 records
    #[allow(clippy::too_many_arguments)]
    fn process_maximum_4way(
        synapses: &[SynapseData],
        act0: &mut [f32],
        act1: &mut [f32],
        act2: &mut [f32],
        act3: &mut [f32],
        actual_idx: usize,
        neuron_idx: usize,
        bias: f32,
        start_synapse: usize,
        num_synapse: usize,
        hints0: &mut [f32],
        hints1: &mut [f32],
        hints2: &mut [f32],
        hints3: &mut [f32],
        trace0: &mut Vec<f32>,
        trace1: &mut Vec<f32>,
        trace2: &mut Vec<f32>,
        trace3: &mut Vec<f32>,
    ) {
        let mut max0 = f32::NEG_INFINITY;
        let mut max1 = f32::NEG_INFINITY;
        let mut max2 = f32::NEG_INFINITY;
        let mut max3 = f32::NEG_INFINITY;
        let mut idx0: usize = 0;
        let mut idx1: usize = 0;
        let mut idx2: usize = 0;
        let mut idx3: usize = 0;

        for local_idx in 0..num_synapse {
            let synapse = &synapses[start_synapse + local_idx];
            let from = synapse.from_index as usize;
            let w = synapse.weight;

            let v0 = act0[from] * w;
            let v1 = act1[from] * w;
            let v2 = act2[from] * w;
            let v3 = act3[from] * w;

            if v0 > max0 {
                max0 = v0;
                idx0 = local_idx;
            }
            if v1 > max1 {
                max1 = v1;
                idx1 = local_idx;
            }
            if v2 > max2 {
                max2 = v2;
                idx2 = local_idx;
            }
            if v3 > max3 {
                max3 = v3;
                idx3 = local_idx;
            }
        }

        let results = [
            if max0 == f32::NEG_INFINITY { bias } else { max0 + bias },
            if max1 == f32::NEG_INFINITY { bias } else { max1 + bias },
            if max2 == f32::NEG_INFINITY { bias } else { max2 + bias },
            if max3 == f32::NEG_INFINITY { bias } else { max3 + bias },
        ];

        let squash = SquashType::Maximum;
        act0[actual_idx] = apply_limit_range(squash, results[0]);
        act1[actual_idx] = apply_limit_range(squash, results[1]);
        act2[actual_idx] = apply_limit_range(squash, results[2]);
        act3[actual_idx] = apply_limit_range(squash, results[3]);

        hints0[neuron_idx] = act0[actual_idx];
        hints1[neuron_idx] = act1[actual_idx];
        hints2[neuron_idx] = act2[actual_idx];
        hints3[neuron_idx] = act3[actual_idx];

        trace0.push(neuron_idx as f32);
        trace0.push(idx0 as f32);
        trace1.push(neuron_idx as f32);
        trace1.push(idx1 as f32);
        trace2.push(neuron_idx as f32);
        trace2.push(idx2 as f32);
        trace3.push(neuron_idx as f32);
        trace3.push(idx3 as f32);
    }

    /// Process IF aggregate for 4 records
    #[allow(clippy::too_many_arguments)]
    fn process_if_4way(
        synapses: &[SynapseData],
        act0: &mut [f32],
        act1: &mut [f32],
        act2: &mut [f32],
        act3: &mut [f32],
        actual_idx: usize,
        neuron_idx: usize,
        bias: f32,
        start_synapse: usize,
        end_synapse: usize,
        hints0: &mut [f32],
        hints1: &mut [f32],
        hints2: &mut [f32],
        hints3: &mut [f32],
        trace0: &mut Vec<f32>,
        trace1: &mut Vec<f32>,
        trace2: &mut Vec<f32>,
        trace3: &mut Vec<f32>,
    ) {
        let mut cond = [0.0f32; 4];
        let mut pos = [0.0f32; 4];
        let mut neg = [0.0f32; 4];

        for synapse_idx in start_synapse..end_synapse {
            let synapse = &synapses[synapse_idx];
            let from = synapse.from_index as usize;
            let w = synapse.weight;

            let v0 = act0[from] * w;
            let v1 = act1[from] * w;
            let v2 = act2[from] * w;
            let v3 = act3[from] * w;

            match SynapseType::from(synapse.synapse_type) {
                SynapseType::Condition => {
                    cond[0] += v0;
                    cond[1] += v1;
                    cond[2] += v2;
                    cond[3] += v3;
                }
                SynapseType::Negative => {
                    neg[0] += v0;
                    neg[1] += v1;
                    neg[2] += v2;
                    neg[3] += v3;
                }
                SynapseType::Positive | SynapseType::Standard => {
                    pos[0] += v0;
                    pos[1] += v1;
                    pos[2] += v2;
                    pos[3] += v3;
                }
            }
        }

        let squash = SquashType::If;
        let acts = [act0, act1, act2, act3];
        let hints = [hints0, hints1, hints2, hints3];
        let traces = [trace0, trace1, trace2, trace3];

        for (i, ((act, hint), trace)) in
            acts.into_iter().zip(hints).zip(traces).enumerate()
        {
            let branch = if cond[i] > 0.0 { 1.0f32 } else { 0.0f32 };
            let result = if cond[i] > 0.0 {
                pos[i] + bias
            } else {
                neg[i] + bias
            };
            let limited = apply_limit_range(squash, result);
            act[actual_idx] = limited;
            hint[neuron_idx] = limited;
            trace.push(neuron_idx as f32);
            trace.push(branch);
        }
    }

    /// Process Hypotenuse aggregate for 4 records
    #[allow(clippy::too_many_arguments)]
    fn process_hypotenuse_4way(
        synapses: &[SynapseData],
        act0: &mut [f32],
        act1: &mut [f32],
        act2: &mut [f32],
        act3: &mut [f32],
        actual_idx: usize,
        neuron_idx: usize,
        bias: f32,
        start_synapse: usize,
        end_synapse: usize,
        hints0: &mut [f32],
        hints1: &mut [f32],
        hints2: &mut [f32],
        hints3: &mut [f32],
        trace0: &mut Vec<f32>,
        trace1: &mut Vec<f32>,
        trace2: &mut Vec<f32>,
        trace3: &mut Vec<f32>,
    ) {
        let mut sq0 = 0.0f32;
        let mut sq1 = 0.0f32;
        let mut sq2 = 0.0f32;
        let mut sq3 = 0.0f32;

        for synapse_idx in start_synapse..end_synapse {
            let synapse = &synapses[synapse_idx];
            let from = synapse.from_index as usize;
            let w = synapse.weight;

            let v0 = act0[from] * w;
            let v1 = act1[from] * w;
            let v2 = act2[from] * w;
            let v3 = act3[from] * w;

            sq0 += v0 * v0;
            sq1 += v1 * v1;
            sq2 += v2 * v2;
            sq3 += v3 * v3;
        }

        let squash = SquashType::Hypotenuse;
        let results = [
            sq0.sqrt() + bias,
            sq1.sqrt() + bias,
            sq2.sqrt() + bias,
            sq3.sqrt() + bias,
        ];

        act0[actual_idx] = apply_limit_range(squash, results[0]);
        act1[actual_idx] = apply_limit_range(squash, results[1]);
        act2[actual_idx] = apply_limit_range(squash, results[2]);
        act3[actual_idx] = apply_limit_range(squash, results[3]);

        hints0[neuron_idx] = act0[actual_idx];
        hints1[neuron_idx] = act1[actual_idx];
        hints2[neuron_idx] = act2[actual_idx];
        hints3[neuron_idx] = act3[actual_idx];

        for trace in [trace0, trace1, trace2, trace3] {
            trace.push(neuron_idx as f32);
            trace.push(0.0f32);
        }
    }

    /// Process HypotenuseV2 aggregate for 4 records
    #[allow(clippy::too_many_arguments)]
    fn process_hypotenuse_v2_4way(
        synapses: &[SynapseData],
        act0: &mut [f32],
        act1: &mut [f32],
        act2: &mut [f32],
        act3: &mut [f32],
        actual_idx: usize,
        neuron_idx: usize,
        bias: f32,
        start_synapse: usize,
        end_synapse: usize,
        hints0: &mut [f32],
        hints1: &mut [f32],
        hints2: &mut [f32],
        hints3: &mut [f32],
        trace0: &mut Vec<f32>,
        trace1: &mut Vec<f32>,
        trace2: &mut Vec<f32>,
        trace3: &mut Vec<f32>,
    ) {
        let mut sq0 = 0.0f32;
        let mut sq1 = 0.0f32;
        let mut sq2 = 0.0f32;
        let mut sq3 = 0.0f32;

        for synapse_idx in start_synapse..end_synapse {
            let synapse = &synapses[synapse_idx];
            let from = synapse.from_index as usize;
            let w = synapse.weight;

            let v0 = bias + act0[from] * w;
            let v1 = bias + act1[from] * w;
            let v2 = bias + act2[from] * w;
            let v3 = bias + act3[from] * w;

            sq0 += v0 * v0;
            sq1 += v1 * v1;
            sq2 += v2 * v2;
            sq3 += v3 * v3;
        }

        let squash = SquashType::HypotenuseV2;
        let results = [sq0.sqrt(), sq1.sqrt(), sq2.sqrt(), sq3.sqrt()];

        act0[actual_idx] = apply_limit_range(squash, results[0]);
        act1[actual_idx] = apply_limit_range(squash, results[1]);
        act2[actual_idx] = apply_limit_range(squash, results[2]);
        act3[actual_idx] = apply_limit_range(squash, results[3]);

        hints0[neuron_idx] = act0[actual_idx];
        hints1[neuron_idx] = act1[actual_idx];
        hints2[neuron_idx] = act2[actual_idx];
        hints3[neuron_idx] = act3[actual_idx];

        for trace in [trace0, trace1, trace2, trace3] {
            trace.push(neuron_idx as f32);
            trace.push(0.0f32);
        }
    }

    /// Process Mean aggregate for 4 records
    #[allow(clippy::too_many_arguments)]
    fn process_mean_4way(
        synapses: &[SynapseData],
        act0: &mut [f32],
        act1: &mut [f32],
        act2: &mut [f32],
        act3: &mut [f32],
        actual_idx: usize,
        neuron_idx: usize,
        bias: f32,
        start_synapse: usize,
        end_synapse: usize,
        num_synapse: usize,
        hints0: &mut [f32],
        hints1: &mut [f32],
        hints2: &mut [f32],
        hints3: &mut [f32],
        trace0: &mut Vec<f32>,
        trace1: &mut Vec<f32>,
        trace2: &mut Vec<f32>,
        trace3: &mut Vec<f32>,
    ) {
        let n = num_synapse as f32;
        let squash = SquashType::Mean;

        if n <= 0.0 {
            let limited = apply_limit_range(squash, bias);
            act0[actual_idx] = limited;
            act1[actual_idx] = limited;
            act2[actual_idx] = limited;
            act3[actual_idx] = limited;
            hints0[neuron_idx] = limited;
            hints1[neuron_idx] = limited;
            hints2[neuron_idx] = limited;
            hints3[neuron_idx] = limited;
        } else {
            let mut sum0 = 0.0f32;
            let mut sum1 = 0.0f32;
            let mut sum2 = 0.0f32;
            let mut sum3 = 0.0f32;

            for synapse_idx in start_synapse..end_synapse {
                let synapse = &synapses[synapse_idx];
                let from = synapse.from_index as usize;
                let w = synapse.weight;

                sum0 += act0[from] * w;
                sum1 += act1[from] * w;
                sum2 += act2[from] * w;
                sum3 += act3[from] * w;
            }

            let results = [
                sum0 / n + bias,
                sum1 / n + bias,
                sum2 / n + bias,
                sum3 / n + bias,
            ];

            act0[actual_idx] = apply_limit_range(squash, results[0]);
            act1[actual_idx] = apply_limit_range(squash, results[1]);
            act2[actual_idx] = apply_limit_range(squash, results[2]);
            act3[actual_idx] = apply_limit_range(squash, results[3]);

            hints0[neuron_idx] = act0[actual_idx];
            hints1[neuron_idx] = act1[actual_idx];
            hints2[neuron_idx] = act2[actual_idx];
            hints3[neuron_idx] = act3[actual_idx];
        }

        for trace in [trace0, trace1, trace2, trace3] {
            trace.push(neuron_idx as f32);
            trace.push(0.0f32);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to build a CompiledNetwork directly for testing
    fn make_network(
        num_inputs: usize,
        neurons: Vec<NeuronData>,
        synapses: Vec<SynapseData>,
    ) -> CompiledNetwork {
        let num_neurons = num_inputs + neurons.len();
        let num_non_inputs = neurons.len();
        let estimated_trace_size = (num_non_inputs / 10).max(1) * 2 + 1;
        CompiledNetwork {
            num_neurons,
            num_inputs,
            neurons,
            synapses,
            activations: vec![0.0; num_neurons],
            hint_values_buffer: vec![0.0; num_non_inputs],
            trace_data_buffer: Vec::with_capacity(estimated_trace_size),
        }
    }

    fn make_synapse(from_index: u32, weight: f32) -> SynapseData {
        SynapseData {
            weight,
            from_index,
            synapse_type: 0,
            _padding: [0; 3],
        }
    }

    fn make_synapse_typed(from_index: u32, weight: f32, synapse_type: u8) -> SynapseData {
        SynapseData {
            weight,
            from_index,
            synapse_type,
            _padding: [0; 3],
        }
    }

    /// Test that batch 4-way matches single-record activate_and_trace for standard squash (ReLU)
    #[test]
    fn test_batch_4way_matches_single_relu() {
        // Network: 2 inputs, 1 hidden (ReLU), 1 output (Identity)
        let synapses = vec![
            make_synapse(0, 0.5),  // hidden <- input0
            make_synapse(1, -0.3), // hidden <- input1
            make_synapse(2, 1.0),  // output <- hidden
        ];
        let neurons = vec![
            NeuronData {
                bias: 0.1,
                start_synapse: 0,
                num_synapses: 2,
                squash_type: 1, // ReLU
                is_constant: false,
            },
            NeuronData {
                bias: -0.2,
                start_synapse: 2,
                num_synapses: 1,
                squash_type: 0, // Identity
                is_constant: false,
            },
        ];

        let inputs: [&[f32]; 4] = [
            &[1.0, 2.0],
            &[0.5, -1.0],
            &[-2.0, 3.0],
            &[0.0, 0.0],
        ];

        // Run single-record activate_and_trace for each
        let mut single_results = Vec::new();
        for input in &inputs {
            let mut net = make_network(2, neurons.clone(), synapses.clone());
            let result = net.activate_and_trace(input, 1);
            single_results.push(result);
        }

        // Run batch 4-way
        let net = make_network(2, neurons.clone(), synapses.clone());
        let packed_input: Vec<f32> = inputs.iter().flat_map(|i| i.iter().copied()).collect();
        let batch_result = net.activate_and_trace_batch_4way(&packed_input, 2, 1);

        // Parse batch result - first 4 values are record lengths
        let len0 = batch_result[0] as usize;
        let len1 = batch_result[1] as usize;
        let len2 = batch_result[2] as usize;
        let len3 = batch_result[3] as usize;

        let start0 = 4;
        let start1 = start0 + len0;
        let start2 = start1 + len1;
        let start3 = start2 + len2;

        let batch_records = [
            &batch_result[start0..start0 + len0],
            &batch_result[start1..start1 + len1],
            &batch_result[start2..start2 + len2],
            &batch_result[start3..start3 + len3],
        ];

        // Compare each batch record with its single-record counterpart
        for (i, (single, batch)) in single_results.iter().zip(batch_records.iter()).enumerate() {
            assert_eq!(
                single.len(),
                batch.len(),
                "Record {i}: length mismatch (single={}, batch={})",
                single.len(),
                batch.len()
            );
            for (j, (s, b)) in single.iter().zip(batch.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {i}, element {j}: single={s}, batch={b}"
                );
            }
        }
    }

    /// Test batch 4-way with TANH and LOGISTIC squash functions
    #[test]
    fn test_batch_4way_matches_single_tanh_logistic() {
        let synapses = vec![
            make_synapse(0, 1.0),
            make_synapse(1, 0.5),
            make_synapse(2, -0.7),
        ];
        let neurons = vec![
            NeuronData {
                bias: 0.0,
                start_synapse: 0,
                num_synapses: 2,
                squash_type: 7, // TANH
                is_constant: false,
            },
            NeuronData {
                bias: 0.5,
                start_synapse: 2,
                num_synapses: 1,
                squash_type: 6, // LOGISTIC
                is_constant: false,
            },
        ];

        let inputs: [&[f32]; 4] = [
            &[1.0, 0.5],
            &[-1.0, 2.0],
            &[0.3, -0.3],
            &[2.0, -1.0],
        ];

        let mut single_results = Vec::new();
        for input in &inputs {
            let mut net = make_network(2, neurons.clone(), synapses.clone());
            let result = net.activate_and_trace(input, 1);
            single_results.push(result);
        }

        let net = make_network(2, neurons.clone(), synapses.clone());
        let packed: Vec<f32> = inputs.iter().flat_map(|i| i.iter().copied()).collect();
        let batch_result = net.activate_and_trace_batch_4way(&packed, 2, 1);

        let len0 = batch_result[0] as usize;
        let len1 = batch_result[1] as usize;
        let len2 = batch_result[2] as usize;

        let start0 = 4;
        let start1 = start0 + len0;
        let start2 = start1 + len1;
        let start3 = start2 + len2;

        let batch_records = [
            &batch_result[start0..start0 + len0],
            &batch_result[start1..start1 + len1],
            &batch_result[start2..start2 + len0],
            &batch_result[start3..start3 + batch_result[3] as usize],
        ];

        for (i, (single, batch)) in single_results.iter().zip(batch_records.iter()).enumerate() {
            assert_eq!(single.len(), batch.len(), "Record {i}: length mismatch");
            for (j, (s, b)) in single.iter().zip(batch.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {i}, element {j}: single={s}, batch={b}"
                );
            }
        }
    }

    /// Test batch 4-way with MINIMUM aggregate function
    #[test]
    fn test_batch_4way_minimum_aggregate() {
        // 2 inputs -> 1 MINIMUM neuron (output)
        let synapses = vec![
            make_synapse(0, 1.0),
            make_synapse(1, 1.0),
        ];
        let neurons = vec![
            NeuronData {
                bias: 0.0,
                start_synapse: 0,
                num_synapses: 2,
                squash_type: 32, // MINIMUM
                is_constant: false,
            },
        ];

        let inputs: [&[f32]; 4] = [
            &[3.0, 1.0], // min = 1.0
            &[-1.0, 2.0], // min = -1.0
            &[5.0, 5.0], // min = 5.0
            &[0.0, -3.0], // min = -3.0
        ];

        let mut single_results = Vec::new();
        for input in &inputs {
            let mut net = make_network(2, neurons.clone(), synapses.clone());
            let result = net.activate_and_trace(input, 1);
            single_results.push(result);
        }

        let net = make_network(2, neurons.clone(), synapses.clone());
        let packed: Vec<f32> = inputs.iter().flat_map(|i| i.iter().copied()).collect();
        let batch_result = net.activate_and_trace_batch_4way(&packed, 2, 1);

        let len0 = batch_result[0] as usize;
        let len1 = batch_result[1] as usize;
        let len2 = batch_result[2] as usize;

        let start0 = 4;
        let start1 = start0 + len0;
        let start2 = start1 + len1;
        let start3 = start2 + len2;

        let batch_records = [
            &batch_result[start0..start0 + len0],
            &batch_result[start1..start1 + len1],
            &batch_result[start2..start2 + len2],
            &batch_result[start3..start3 + batch_result[3] as usize],
        ];

        for (i, (single, batch)) in single_results.iter().zip(batch_records.iter()).enumerate() {
            assert_eq!(single.len(), batch.len(), "Record {i}: length mismatch");
            for (j, (s, b)) in single.iter().zip(batch.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {i}, element {j}: single={s}, batch={b}"
                );
            }
        }
    }

    /// Test batch 4-way with MAXIMUM aggregate function
    #[test]
    fn test_batch_4way_maximum_aggregate() {
        let synapses = vec![
            make_synapse(0, 1.0),
            make_synapse(1, 1.0),
        ];
        let neurons = vec![
            NeuronData {
                bias: 0.5,
                start_synapse: 0,
                num_synapses: 2,
                squash_type: 33, // MAXIMUM
                is_constant: false,
            },
        ];

        let inputs: [&[f32]; 4] = [
            &[3.0, 1.0],
            &[-1.0, 2.0],
            &[5.0, 5.0],
            &[0.0, -3.0],
        ];

        let mut single_results = Vec::new();
        for input in &inputs {
            let mut net = make_network(2, neurons.clone(), synapses.clone());
            let result = net.activate_and_trace(input, 1);
            single_results.push(result);
        }

        let net = make_network(2, neurons.clone(), synapses.clone());
        let packed: Vec<f32> = inputs.iter().flat_map(|i| i.iter().copied()).collect();
        let batch_result = net.activate_and_trace_batch_4way(&packed, 2, 1);

        let len0 = batch_result[0] as usize;
        let len1 = batch_result[1] as usize;
        let len2 = batch_result[2] as usize;

        let start0 = 4;
        let start1 = start0 + len0;
        let start2 = start1 + len1;
        let start3 = start2 + len2;

        let batch_records = [
            &batch_result[start0..start0 + len0],
            &batch_result[start1..start1 + len1],
            &batch_result[start2..start2 + len2],
            &batch_result[start3..start3 + batch_result[3] as usize],
        ];

        for (i, (single, batch)) in single_results.iter().zip(batch_records.iter()).enumerate() {
            assert_eq!(single.len(), batch.len(), "Record {i}: length mismatch");
            for (j, (s, b)) in single.iter().zip(batch.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {i}, element {j}: single={s}, batch={b}"
                );
            }
        }
    }

    /// Test batch 4-way with IF aggregate function
    #[test]
    fn test_batch_4way_if_aggregate() {
        // 3 inputs -> 1 IF neuron
        // synapse0: condition, synapse1: positive, synapse2: negative
        let synapses = vec![
            make_synapse_typed(0, 1.0, 1),  // condition
            make_synapse_typed(1, 1.0, 3),  // positive
            make_synapse_typed(2, 1.0, 2),  // negative
        ];
        let neurons = vec![
            NeuronData {
                bias: 0.0,
                start_synapse: 0,
                num_synapses: 3,
                squash_type: 34, // IF
                is_constant: false,
            },
        ];

        let inputs: [&[f32]; 4] = [
            &[1.0, 5.0, 10.0],  // condition>0 -> positive=5.0
            &[-1.0, 5.0, 10.0], // condition<=0 -> negative=10.0
            &[0.5, 3.0, 7.0],   // condition>0 -> positive=3.0
            &[-2.0, 3.0, 7.0],  // condition<=0 -> negative=7.0
        ];

        let mut single_results = Vec::new();
        for input in &inputs {
            let mut net = make_network(3, neurons.clone(), synapses.clone());
            let result = net.activate_and_trace(input, 1);
            single_results.push(result);
        }

        let net = make_network(3, neurons.clone(), synapses.clone());
        let packed: Vec<f32> = inputs.iter().flat_map(|i| i.iter().copied()).collect();
        let batch_result = net.activate_and_trace_batch_4way(&packed, 3, 1);

        let len0 = batch_result[0] as usize;
        let len1 = batch_result[1] as usize;
        let len2 = batch_result[2] as usize;

        let start0 = 4;
        let start1 = start0 + len0;
        let start2 = start1 + len1;
        let start3 = start2 + len2;

        let batch_records = [
            &batch_result[start0..start0 + len0],
            &batch_result[start1..start1 + len1],
            &batch_result[start2..start2 + len2],
            &batch_result[start3..start3 + batch_result[3] as usize],
        ];

        for (i, (single, batch)) in single_results.iter().zip(batch_records.iter()).enumerate() {
            assert_eq!(single.len(), batch.len(), "Record {i}: length mismatch");
            for (j, (s, b)) in single.iter().zip(batch.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {i}, element {j}: single={s}, batch={b}"
                );
            }
        }
    }

    /// Test batch 4-way with constant neurons
    #[test]
    fn test_batch_4way_constant_neuron() {
        let synapses = vec![
            make_synapse(2, 1.0), // output <- constant
        ];
        let neurons = vec![
            NeuronData {
                bias: 42.0,
                start_synapse: 0,
                num_synapses: 0,
                squash_type: 0,
                is_constant: true,
            },
            NeuronData {
                bias: 0.0,
                start_synapse: 0,
                num_synapses: 1,
                squash_type: 0, // Identity
                is_constant: false,
            },
        ];

        let inputs: [&[f32]; 4] = [
            &[1.0, 2.0],
            &[3.0, 4.0],
            &[5.0, 6.0],
            &[7.0, 8.0],
        ];

        let mut single_results = Vec::new();
        for input in &inputs {
            let mut net = make_network(2, neurons.clone(), synapses.clone());
            let result = net.activate_and_trace(input, 1);
            single_results.push(result);
        }

        let net = make_network(2, neurons.clone(), synapses.clone());
        let packed: Vec<f32> = inputs.iter().flat_map(|i| i.iter().copied()).collect();
        let batch_result = net.activate_and_trace_batch_4way(&packed, 2, 1);

        // All 4 records should produce the same output (constant 42.0 passed through identity)
        for r in 0..4 {
            let start = 4 + (0..r).map(|i| batch_result[i] as usize).sum::<usize>();
            let len = batch_result[r] as usize;
            let batch_record = &batch_result[start..start + len];
            let single = &single_results[r];

            assert_eq!(single.len(), batch_record.len(), "Record {r}: length mismatch");
            for (j, (s, b)) in single.iter().zip(batch_record.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {r}, element {j}: single={s}, batch={b}"
                );
            }
        }
    }

    /// Test batch 4-way with a deeper network (multiple layers)
    #[test]
    fn test_batch_4way_multi_layer() {
        // 2 inputs -> 2 hidden (ReLU) -> 1 output (Identity)
        let synapses = vec![
            // Hidden 0 (idx 2): from input 0 and 1
            make_synapse(0, 0.5),
            make_synapse(1, 0.3),
            // Hidden 1 (idx 3): from input 0 and 1
            make_synapse(0, -0.4),
            make_synapse(1, 0.6),
            // Output (idx 4): from hidden 0 and hidden 1
            make_synapse(2, 1.0),
            make_synapse(3, -0.5),
        ];
        let neurons = vec![
            NeuronData {
                bias: 0.1,
                start_synapse: 0,
                num_synapses: 2,
                squash_type: 1, // ReLU
                is_constant: false,
            },
            NeuronData {
                bias: -0.1,
                start_synapse: 2,
                num_synapses: 2,
                squash_type: 1, // ReLU
                is_constant: false,
            },
            NeuronData {
                bias: 0.0,
                start_synapse: 4,
                num_synapses: 2,
                squash_type: 0, // Identity
                is_constant: false,
            },
        ];

        let inputs: [&[f32]; 4] = [
            &[1.0, 2.0],
            &[-1.0, 0.5],
            &[3.0, -2.0],
            &[0.0, 0.0],
        ];

        let mut single_results = Vec::new();
        for input in &inputs {
            let mut net = make_network(2, neurons.clone(), synapses.clone());
            let result = net.activate_and_trace(input, 1);
            single_results.push(result);
        }

        let net = make_network(2, neurons.clone(), synapses.clone());
        let packed: Vec<f32> = inputs.iter().flat_map(|i| i.iter().copied()).collect();
        let batch_result = net.activate_and_trace_batch_4way(&packed, 2, 1);

        for r in 0..4 {
            let start = 4 + (0..r).map(|i| batch_result[i] as usize).sum::<usize>();
            let len = batch_result[r] as usize;
            let batch_record = &batch_result[start..start + len];
            let single = &single_results[r];

            assert_eq!(single.len(), batch_record.len(), "Record {r}: length mismatch");
            for (j, (s, b)) in single.iter().zip(batch_record.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {r}, element {j}: single={s}, batch={b}"
                );
            }
        }
    }
}
