//! WASM Activation Module for NEAT-AI
//!
//! This module provides WebAssembly implementations of neural network activation
//! functions for the NEAT-AI project. It is a prototype for Issue #1116 to evaluate
//! whether WASM can provide significant performance improvements over dynamically
//! generated JavaScript functions.
//!
//! The module implements a compiled activation function approach where:
//! 1. Network topology (weights, biases, connections) is serialised to a compact format
//! 2. The activation function iterates through neurons applying weighted sums and squash functions
//! 3. All computation happens in WASM linear memory to avoid JS/WASM boundary overhead

use wasm_bindgen::prelude::*;
use js_sys::Float32Array;
// Note: E and PI are not currently used but kept for potential future squash functions

// SELU constants
const SELU_ALPHA: f32 = 1.6732632423543772;
const SELU_LAMBDA: f32 = 1.0507009873554805;

// GELU constant
const GELU_COEFF: f32 = 0.044715;
const SQRT_2_OVER_PI: f32 = 0.7978845608028654; // sqrt(2/pi)

// LeakyReLU alpha
const LEAKY_RELU_ALPHA: f32 = 0.01;

/// Squash function identifiers - must match TypeScript enum
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SquashType {
    Identity = 0,
    Relu = 1,
    Relu6 = 2,
    LeakyRelu = 3,
    Selu = 4,
    Elu = 5,
    Logistic = 6,
    Tanh = 7,
    HardTanh = 8,
    Softsign = 9,
    Softplus = 10,
    Swish = 11,
    Mish = 12,
    Gelu = 13,
    Sine = 14,
    Cosine = 15,
    Tan = 16,
    ArcTan = 17,
    Gaussian = 18,
    BentIdentity = 19,
    BipolarSigmoid = 20,
    Bipolar = 21,
    Step = 22,
    Complement = 23,
    Absolute = 24,
    Square = 25,
    Cube = 26,
    Sqrt = 27,
    StdInverse = 28,
    Exponential = 29,
    LogSigmoid = 30,
    Isru = 31,
    // Aggregate functions (Issue #1125)
    Minimum = 32,
    Maximum = 33,
    If = 34,
}

/// Synapse type identifiers for aggregate functions (Issue #1125)
/// These are used by IF squash function to categorise inputs
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SynapseType {
    /// Standard synapse (no special type) - also used as "positive" for IF
    Standard = 0,
    /// Condition synapse for IF activation
    Condition = 1,
    /// Negative synapse for IF activation
    Negative = 2,
    /// Positive synapse for IF activation (explicit)
    Positive = 3,
}

impl From<u8> for SynapseType {
    fn from(v: u8) -> Self {
        match v {
            1 => SynapseType::Condition,
            2 => SynapseType::Negative,
            3 => SynapseType::Positive,
            _ => SynapseType::Standard,
        }
    }
}

impl From<u8> for SquashType {
    fn from(v: u8) -> Self {
        match v {
            0 => SquashType::Identity,
            1 => SquashType::Relu,
            2 => SquashType::Relu6,
            3 => SquashType::LeakyRelu,
            4 => SquashType::Selu,
            5 => SquashType::Elu,
            6 => SquashType::Logistic,
            7 => SquashType::Tanh,
            8 => SquashType::HardTanh,
            9 => SquashType::Softsign,
            10 => SquashType::Softplus,
            11 => SquashType::Swish,
            12 => SquashType::Mish,
            13 => SquashType::Gelu,
            14 => SquashType::Sine,
            15 => SquashType::Cosine,
            16 => SquashType::Tan,
            17 => SquashType::ArcTan,
            18 => SquashType::Gaussian,
            19 => SquashType::BentIdentity,
            20 => SquashType::BipolarSigmoid,
            21 => SquashType::Bipolar,
            22 => SquashType::Step,
            23 => SquashType::Complement,
            24 => SquashType::Absolute,
            25 => SquashType::Square,
            26 => SquashType::Cube,
            27 => SquashType::Sqrt,
            28 => SquashType::StdInverse,
            29 => SquashType::Exponential,
            30 => SquashType::LogSigmoid,
            31 => SquashType::Isru,
            // Aggregate functions (Issue #1125)
            32 => SquashType::Minimum,
            33 => SquashType::Maximum,
            34 => SquashType::If,
            _ => SquashType::Identity,
        }
    }
}

