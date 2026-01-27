//! Compiled neural network data structures and activation.
//!
//! This module provides the CompiledNetwork struct which represents a neural network
//! compiled for efficient activation in WASM. Issue #1116, #1121, #1125, #1173, #1175, #1177.

use js_sys::Float32Array;
use wasm_bindgen::prelude::*;

use crate::range::apply_limit_range;
use crate::simd::weighted_sum_simd;
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
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        // Issue #1178 - Use SIMD-optimised weighted sum
                        #[cfg(target_arch = "wasm32")]
                        let sum = unsafe {
                            weighted_sum_simd(
                                &self.synapses,
                                &self.activations,
                                start_synapse,
                                end_synapse,
                                neuron.bias,
                            )
                        };
                        #[cfg(not(target_arch = "wasm32"))]
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
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        // Issue #1178 - Use SIMD-optimised weighted sum
                        #[cfg(target_arch = "wasm32")]
                        let sum = unsafe {
                            weighted_sum_simd(
                                &self.synapses,
                                &self.activations,
                                start_synapse,
                                end_synapse,
                                neuron.bias,
                            )
                        };
                        #[cfg(not(target_arch = "wasm32"))]
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
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        // Issue #1178 - Use SIMD-optimised weighted sum
                        #[cfg(target_arch = "wasm32")]
                        let sum = unsafe {
                            weighted_sum_simd(
                                &self.synapses,
                                &self.activations,
                                start_synapse,
                                end_synapse,
                                neuron.bias,
                            )
                        };
                        #[cfg(not(target_arch = "wasm32"))]
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
                    SquashType::Minimum | SquashType::Maximum | SquashType::If => {
                        activation_limited
                    }
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
}
