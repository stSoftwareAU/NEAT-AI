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

// Match the JS implementation's practical clamp for very large one-sided outputs.
// JS uses Number.MAX_SAFE_INTEGER (~9.007e15) as an upper bound for several
// activations (e.g. Exponential).
const JS_MAX_SAFE_INTEGER: f32 = 9_007_199_254_740_992.0;

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
        SquashType::Exponential => {
            // Match TypeScript behavior:
            // - For non-finite x, return a safe capped value.
            // - For x >= 36, clamp to MAX_SAFE_INTEGER to prevent runaway growth.
            //   (JS uses this to avoid overflow and destabilising downstream sums.)
            if !x.is_finite() {
                JS_MAX_SAFE_INTEGER
            } else if x >= 36.0 {
                JS_MAX_SAFE_INTEGER
            } else {
                x.exp()
            }
        }
        SquashType::LogSigmoid => {
            // Numerically stable LogSigmoid for f32:
            //
            // log(sigmoid(x)) = -log(1 + exp(-x))
            //
            // For large negative x, exp(-x) overflows in f32. Use an equivalent
            // stable form that avoids overflow:
            //   log(sigmoid(x)) = x - log(1 + exp(x))   (when x < 0)
            if x >= 0.0 {
                // exp(-x) is in (0, 1], safe
                -(1.0 + (-x).exp()).ln()
            } else {
                // exp(x) is in (0, 1], safe (underflows to 0 for very negative x)
                x - (1.0 + x.exp()).ln()
            }
        }
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