/// Apply a squash function to a value
#[inline(always)]
fn apply_squash(squash_type: SquashType, x: f32) -> f32 {
    match squash_type {
        SquashType::Identity => x,
        SquashType::Relu => x.max(0.0),
        SquashType::Relu6 => x.max(0.0).min(6.0),
        SquashType::LeakyRelu => if x >= 0.0 { x } else { LEAKY_RELU_ALPHA * x },
        SquashType::Selu => {
            if x >= 0.0 {
                SELU_LAMBDA * x
            } else {
                SELU_LAMBDA * SELU_ALPHA * (x.exp() - 1.0)
            }
        }
        SquashType::Elu => if x > 0.0 { x } else { x.exp() - 1.0 },
        SquashType::Logistic => 1.0 / (1.0 + (-x).exp()),
        SquashType::Tanh => x.tanh(),
        SquashType::HardTanh => x.max(-1.0).min(1.0),
        SquashType::Softsign => x / (1.0 + x.abs()),
        SquashType::Softplus => (1.0 + x.exp()).ln(),
        SquashType::Swish => x / (1.0 + (-x).exp()),
        SquashType::Mish => x * (1.0 + x.exp()).ln().tanh(),
        SquashType::Gelu => {
            0.5 * x * (1.0 + (SQRT_2_OVER_PI * (x + GELU_COEFF * x * x * x)).tanh())
        }
        SquashType::Sine => x.sin(),
        SquashType::Cosine => x.cos(),
        SquashType::Tan => x.tan(),
        SquashType::ArcTan => x.atan(),
        SquashType::Gaussian => (-x * x).exp(),
        SquashType::BentIdentity => ((x * x + 1.0).sqrt() - 1.0) / 2.0 + x,
        SquashType::BipolarSigmoid => 2.0 / (1.0 + (-x).exp()) - 1.0,
        SquashType::Bipolar => if x > 0.0 { 1.0 } else { -1.0 },
        SquashType::Step => if x > 0.0 { 1.0 } else { 0.0 },
        SquashType::Complement => 1.0 - x,
        SquashType::Absolute => x.abs(),
        SquashType::Square => x * x,
        SquashType::Cube => x * x * x,
        SquashType::Sqrt => if x >= 0.0 { x.sqrt() } else { 0.0 },
        SquashType::StdInverse => {
            if x.abs() < 1e-10 {
                if x >= 0.0 { 1e10 } else { -1e10 }
            } else {
                1.0 / x
            }
        }
        SquashType::Exponential => x.exp(),
        SquashType::LogSigmoid => -(1.0 + (-x).exp()).ln(),
        SquashType::Isru => x / (1.0 + x * x).sqrt(),
        // Aggregate functions (Issue #1125) - these are handled specially in the
        // neuron activation loop and don't use the standard sum-then-squash pattern.
        // Return identity as a fallback if they're ever called directly.
        SquashType::Minimum | SquashType::Maximum | SquashType::If => x,
    }
}

