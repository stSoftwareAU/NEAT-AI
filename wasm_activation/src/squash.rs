//! Squash (activation) functions for neural network neurons.
//!
//! This module provides the squash function types and their implementations,
//! matching the TypeScript activation functions in the NEAT-AI project.

// SELU constants
pub const SELU_ALPHA: f32 = 1.673_263_2;
pub const SELU_LAMBDA: f32 = 1.050_701;

// GELU constant
pub const GELU_COEFF: f32 = 0.044715;
pub const SQRT_2_OVER_PI: f32 = 0.797_884_6; // sqrt(2/pi)

// LeakyReLU alpha
pub const LEAKY_RELU_ALPHA: f32 = 0.01;

// Match the JS implementation's practical clamp for very large one-sided outputs.
// JS uses Number.MAX_SAFE_INTEGER (~9.007e15) as an upper bound for several
// activations (e.g. Exponential).
pub const JS_MAX_SAFE_INTEGER: f32 = 9_007_199_254_740_992.0;

// Softsign approaches but never reaches +/-1
pub const SOFTSIGN_LIMIT: f32 = 0.99;

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
pub fn apply_squash(squash_type: SquashType, x: f32) -> f32 {
    match squash_type {
        SquashType::Identity => x,
        SquashType::Relu => x.max(0.0),
        SquashType::Relu6 => x.clamp(0.0, 6.0),
        SquashType::LeakyRelu => {
            if x >= 0.0 {
                x
            } else {
                LEAKY_RELU_ALPHA * x
            }
        }
        // Match TypeScript behaviour (SELU clamps upper bound to avoid exp overflow).
        SquashType::Selu => {
            if !x.is_finite() {
                return -JS_MAX_SAFE_INTEGER;
            }
            let safe_x = (x as f64).min(709.0);
            let fx = if safe_x > 0.0 {
                safe_x
            } else {
                (SELU_ALPHA as f64) * safe_x.exp() - (SELU_ALPHA as f64)
            };
            ((SELU_LAMBDA as f64) * fx) as f32
        }
        SquashType::Elu => {
            if x > 0.0 {
                x
            } else {
                x.exp() - 1.0
            }
        }
        SquashType::Logistic => 1.0 / (1.0 + (-x).exp()),
        SquashType::Tanh => x.tanh(),
        SquashType::HardTanh => x.clamp(-1.0, 1.0),
        SquashType::Softsign => {
            // Match JS ActivationRange bounds (+/-0.99) and avoid tiny f32 overshoots
            // that can fail validation (see test/propagate/ToValue.ts).
            let y = x / (1.0 + x.abs());
            // IMPORTANT: `0.99` in f32 is slightly *greater* than `0.99` in JS (f64),
            // so clamping to `SOFTSIGN_LIMIT` can still yield values > 0.99 in JS.
            // Use the next smaller f32 value to stay within the JS bounds.
            let limit = f32::from_bits(SOFTSIGN_LIMIT.to_bits() - 1);
            y.max(-limit).min(limit)
        }
        // Match TypeScript behaviour (Softplus clamps at x>=709 to 100, non-finite -> 1e-15).
        SquashType::Softplus => {
            if !x.is_finite() {
                return 1e-15;
            }
            if x >= 709.0 {
                return 100.0;
            }
            ((1.0f64 + (x as f64).exp()).ln()) as f32
        }
        SquashType::Swish => x / (1.0 + (-x).exp()),
        SquashType::Mish => x * (1.0 + x.exp()).ln().tanh(),
        SquashType::Gelu => {
            0.5 * x * (1.0 + (SQRT_2_OVER_PI * (x + GELU_COEFF * x * x * x)).tanh())
        }
        SquashType::Sine => x.sin(),
        SquashType::Cosine => ((x as f64).cos()) as f32,
        SquashType::Tan => ((x as f64).tan()) as f32,
        SquashType::ArcTan => x.atan(),
        SquashType::Gaussian => (-x * x).exp(),
        SquashType::BentIdentity => ((x * x + 1.0).sqrt() - 1.0) / 2.0 + x,
        SquashType::BipolarSigmoid => 2.0 / (1.0 + (-x).exp()) - 1.0,
        SquashType::Bipolar => {
            if x > 0.0 {
                1.0
            } else {
                -1.0
            }
        }
        SquashType::Step => {
            if x > 0.0 {
                1.0
            } else {
                0.0
            }
        }
        SquashType::Complement => 1.0 - x,
        SquashType::Absolute => x.abs(),
        SquashType::Square => {
            let xf = x as f64;
            (xf * xf) as f32
        }
        SquashType::Cube => {
            let xf = x as f64;
            (xf * xf * xf) as f32
        }
        SquashType::Sqrt => {
            if x >= 0.0 {
                x.sqrt()
            } else {
                0.0
            }
        }
        SquashType::StdInverse => {
            if x.abs() < 1e-10 {
                if x >= 0.0 {
                    1e10
                } else {
                    -1e10
                }
            } else {
                1.0 / x
            }
        }
        SquashType::Exponential => {
            // Match TypeScript behaviour:
            // - For non-finite x, return a safe capped value.
            // - For x >= 36, clamp to MAX_SAFE_INTEGER to prevent runaway growth.
            //   (JS uses this to avoid overflow and destabilising downstream sums.)
            if !x.is_finite() || x >= 36.0 {
                JS_MAX_SAFE_INTEGER
            } else {
                ((x as f64).exp()) as f32
            }
        }
        SquashType::LogSigmoid => {
            // Match TypeScript behaviour:
            // - Non-finite -> MIN_SAFE_INTEGER
            // - For x <= -709, exp(-x) overflows in JS; TS clamps to low bound.
            if !x.is_finite() || x <= -709.0 {
                return -JS_MAX_SAFE_INTEGER;
            }
            let xf = x as f64;
            let exp_neg_x = (-xf).exp();
            (-(1.0f64 + exp_neg_x).ln()) as f32
        }
        SquashType::Isru => x / (1.0 + x * x).sqrt(),
        // Aggregate functions (Issue #1125) - these are handled specially in the
        // neuron activation loop and don't use the standard sum-then-squash pattern.
        // Return identity as a fallback if they're ever called directly.
        SquashType::Minimum | SquashType::Maximum | SquashType::If => x,
    }
}

