//! Predictive Coding inference (settling) engine.
//!
//! Issue #1560: Implements the iterative inference loop where latent
//! variables settle to minimise prediction error energy. This is the
//! performance-critical inner loop of the Predictive Coding framework.
//!
//! Algorithm per data sample:
//!   1. Clamp input neurons to observed data.
//!   2. Initialise latent variables (hidden neurons) from forward prediction.
//!   3. For t = 1..T_infer:
//!      a. Compute predictions and errors for all non-input neurons.
//!      b. Compute total energy E = ½ Σ ε(l)².
//!      c. Update hidden neuron latents: x(l) -= η · ∂E/∂x(l).
//!      d. If E < energyThreshold, stop early.
//!   4. Return final latent states and prediction errors.
//!
//! Matches the TypeScript reference implementation in
//! src/predictiveCoding/PredictiveCodingInference.ts within f32 precision.

use wasm_bindgen::prelude::*;

use crate::derivative::apply_derivative;
use crate::squash::{apply_squash, SquashType};

/// Neuron definition for the predictive coding engine.
/// Represents the topology of a single non-input neuron.
#[derive(Clone, Debug)]
pub struct PcNeuron {
    /// Bias value for this neuron.
    pub bias: f32,
    /// Squash (activation) function type.
    pub squash_type: SquashType,
    /// Whether this neuron is a hidden neuron (updatable during inference).
    pub is_hidden: bool,
    /// Starting index in the connections array.
    pub conn_start: usize,
    /// Number of inward connections.
    pub conn_count: usize,
}

/// An inward connection (synapse) to a neuron.
#[derive(Clone, Debug)]
pub struct PcConnection {
    /// Index of the source neuron in the full neuron array.
    pub from: usize,
    /// Weight of the connection.
    pub weight: f32,
}

/// An outward connection from a neuron to a downstream neuron.
#[derive(Clone, Debug)]
pub struct PcOutwardConnection {
    /// Index of the target neuron in the full neuron array.
    pub to: usize,
    /// Weight of the connection from source to target.
    pub weight: f32,
}

/// Result of a single predictive coding inference run.
#[derive(Clone, Debug)]
pub struct PcInferenceResult {
    /// Final latent values for all neurons.
    pub latents: Vec<f32>,
    /// Per-neuron prediction (for non-input neurons, indexed by neuron_idx - num_inputs).
    pub predictions: Vec<f32>,
    /// Per-neuron prediction error (for non-input neurons, indexed by neuron_idx - num_inputs).
    pub errors: Vec<f32>,
    /// Total prediction error energy at convergence.
    pub final_energy: f32,
    /// Energy at each iteration (for diagnostics).
    pub energy_history: Vec<f32>,
    /// Number of inference steps actually used.
    pub steps_used: u32,
    /// Whether energy converged below the threshold.
    pub converged: bool,
}

/// The Predictive Coding inference engine.
///
/// Holds the network topology and configuration for running the iterative
/// inference (settling) loop. The engine is constructed once from a creature's
/// topology and can be reused for multiple inference calls.
#[wasm_bindgen]
pub struct PredictiveCodingEngine {
    /// Total number of neurons (including inputs).
    pub(crate) num_neurons: usize,
    /// Number of input neurons.
    pub(crate) num_inputs: usize,
    /// Number of output neurons.
    pub(crate) num_outputs: usize,
    /// Non-input neuron metadata.
    pub(crate) neurons: Vec<PcNeuron>,
    /// Inward connections (synapses) for all non-input neurons, packed.
    pub(crate) connections: Vec<PcConnection>,
    /// Outward connections from each neuron (indexed by full neuron index).
    /// Each entry is a list of (target_neuron_index, weight).
    outward_connections: Vec<Vec<PcOutwardConnection>>,
    /// Indices of hidden neurons (full indices, not relative).
    hidden_indices: Vec<usize>,
    /// Maximum inference iterations.
    inference_steps: u32,
    /// Inference learning rate (η_x).
    inference_rate: f32,
    /// Convergence threshold for total energy.
    energy_threshold: f32,
}