/// Apply a derivative function to a value
/// Issue #1138 - WASM Migration Phase 6: Implement derivative() in Rust/WASM
///
/// Each derivative formula matches the corresponding TypeScript implementation.
#[inline(always)]
fn apply_derivative(squash_type: SquashType, x: f32) -> f32 {
    match squash_type {
        // f(x) = x, f'(x) = 1
        SquashType::Identity => 1.0,

        // f(x) = max(0, x), f'(x) = x > 0 ? 1 : 0
        SquashType::Relu => if x > 0.0 { 1.0 } else { 0.0 },

        // f(x) = clamp(x, 0, 6), f'(x) = x > 0 && x < 6 ? 1 : 0
        SquashType::Relu6 => if x > 0.0 && x < 6.0 { 1.0 } else { 0.0 },

        // f(x) = x >= 0 ? x : 0.01*x, f'(x) = x >= 0 ? 1 : 0.01
        SquashType::LeakyRelu => if x >= 0.0 { 1.0 } else { LEAKY_RELU_ALPHA },

        // f(x) = lambda * (x >= 0 ? x : alpha * (exp(x) - 1))
        // f'(x) = lambda * (x >= 0 ? 1 : alpha * exp(x))
        SquashType::Selu => {
            if x >= 0.0 {
                SELU_LAMBDA
            } else {
                SELU_LAMBDA * SELU_ALPHA * x.exp()
            }
        }

        // f(x) = x > 0 ? x : exp(x) - 1
        // f'(x) = x > 0 ? 1 : exp(x)
        // Note: JS uses f(x) + alpha where alpha=1, which equals exp(x) for x<=0
        SquashType::Elu => if x > 0.0 { 1.0 } else { x.exp() },

        // f(x) = 1 / (1 + exp(-x)) (sigmoid)
        // f'(x) = f(x) * (1 - f(x))
        SquashType::Logistic => {
            let y = 1.0 / (1.0 + (-x).exp());
            y * (1.0 - y)
        }

        // f(x) = tanh(x)
        // f'(x) = 1 - tanh(x)^2
        SquashType::Tanh => {
            let y = x.tanh();
            1.0 - y * y
        }

        // f(x) = clamp(x, -1, 1)
        // f'(x) = x > -1 && x < 1 ? 1 : 0
        SquashType::HardTanh => if x > -1.0 && x < 1.0 { 1.0 } else { 0.0 },

        // f(x) = x / (1 + |x|)
        // f'(x) = 1 / (1 + |x|)^2
        SquashType::Softsign => {
            let denom = 1.0 + x.abs();
            1.0 / (denom * denom)
        }

        // f(x) = ln(1 + exp(x))
        // f'(x) = 1 / (1 + exp(-x)) = sigmoid(x)
        SquashType::Softplus => {
            let d = 1.0 / (1.0 + (-x).exp());
            if d.is_finite() { d } else { 0.0 }
        }

        // f(x) = x * sigmoid(x) = x / (1 + exp(-x))
        // f'(x) = sigmoid(x) + x * sigmoid(x) * (1 - sigmoid(x))
        //       = sigmoid(x) * (1 + x * (1 - sigmoid(x)))
        SquashType::Swish => {
            let sigmoid = 1.0 / (1.0 + (-x).exp());
            sigmoid * (1.0 + x * (1.0 - sigmoid))
        }

        // f(x) = x * tanh(ln(1 + exp(x)))
        // f'(x) = exp(x) * omega / delta^2
        // where omega = 4*e^(2x) + 4*e^x*x + e^(2x)*x^2 + 2*e^x*x^2 + 2*x^3 + 4*e^x + 4*x + 6
        //       delta = 2 + 2*e^x + e^(2x)
        SquashType::Mish => {
            let e_x = x.exp();
            let e_2x = (2.0 * x).exp();
            let x2 = x * x;
            let x3 = x2 * x;

            let omega = 4.0 * e_2x + 4.0 * e_x * x + e_2x * x2 + 2.0 * e_x * x2 +
                2.0 * x3 + 4.0 * e_x + 4.0 * x + 6.0;
            let delta = 2.0 + 2.0 * e_x + e_2x;
            let raw = e_x * omega / (delta * delta);

            if raw.is_finite() { raw.max(0.0) } else { 0.0 }
        }

        // f(x) = 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
        // f'(x) = cdf + pdf where:
        //   inner = sqrt(2/pi) * (x + 0.044715 * x^3)
        //   cdf = 0.5 * (1 + tanh(inner))
        //   pdf = 0.5 * x * (1 - tanh^2(inner)) * sqrt(2/pi) * (1 + 3 * 0.044715 * x^2)
        SquashType::Gelu => {
            let inner = SQRT_2_OVER_PI * (x + GELU_COEFF * x * x * x);
            let tanh_inner = inner.tanh();

            let cdf = 0.5 * (1.0 + tanh_inner);
            let pdf = (0.5 * x * (1.0 - tanh_inner * tanh_inner)) *
                SQRT_2_OVER_PI *
                (1.0 + 3.0 * GELU_COEFF * x * x);

            let result = cdf + pdf;
            if result.is_finite() { result } else { 0.0 }
        }

        // f(x) = sin(x), f'(x) = cos(x)
        SquashType::Sine => x.cos(),

        // f(x) = cos(x), f'(x) = -sin(x)
        SquashType::Cosine => -x.sin(),

        // f(x) = tan(x), f'(x) = 1 + tan^2(x) = 1/cos^2(x)
        // Cap to prevent explosion near asymptotes
        SquashType::Tan => {
            let tan_x = x.tan();
            let d = 1.0 + tan_x * tan_x;
            if !d.is_finite() || d > 1000.0 { 1000.0 } else { d }
        }

        // f(x) = atan(x), f'(x) = 1 / (1 + x^2)
        SquashType::ArcTan => 1.0 / (1.0 + x * x),

        // f(x) = exp(-x^2), f'(x) = -2x * exp(-x^2)
        SquashType::Gaussian => {
            let result = -2.0 * x * (-x * x).exp();
            if result.is_finite() && result.abs() >= 1e-300 { result } else { 0.0 }
        }

        // f(x) = (sqrt(x^2 + 1) - 1) / 2 + x
        // f'(x) = x / (2 * sqrt(x^2 + 1)) + 1
        SquashType::BentIdentity => x / (2.0 * (x * x + 1.0).sqrt()) + 1.0,

        // f(x) = 2 / (1 + exp(-x)) - 1
        // f'(x) = (1 - f(x)^2) / 2
        SquashType::BipolarSigmoid => {
            let fx = 2.0 / (1.0 + (-x).exp()) - 1.0;
            (1.0 - fx * fx) / 2.0
        }

        // f(x) = x > 0 ? 1 : -1 (step function)
        // f'(x) = 0 (not differentiable)
        SquashType::Bipolar => 0.0,

        // f(x) = x > 0 ? 1 : 0 (step function)
        // f'(x) = 0 (with small pseudo-gradient near 0 in JS)
        // Note: JS returns 0.01 for |x| < 0.01, but we return 0 for simplicity
        // since the derivative is undefined everywhere
        SquashType::Step => {
            let epsilon = 0.01;
            if x.abs() < epsilon { 0.01 } else { 0.0 }
        }

        // f(x) = 1 - x, f'(x) = -1
        SquashType::Complement => -1.0,

        // f(x) = |x|, f'(x) = x > 0 ? 1 : (x < 0 ? -1 : 0)
        SquashType::Absolute => {
            if x > 0.0 { 1.0 }
            else if x < 0.0 { -1.0 }
            else { 0.0 }
        }

        // f(x) = x^2, f'(x) = 2x
        SquashType::Square => {
            if x.is_finite() { 2.0 * x } else { 0.0 }
        }

        // f(x) = x^3, f'(x) = 3x^2
        SquashType::Cube => 3.0 * x * x,

        // f(x) = sqrt(x) for x >= 0, f'(x) = 1 / (2 * sqrt(x)) for x > 0
        SquashType::Sqrt => {
            if x > 0.0 { 1.0 / (2.0 * x.sqrt()) } else { 0.0 }
        }

        // Note: StdInverse in JS is implemented as f(x) = 1/(1+|x|)
        // f'(x) = -sign(x) / (1 + |x|)^2
        // Note: JS Math.sign(0) = 0, but Rust signum(0.0) = 1.0, so we handle 0 specially
        SquashType::StdInverse => {
            if x == 0.0 {
                0.0
            } else {
                let abs_x = x.abs();
                let denom = (1.0 + abs_x) * (1.0 + abs_x);
                -x.signum() / denom
            }
        }

        // f(x) = exp(x), f'(x) = exp(x)
        // Cap to prevent explosion
        SquashType::Exponential => {
            let raw = x.exp();
            // Match JS: cap at 50 to avoid exploding gradients
            if raw < 1e-12 { 0.0 }
            else if raw > 50.0 { 50.0 }
            else { raw }
        }

        // f(x) = log(sigmoid(x)) = -log(1 + exp(-x))
        // f'(x) = 1 - sigmoid(x) = exp(-x) / (1 + exp(-x))
        SquashType::LogSigmoid => {
            // Handle overflow/underflow
            if x >= 709.0 { return 0.0; }
            if x <= -709.0 { return 1.0; }

            let exp_neg_x = (-x).exp();
            let value = exp_neg_x / (1.0 + exp_neg_x);

            // Clamp to safe float range
            value.max(1e-6).min(1.0)
        }

        // f(x) = x / sqrt(1 + alpha * x^2), alpha = 1
        // f'(x) = (1 + x^2)^(-3/2)
        SquashType::Isru => {
            let x2 = x * x;
            let denom = 1.0 + x2;
            if denom < 1e-12 { 0.0 } else { denom.powf(-1.5) }
        }

        // Aggregate functions don't have traditional derivatives
        // Return 0 as a safe default
        SquashType::Minimum | SquashType::Maximum | SquashType::If => 0.0,
    }
}