/// Apply a squash function to a value (f64 path).
///
/// This is used by the compiled-network activator to more closely match the
/// TypeScript implementation (JS numbers are f64) while still storing the final
/// activations as f32 (Float32Array parity).
#[allow(dead_code)]
#[inline(always)]
pub fn apply_squash_f64(squash_type: SquashType, x: f64) -> f64 {
    match squash_type {
        SquashType::Identity => x,
        SquashType::Relu => x.max(0.0),
        SquashType::Relu6 => x.clamp(0.0, 6.0),
        SquashType::LeakyRelu => {
            if x >= 0.0 {
                x
            } else {
                (LEAKY_RELU_ALPHA as f64) * x
            }
        }
        SquashType::Selu => {
            // Match TypeScript behaviour: clamp upper bound to avoid exp overflow.
            if !x.is_finite() {
                return -JS_MAX_SAFE_INTEGER as f64;
            }
            let safe_x = x.min(709.0);
            let fx = if safe_x > 0.0 {
                safe_x
            } else {
                (SELU_ALPHA as f64) * safe_x.exp() - (SELU_ALPHA as f64)
            };
            (SELU_LAMBDA as f64) * fx
        }
        SquashType::Elu => {
            if x > 0.0 {
                x
            } else {
                x.exp() - 1.0
            }
        }
        SquashType::Logistic => 1.0 / (1.0 + (-x).exp()),
        SquashType::Tanh => x.tanh(),
        SquashType::HardTanh => x.clamp(-1.0, 1.0),
        SquashType::Softsign => x / (1.0 + x.abs()),
        SquashType::Softplus => {
            // Match TypeScript behaviour:
            // - Non-finite -> SMALL_THRESHOLD (1e-15)
            // - Clamp at x>=709 to LARGE_THRESHOLD (100)
            if !x.is_finite() {
                return 1e-15;
            }
            if x >= 709.0 {
                return 100.0;
            }
            (1.0 + x.exp()).ln()
        }
        SquashType::Swish => {
            // Match TypeScript behaviour: exp(-x) underflows for large +x.
            if !x.is_finite() {
                return 0.0;
            }
            let exp_neg_x = if x > 20.0 { 0.0 } else { (-x).exp() };
            x / (1.0 + exp_neg_x)
        }
        SquashType::Mish => x * (1.0 + x.exp()).ln().tanh(),
        SquashType::Gelu => {
            let x3 = x * x * x;
            0.5 * x * (1.0 + ((SQRT_2_OVER_PI as f64) * (x + (GELU_COEFF as f64) * x3)).tanh())
        }
        SquashType::Sine => x.sin(),
        SquashType::Cosine => x.cos(),
        SquashType::Tan => x.tan(),
        SquashType::ArcTan => x.atan(),
        SquashType::Gaussian => (-x * x).exp(),
        SquashType::BentIdentity => ((x * x + 1.0).sqrt() - 1.0) / 2.0 + x,
        SquashType::BipolarSigmoid => 2.0 / (1.0 + (-x).exp()) - 1.0,
        SquashType::Bipolar => {
            if x > 0.0 {
                1.0
            } else {
                -1.0
            }
        }
        SquashType::Step => {
            if x > 0.0 {
                1.0
            } else {
                0.0
            }
        }
        SquashType::Complement => 1.0 - x,
        SquashType::Absolute => x.abs(),
        SquashType::Square => x * x,
        SquashType::Cube => x * x * x,
        SquashType::Sqrt => {
            if x >= 0.0 {
                x.sqrt()
            } else {
                0.0
            }
        }
        SquashType::StdInverse => {
            // Match TypeScript: avoid division by near-zero and NaN.
            if !x.is_finite() {
                return 0.0;
            }
            let safe_x = if x.abs() < 1e-15 {
                if x > 0.0 {
                    1e-15
                } else {
                    -1e-15
                }
            } else {
                x
            };
            if safe_x != 0.0 {
                1.0 / safe_x
            } else {
                0.0
            }
        }
        SquashType::Exponential => {
            if !x.is_finite() {
                return JS_MAX_SAFE_INTEGER as f64;
            }
            if x >= 36.0 {
                return JS_MAX_SAFE_INTEGER as f64;
            }
            x.exp()
        }
        SquashType::LogSigmoid => {
            // Match TypeScript clamp behaviour.
            if !x.is_finite() || x <= -709.0 {
                return -(JS_MAX_SAFE_INTEGER as f64);
            }
            let exp_neg_x = (-x).exp();
            -(1.0 + exp_neg_x).ln()
        }
        SquashType::Isru => x / (1.0 + x * x).sqrt(),
        // Aggregate squashes are handled specially in the neuron loop.
        SquashType::Minimum | SquashType::Maximum | SquashType::If => x,
    }
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
}