/// Apply an inverse squash (unsquash) function to a value
/// Issue #1139 - WASM Migration Phase 7: Implement unSquash() in Rust/WASM
///
/// The unsquash function converts an activation-space value back to value-space.
/// It is the inverse of the squash function where possible.
///
/// For non-invertible functions (like Step, Bipolar) or functions with domain
/// restrictions, the hint parameter is used to guide the inverse when the result
/// is ambiguous or undefined.
///
/// # Arguments
/// * `squash_type` - The type of activation function to invert
/// * `activation` - The squashed activation value to invert
/// * `hint` - An optional hint value to guide the inverse for ambiguous cases
#[inline(always)]
fn apply_unsquash(squash_type: SquashType, activation: f32, hint: f32) -> f32 {
    // Check for non-finite inputs
    if !activation.is_finite() {
        return if hint.is_finite() { hint } else { 0.0 };
    }

    match squash_type {
        // f(x) = x, f⁻¹(y) = y
        SquashType::Identity => activation,

        // f(x) = max(0, x), f⁻¹(y) = y for y > 0, else hint
        SquashType::Relu => {
            if activation > 0.0 {
                activation
            } else if hint.is_finite() {
                hint
            } else {
                0.0
            }
        }

        // f(x) = clamp(x, 0, 6), f⁻¹(y) = y for 0 < y < 6
        SquashType::Relu6 => {
            if activation > 0.0 && activation < 6.0 {
                activation
            } else if activation == 6.0 && hint.is_finite() {
                if hint > 6.0 { hint } else { 6.0 }
            } else if activation == 0.0 && hint.is_finite() {
                if hint < 0.0 { hint } else { 0.0 }
            } else {
                0.0
            }
        }

        // f(x) = x >= 0 ? x : 0.01*x, f⁻¹(y) = y >= 0 ? y : y/0.01
        SquashType::LeakyRelu => {
            if activation >= 0.0 {
                activation
            } else {
                activation / LEAKY_RELU_ALPHA
            }
        }

        // f(x) = lambda * (x >= 0 ? x : alpha * (exp(x) - 1))
        // f⁻¹(y) for y >= 0: y/lambda
        // f⁻¹(y) for y < 0: log(y/(lambda*alpha) + 1) if ratio > 0
        SquashType::Selu => {
            let scaled = activation / SELU_LAMBDA;
            if scaled >= 0.0 {
                scaled
            } else {
                // scaled = alpha * (exp(x) - 1), so exp(x) = scaled/alpha + 1
                let ratio = scaled / SELU_ALPHA + 1.0;
                if ratio > 0.0 {
                    ratio.ln()
                } else if hint.is_finite() {
                    hint
                } else {
                    -10.0
                }
            }
        }

        // f(x) = x > 0 ? x : exp(x) - 1
        // f⁻¹(y) = y > 0 ? y : log(y + 1)
        SquashType::Elu => {
            if activation > 0.0 {
                activation
            } else {
                // activation = exp(x) - 1, so exp(x) = activation + 1
                let ratio = activation + 1.0;
                if ratio > 0.0 {
                    ratio.ln()
                } else if hint.is_finite() {
                    hint
                } else {
                    -20.0
                }
            }
        }

        // f(x) = 1 / (1 + exp(-x)) (sigmoid)
        // f⁻¹(y) = log(y / (1 - y)) (logit)
        SquashType::Logistic => {
            // Clamp to safe range to avoid log(0)
            let safe = activation.max(f32::EPSILON).min(1.0 - f32::EPSILON);
            (safe / (1.0 - safe)).ln()
        }

        // f(x) = tanh(x)
        // f⁻¹(y) = 0.5 * log((1 + y) / (1 - y)) = atanh(y)
        SquashType::Tanh => {
            // Handle saturation
            if activation.abs() >= 0.9999999 {
                return if hint.is_finite() {
                    hint
                } else {
                    activation.signum() * 10.0
                };
            }
            let value = (1.0 + activation) / (1.0 - activation);
            if value <= 1e-10 || !value.is_finite() {
                return if hint.is_finite() { hint } else { 0.0 };
            }
            0.5 * value.ln()
        }

        // f(x) = clamp(x, -1, 1)
        // f⁻¹(y) = y (if squash(hint) == y, return hint)
        SquashType::HardTanh => {
            if hint.is_finite() && apply_squash(SquashType::HardTanh, hint) == activation {
                hint
            } else {
                activation
            }
        }

        // f(x) = x / (1 + |x|)
        // f⁻¹(y) = y / (1 - |y|)
        SquashType::Softsign => {
            let denom = 1.0 - activation.abs();
            if denom <= 1e-8 || !denom.is_finite() {
                return if hint.is_finite() { hint } else { 0.0 };
            }
            activation / denom
        }

        // f(x) = ln(1 + exp(x))
        // f⁻¹(y) = log(exp(y) - 1)
        SquashType::Softplus => {
            const SMALL_THRESHOLD: f32 = 1e-10;
            if activation < SMALL_THRESHOLD {
                return 0.0;
            }
            let exp_a = activation.exp();
            let diff = exp_a - 1.0;
            if diff <= 0.0 || !diff.is_finite() {
                return if hint.is_finite() { hint } else { 0.0 };
            }
            diff.ln()
        }

        // f(x) = x * sigmoid(x)
        // Use Newton-Raphson iteration
        SquashType::Swish => {
            const MAX_ITERATIONS: i32 = 100;
            const EPSILON: f32 = 1e-6;

            let mut x = if hint.is_finite() {
                hint
            } else if activation >= 0.0 {
                activation
            } else {
                activation / 2.0
            };

            for _ in 0..MAX_ITERATIONS {
                let exp_neg_x = if x < -20.0 { 0.0 } else { (-x).exp() };
                let denom = 1.0 + exp_neg_x;
                let sigmoid_x = 1.0 / denom;
                let fx = x * sigmoid_x - activation;

                if fx.abs() < EPSILON {
                    break;
                }

                let d_sigmoid = exp_neg_x / (denom * denom);
                let dfx = sigmoid_x + x * -d_sigmoid;
                let safe_dfx = if dfx.abs() > 1e-8 { dfx } else { dfx.signum() * 1e-8 };
                let next_x = x - fx / safe_dfx;

                if !next_x.is_finite() {
                    return if hint.is_finite() { hint } else { 0.0 };
                }
                x = next_x;
            }
            x
        }

        // f(x) = x * tanh(ln(1 + exp(x)))
        // Use Newton-Raphson iteration
        SquashType::Mish => {
            const MAX_ITERATIONS: i32 = 100;
            const TOLERANCE: f32 = 1e-6;
            const SAFE_LIMIT: f32 = 20.0;

            let mut guess = if hint.is_finite() {
                hint
            } else if activation >= 0.0 {
                activation
            } else {
                activation / 2.0
            };
            guess = guess.max(-SAFE_LIMIT).min(SAFE_LIMIT);

            for _ in 0..MAX_ITERATIONS {
                let fx = apply_squash(SquashType::Mish, guess);
                let error = fx - activation;

                if error.abs() < TOLERANCE {
                    break;
                }

                let derivative = apply_derivative(SquashType::Mish, guess);
                let safe_derivative = if derivative.abs() > 1e-6 {
                    derivative
                } else {
                    derivative.signum() * 1e-6
                };
                guess -= error / safe_derivative;

                if !guess.is_finite() {
                    return 0.0;
                }
                guess = guess.max(-SAFE_LIMIT).min(SAFE_LIMIT);
            }

            if guess.is_finite() { guess } else { 0.0 }
        }

        // f(x) = 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
        // Use Newton-Raphson iteration
        SquashType::Gelu => {
            const MAX_ITERATIONS: i32 = 100;
            const TOLERANCE: f32 = 1e-6;
            const MAX_X: f32 = 10.0;

            if activation.abs() < 1e-10 {
                return if hint.is_finite() { hint } else { -10.0 };
            }

            let mut x = if hint.is_finite() {
                hint
            } else if activation < 0.5 {
                -1.0
            } else {
                1.0
            };

            for _ in 0..MAX_ITERATIONS {
                let fx = apply_squash(SquashType::Gelu, x) - activation;

                if fx.abs() < TOLERANCE {
                    break;
                }

                let derivative = apply_derivative(SquashType::Gelu, x);
                if derivative.abs() < 1e-10 {
                    if fx.abs() < 0.1 {
                        return x;
                    }
                    break;
                }

                let next_x = x - fx / derivative;
                if !next_x.is_finite() || next_x.abs() > MAX_X {
                    return if hint.is_finite() { hint } else { 0.0 };
                }
                x = next_x;
            }
            x
        }

        // f(x) = sin(x), f⁻¹(y) = arcsin(y) adjusted by hint for periodicity
        SquashType::Sine => {
            let principal = activation.asin();
            let period = 2.0 * std::f32::consts::PI;
            let hint_finite = if hint.is_finite() { hint } else { 0.0 };
            let hint_periods = (hint_finite / period).round();

            // Find solutions closest to hint
            let mut best = principal + hint_periods * period;
            let mut best_dist = (best - hint_finite).abs();

            // Check alternative solution in same period
            let alt = std::f32::consts::PI - principal + hint_periods * period;
            if (alt - hint_finite).abs() < best_dist {
                best = alt;
                best_dist = (alt - hint_finite).abs();
            }

            // Check adjacent periods
            for i in [-1, 1] {
                let base_period = hint_periods + i as f32;
                let sol1 = principal + base_period * period;
                let sol2 = std::f32::consts::PI - principal + base_period * period;
                if (sol1 - hint_finite).abs() < best_dist {
                    best = sol1;
                    best_dist = (sol1 - hint_finite).abs();
                }
                if (sol2 - hint_finite).abs() < best_dist {
                    best = sol2;
                    best_dist = (sol2 - hint_finite).abs();
                }
            }

            best
        }

        // f(x) = cos(x), f⁻¹(y) = arccos(y) adjusted by hint for periodicity
        SquashType::Cosine => {
            let principal = activation.acos();
            let period = 2.0 * std::f32::consts::PI;
            let hint_finite = if hint.is_finite() { hint } else { 0.0 };
            let hint_periods = (hint_finite / period).round();

            // Collect valid solutions like JS does (exploring ±4 periods)
            let mut solutions = Vec::new();
            for i in -4..=4 {
                let base = (hint_periods + i as f32) * period;
                let sol1 = principal + base;
                let sol2 = -principal + base;

                // Verify solutions are valid (cos(sol) ≈ activation)
                if (sol1.cos() - activation).abs() < 1e-6 {
                    solutions.push(sol1);
                }
                if (sol2.cos() - activation).abs() < 1e-6 {
                    solutions.push(sol2);
                }
            }

            // Find the solution closest to hint (matching JS reduce behaviour)
            // JS uses `<` not `<=`, so first element with min distance wins
            // Use a small epsilon to handle f32 precision issues to match JS f64 behaviour
            let eps = 1e-5;
            let mut best = if solutions.is_empty() {
                // Fallback if no valid solutions found
                let fallback1 = principal + hint_periods * period;
                let fallback2 = -principal + hint_periods * period;
                if (fallback1 - hint_finite).abs() < (fallback2 - hint_finite).abs() {
                    fallback1
                } else {
                    fallback2
                }
            } else {
                solutions[0]
            };
            let mut best_dist = (best - hint_finite).abs();

            for sol in solutions.iter().skip(1) {
                let dist = (*sol - hint_finite).abs();
                // Only update if significantly closer (using epsilon to handle f32 precision)
                if dist + eps < best_dist {
                    best = *sol;
                    best_dist = dist;
                }
            }

            best
        }

        // f(x) = tan(x), f⁻¹(y) = atan(y) adjusted by hint for periodicity
        SquashType::Tan => {
            let base_value = activation.atan();
            if hint.is_finite() {
                let diff = hint - base_value;
                let adjustment = (diff / std::f32::consts::PI).round() * std::f32::consts::PI;
                base_value + adjustment
            } else {
                base_value
            }
        }

        // f(x) = atan(x), f⁻¹(y) = tan(y)
        SquashType::ArcTan => {
            const EPSILON: f32 = 1e-10;
            let upper = std::f32::consts::FRAC_PI_2 - EPSILON;
            let lower = -std::f32::consts::FRAC_PI_2 + EPSILON;

            if activation >= upper {
                return if hint.is_finite() { hint } else { 1e6 };
            }
            if activation <= lower {
                return if hint.is_finite() { hint } else { -1e6 };
            }

            let value = activation.tan();
            if !value.is_finite() {
                if hint.is_finite() { hint } else { 0.0 }
            } else {
                value
            }
        }

        // f(x) = exp(-x^2), f⁻¹(y) = ±sqrt(-ln(y))
        SquashType::Gaussian => {
            let safe_activation = activation.max(1e-10);
            let sqrt_val = (-safe_activation.ln()).sqrt();
            if hint.is_finite() && hint < 0.0 {
                -sqrt_val
            } else {
                sqrt_val
            }
        }

        // f(x) = (sqrt(x^2 + 1) - 1) / 2 + x
        // Use Newton-Raphson iteration
        SquashType::BentIdentity => {
            const MAX_ITERATIONS: i32 = 100;
            const EPSILON: f32 = 1e-6;
            const OVERFLOW_LIMIT: f32 = 1e10;

            let mut x = if hint.is_finite() { hint } else { activation };

            for _ in 0..MAX_ITERATIONS {
                if x.abs() >= OVERFLOW_LIMIT {
                    return x;
                }
                let d = (x * x + 1.0).sqrt();
                let fx = (d - 1.0) / 2.0 + x - activation;
                if fx.abs() < EPSILON {
                    break;
                }
                let dfx = x / (2.0 * d) + 1.0;
                x -= fx / dfx;
            }
            x
        }

        // f(x) = 2 / (1 + exp(-x)) - 1
        // f⁻¹(y) = -log(2 / (y + 1) - 1)
        SquashType::BipolarSigmoid => {
            const EPSILON: f32 = 1e-10;
            let y = activation.max(-1.0 + EPSILON).min(1.0 - EPSILON);
            let result = -(2.0 / (y + 1.0) - 1.0).ln();
            if result.is_finite() {
                result
            } else if hint.is_finite() {
                hint
            } else if activation >= 0.0 {
                15.0
            } else {
                -15.0
            }
        }

        // f(x) = x > 0 ? 1 : -1
        // Not invertible, use hint
        SquashType::Bipolar => {
            if hint.is_finite() {
                // Note: Use custom sign function to match JS Math.sign() behaviour
                // JS: Math.sign(0) = 0, Rust: (0.0f32).signum() = 1
                let js_sign = |x: f32| -> i32 {
                    if x > 0.0 { 1 }
                    else if x < 0.0 { -1 }
                    else { 0 }
                };
                if js_sign(hint) == js_sign(activation) {
                    return hint;
                }
                if hint.abs() < 1e-10 && activation < 0.0 {
                    return hint;
                }
            }
            if activation >= 0.0 { 1.0 } else { -1.0 }
        }

        // f(x) = x > 0 ? 1 : 0
        // Not invertible, use hint
        SquashType::Step => {
            if activation == 1.0 && hint.is_finite() && hint > 0.0 {
                hint
            } else if activation == 0.0 && hint.is_finite() && hint <= 0.0 {
                hint
            } else {
                activation
            }
        }

        // f(x) = 1 - x, f⁻¹(y) = 1 - y
        SquashType::Complement => 1.0 - activation,

        // f(x) = |x|, f⁻¹(y) = y or -y based on hint
        SquashType::Absolute => {
            if hint.is_finite() && hint < 0.0 {
                -activation
            } else {
                activation
            }
        }

        // f(x) = x^2, f⁻¹(y) = ±sqrt(y) based on hint
        SquashType::Square => {
            let sign = if hint.is_finite() && hint < 0.0 { -1.0 } else { 1.0 };
            sign * activation.max(0.0).sqrt()
        }

        // f(x) = x^3, f⁻¹(y) = cbrt(y)
        SquashType::Cube => activation.cbrt(),

        // f(x) = sqrt(x), f⁻¹(y) = y^2 with sign from hint
        SquashType::Sqrt => {
            if hint.is_finite() {
                if activation <= 0.0 {
                    return hint;
                }
                let sign = if hint < 0.0 { -1.0 } else { 1.0 };
                return activation * activation * sign;
            }
            activation * activation
        }

        // f(x) = 1/x (actually 1/(1+|x|) in JS), f⁻¹(y) = 1/y
        SquashType::StdInverse => {
            if !activation.is_finite() || activation.abs() < 1e-15 {
                return if hint.is_finite() {
                    hint
                } else if activation > 0.0 {
                    f32::MAX
                } else {
                    f32::MIN
                };
            }
            1.0 / activation
        }

        // f(x) = exp(x), f⁻¹(y) = ln(y)
        SquashType::Exponential => {
            if activation <= 0.0 || !activation.is_finite() {
                return if hint.is_finite() { hint } else { -20.0 };
            }
            activation.ln()
        }

        // f(x) = log(sigmoid(x)) = -log(1 + exp(-x))
        // f⁻¹(y) = log(exp(y) / (1 - exp(y)))
        SquashType::LogSigmoid => {
            if activation < -700.0 {
                return if hint.is_finite() { hint } else { -10.0 };
            }
            let exp_y = activation.exp();
            let denom = 1.0 - exp_y;
            if denom <= 0.0 || !exp_y.is_finite() {
                return if hint.is_finite() { hint } else { -10.0 };
            }
            (exp_y / denom).ln()
        }

        // f(x) = x / sqrt(1 + x^2)
        // f⁻¹(y) = y / sqrt(1 - y^2)
        SquashType::Isru => {
            const MAX_ACTIVATION: f32 = 0.9999999;
            let safe = activation.max(-MAX_ACTIVATION + 1e-10).min(MAX_ACTIVATION - 1e-10);
            safe / (1.0 - safe * safe).sqrt()
        }

        // Aggregate functions - return hint or activation
        SquashType::Minimum | SquashType::Maximum | SquashType::If => {
            if hint.is_finite() { hint } else { activation }
        }
    }
}