/// Compiled network data structure
///
/// Format (Issue #1125 - updated to support aggregate functions):
/// - Header: [num_neurons: u32, num_inputs: u32]
/// - Neuron data: For each neuron after inputs:
///   - [bias: f32, squash_type: u8, is_constant: u8, num_synapses: u16]
///   - Connections: [from_index: u16, synapse_type: u8, padding: u8, weight: f32] * num_connections
///
/// Synapse types (for IF activation):
///   - 0: Standard/Positive (used in weighted sum or as positive branch for IF)
///   - 1: Condition (for IF: summed to determine branch)
///   - 2: Negative (for IF: used when condition <= 0)
///   - 3: Positive (explicit, same as Standard for IF)
///
/// This compact format minimises memory access and enables efficient iteration.
#[wasm_bindgen]
pub struct CompiledNetwork {
    /// Total number of neurons (including input)
    num_neurons: usize,
    /// Number of input neurons
    num_inputs: usize,
    /// Neuron metadata: (bias, squash_type, start_synapse_idx, num_synapses, is_constant)
    neurons: Vec<(f32, u8, usize, usize, bool)>,
    /// Synapse data: (from_index, synapse_type, weight)
    synapses: Vec<(usize, u8, f32)>,
    /// Activation buffer - reused across calls
    activations: Vec<f32>,
}