impl PredictiveCodingEngine {
    /// Creates a new PredictiveCodingEngine from topology data.
    ///
    /// # Arguments
    /// * `num_inputs` - Number of input neurons.
    /// * `num_outputs` - Number of output neurons.
    /// * `neurons` - Non-input neuron definitions.
    /// * `connections` - Packed inward connections for non-input neurons.
    /// * `inference_steps` - Maximum settling iterations.
    /// * `inference_rate` - Learning rate for latent updates.
    /// * `energy_threshold` - Convergence threshold.
    pub fn new_from_parts(
        num_inputs: usize,
        num_outputs: usize,
        neurons: Vec<PcNeuron>,
        connections: Vec<PcConnection>,
        inference_steps: u32,
        inference_rate: f32,
        energy_threshold: f32,
    ) -> Self {
        let num_neurons = num_inputs + neurons.len();

        // Build outward connections map.
        let mut outward_connections = vec![Vec::new(); num_neurons];
        for (ni, neuron) in neurons.iter().enumerate() {
            let actual_idx = num_inputs + ni;
            for ci in neuron.conn_start..neuron.conn_start + neuron.conn_count {
                let conn = &connections[ci];
                outward_connections[conn.from].push(PcOutwardConnection {
                    to: actual_idx,
                    weight: conn.weight,
                });
            }
        }

        // Identify hidden neuron indices.
        let hidden_indices: Vec<usize> = neurons
            .iter()
            .enumerate()
            .filter(|(_, n)| n.is_hidden)
            .map(|(i, _)| num_inputs + i)
            .collect();

        PredictiveCodingEngine {
            num_neurons,
            num_inputs,
            num_outputs,
            neurons,
            connections,
            outward_connections,
            hidden_indices,
            inference_steps,
            inference_rate,
            energy_threshold,
        }
    }

    /// Computes the top-down prediction for a single non-input neuron.
    ///
    /// prediction = squash(Σ weight_i * latent[source_i] + bias)
    fn compute_prediction(&self, neuron_rel_idx: usize, latents: &[f32]) -> f32 {
        let neuron = &self.neurons[neuron_rel_idx];
        let mut weighted_sum = neuron.bias;

        for ci in neuron.conn_start..neuron.conn_start + neuron.conn_count {
            let conn = &self.connections[ci];
            weighted_sum += conn.weight * latents[conn.from];
        }

        apply_squash(neuron.squash_type, weighted_sum)
    }

    /// Computes the weighted input sum (pre-activation) for a non-input neuron.
    pub(crate) fn compute_pre_activation(&self, neuron_rel_idx: usize, latents: &[f32]) -> f32 {
        let neuron = &self.neurons[neuron_rel_idx];
        let mut weighted_sum = neuron.bias;

        for ci in neuron.conn_start..neuron.conn_start + neuron.conn_count {
            let conn = &self.connections[ci];
            weighted_sum += conn.weight * latents[conn.from];
        }

        weighted_sum
    }

    /// Computes prediction errors for all non-input neurons.
    ///
    /// Returns (predictions, errors) vectors indexed by neuron_rel_idx.
    fn compute_errors(&self, latents: &[f32]) -> (Vec<f32>, Vec<f32>) {
        let n = self.neurons.len();
        let mut predictions = vec![0.0f32; n];
        let mut errors = vec![0.0f32; n];

        for i in 0..n {
            let prediction = self.compute_prediction(i, latents);
            let latent = latents[self.num_inputs + i];
            predictions[i] = prediction;
            errors[i] = latent - prediction;
        }

        (predictions, errors)
    }

    /// Computes total energy E = ½ Σ ε(l)².
    fn compute_energy(errors: &[f32]) -> f32 {
        let mut sum_sq = 0.0f32;
        for &e in errors {
            sum_sq += e * e;
        }
        0.5 * sum_sq
    }