/// Apply safe zone adjustment for a given activation function
/// Issue #1140 - WASM Migration Phase 8: Implement safeZoneAdjustment() in Rust/WASM
///
/// Returns a float from 0 (not safe) to 1 (fully safe) indicating how useful it is
/// to backpropagate through a neuron based on saturation levels.
///
/// - 1.0: Fully in safe zone, gradient flows freely
/// - 0.0: Completely saturated, no gradient should flow
/// - 0.0-1.0: Partial safety, used for gradual fade-out
///
/// # Arguments
/// * `squash_type` - The type of activation function
/// * `raw_input` - The raw input value before squashing
/// * `error` - The error value from backpropagation
/// * `weight` - The synapse weight (used by some activation functions)
#[inline(always)]
fn apply_safe_zone_adjustment(squash_type: SquashType, raw_input: f32, error: f32, weight: f32) -> f32 {
    // Non-finite inputs are never safe
    if !raw_input.is_finite() {
        return 0.0;
    }

    match squash_type {
        // IDENTITY: Almost never saturates, but checks for extreme raw inputs with tiny weights
        SquashType::Identity => {
            let abs_raw = raw_input.abs();
            let abs_weight = weight.abs();

            let raw_is_extreme = abs_raw > 1e6;
            let weight_too_small = abs_weight < 1e-6;

            if raw_is_extreme && weight_too_small {
                return 0.0; // suggest adjusting the weight instead
            }

            1.0
        }

        // ReLU: Dead ReLU problem - only safe when positive or recovering
        SquashType::Relu => {
            if raw_input > 0.0 {
                return 1.0; // Fully active
            }

            // Recovery: try to push back into positive zone
            if raw_input <= 0.0 && error > 0.0 {
                return 1.0;
            }

            // Dead and shouldn't wake up
            0.0
        }

        // ReLU6: Both ends saturate
        SquashType::Relu6 => {
            if raw_input > 0.0 && raw_input < 6.0 {
                return 1.0;
            }

            if raw_input <= 0.0 && error > 0.0 {
                return 1.0; // Try to reactivate
            }

            if raw_input >= 6.0 && error < 0.0 {
                return 1.0; // Try to lower from saturated high
            }

            0.0
        }

        // LeakyReLU: Never fully saturates, but has weight-based logic
        SquashType::LeakyRelu => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -50.0;
            let safe_max = 50.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 20.0 {
                return 1.0 - (raw_input - safe_max) / 20.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 20.0 {
                return 1.0 - (safe_min - raw_input) / 20.0;
            }

            0.0
        }

        // SELU: Similar to ELU but with specific safe zones
        SquashType::Selu => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // ELU: Similar pattern to SELU
        SquashType::Elu => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // LOGISTIC (Sigmoid): Classic sigmoid saturation
        SquashType::Logistic => {
            let safe_low = -6.0;
            let safe_high = 6.0;
            let min = -10.0;
            let max = 10.0;

            // Fully safe zone
            if raw_input >= safe_low && raw_input <= safe_high { return 1.0; }

            // Recovery logic: if we're out of zone, but error would push us back in
            if raw_input < safe_low && error > 0.0 {
                return 0.2; // Pushes rawInput toward centre
            }
            if raw_input > safe_high && error < 0.0 {
                return 0.2;
            }

            // Fading out logic: scale linearly from edge of safe zone to extreme
            if raw_input > safe_high && raw_input <= max {
                return 1.0 - (raw_input - safe_high) / (max - safe_high); // fade from 1 to 0
            }
            if raw_input < safe_low && raw_input >= min {
                return (raw_input - min) / (safe_low - min); // fade from 0 to 1
            }

            // Beyond hard saturation
            0.0
        }

        // TANH: Similar to logistic
        SquashType::Tanh => {
            let safe_low = -2.0;
            let safe_high = 2.0;
            let min = -6.0;
            let max = 6.0;

            // Fully in safe zone
            if raw_input >= safe_low && raw_input <= safe_high { return 1.0; }

            // Recovery direction logic
            if raw_input < safe_low && error > 0.0 { return 0.2; }
            if raw_input > safe_high && error < 0.0 { return 0.2; }

            // Gradual fade to saturation
            if raw_input > safe_high && raw_input <= max {
                return 1.0 - (raw_input - safe_high) / (max - safe_high);
            }
            if raw_input < safe_low && raw_input >= min {
                return (raw_input - min) / (safe_low - min);
            }

            0.0
        }

        // HardTanh: Hard boundaries at -1 and 1
        SquashType::HardTanh => {
            let safe_low = -0.9;
            let safe_high = 0.9;
            let min = -1.2;
            let max = 1.2;

            // Fully safe region
            if raw_input >= safe_low && raw_input <= safe_high { return 1.0; }

            // Recovery: out of bounds but error would bring it back
            if raw_input <= -1.0 && error > 0.0 { return 0.2; }
            if raw_input >= 1.0 && error < 0.0 { return 0.2; }

            // Fade into the dead zone
            if raw_input > safe_high && raw_input <= max {
                return 1.0 - (raw_input - safe_high) / (max - safe_high);
            }
            if raw_input < safe_low && raw_input >= min {
                return (raw_input - min) / (safe_low - min);
            }

            0.0
        }

        // Softsign: Slow saturation
        SquashType::Softsign => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }

            // Soft fade near edge zones
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Softplus: One-sided saturation
        SquashType::Softplus => {
            let safe_min = -10.0;
            let safe_max = 20.0;
            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;
            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improves = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_raw && raw_getting_worse { return 0.0; }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improves {
                return 0.0;
            }

            if in_safe_raw { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Swish: Similar to tanh in behaviour
        SquashType::Swish => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Mish: Similar to Swish
        SquashType::Mish => {
            let safe_min = -10.0;
            let safe_max = 10.0;
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;
            let raw_worsening = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_raw && raw_worsening { return 0.0; }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_raw { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // GELU: Similar to ReLU but smoother
        SquashType::Gelu => {
            let safe_min = -6.0;
            let safe_max = 6.0;
            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;
            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;
            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improves = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_raw && raw_getting_worse { return 0.0; }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improves {
                return 0.0;
            }

            if in_safe_raw { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // SINE: Periodic, always varying
        SquashType::Sine => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let slope = raw_input.cos(); // derivative of sin(x)
            let in_flat_zone = slope.abs() < 0.1;
            let raw_getting_worse = slope * error < 0.0;

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if in_flat_zone && raw_getting_worse { return 0.0; }
            if !in_flat_zone && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if !in_flat_zone { return 1.0; }

            // Soft fade for near-flat slope areas
            let fade = slope.abs() / 0.1;
            fade.max(0.0).min(1.0)
        }

        // Cosine: Periodic
        SquashType::Cosine => {
            let slope = raw_input.sin().abs();
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            // When slope is strong
            if slope > 0.1 {
                if (abs_weight < min_weight && weight * error > 0.0) ||
                    (abs_weight > max_weight && weight * error < 0.0) {
                    return 0.0; // allow weight to correct first
                }
                return 1.0;
            }

            // Fade zone
            if slope > 0.05 {
                return (slope - 0.05) / 0.05;
            }

            // Flat zone — poor for learning
            0.0
        }

        // TAN: Avoid asymptotes at ±π/2
        SquashType::Tan => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let pi = std::f32::consts::PI;
            let modulo = raw_input % pi;
            let dist_from_asymptote = (modulo.abs() - pi / 2.0).abs();

            let near_asymptote = dist_from_asymptote < 0.2;
            let raw_getting_worse = (modulo > pi / 2.0 && error > 0.0) ||
                (modulo < -pi / 2.0 && error < 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if near_asymptote && raw_getting_worse { return 0.0; }
            if !near_asymptote && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            // Soft fade if near π/2 mod
            if dist_from_asymptote < 0.5 {
                return 1.0 - (0.5 - dist_from_asymptote) * 2.0;
            }

            1.0
        }

        // ArcTan: Fade at extremes
        SquashType::ArcTan => {
            let abs = raw_input.abs();

            // Ideal gradient zone: roughly x ∈ [−2, 2]
            if abs <= 2.0 { return 1.0; }

            // Out of bounds: too flat for meaningful updates.
            if abs > 4.0 { return 0.0; }

            // Recovery zone: allow updates that move toward centre
            if raw_input > 2.0 && error < 0.0 { return 0.3; }
            if raw_input < -2.0 && error > 0.0 { return 0.3; }

            // Fade zone: x ∈ [2, 4]
            if abs <= 4.0 { return 1.0 - (abs - 2.0) / 2.0; }
            0.0
        }

        // GAUSSIAN: Bell curve
        SquashType::Gaussian => {
            let abs_raw = raw_input.abs();
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let in_safe_zone = abs_raw <= 3.0;

            let raw_getting_worse = (raw_input < -3.0 && error < 0.0) ||
                (raw_input > 3.0 && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_zone && raw_getting_worse { return 0.0; }
            if in_safe_zone && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_zone { return 1.0; }
            if abs_raw <= 6.0 { return 1.0 - (abs_raw - 3.0) / 3.0; }

            0.0
        }

        // BentIdentity: Never saturates
        SquashType::BentIdentity => {
            let abs = raw_input.abs();

            // Safe/strong zone: x ∈ [−10, 10] is nearly linear
            if abs <= 10.0 { return 1.0; }

            // Allow recovery if error is pulling us back toward centre
            if raw_input > 10.0 && error < 0.0 { return 0.3; }
            if raw_input < -10.0 && error > 0.0 { return 0.3; }

            // Fade between 10 and 20
            if abs <= 20.0 { return 1.0 - (abs - 10.0) / 10.0; }

            0.0
        }

        // BipolarSigmoid: Similar to logistic
        SquashType::BipolarSigmoid => {
            let abs_raw = raw_input.abs();
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let raw_getting_worse = (raw_input < -4.0 && error < 0.0) ||
                (raw_input > 4.0 && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !(-4.0 <= raw_input && raw_input <= 4.0) && raw_getting_worse { return 0.0; }

            if -4.0 <= raw_input && raw_input <= 4.0 {
                if (weight_too_small || weight_too_large) && weight_improving { return 0.0; }
                return 1.0;
            }

            // Gradual fade out for raw inputs in [4, 8] or [-8, -4]
            if abs_raw <= 8.0 { return 1.0 - (abs_raw - 4.0) / 4.0; }

            0.0
        }

        // BIPOLAR: Discontinuous - always return 0
        SquashType::Bipolar => 0.0,

        // STEP: Special handling for threshold function
        SquashType::Step => {
            // STEP function: threshold at x = 0
            let is_above = raw_input > 0.0;
            let expected_above = error > 0.0;

            // If we're on the wrong side and the error pushes us toward the correct side
            if is_above != expected_above { return 1.0; }

            // If we're on the correct side, but error is still non-zero, reduce confidence
            0.2
        }

        // COMPLEMENT: Never saturates (linear function)
        SquashType::Complement => 1.0,

        // ABSOLUTE: Loses sign information
        SquashType::Absolute => {
            let abs_input = raw_input.abs();
            let abs_weight = weight.abs();

            let very_large_input = abs_input > 1000.0;
            let tiny_weight = abs_weight < 1e-3;

            if very_large_input && tiny_weight { return 0.0; } // raw input extreme, but weight could move

            1.0
        }

        // SQUARE: x^2 grows fast
        SquashType::Square => {
            let abs = raw_input.abs();

            // Safe zone: input ∈ [−5, 5]
            if abs <= 5.0 { return 1.0; }

            // If error direction pushes input toward centre, allow it (recovery zone)
            if raw_input > 5.0 && error < 0.0 { return 0.2; }
            if raw_input < -5.0 && error > 0.0 { return 0.2; }

            // Fade between 5 and 10
            if abs <= 10.0 {
                return 1.0 - (abs - 5.0) / 5.0;
            }

            // Beyond 10, input dominates and gradients explode
            0.0
        }

        // Cube: x^3 grows extremely fast
        SquashType::Cube => {
            let abs = raw_input.abs();

            // Safe zone: x ∈ [−5, 5]
            if abs <= 5.0 { return 1.0; }

            // Recovery: error moves us back in
            if raw_input < -5.0 && error > 0.0 { return 0.2; }
            if raw_input > 5.0 && error < 0.0 { return 0.2; }

            // Fade: x ∈ [5, 10]
            if abs <= 10.0 {
                return 1.0 - (abs - 5.0) / 5.0;
            }

            0.0
        }

        // SQRT: Only defined for x >= 0
        SquashType::Sqrt => {
            // SQRT is undefined for x < 0; never propagate toward negatives
            if raw_input < 0.0 && error < 0.0 { return 0.0; }

            // Strong incentive to stay in a stable gradient zone: x ∈ [0.01, 10]
            if raw_input >= 0.01 && raw_input <= 10.0 { return 1.0; }

            // If we're below safe zone and trying to go up (into domain), allow it
            if raw_input < 0.01 && error > 0.0 { return 0.3; }

            // Fade zone: x ∈ [10, 20] — flatter gradients, lower gain
            if raw_input > 10.0 && raw_input <= 20.0 {
                return 1.0 - (raw_input - 10.0) / 10.0;
            }

            // Above 20, gradients are too flat; prefer weight/bias adjustment
            0.0
        }

        // StdInverse: Sensitive around zero
        SquashType::StdInverse => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Exponential: Grows rapidly
        SquashType::Exponential => {
            // Safe zone for Exponential raw input
            let safe_min = -10.0;
            let safe_max = 30.0;
            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;

            // Check if pushing raw input would make it worse
            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            // Safe weight bounds
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;
            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;

            // Is weight improvement in direction of error?
            let weight_improves = (weight_too_small && weight * error > 0.0) || // growing small weight
                (weight_too_large && weight * error < 0.0); // shrinking big weight

            // Fallback to weight adjustment
            if !in_safe_raw && raw_getting_worse { return 0.0; }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improves {
                return 0.0;
            }

            // Default logic (fade outside the soft safe zone)
            if in_safe_raw { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // LogSigmoid: Flattens sharply for large negative inputs
        SquashType::LogSigmoid => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -20.0;
            let safe_max = 20.0;
            let fade_min = -30.0;
            let fade_max = 30.0;

            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;
            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            // Prefer not to propagate if the raw input is very bad and the weight would help
            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }

            // Soft fade zones
            if raw_input > safe_max && raw_input <= fade_max {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= fade_min {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // ISRU: Saturates at large |x|
        SquashType::Isru => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse = (raw_input < safe_min && error < 0.0) ||
                (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0) ||
                (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse { return 0.0; }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range { return 1.0; }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Aggregate functions - not differentiable, always return 0
        SquashType::Minimum | SquashType::Maximum | SquashType::If => 0.0,
    }
}

/// Error epsilon - smallest meaningful difference between target and actual activation
/// Used to short-circuit calculateError() for near-zero error cases.
const ERROR_EPSILON: f32 = 1e-6;

/// Maximum error magnitude for clamping
/// Prevents exploding gradients during backpropagation.
const MAX_ERROR_MAGNITUDE: f32 = 100.0;

/// Clamps error to a maximum absolute magnitude.
/// Avoids NaN propagation and prevents weight explosion.
#[inline(always)]
fn clamp_error(error: f32) -> f32 {
    if !error.is_finite() {
        return 0.0;
    }
    error.max(-MAX_ERROR_MAGNITUDE).min(MAX_ERROR_MAGNITUDE)
}

/// Apply calculateError function for a given activation function
/// Issue #1141 - WASM Migration Phase 9: Implement calculateError() in Rust/WASM
///
/// Calculates the error in value-space given:
/// - `current_activation`: The neuron's current output (after squash)
/// - `target_activation`: The desired output
/// - `current_value`: The pre-squash value (hint for unSquash)
///
/// The basic algorithm:
/// 1. Compute raw error: rawError = targetActivation - currentActivation
/// 2. If raw error is tiny (< ERROR_EPSILON), return 0
/// 3. If derivative (slope) is strong: error = rawError / slope
/// 4. Otherwise fall back to: error = unSquash(targetActivation) - currentValue
/// 5. Clamp error to prevent weight explosion
///
/// # Arguments
/// * `squash_type` - The type of activation function
/// * `current_activation` - The squashed activation value
/// * `target_activation` - The desired activation value
/// * `current_value` - The pre-squash value (used as hint for unSquash)
#[inline(always)]
fn apply_calculate_error(
    squash_type: SquashType,
    current_activation: f32,
    target_activation: f32,
    current_value: f32,
) -> f32 {
    let raw_error = target_activation - current_activation;

    // Short-circuit for tiny errors
    if raw_error.abs() < ERROR_EPSILON {
        return 0.0;
    }

    match squash_type {
        // IDENTITY: Always use raw error directly (slope = 1)
        SquashType::Identity => {
            clamp_error(raw_error)
        }

        // COMPLEMENT: Always use derivative (slope = -1)
        SquashType::Complement => {
            clamp_error(raw_error / -1.0)
        }

        // ReLU: Use raw error when active, unSquash fallback otherwise
        SquashType::Relu => {
            let error = if current_value > 0.0 {
                raw_error
            } else {
                apply_unsquash(SquashType::Relu, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // ReLU6: Use raw error when active, unSquash fallback otherwise
        SquashType::Relu6 => {
            let error = if current_value > 0.0 && current_value < 6.0 {
                raw_error
            } else {
                apply_unsquash(SquashType::Relu6, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // LeakyReLU: Always use unSquash (per JS implementation)
        SquashType::LeakyRelu => {
            let target_value = apply_unsquash(SquashType::LeakyRelu, target_activation, current_value);
            let error = target_value - current_value;
            clamp_error(error)
        }

        // SELU: Use derivative with fallback
        SquashType::Selu => {
            let slope = apply_derivative(SquashType::Selu, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Selu, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // ELU: Use derivative with fallback
        SquashType::Elu => {
            let slope = apply_derivative(SquashType::Elu, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Elu, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // LOGISTIC: Use activation-based slope (f(x)*(1-f(x))) with fallback
        SquashType::Logistic => {
            let slope = current_activation * (1.0 - current_activation);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Logistic, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // TANH: Use derivative with fallback
        SquashType::Tanh => {
            let slope = apply_derivative(SquashType::Tanh, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Tanh, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // HardTanh: Use derivative with fallback
        SquashType::HardTanh => {
            let slope = apply_derivative(SquashType::HardTanh, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::HardTanh, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Softsign: Use derivative with fallback
        SquashType::Softsign => {
            let slope = apply_derivative(SquashType::Softsign, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Softsign, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Softplus: Use derivative with fallback
        SquashType::Softplus => {
            let slope = apply_derivative(SquashType::Softplus, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Softplus, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Swish: Use derivative with fallback
        SquashType::Swish => {
            let slope = apply_derivative(SquashType::Swish, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Swish, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Mish: Always use derivative (no fallback per JS implementation)
        SquashType::Mish => {
            let slope = apply_derivative(SquashType::Mish, current_value);
            // JS code uses rawError / slope directly without abs() check
            let error = raw_error / slope;
            clamp_error(error)
        }

        // GELU: Use derivative with fallback
        SquashType::Gelu => {
            let slope = apply_derivative(SquashType::Gelu, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Gelu, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // SINE: Use derivative with fallback
        SquashType::Sine => {
            let slope = apply_derivative(SquashType::Sine, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Sine, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Cosine: Use derivative with fallback
        SquashType::Cosine => {
            let slope = apply_derivative(SquashType::Cosine, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Cosine, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // TAN: Use derivative with fallback, cap slope to prevent explosion
        SquashType::Tan => {
            let slope = apply_derivative(SquashType::Tan, current_value);
            let error = if slope.abs() > 1e-8 && slope < 1000.0 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Tan, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // ArcTan: Use derivative with fallback
        SquashType::ArcTan => {
            let slope = apply_derivative(SquashType::ArcTan, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::ArcTan, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Gaussian: Use derivative with fallback
        SquashType::Gaussian => {
            let slope = apply_derivative(SquashType::Gaussian, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Gaussian, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // BentIdentity: Use derivative with fallback
        SquashType::BentIdentity => {
            let slope = apply_derivative(SquashType::BentIdentity, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::BentIdentity, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // BipolarSigmoid: Use derivative with fallback
        SquashType::BipolarSigmoid => {
            let slope = apply_derivative(SquashType::BipolarSigmoid, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::BipolarSigmoid, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Bipolar: Non-differentiable, use unSquash fallback
        SquashType::Bipolar => {
            let target_value = apply_unsquash(SquashType::Bipolar, target_activation, current_value);
            let error = target_value - current_value;
            clamp_error(error)
        }

        // Step: Non-differentiable, use unSquash fallback
        SquashType::Step => {
            let target_value = apply_unsquash(SquashType::Step, target_activation, current_value);
            let error = target_value - current_value;
            clamp_error(error)
        }

        // ABSOLUTE: Use closest target approach (both -target and +target are valid)
        SquashType::Absolute => {
            let neg_target = -target_activation;
            let pos_target = target_activation;

            // Choose the target value closest to currentValue
            let closest_target = if (current_value - neg_target).abs() < (current_value - pos_target).abs() {
                neg_target
            } else {
                pos_target
            };

            clamp_error(closest_target - current_value)
        }

        // SQUARE: Use derivative with safe slope clamping
        SquashType::Square => {
            let slope = apply_derivative(SquashType::Square, current_value);
            let error = if slope.abs() > 1e-8 {
                let safe_slope = slope.max(-50.0).min(50.0);
                raw_error / safe_slope
            } else {
                apply_unsquash(SquashType::Square, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Cube: Use derivative with fallback
        SquashType::Cube => {
            let slope = apply_derivative(SquashType::Cube, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Cube, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Sqrt: Use derivative with safe slope clamping
        SquashType::Sqrt => {
            let slope = apply_derivative(SquashType::Sqrt, current_value);
            let error = if slope.abs() > 1e-8 {
                let safe_slope = slope.max(-50.0).min(50.0);
                raw_error / safe_slope
            } else {
                apply_unsquash(SquashType::Sqrt, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // StdInverse: Use derivative with fallback
        SquashType::StdInverse => {
            let slope = apply_derivative(SquashType::StdInverse, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::StdInverse, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Exponential: Use derivative with range checks
        SquashType::Exponential => {
            let slope = apply_derivative(SquashType::Exponential, current_value);
            const MIN_SLOPE: f32 = 1e-8;
            const MAX_SLOPE: f32 = 1e8;

            let error = if slope > MIN_SLOPE && slope < MAX_SLOPE {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Exponential, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // LogSigmoid: Use derivative with fallback
        SquashType::LogSigmoid => {
            let slope = apply_derivative(SquashType::LogSigmoid, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::LogSigmoid, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // ISRU: Use derivative with fallback
        SquashType::Isru => {
            let slope = apply_derivative(SquashType::Isru, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Isru, target_activation, current_value) - current_value
            };
            clamp_error(error)
        }

        // Aggregate functions - not differentiable, return 0
        SquashType::Minimum | SquashType::Maximum | SquashType::If => 0.0,
    }
}

// ============================================================================
// Issue #1142 - WASM Migration Phase 10: Range Validation
// ============================================================================

// Special range constants based on TypeScript implementations
// GELU minimum occurs around x ≈ -0.509 with value ≈ -0.17
const GELU_MIN: f32 = -0.17;

// Swish minimum occurs around x ≈ -1.278 with value ≈ -0.278
const SWISH_MIN: f32 = -0.278;

// Mish minimum occurs around x ≈ -1.19 with value ≈ -0.309
const MISH_MIN: f32 = -0.309;

// Softplus practical lower bound (small positive)
const SOFTPLUS_MIN: f32 = 1e-15;

// Softplus practical upper bound (prevents overflow)
const SOFTPLUS_MAX: f32 = 100.0;

// Softsign approaches but never reaches ±1
const SOFTSIGN_LIMIT: f32 = 0.99;

// Use f32::MAX as a practical "unbounded" value since we're in WASM/f32 space
const F32_LARGE: f32 = 3.4028235e38;

/// Get the range (low, high) for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns a tuple (low, high) representing the valid output range.
#[inline(always)]
fn apply_get_range(squash_type: SquashType) -> (f32, f32) {
    match squash_type {
        // Unbounded functions: use large f32 values
        SquashType::Identity => (-F32_LARGE, F32_LARGE),
        SquashType::LeakyRelu => (-F32_LARGE, F32_LARGE),
        SquashType::Tan => (-F32_LARGE, F32_LARGE),
        SquashType::BentIdentity => (-F32_LARGE, F32_LARGE),
        SquashType::Complement => (-F32_LARGE, F32_LARGE),
        SquashType::Cube => (-F32_LARGE, F32_LARGE),
        SquashType::StdInverse => (-F32_LARGE, F32_LARGE),

        // One-sided unbounded [0, inf)
        SquashType::Relu => (0.0, F32_LARGE),
        SquashType::Absolute => (0.0, F32_LARGE),
        SquashType::Square => (0.0, F32_LARGE),
        SquashType::Sqrt => (0.0, F32_LARGE),
        SquashType::Exponential => (0.0, F32_LARGE),

        // Bounded [0, 1]
        SquashType::Logistic => (0.0, 1.0),
        SquashType::Gaussian => (0.0, 1.0),
        SquashType::Step => (0.0, 1.0),

        // Bounded [-1, 1]
        SquashType::Tanh => (-1.0, 1.0),
        SquashType::HardTanh => (-1.0, 1.0),
        SquashType::Sine => (-1.0, 1.0),
        SquashType::Cosine => (-1.0, 1.0),
        SquashType::BipolarSigmoid => (-1.0, 1.0),
        SquashType::Bipolar => (-1.0, 1.0),
        SquashType::Isru => (-1.0, 1.0),

        // Specific bounded ranges
        SquashType::Relu6 => (0.0, 6.0),
        SquashType::Softsign => (-SOFTSIGN_LIMIT, SOFTSIGN_LIMIT),
        SquashType::Softplus => (SOFTPLUS_MIN, SOFTPLUS_MAX),
        SquashType::ArcTan => (-std::f32::consts::FRAC_PI_2, std::f32::consts::FRAC_PI_2),

        // Special bounded with negative lower
        SquashType::Elu => (-1.0, F32_LARGE), // ELU with alpha=1 has min of -1
        SquashType::Selu => (-SELU_ALPHA * SELU_LAMBDA, F32_LARGE), // SELU minimum
        SquashType::LogSigmoid => (-F32_LARGE, 0.0), // Output is always <= 0

        // Functions with empirically determined minimums
        SquashType::Swish => (SWISH_MIN, F32_LARGE),
        SquashType::Mish => (MISH_MIN, F32_LARGE),
        SquashType::Gelu => (GELU_MIN, F32_LARGE),

        // Aggregate functions - unbounded
        SquashType::Minimum => (-F32_LARGE, F32_LARGE),
        SquashType::Maximum => (-F32_LARGE, F32_LARGE),
        SquashType::If => (-F32_LARGE, F32_LARGE),
    }
}

/// Validate that an activation value is within the valid range
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns true if the activation is within the valid range, false otherwise.
/// Also returns false for NaN and Infinity values.
#[inline(always)]
fn apply_validate_range(squash_type: SquashType, activation: f32) -> bool {
    // NaN and Infinity are never valid
    if !activation.is_finite() {
        return false;
    }

    let (low, high) = apply_get_range(squash_type);
    activation >= low && activation <= high
}

/// Clamp a value to the valid range for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns the value clamped to the valid range.
/// Infinity values are clamped to the bounds.
/// NaN returns 0.0 as a safe default.
#[inline(always)]
fn apply_limit_range(squash_type: SquashType, value: f32) -> f32 {
    // Handle NaN - return 0 as a safe default
    if value.is_nan() {
        return 0.0;
    }

    let (low, high) = apply_get_range(squash_type);

    // Handle infinities by clamping to bounds
    if value == f32::INFINITY {
        return high.min(F32_LARGE);
    }
    if value == f32::NEG_INFINITY {
        return low.max(-F32_LARGE);
    }

    // Clamp to range
    value.max(low).min(high)
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
                self.activations[actual_idx] = apply_limit_range(SquashType::Identity, bias);
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

                // Clamp to the activation's expected output range to avoid NaN/Inf
                // propagation and to match the JS implementation's range limiting.
                self.activations[actual_idx] = apply_limit_range(squash, activation);
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

                // Clamp activation output to match JS range limiting and prevent
                // NaN/Inf propagation through the network.
                let activation_limited = apply_limit_range(squash, activation);

                self.activations[actual_idx] = activation_limited;

                // hintValues: for aggregate functions we expect hint==activation.
                // For standard squashes keep the pre-squash value.
                hint_values[neuron_idx] = match squash {
                    SquashType::Minimum | SquashType::Maximum | SquashType::If => activation_limited,
                    _ => hint_value,
                };
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

/// Standalone unsquash function for testing
/// Issue #1139 - WASM Migration Phase 7
///
/// Computes the inverse of the specified activation function at the given activation value.
/// The hint parameter guides the inverse for ambiguous or non-invertible functions.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `activation` - The squashed activation value to invert
/// * `hint` - A hint value to guide the inverse (use NaN or pass the original input value)
#[wasm_bindgen]
pub fn unsquash(squash_type: u8, activation: f32, hint: f32) -> f32 {
    apply_unsquash(SquashType::from(squash_type), activation, hint)
}

/// Standalone safe zone adjustment function for testing
/// Issue #1140 - WASM Migration Phase 8
///
/// Returns a float from 0 (not safe) to 1 (fully safe) indicating how useful it is
/// to backpropagate through a neuron based on saturation levels.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `raw_input` - The raw input value before squashing
/// * `error` - The error value from backpropagation
/// * `weight` - The synapse weight (use NaN if not applicable)
#[wasm_bindgen]
pub fn safe_zone_adjustment(squash_type: u8, raw_input: f32, error: f32, weight: f32) -> f32 {
    // If weight is NaN, use 1.0 as a neutral default
    let safe_weight = if weight.is_finite() { weight } else { 1.0 };
    apply_safe_zone_adjustment(SquashType::from(squash_type), raw_input, error, safe_weight)
}

/// Standalone calculate error function for testing
/// Issue #1141 - WASM Migration Phase 9
///
/// Calculates the error in value-space for backpropagation.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `current_activation` - The neuron's current output (after squash)
/// * `target_activation` - The desired output
/// * `current_value` - The pre-squash value (hint for unSquash)
#[wasm_bindgen]
pub fn calculate_error(
    squash_type: u8,
    current_activation: f32,
    target_activation: f32,
    current_value: f32,
) -> f32 {
    apply_calculate_error(
        SquashType::from(squash_type),
        current_activation,
        target_activation,
        current_value,
    )
}

/// Get the range (low, high) for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns a Float32Array with two elements: [low, high]
/// representing the valid output range for the activation function.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
#[wasm_bindgen]
pub fn get_range(squash_type: u8) -> js_sys::Float32Array {
    let (low, high) = apply_get_range(SquashType::from(squash_type));
    let result = js_sys::Float32Array::new_with_length(2);
    result.set_index(0, low);
    result.set_index(1, high);
    result
}

/// Validate that an activation value is within the valid range
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns true if the activation is within the valid range for the
/// specified activation function, false otherwise.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `activation` - The activation value to validate
#[wasm_bindgen]
pub fn validate_range(squash_type: u8, activation: f32) -> bool {
    apply_validate_range(SquashType::from(squash_type), activation)
}

/// Clamp a value to the valid range for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns the value clamped to the valid range for the specified
/// activation function. Infinity values are clamped to the bounds.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `value` - The value to clamp
#[wasm_bindgen]
pub fn limit_range(squash_type: u8, value: f32) -> f32 {
    apply_limit_range(SquashType::from(squash_type), value)
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

    // Issue #1139 - UnSquash tests
    #[test]
    fn test_unsquash_identity() {
        // Identity: f⁻¹(y) = y
        assert_eq!(apply_unsquash(SquashType::Identity, 0.0, 0.0), 0.0);
        assert_eq!(apply_unsquash(SquashType::Identity, 5.0, 0.0), 5.0);
        assert_eq!(apply_unsquash(SquashType::Identity, -5.0, 0.0), -5.0);
    }

    #[test]
    fn test_unsquash_relu() {
        // ReLU: f⁻¹(y) = y for y > 0, else hint
        assert_eq!(apply_unsquash(SquashType::Relu, 5.0, 0.0), 5.0);
        assert_eq!(apply_unsquash(SquashType::Relu, 0.0, -3.0), -3.0);
        assert_eq!(apply_unsquash(SquashType::Relu, 0.0, f32::NAN), 0.0);
    }

    #[test]
    fn test_unsquash_leaky_relu() {
        // LeakyReLU: f⁻¹(y) = y >= 0 ? y : y / alpha
        assert_eq!(apply_unsquash(SquashType::LeakyRelu, 1.0, 0.0), 1.0);
        // For y = -0.01, x = -0.01 / 0.01 = -1.0
        let result = apply_unsquash(SquashType::LeakyRelu, -0.01, 0.0);
        assert!((result - (-1.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_logistic() {
        // Logistic: f⁻¹(y) = log(y / (1 - y))
        // At y = 0.5, x = log(0.5 / 0.5) = log(1) = 0
        let result = apply_unsquash(SquashType::Logistic, 0.5, 0.0);
        assert!(result.abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_tanh() {
        // TANH: f⁻¹(y) = 0.5 * log((1 + y) / (1 - y))
        // At y = 0, x = 0.5 * log(1/1) = 0
        let result = apply_unsquash(SquashType::Tanh, 0.0, 0.0);
        assert!(result.abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_complement() {
        // Complement: f⁻¹(y) = 1 - y
        assert_eq!(apply_unsquash(SquashType::Complement, 0.0, 0.0), 1.0);
        assert_eq!(apply_unsquash(SquashType::Complement, 0.5, 0.0), 0.5);
        assert_eq!(apply_unsquash(SquashType::Complement, 1.0, 0.0), 0.0);
    }

    #[test]
    fn test_unsquash_cube() {
        // Cube: f⁻¹(y) = cbrt(y)
        assert_eq!(apply_unsquash(SquashType::Cube, 0.0, 0.0), 0.0);
        let result = apply_unsquash(SquashType::Cube, 8.0, 0.0);
        assert!((result - 2.0).abs() < 1e-5);
        let result2 = apply_unsquash(SquashType::Cube, -8.0, 0.0);
        assert!((result2 - (-2.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_square() {
        // Square: f⁻¹(y) = ±sqrt(y) based on hint
        let result = apply_unsquash(SquashType::Square, 4.0, 2.0);
        assert!((result - 2.0).abs() < 1e-5);
        let result2 = apply_unsquash(SquashType::Square, 4.0, -2.0);
        assert!((result2 - (-2.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_roundtrip() {
        // Test roundtrip: squash(x) -> unsquash(activation, x) should give x back
        let test_values = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0];

        for &x in &test_values {
            // Identity
            let activation = apply_squash(SquashType::Identity, x);
            let recovered = apply_unsquash(SquashType::Identity, activation, x);
            assert!((recovered - x).abs() < 1e-5, "Identity roundtrip failed for x={}", x);

            // LeakyReLU
            let activation = apply_squash(SquashType::LeakyRelu, x);
            let recovered = apply_unsquash(SquashType::LeakyRelu, activation, x);
            assert!((recovered - x).abs() < 1e-4, "LeakyReLU roundtrip failed for x={}", x);

            // Complement
            let activation = apply_squash(SquashType::Complement, x);
            let recovered = apply_unsquash(SquashType::Complement, activation, x);
            assert!((recovered - x).abs() < 1e-5, "Complement roundtrip failed for x={}", x);

            // Cube
            let activation = apply_squash(SquashType::Cube, x);
            let recovered = apply_unsquash(SquashType::Cube, activation, x);
            assert!((recovered - x).abs() < 1e-5, "Cube roundtrip failed for x={}", x);
        }
    }

    #[test]
    fn test_unsquash_aggregate_functions() {
        // Aggregate functions return hint if provided
        assert_eq!(apply_unsquash(SquashType::Minimum, 1.0, 42.0), 42.0);
        assert_eq!(apply_unsquash(SquashType::Maximum, 1.0, 42.0), 42.0);
        assert_eq!(apply_unsquash(SquashType::If, 1.0, 42.0), 42.0);
    }

    // Issue #1141 - CalculateError tests
    #[test]
    fn test_calculate_error_identity() {
        // Identity: error = rawError (slope = 1)
        let error = apply_calculate_error(SquashType::Identity, 0.5, 0.8, 0.5);
        assert!((error - 0.3).abs() < 1e-5, "Identity error should be 0.3, got {}", error);

        // Tiny error should return 0
        let tiny_error = apply_calculate_error(SquashType::Identity, 0.5, 0.5 + 1e-8, 0.5);
        assert_eq!(tiny_error, 0.0, "Tiny error should return 0");
    }

    #[test]
    fn test_calculate_error_complement() {
        // Complement: error = rawError / -1 = -rawError
        let error = apply_calculate_error(SquashType::Complement, 0.5, 0.8, 0.5);
        assert!((error - (-0.3)).abs() < 1e-5, "Complement error should be -0.3, got {}", error);
    }

    #[test]
    fn test_calculate_error_relu() {
        // ReLU: use raw error when active
        let error = apply_calculate_error(SquashType::Relu, 2.0, 3.0, 2.0);
        assert!((error - 1.0).abs() < 1e-5, "ReLU active error should be 1.0, got {}", error);

        // ReLU: dead neuron uses unSquash fallback
        let dead_error = apply_calculate_error(SquashType::Relu, 0.0, 1.0, -1.0);
        assert!(dead_error.is_finite(), "ReLU dead error should be finite");
    }

    #[test]
    fn test_calculate_error_tanh() {
        // TANH: use derivative when slope is strong
        let current_value = 0.0;
        let activation = (current_value as f32).tanh(); // 0.0
        let error = apply_calculate_error(SquashType::Tanh, activation, 0.5, current_value);
        // At x=0, derivative = 1, so error = rawError / 1 = 0.5
        assert!((error - 0.5).abs() < 1e-4, "TANH error at x=0 should be ~0.5, got {}", error);
    }

    #[test]
    fn test_calculate_error_absolute() {
        // ABSOLUTE: uses closest target approach
        // currentValue = -2, activation = 2, target = 1
        // Options: -1 or +1 as targets
        // closest to -2 is -1, so error = -1 - (-2) = 1
        let error = apply_calculate_error(SquashType::Absolute, 2.0, 1.0, -2.0);
        assert!((error - 1.0).abs() < 1e-5, "Absolute error should be 1.0, got {}", error);
    }

    #[test]
    fn test_calculate_error_clamping() {
        // Test that errors are clamped to ±100
        let large_error = apply_calculate_error(SquashType::Identity, 0.0, 1000.0, 0.0);
        assert!(large_error.abs() <= 100.0, "Error should be clamped to ±100, got {}", large_error);

        let neg_large_error = apply_calculate_error(SquashType::Identity, 1000.0, 0.0, 1000.0);
        assert!(neg_large_error.abs() <= 100.0, "Negative error should be clamped to ±100, got {}", neg_large_error);
    }

    #[test]
    fn test_calculate_error_aggregate_functions() {
        // Aggregate functions should return 0
        assert_eq!(apply_calculate_error(SquashType::Minimum, 0.5, 0.8, 0.5), 0.0);
        assert_eq!(apply_calculate_error(SquashType::Maximum, 0.5, 0.8, 0.5), 0.0);
        assert_eq!(apply_calculate_error(SquashType::If, 0.5, 0.8, 0.5), 0.0);
    }

    // Issue #1142 - Range Validation tests
    #[test]
    fn test_get_range_bounded() {
        // LOGISTIC [0, 1]
        let (low, high) = apply_get_range(SquashType::Logistic);
        assert_eq!(low, 0.0, "Logistic low should be 0");
        assert_eq!(high, 1.0, "Logistic high should be 1");

        // TANH [-1, 1]
        let (low, high) = apply_get_range(SquashType::Tanh);
        assert_eq!(low, -1.0, "Tanh low should be -1");
        assert_eq!(high, 1.0, "Tanh high should be 1");

        // ReLU6 [0, 6]
        let (low, high) = apply_get_range(SquashType::Relu6);
        assert_eq!(low, 0.0, "ReLU6 low should be 0");
        assert_eq!(high, 6.0, "ReLU6 high should be 6");

        // GAUSSIAN [0, 1]
        let (low, high) = apply_get_range(SquashType::Gaussian);
        assert_eq!(low, 0.0, "Gaussian low should be 0");
        assert_eq!(high, 1.0, "Gaussian high should be 1");
    }

    #[test]
    fn test_get_range_unbounded() {
        // IDENTITY - unbounded
        let (low, high) = apply_get_range(SquashType::Identity);
        assert!(low < -1e30, "Identity low should be very negative");
        assert!(high > 1e30, "Identity high should be very positive");

        // ReLU [0, inf)
        let (low, high) = apply_get_range(SquashType::Relu);
        assert_eq!(low, 0.0, "ReLU low should be 0");
        assert!(high > 1e30, "ReLU high should be very positive");
    }

    #[test]
    fn test_get_range_special_bounds() {
        // ArcTan [-π/2, π/2]
        let (low, high) = apply_get_range(SquashType::ArcTan);
        assert!((low - (-std::f32::consts::FRAC_PI_2)).abs() < 1e-5, "ArcTan low should be -π/2");
        assert!((high - std::f32::consts::FRAC_PI_2).abs() < 1e-5, "ArcTan high should be π/2");

        // LogSigmoid (-inf, 0]
        let (low, high) = apply_get_range(SquashType::LogSigmoid);
        assert!(low < -1e30, "LogSigmoid low should be very negative");
        assert_eq!(high, 0.0, "LogSigmoid high should be 0");

        // ELU [-1, inf)
        let (low, high) = apply_get_range(SquashType::Elu);
        assert_eq!(low, -1.0, "ELU low should be -1");
        assert!(high > 1e30, "ELU high should be very positive");

        // GELU has empirically determined minimum
        let (low, _) = apply_get_range(SquashType::Gelu);
        assert!((low - (-0.17)).abs() < 0.01, "GELU low should be approximately -0.17");
    }

    #[test]
    fn test_validate_range_valid() {
        // Valid values within range
        assert!(apply_validate_range(SquashType::Logistic, 0.5), "0.5 should be valid for Logistic");
        assert!(apply_validate_range(SquashType::Logistic, 0.0), "0.0 should be valid for Logistic");
        assert!(apply_validate_range(SquashType::Logistic, 1.0), "1.0 should be valid for Logistic");

        assert!(apply_validate_range(SquashType::Tanh, 0.0), "0.0 should be valid for Tanh");
        assert!(apply_validate_range(SquashType::Tanh, -0.5), "-0.5 should be valid for Tanh");

        assert!(apply_validate_range(SquashType::Relu, 0.0), "0.0 should be valid for ReLU");
        assert!(apply_validate_range(SquashType::Relu, 100.0), "100.0 should be valid for ReLU");

        // Unbounded functions accept any finite value
        assert!(apply_validate_range(SquashType::Identity, -1000.0), "-1000 should be valid for Identity");
        assert!(apply_validate_range(SquashType::Identity, 1000.0), "1000 should be valid for Identity");
    }

    #[test]
    fn test_validate_range_invalid() {
        // Out of range values
        assert!(!apply_validate_range(SquashType::Logistic, -0.1), "-0.1 should be invalid for Logistic");
        assert!(!apply_validate_range(SquashType::Logistic, 1.1), "1.1 should be invalid for Logistic");

        assert!(!apply_validate_range(SquashType::Tanh, -1.5), "-1.5 should be invalid for Tanh");
        assert!(!apply_validate_range(SquashType::Tanh, 1.5), "1.5 should be invalid for Tanh");

        assert!(!apply_validate_range(SquashType::Relu, -1.0), "-1.0 should be invalid for ReLU");

        // NaN and Infinity
        assert!(!apply_validate_range(SquashType::Logistic, f32::NAN), "NaN should be invalid");
        assert!(!apply_validate_range(SquashType::Tanh, f32::INFINITY), "Infinity should be invalid");
        assert!(!apply_validate_range(SquashType::Relu, f32::NEG_INFINITY), "-Infinity should be invalid");
    }

    #[test]
    fn test_limit_range_clamping() {
        // Values within range should pass through
        assert_eq!(apply_limit_range(SquashType::Logistic, 0.5), 0.5);
        assert_eq!(apply_limit_range(SquashType::Tanh, 0.0), 0.0);

        // Values outside range should be clamped
        assert_eq!(apply_limit_range(SquashType::Logistic, -0.5), 0.0);
        assert_eq!(apply_limit_range(SquashType::Logistic, 1.5), 1.0);
        assert_eq!(apply_limit_range(SquashType::Tanh, -2.0), -1.0);
        assert_eq!(apply_limit_range(SquashType::Tanh, 2.0), 1.0);
        assert_eq!(apply_limit_range(SquashType::Relu6, 10.0), 6.0);
        assert_eq!(apply_limit_range(SquashType::Relu6, -1.0), 0.0);

        // Infinity should be clamped to bounds
        assert_eq!(apply_limit_range(SquashType::Logistic, f32::INFINITY), 1.0);
        assert_eq!(apply_limit_range(SquashType::Logistic, f32::NEG_INFINITY), 0.0);
        assert_eq!(apply_limit_range(SquashType::Tanh, f32::INFINITY), 1.0);
        assert_eq!(apply_limit_range(SquashType::Tanh, f32::NEG_INFINITY), -1.0);

        // NaN should return 0
        assert_eq!(apply_limit_range(SquashType::Logistic, f32::NAN), 0.0);
    }

    #[test]
    fn test_range_aggregate_functions() {
        // Aggregate functions should have unbounded ranges
        let (low, high) = apply_get_range(SquashType::Minimum);
        assert!(low < -1e30, "Minimum low should be very negative");
        assert!(high > 1e30, "Minimum high should be very positive");

        let (low, high) = apply_get_range(SquashType::Maximum);
        assert!(low < -1e30, "Maximum low should be very negative");
        assert!(high > 1e30, "Maximum high should be very positive");

        let (low, high) = apply_get_range(SquashType::If);
        assert!(low < -1e30, "If low should be very negative");
        assert!(high > 1e30, "If high should be very positive");
    }
}