#[wasm_bindgen]
impl CompiledNetwork {
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
    ///     - f32: weight
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<CompiledNetwork, JsValue> {
        if data.len() < 8 {
            return Err(JsValue::from_str("Data too short for header"));
        }

        let num_neurons = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let num_inputs = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;

        let mut neurons = Vec::with_capacity(num_neurons - num_inputs);
        let mut synapses = Vec::new();
        let mut offset = 8;

        for _ in num_inputs..num_neurons {
            if offset + 8 > data.len() {
                return Err(JsValue::from_str("Data too short for neuron"));
            }

            let bias = f32::from_le_bytes([
                data[offset], data[offset + 1], data[offset + 2], data[offset + 3]
            ]);
            let squash_type = data[offset + 4];
            let is_constant = data[offset + 5] != 0;
            let num_synapse = u16::from_le_bytes([data[offset + 6], data[offset + 7]]) as usize;
            offset += 8;

            let start_synapse_idx = synapses.len();

            for _ in 0..num_synapse {
                if offset + 8 > data.len() {
                    return Err(JsValue::from_str("Data too short for synapse"));
                }

                let from_index = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
                let synapse_type = data[offset + 2];
                // offset + 3 is padding
                let weight = f32::from_le_bytes([
                    data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]
                ]);
                offset += 8;

                synapses.push((from_index, synapse_type, weight));
            }

            neurons.push((bias, squash_type, start_synapse_idx, num_synapse, is_constant));
        }