    /// Runs the predictive coding inference (settling) loop.
    ///
    /// # Arguments
    /// * `input` - Input values (one per input neuron).
    /// * `targets` - Optional supervised targets for output neurons.
    pub fn infer(&self, input: &[f32], targets: Option<&[f32]>) -> PcInferenceResult {
        let mut latents = vec![0.0f32; self.num_neurons];

        // Step 1: Clamp input neurons.
        let input_len = input.len().min(self.num_inputs);
        latents[..input_len].copy_from_slice(&input[..input_len]);

        // Step 2: Initialise hidden/output neurons from forward prediction.
        for i in 0..self.neurons.len() {
            latents[self.num_inputs + i] = self.compute_prediction(i, &latents);
        }

        // Clamp output neurons to targets if provided.
        if let Some(tgt) = targets {
            let output_start = self.num_neurons - self.num_outputs;
            for j in 0..self.num_outputs.min(tgt.len()) {
                latents[output_start + j] = tgt[j];
            }
        }

        // Step 3: Iterative settling loop.
        let mut energy_history = Vec::with_capacity(self.inference_steps as usize + 1);
        let mut converged = false;
        let mut steps_used = 0u32;

        // Compute initial errors.
        let (mut predictions, mut errors) = self.compute_errors(&latents);
        let mut energy = Self::compute_energy(&errors);
        energy_history.push(energy);

        for t in 0..self.inference_steps {
            steps_used = t + 1;

            // Check convergence before updating.
            if energy <= self.energy_threshold {
                converged = true;
                break;
            }

            // Update hidden neuron latents.
            for &hidden_idx in &self.hidden_indices {
                let hidden_rel = hidden_idx - self.num_inputs;
                let hidden_error = errors[hidden_rel];

                // Term 1: error at this neuron.
                let mut gradient = hidden_error;

                // Term 2: contribution from downstream neurons.
                for outward in &self.outward_connections[hidden_idx] {
                    let target_rel = outward.to - self.num_inputs;
                    let target_error = errors[target_rel];

                    // Compute derivative of the target neuron's squash function.
                    let target_squash = self.neurons[target_rel].squash_type;
                    let pre_activation = self.compute_pre_activation(target_rel, &latents);
                    let derivative = apply_derivative(target_squash, pre_activation);

                    gradient -= outward.weight * target_error * derivative;
                }

                // Update latent value: x(l) -= η · ∂E/∂x(l).
                latents[hidden_idx] -= self.inference_rate * gradient;
            }

            // Re-clamp input neurons.
            latents[..input_len].copy_from_slice(&input[..input_len]);

            // Re-clamp output neurons to targets if provided.
            if let Some(tgt) = targets {
                let output_start = self.num_neurons - self.num_outputs;
                for j in 0..self.num_outputs.min(tgt.len()) {
                    latents[output_start + j] = tgt[j];
                }
            }

            // Recompute errors and energy.
            let (new_pred, new_err) = self.compute_errors(&latents);
            predictions = new_pred;
            errors = new_err;
            energy = Self::compute_energy(&errors);
            energy_history.push(energy);
        }

        // Check final convergence if loop finished without early stopping.
        if !converged && energy <= self.energy_threshold {
            converged = true;
        }

        PcInferenceResult {
            latents,
            predictions,
            errors,
            final_energy: energy,
            energy_history,
            steps_used,
            converged,
        }
    }