        Ok(CompiledNetwork {
            num_neurons,
            num_inputs,
            neurons,
            synapses,
            activations: vec![0.0; num_neurons],
        })
    }

    /// Activate the network with the given input values
    /// Returns the output values
    #[wasm_bindgen]
    pub fn activate(&mut self, input: &[f32], num_outputs: usize) -> Float32Array {
        // Copy input values to activation buffer
        for (i, &val) in input.iter().enumerate() {
            if i < self.num_inputs {
                self.activations[i] = val;
            }
        }

        // Process each neuron in order
        for (neuron_idx, &(bias, squash_type, start_synapse, num_synapse, is_constant)) in self.neurons.iter().enumerate() {
            let actual_idx = self.num_inputs + neuron_idx;

            if is_constant {
                // Constant neuron - just set the bias value
                self.activations[actual_idx] = bias;
            } else {
                let squash = SquashType::from(squash_type);

                // Handle aggregate functions differently (Issue #1125)
                let activation = match squash {
                    SquashType::Minimum => {
                        // MINIMUM: take the minimum of all weighted inputs + bias
                        let mut min_val = f32::INFINITY;
                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, _, weight) = self.synapses[synapse_idx];
                            let val = self.activations[from_idx] * weight;
                            if val < min_val {
                                min_val = val;
                            }
                        }
                        if min_val == f32::INFINITY {
                            bias
                        } else {
                            min_val + bias
                        }
                    }
                    SquashType::Maximum => {
                        // MAXIMUM: take the maximum of all weighted inputs + bias
                        let mut max_val = f32::NEG_INFINITY;
                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, _, weight) = self.synapses[synapse_idx];
                            let val = self.activations[from_idx] * weight;
                            if val > max_val {
                                max_val = val;
                            }
                        }
                        if max_val == f32::NEG_INFINITY {
                            bias
                        } else {
                            max_val + bias
                        }
                    }
                    SquashType::If => {
                        // IF: sum condition inputs, then use positive or negative branch
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;

                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, syn_type, weight) = self.synapses[synapse_idx];
                            let val = self.activations[from_idx] * weight;

                            match SynapseType::from(syn_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => positive_sum += val,
                            }
                        }

                        if condition_sum > 0.0 {
                            positive_sum + bias
                        } else {
                            negative_sum + bias
                        }
                    }
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        let mut sum = bias;
                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, _, weight) = self.synapses[synapse_idx];
                            sum += self.activations[from_idx] * weight;
                        }
                        apply_squash(squash, sum)
                    }
                };

                self.activations[actual_idx] = activation;
            }
        }

        // Extract outputs from the end of the activation buffer
        let output_start = self.num_neurons - num_outputs;
        let output_slice = &self.activations[output_start..];

        // Create a Float32Array to return to JS
        let result = Float32Array::new_with_length(num_outputs as u32);
        for (i, &val) in output_slice.iter().enumerate() {
            result.set_index(i as u32, val);
        }
        result
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
    pub fn activate_and_trace(&mut self, input: &[f32], num_outputs: usize) -> Float32Array {
        // Copy input values to activation buffer
        for (i, &val) in input.iter().enumerate() {
            if i < self.num_inputs {
                self.activations[i] = val;
            }
        }

        // Track trace data for aggregate functions
        // Format: pairs of (neuron_relative_index, trace_info), terminated by -1.0
        let mut trace_data: Vec<f32> = Vec::new();

        // Track pre-squash values (hintValues) for backpropagation
        let num_non_inputs = self.num_neurons - self.num_inputs;
        let mut hint_values: Vec<f32> = vec![0.0; num_non_inputs];

        // Process each neuron in order
        for (neuron_idx, &(bias, squash_type, start_synapse, num_synapse, is_constant)) in self.neurons.iter().enumerate() {
            let actual_idx = self.num_inputs + neuron_idx;

            if is_constant {
                // Constant neuron - just set the bias value
                self.activations[actual_idx] = bias;
                hint_values[neuron_idx] = bias;
            } else {
                let squash = SquashType::from(squash_type);

                // Handle aggregate functions differently (Issue #1125)
                let (activation, hint_value) = match squash {
                    SquashType::Minimum => {
                        // MINIMUM: take the minimum of all weighted inputs + bias
                        // Track which synapse provided the minimum value
                        let mut min_val = f32::INFINITY;
                        let mut min_local_idx: usize = 0;
                        for local_idx in 0..num_synapse {
                            let synapse_idx = start_synapse + local_idx;
                            let (from_idx, _, weight) = self.synapses[synapse_idx];
                            let val = self.activations[from_idx] * weight;
                            if val < min_val {
                                min_val = val;
                                min_local_idx = local_idx;
                            }
                        }
                        // Record trace: neuron index and winning synapse local index
                        trace_data.push(neuron_idx as f32);
                        trace_data.push(min_local_idx as f32);

                        let result = if min_val == f32::INFINITY {
                            bias
                        } else {
                            min_val + bias
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
                            let (from_idx, _, weight) = self.synapses[synapse_idx];
                            let val = self.activations[from_idx] * weight;
                            if val > max_val {
                                max_val = val;
                                max_local_idx = local_idx;
                            }
                        }
                        // Record trace: neuron index and winning synapse local index
                        trace_data.push(neuron_idx as f32);
                        trace_data.push(max_local_idx as f32);

                        let result = if max_val == f32::NEG_INFINITY {
                            bias
                        } else {
                            max_val + bias
                        };
                        // For aggregate functions, hintValue is the same as activation
                        (result, result)
                    }
                    SquashType::If => {
                        // IF: sum condition inputs, then use positive or negative branch
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;

                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, syn_type, weight) = self.synapses[synapse_idx];
                            let val = self.activations[from_idx] * weight;

                            match SynapseType::from(syn_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => positive_sum += val,
                            }
                        }

                        // Record trace: neuron index and branch taken (1.0 = positive, 0.0 = negative)
                        let branch_taken = if condition_sum > 0.0 { 1.0f32 } else { 0.0f32 };
                        trace_data.push(neuron_idx as f32);
                        trace_data.push(branch_taken);

                        let result = if condition_sum > 0.0 {
                            positive_sum + bias
                        } else {
                            negative_sum + bias
                        };
                        // For aggregate functions, hintValue is the same as activation
                        (result, result)
                    }
                    _ => {
                        // Standard activation: weighted sum + bias, then apply squash
                        let mut sum = bias;
                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, _, weight) = self.synapses[synapse_idx];
                            sum += self.activations[from_idx] * weight;
                        }
                        // For standard squash, hintValue is the pre-squash value (sum)
                        (apply_squash(squash, sum), sum)
                    }
                };

                self.activations[actual_idx] = activation;
                hint_values[neuron_idx] = hint_value;
            }
        }

        // Terminate trace data
        trace_data.push(-1.0);

        // Build result array:
        // - Output values (num_outputs)
        // - All non-input neuron activations (num_non_inputs)
        // - Pre-squash values / hintValues (num_non_inputs)
        // - Trace data
        let output_start = self.num_neurons - num_outputs;
        let result_len = num_outputs + (num_non_inputs * 2) + trace_data.len();

        let result = Float32Array::new_with_length(result_len as u32);

        // Copy output values
        for (i, &val) in self.activations[output_start..].iter().enumerate() {
            result.set_index(i as u32, val);
        }

        // Copy all non-input neuron activations
        for (i, &val) in self.activations[self.num_inputs..].iter().enumerate() {
            result.set_index((num_outputs + i) as u32, val);
        }

        // Copy pre-squash values (hintValues)
        for (i, &val) in hint_values.iter().enumerate() {
            result.set_index((num_outputs + num_non_inputs + i) as u32, val);
        }

        // Copy trace data
        for (i, &val) in trace_data.iter().enumerate() {
            result.set_index((num_outputs + (num_non_inputs * 2) + i) as u32, val);
        }

        result
    }
}

/// Batch activation - activate the network with multiple inputs at once
/// This reduces JS/WASM boundary crossing overhead for batch processing
/// Updated for Issue #1125 to support aggregate functions (MINIMUM, MAXIMUM, IF)
#[wasm_bindgen]
pub fn activate_batch(
    network: &mut CompiledNetwork,
    inputs: &[f32],
    input_size: usize,
    num_outputs: usize,
) -> Float32Array {
    let num_samples = inputs.len() / input_size;
    let result = Float32Array::new_with_length((num_samples * num_outputs) as u32);

    for sample_idx in 0..num_samples {
        let input_start = sample_idx * input_size;
        let input_slice = &inputs[input_start..(input_start + input_size)];

        // Copy input values to activation buffer
        for (i, &val) in input_slice.iter().enumerate() {
            if i < network.num_inputs {
                network.activations[i] = val;
            }
        }

        // Process each neuron in order
        for (neuron_idx, &(bias, squash_type, start_synapse, num_synapse, is_constant)) in network.neurons.iter().enumerate() {
            let actual_idx = network.num_inputs + neuron_idx;

            if is_constant {
                network.activations[actual_idx] = bias;
            } else {
                let squash = SquashType::from(squash_type);

                // Handle aggregate functions differently (Issue #1125)
                let activation = match squash {
                    SquashType::Minimum => {
                        let mut min_val = f32::INFINITY;
                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, _, weight) = network.synapses[synapse_idx];
                            let val = network.activations[from_idx] * weight;
                            if val < min_val {
                                min_val = val;
                            }
                        }
                        if min_val == f32::INFINITY { bias } else { min_val + bias }
                    }
                    SquashType::Maximum => {
                        let mut max_val = f32::NEG_INFINITY;
                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, _, weight) = network.synapses[synapse_idx];
                            let val = network.activations[from_idx] * weight;
                            if val > max_val {
                                max_val = val;
                            }
                        }
                        if max_val == f32::NEG_INFINITY { bias } else { max_val + bias }
                    }
                    SquashType::If => {
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;

                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, syn_type, weight) = network.synapses[synapse_idx];
                            let val = network.activations[from_idx] * weight;

                            match SynapseType::from(syn_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => positive_sum += val,
                            }
                        }

                        if condition_sum > 0.0 { positive_sum + bias } else { negative_sum + bias }
                    }
                    _ => {
                        let mut sum = bias;
                        for synapse_idx in start_synapse..(start_synapse + num_synapse) {
                            let (from_idx, _, weight) = network.synapses[synapse_idx];
                            sum += network.activations[from_idx] * weight;
                        }
                        apply_squash(squash, sum)
                    }
                };

                network.activations[actual_idx] = activation;
            }
        }

        // Copy outputs to result
        let output_start = network.num_neurons - num_outputs;
        let result_start = sample_idx * num_outputs;
        for (i, &val) in network.activations[output_start..].iter().enumerate() {
            result.set_index((result_start + i) as u32, val);
        }
    }

    result
}

/// Standalone squash function for testing
#[wasm_bindgen]
pub fn squash(squash_type: u8, value: f32) -> f32 {
    apply_squash(SquashType::from(squash_type), value)
}