    /// Runs inference on a batch of samples.
    ///
    /// Each sample is processed independently using the same network topology.
    /// Returns a vector of results, one per sample.
    pub fn infer_batch(
        &self,
        inputs: &[&[f32]],
        targets: Option<&[&[f32]]>,
    ) -> Vec<PcInferenceResult> {
        inputs
            .iter()
            .enumerate()
            .map(|(i, input)| {
                let tgt = targets.map(|t| t[i]);
                self.infer(input, tgt)
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// WASM bindings
// ---------------------------------------------------------------------------

#[wasm_bindgen]
impl PredictiveCodingEngine {
    /// Creates a new PredictiveCodingEngine from serialised topology data.
    ///
    /// Data format (all values little-endian):
    /// - u32: num_inputs
    /// - u32: num_outputs
    /// - u32: num_neurons_total (including inputs)
    /// - u32: inference_steps
    /// - f32: inference_rate
    /// - f32: energy_threshold
    /// - For each non-input neuron:
    ///   - f32: bias
    ///   - u8: squash_type
    ///   - u8: is_hidden (1 = hidden, 0 = output)
    ///   - u16: num_connections
    ///   - For each connection:
    ///     - u16: from_index
    ///     - f32: weight (as 4 bytes, little-endian)
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<PredictiveCodingEngine, JsValue> {
        if data.len() < 24 {
            return Err(JsValue::from_str("Data too short for PC engine header"));
        }

        let num_inputs =
            u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let num_outputs =
            u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let num_neurons_total =
            u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
        let inference_steps =
            u32::from_le_bytes([data[12], data[13], data[14], data[15]]);
        let inference_rate =
            f32::from_le_bytes([data[16], data[17], data[18], data[19]]);
        let energy_threshold =
            f32::from_le_bytes([data[20], data[21], data[22], data[23]]);

        let num_non_inputs = num_neurons_total - num_inputs;
        let mut neurons = Vec::with_capacity(num_non_inputs);
        let mut connections = Vec::new();
        let mut offset = 24;

        for _ in 0..num_non_inputs {
            if offset + 8 > data.len() {
                return Err(JsValue::from_str("Data too short for PC neuron"));
            }

            let bias = f32::from_le_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ]);
            let squash_type = SquashType::from(data[offset + 4]);
            let is_hidden = data[offset + 5] != 0;
            let num_conn =
                u16::from_le_bytes([data[offset + 6], data[offset + 7]]) as usize;
            offset += 8;

            let conn_start = connections.len();

            for _ in 0..num_conn {
                if offset + 6 > data.len() {
                    return Err(JsValue::from_str("Data too short for PC connection"));
                }

                let from = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
                let weight = f32::from_le_bytes([
                    data[offset + 2],
                    data[offset + 3],
                    data[offset + 4],
                    data[offset + 5],
                ]);
                offset += 6;

                connections.push(PcConnection { from, weight });
            }

            neurons.push(PcNeuron {
                bias,
                squash_type,
                is_hidden,
                conn_start,
                conn_count: num_conn,
            });
        }

        Ok(PredictiveCodingEngine::new_from_parts(
            num_inputs,
            num_outputs,
            neurons,
            connections,
            inference_steps,
            inference_rate,
            energy_threshold,
        ))
    }

    /// Runs inference and returns a packed result array.
    ///
    /// Input format: Float32Array of input values.
    /// Optional targets: Float32Array of target values for output neurons.
    ///
    /// Result format (Float32Array):
    /// - [0]: steps_used (as f32)
    /// - [1]: final_energy
    /// - [2]: converged (1.0 = true, 0.0 = false)
    /// - [3]: num_neurons
    /// - [4]: num_non_inputs
    /// - [5]: energy_history_length
    /// - [6..6+num_neurons): latent values
    /// - [6+num_neurons..6+num_neurons+num_non_inputs): predictions
    /// - [6+num_neurons+num_non_inputs..6+num_neurons+2*num_non_inputs): errors
    /// - [remaining]: energy history
    #[wasm_bindgen]
    pub fn infer_wasm(&self, input: &[f32], targets: Option<Vec<f32>>) -> Vec<f32> {
        let tgt_ref = targets.as_deref();
        let result = self.infer(input, tgt_ref);

        let num_non_inputs = self.neurons.len();
        let header_size = 6;
        let total = header_size
            + self.num_neurons
            + num_non_inputs * 2
            + result.energy_history.len();
        let mut packed = Vec::with_capacity(total);

        // Header
        packed.push(result.steps_used as f32);
        packed.push(result.final_energy);
        packed.push(if result.converged { 1.0 } else { 0.0 });
        packed.push(self.num_neurons as f32);
        packed.push(num_non_inputs as f32);
        packed.push(result.energy_history.len() as f32);

        // Latent values
        packed.extend_from_slice(&result.latents);

        // Predictions
        packed.extend_from_slice(&result.predictions);

        // Errors
        packed.extend_from_slice(&result.errors);

        // Energy history
        packed.extend_from_slice(&result.energy_history);

        packed
    }

    /// Runs inference on a batch of samples.
    ///
    /// Input format: packed Float32Array [input0..., input1..., ...]
    /// Each input has `input_size` elements.
    ///
    /// Result format: packed with per-record length headers (same as
    /// activate_and_trace_batch_4way pattern):
    /// - [0..num_samples): per-record lengths
    /// - Then each record in infer_wasm format
    #[wasm_bindgen]
    pub fn infer_batch_wasm(
        &self,
        inputs: &[f32],
        input_size: usize,
        num_samples: usize,
        targets: Option<Vec<f32>>,
        target_size: usize,
    ) -> Vec<f32> {
        let mut records: Vec<Vec<f32>> = Vec::with_capacity(num_samples);

        for i in 0..num_samples {
            let start = i * input_size;
            let end = start + input_size;
            let input = &inputs[start..end];

            let tgt = if let Some(ref t) = targets {
                let t_start = i * target_size;
                let t_end = t_start + target_size;
                if t_end <= t.len() {
                    Some(&t[t_start..t_end])
                } else {
                    None
                }
            } else {
                None
            };

            let result = self.infer(input, tgt);

            let num_non_inputs = self.neurons.len();
            let header_size = 6;
            let record_len = header_size
                + self.num_neurons
                + num_non_inputs * 2
                + result.energy_history.len();
            let mut record = Vec::with_capacity(record_len);

            record.push(result.steps_used as f32);
            record.push(result.final_energy);
            record.push(if result.converged { 1.0 } else { 0.0 });
            record.push(self.num_neurons as f32);
            record.push(num_non_inputs as f32);
            record.push(result.energy_history.len() as f32);
            record.extend_from_slice(&result.latents);
            record.extend_from_slice(&result.predictions);
            record.extend_from_slice(&result.errors);
            record.extend_from_slice(&result.energy_history);

            records.push(record);
        }

        // Pack with length headers
        let total: usize = num_samples + records.iter().map(|r| r.len()).sum::<usize>();
        let mut packed = Vec::with_capacity(total);

        // Write per-record lengths
        for record in &records {
            packed.push(record.len() as f32);
        }

        // Write records
        for record in &records {
            packed.extend_from_slice(record);
        }

        packed
    }

    /// Get the number of neurons in the engine.
    #[wasm_bindgen(getter)]
    pub fn num_neurons(&self) -> usize {
        self.num_neurons
    }

    /// Get the number of input neurons.
    #[wasm_bindgen(getter)]
    pub fn num_inputs(&self) -> usize {
        self.num_inputs
    }

    /// Get the number of output neurons.
    #[wasm_bindgen(getter)]
    pub fn num_outputs(&self) -> usize {
        self.num_outputs
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: builds a simple network for testing.
    /// 2 inputs → 1 hidden (Tanh, bias=0) → 1 output (Identity, bias=0).
    fn make_simple_network(
        inference_steps: u32,
        inference_rate: f32,
        energy_threshold: f32,
    ) -> PredictiveCodingEngine {
        // Hidden neuron (index 2): connects from inputs 0 and 1
        // Output neuron (index 3): connects from hidden 2
        let neurons = vec![
            PcNeuron {
                bias: 0.0,
                squash_type: SquashType::Tanh,
                is_hidden: true,
                conn_start: 0,
                conn_count: 2,
            },
            PcNeuron {
                bias: 0.0,
                squash_type: SquashType::Identity,
                is_hidden: false, // output
                conn_start: 2,
                conn_count: 1,
            },
        ];

        let connections = vec![
            PcConnection { from: 0, weight: 0.5 },
            PcConnection { from: 1, weight: 0.3 },
            PcConnection { from: 2, weight: 1.0 },
        ];

        PredictiveCodingEngine::new_from_parts(
            2, // num_inputs
            1, // num_outputs
            neurons,
            connections,
            inference_steps,
            inference_rate,
            energy_threshold,
        )
    }

    /// Helper: network with 2 inputs → 2 hidden → 1 output.
    fn make_deeper_network(
        inference_steps: u32,
        inference_rate: f32,
        energy_threshold: f32,
    ) -> PredictiveCodingEngine {
        // Hidden0 (idx 2): from input0 w=0.5, input1 w=-0.3
        // Hidden1 (idx 3): from input0 w=-0.4, input1 w=0.6
        // Output (idx 4): from hidden0 w=1.0, hidden1 w=-0.5
        let neurons = vec![
            PcNeuron {
                bias: 0.1,
                squash_type: SquashType::Relu,
                is_hidden: true,
                conn_start: 0,
                conn_count: 2,
            },
            PcNeuron {
                bias: -0.1,
                squash_type: SquashType::Relu,
                is_hidden: true,
                conn_start: 2,
                conn_count: 2,
            },
            PcNeuron {
                bias: 0.0,
                squash_type: SquashType::Identity,
                is_hidden: false,
                conn_start: 4,
                conn_count: 2,
            },
        ];

        let connections = vec![
            PcConnection { from: 0, weight: 0.5 },
            PcConnection { from: 1, weight: -0.3 },
            PcConnection { from: 0, weight: -0.4 },
            PcConnection { from: 1, weight: 0.6 },
            PcConnection { from: 2, weight: 1.0 },
            PcConnection { from: 3, weight: -0.5 },
        ];

        PredictiveCodingEngine::new_from_parts(2, 1, neurons, connections, inference_steps, inference_rate, energy_threshold)
    }

    #[test]
    fn test_deterministic_inference() {
        // Same input must produce exactly the same output.
        let engine = make_simple_network(50, 0.05, 1e-6);
        let input = [1.0f32, 0.5];

        let result1 = engine.infer(&input, None);
        let result2 = engine.infer(&input, None);

        assert_eq!(result1.latents, result2.latents, "Latents must be deterministic");
        assert_eq!(result1.final_energy, result2.final_energy, "Energy must be deterministic");
        assert_eq!(result1.steps_used, result2.steps_used, "Steps must be deterministic");
        assert_eq!(result1.converged, result2.converged, "Convergence must be deterministic");
    }

    #[test]
    fn test_input_clamping() {
        // Input neurons must remain clamped after inference.
        let engine = make_simple_network(50, 0.05, 1e-6);
        let input = [2.0f32, -1.5];

        let result = engine.infer(&input, None);

        assert_eq!(result.latents[0], 2.0, "Input 0 must remain clamped");
        assert_eq!(result.latents[1], -1.5, "Input 1 must remain clamped");
    }

    #[test]
    fn test_target_clamping() {
        // Output neurons must be clamped to targets when provided.
        let engine = make_simple_network(50, 0.05, 1e-6);
        let input = [1.0f32, 0.5];
        let targets = [0.8f32];

        let result = engine.infer(&input, Some(&targets));

        // Output neuron is the last one (index 3)
        let output_idx = engine.num_neurons - 1;
        assert!(
            (result.latents[output_idx] - 0.8).abs() < 1e-6,
            "Output must be clamped to target, got {}",
            result.latents[output_idx]
        );
    }

    #[test]
    fn test_energy_non_negative() {
        // Energy must always be non-negative.
        let engine = make_simple_network(50, 0.05, 1e-6);
        let input = [1.0f32, 0.5];

        let result = engine.infer(&input, None);

        assert!(result.final_energy >= 0.0, "Energy must be non-negative");
        for &e in &result.energy_history {
            assert!(e >= 0.0, "Energy at each step must be non-negative");
        }
    }

    #[test]
    fn test_energy_convergence_with_targets() {
        // With targets, energy should generally decrease (or at least not increase
        // dramatically) as inference settles.
        let engine = make_simple_network(100, 0.05, 1e-10);
        let input = [1.0f32, 0.5];
        let targets = [0.5f32];

        let result = engine.infer(&input, Some(&targets));

        // Check that the final energy is less than or equal to the initial energy.
        let initial_energy = result.energy_history[0];
        assert!(
            result.final_energy <= initial_energy + 1e-5,
            "Final energy {} should not exceed initial energy {} significantly",
            result.final_energy,
            initial_energy
        );
    }

    #[test]
    fn test_early_termination() {
        // With a high threshold, inference should stop early.
        let engine = make_simple_network(1000, 0.05, 1e6); // Very high threshold
        let input = [1.0f32, 0.5];

        let result = engine.infer(&input, None);

        // Should converge immediately since threshold is very high.
        assert!(result.converged, "Should converge with high threshold");
        // Initial energy is computed before any update, and convergence checked
        // at the start of each iteration, so steps_used should be 1.
        assert!(result.steps_used <= 1, "Should stop early, got {} steps", result.steps_used);
    }

    #[test]
    fn test_zero_steps() {
        // With 0 inference steps, should just return initial state.
        let engine = make_simple_network(0, 0.05, 1e-6);
        let input = [1.0f32, 0.5];

        let result = engine.infer(&input, None);

        assert_eq!(result.steps_used, 0, "Should use 0 steps");
        // Energy history should have only the initial energy.
        assert_eq!(result.energy_history.len(), 1, "Should have initial energy only");
    }

    #[test]
    fn test_prediction_error_computation() {
        // For a network with no hidden neurons (just input→output with identity),
        // the prediction should match the weighted sum + bias.
        let neurons = vec![PcNeuron {
            bias: 0.5,
            squash_type: SquashType::Identity,
            is_hidden: false,
            conn_start: 0,
            conn_count: 1,
        }];
        let connections = vec![PcConnection { from: 0, weight: 2.0 }];

        let engine = PredictiveCodingEngine::new_from_parts(
            1, 1, neurons, connections, 0, 0.05, 1e-6,
        );

        let input = [3.0f32];
        let result = engine.infer(&input, None);

        // prediction = identity(2.0 * 3.0 + 0.5) = 6.5
        // latent was initialised to prediction, so error = 0
        assert!(
            (result.predictions[0] - 6.5).abs() < 1e-5,
            "Prediction should be 6.5, got {}",
            result.predictions[0]
        );
        assert!(
            result.errors[0].abs() < 1e-5,
            "Error should be ~0 for initialised latent, got {}",
            result.errors[0]
        );
    }

    #[test]
    fn test_batch_matches_sequential() {
        // Batch inference must produce identical results to sequential inference.
        let engine = make_deeper_network(20, 0.05, 1e-6);

        let input0 = [1.0f32, 0.5];
        let input1 = [-1.0f32, 2.0];
        let input2 = [0.0f32, 0.0];
        let input3 = [3.0f32, -2.0];

        let seq_results: Vec<PcInferenceResult> = vec![
            engine.infer(&input0, None),
            engine.infer(&input1, None),
            engine.infer(&input2, None),
            engine.infer(&input3, None),
        ];

        let inputs: Vec<&[f32]> = vec![&input0, &input1, &input2, &input3];
        let batch_results = engine.infer_batch(&inputs, None);

        assert_eq!(batch_results.len(), 4, "Batch should return 4 results");

        for (i, (seq, batch)) in seq_results.iter().zip(batch_results.iter()).enumerate() {
            assert_eq!(
                seq.latents.len(),
                batch.latents.len(),
                "Record {i}: latent length mismatch"
            );
            for (j, (s, b)) in seq.latents.iter().zip(batch.latents.iter()).enumerate() {
                assert!(
                    (s - b).abs() < 1e-5,
                    "Record {i}, latent {j}: seq={s}, batch={b}"
                );
            }
            assert!(
                (seq.final_energy - batch.final_energy).abs() < 1e-5,
                "Record {i}: energy mismatch seq={}, batch={}",
                seq.final_energy,
                batch.final_energy
            );
            assert_eq!(
                seq.steps_used, batch.steps_used,
                "Record {i}: steps mismatch"
            );
        }
    }

    #[test]
    fn test_deeper_network_settles() {
        // A deeper network should still settle and produce reasonable results.
        let engine = make_deeper_network(100, 0.05, 1e-6);
        let input = [1.0f32, 2.0];

        let result = engine.infer(&input, None);

        // Input neurons must remain clamped.
        assert_eq!(result.latents[0], 1.0);
        assert_eq!(result.latents[1], 2.0);

        // Energy must be non-negative.
        assert!(result.final_energy >= 0.0);

        // All predictions and errors should be finite.
        for &p in &result.predictions {
            assert!(p.is_finite(), "Prediction must be finite, got {p}");
        }
        for &e in &result.errors {
            assert!(e.is_finite(), "Error must be finite, got {e}");
        }
    }

    #[test]
    fn test_energy_history_length() {
        // Energy history should have initial + one entry per completed step.
        let engine = make_simple_network(10, 0.05, 1e-10); // Low threshold so it won't converge early
        let input = [1.0f32, 0.5];
        let targets = [0.5f32];

        let result = engine.infer(&input, Some(&targets));

        // history starts with 1 (initial), then adds 1 per step
        // If converged, history length = steps_used + 1 (might be less than 10+1)
        // If not converged, history length = inference_steps + 1
        assert!(
            result.energy_history.len() >= 2,
            "Energy history should have at least 2 entries"
        );
        assert!(
            result.energy_history.len() <= 11,
            "Energy history should have at most 11 entries (10 steps + initial)"
        );
    }

    #[test]
    fn test_various_squash_functions() {
        // Test with different squash functions.
        let squash_types = [
            SquashType::Identity,
            SquashType::Relu,
            SquashType::Tanh,
            SquashType::Logistic,
            SquashType::LeakyRelu,
        ];

        for &squash in &squash_types {
            let neurons = vec![
                PcNeuron {
                    bias: 0.1,
                    squash_type: squash,
                    is_hidden: true,
                    conn_start: 0,
                    conn_count: 1,
                },
                PcNeuron {
                    bias: 0.0,
                    squash_type: SquashType::Identity,
                    is_hidden: false,
                    conn_start: 1,
                    conn_count: 1,
                },
            ];
            let connections = vec![
                PcConnection { from: 0, weight: 1.0 },
                PcConnection { from: 2, weight: 1.0 },
            ];

            let engine = PredictiveCodingEngine::new_from_parts(
                2, 1, neurons, connections, 20, 0.05, 1e-6,
            );

            let result = engine.infer(&[1.0, 0.5], None);

            assert!(
                result.final_energy.is_finite(),
                "Energy must be finite for {:?}",
                squash
            );
            for &l in &result.latents {
                assert!(l.is_finite(), "Latent must be finite for {:?}", squash);
            }
        }
    }

    #[test]
    fn test_no_hidden_neurons() {
        // Network with only input→output (no hidden neurons to update).
        let neurons = vec![PcNeuron {
            bias: 0.0,
            squash_type: SquashType::Identity,
            is_hidden: false,
            conn_start: 0,
            conn_count: 1,
        }];
        let connections = vec![PcConnection { from: 0, weight: 1.0 }];

        let engine = PredictiveCodingEngine::new_from_parts(
            1, 1, neurons, connections, 50, 0.05, 1e-6,
        );

        let result = engine.infer(&[2.0], None);

        // With no hidden neurons, the latent for the output should be the prediction.
        // prediction = identity(1.0 * 2.0 + 0.0) = 2.0, error = 0.
        assert!(
            (result.latents[1] - 2.0).abs() < 1e-5,
            "Output latent should be 2.0, got {}",
            result.latents[1]
        );
        assert!(
            result.final_energy < 1e-5,
            "Energy should be ~0 with no hidden neurons, got {}",
            result.final_energy
        );
    }

    #[test]
    fn test_wasm_serialisation_roundtrip() {
        // Test that the WASM binary serialisation format works correctly.
        let mut data: Vec<u8> = Vec::new();

        // Header: num_inputs=2, num_outputs=1, num_neurons=4, steps=10, rate=0.05, threshold=1e-6
        data.extend_from_slice(&2u32.to_le_bytes());  // num_inputs
        data.extend_from_slice(&1u32.to_le_bytes());  // num_outputs
        data.extend_from_slice(&4u32.to_le_bytes());  // num_neurons_total
        data.extend_from_slice(&10u32.to_le_bytes()); // inference_steps
        data.extend_from_slice(&0.05f32.to_le_bytes()); // inference_rate
        data.extend_from_slice(&1e-6f32.to_le_bytes()); // energy_threshold

        // Neuron 0 (hidden, Tanh): bias=0.0, squash=7(Tanh), is_hidden=1, 2 connections
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.push(7); // Tanh
        data.push(1); // is_hidden
        data.extend_from_slice(&2u16.to_le_bytes());
        // Connection from input 0, weight 0.5
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0.5f32.to_le_bytes());
        // Connection from input 1, weight 0.3
        data.extend_from_slice(&1u16.to_le_bytes());
        data.extend_from_slice(&0.3f32.to_le_bytes());

        // Neuron 1 (output, Identity): bias=0.0, squash=0(Identity), is_hidden=0, 1 connection
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.push(0); // Identity
        data.push(0); // is_hidden = false (output)
        data.extend_from_slice(&1u16.to_le_bytes());
        // Connection from hidden 0 (full index 2), weight 1.0
        data.extend_from_slice(&2u16.to_le_bytes());
        data.extend_from_slice(&1.0f32.to_le_bytes());

        let engine = PredictiveCodingEngine::new(&data).expect("Should parse successfully");

        assert_eq!(engine.num_inputs, 2);
        assert_eq!(engine.num_outputs, 1);
        assert_eq!(engine.num_neurons, 4);

        // Run inference to verify it works.
        let result = engine.infer(&[1.0, 0.5], None);
        assert!(result.final_energy.is_finite());
        assert_eq!(result.latents.len(), 4);
    }
}