/// Standalone derivative function for testing
/// Issue #1138 - WASM Migration Phase 6
#[wasm_bindgen]
pub fn derivative(squash_type: u8, value: f32) -> f32 {
    apply_derivative(SquashType::from(squash_type), value)
}

/// Version information
#[wasm_bindgen]
pub fn version() -> String {
    "0.1.0".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relu() {
        assert_eq!(apply_squash(SquashType::Relu, 1.0), 1.0);
        assert_eq!(apply_squash(SquashType::Relu, -1.0), 0.0);
        assert_eq!(apply_squash(SquashType::Relu, 0.0), 0.0);
    }

    #[test]
    fn test_tanh() {
        let result = apply_squash(SquashType::Tanh, 0.0);
        assert!((result - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_logistic() {
        let result = apply_squash(SquashType::Logistic, 0.0);
        assert!((result - 0.5).abs() < 1e-6);
    }

    // Issue #1138 - Derivative tests
    #[test]
    fn test_derivative_identity() {
        assert_eq!(apply_derivative(SquashType::Identity, 0.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Identity, 5.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Identity, -5.0), 1.0);
    }

    #[test]
    fn test_derivative_relu() {
        assert_eq!(apply_derivative(SquashType::Relu, 1.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Relu, -1.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Relu, 0.0), 0.0);
    }

    #[test]
    fn test_derivative_leaky_relu() {
        assert_eq!(apply_derivative(SquashType::LeakyRelu, 1.0), 1.0);
        assert_eq!(apply_derivative(SquashType::LeakyRelu, -1.0), LEAKY_RELU_ALPHA);
        assert_eq!(apply_derivative(SquashType::LeakyRelu, 0.0), 1.0);
    }

    #[test]
    fn test_derivative_logistic() {
        // At x=0, sigmoid(0) = 0.5, so derivative = 0.5 * 0.5 = 0.25
        let result = apply_derivative(SquashType::Logistic, 0.0);
        assert!((result - 0.25).abs() < 1e-6);
    }

    #[test]
    fn test_derivative_tanh() {
        // At x=0, tanh(0) = 0, so derivative = 1 - 0^2 = 1
        let result = apply_derivative(SquashType::Tanh, 0.0);
        assert!((result - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_derivative_sine() {
        // sin'(x) = cos(x)
        let result = apply_derivative(SquashType::Sine, 0.0);
        assert!((result - 1.0).abs() < 1e-6); // cos(0) = 1
    }

    #[test]
    fn test_derivative_cosine() {
        // cos'(x) = -sin(x)
        let result = apply_derivative(SquashType::Cosine, 0.0);
        assert!((result - 0.0).abs() < 1e-6); // -sin(0) = 0
    }

    #[test]
    fn test_derivative_square() {
        // (x^2)' = 2x
        assert_eq!(apply_derivative(SquashType::Square, 0.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Square, 2.0), 4.0);
        assert_eq!(apply_derivative(SquashType::Square, -3.0), -6.0);
    }

    #[test]
    fn test_derivative_cube() {
        // (x^3)' = 3x^2
        assert_eq!(apply_derivative(SquashType::Cube, 0.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Cube, 2.0), 12.0);
        assert_eq!(apply_derivative(SquashType::Cube, -2.0), 12.0);
    }

    #[test]
    fn test_derivative_complement() {
        // (1-x)' = -1
        assert_eq!(apply_derivative(SquashType::Complement, 0.0), -1.0);
        assert_eq!(apply_derivative(SquashType::Complement, 5.0), -1.0);
    }

    #[test]
    fn test_derivative_absolute() {
        assert_eq!(apply_derivative(SquashType::Absolute, 1.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Absolute, -1.0), -1.0);
        assert_eq!(apply_derivative(SquashType::Absolute, 0.0), 0.0);
    }

    #[test]
    fn test_derivative_arctan() {
        // atan'(x) = 1/(1+x^2)
        let result = apply_derivative(SquashType::ArcTan, 0.0);
        assert!((result - 1.0).abs() < 1e-6); // 1/(1+0) = 1

        let result2 = apply_derivative(SquashType::ArcTan, 1.0);
        assert!((result2 - 0.5).abs() < 1e-6); // 1/(1+1) = 0.5
    }

    #[test]
    fn test_derivative_aggregate_functions() {
        // Aggregate functions return 0
        assert_eq!(apply_derivative(SquashType::Minimum, 1.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Maximum, 1.0), 0.0);
        assert_eq!(apply_derivative(SquashType::If, 1.0), 0.0);
    }
}
