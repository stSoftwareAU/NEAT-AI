//! Derivative functions for neural network activation functions.
//!
//! This module provides the derivative implementations for all squash functions,
//! used in backpropagation. Issue #1138 - WASM Migration Phase 6.

use crate::squash::{
    SquashType, GELU_COEFF, LEAKY_RELU_ALPHA, SELU_ALPHA, SELU_LAMBDA, SQRT_2_OVER_PI,
};

/// Apply a derivative function to a value
/// Issue #1138 - WASM Migration Phase 6: Implement derivative() in Rust/WASM
///
/// Each derivative formula matches the corresponding TypeScript implementation.
#[inline(always)]
pub fn apply_derivative(squash_type: SquashType, x: f32) -> f32 {
    match squash_type {
        // f(x) = x, f'(x) = 1
        SquashType::Identity => 1.0,

        // f(x) = max(0, x), f'(x) = x > 0 ? 1 : 0
        SquashType::Relu => {
            if x > 0.0 {
                1.0
            } else {
                0.0
            }
        }

        // f(x) = clamp(x, 0, 6), f'(x) = x > 0 && x < 6 ? 1 : 0
        SquashType::Relu6 => {
            if x > 0.0 && x < 6.0 {
                1.0
            } else {
                0.0
            }
        }

        // f(x) = x >= 0 ? x : 0.01*x, f'(x) = x >= 0 ? 1 : 0.01
        SquashType::LeakyRelu => {
            if x >= 0.0 {
                1.0
            } else {
                LEAKY_RELU_ALPHA
            }
        }

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
        SquashType::Elu => {
            if x > 0.0 {
                1.0
            } else {
                x.exp()
            }
        }

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
        SquashType::HardTanh => {
            if x > -1.0 && x < 1.0 {
                1.0
            } else {
                0.0
            }
        }

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
            if d.is_finite() {
                d
            } else {
                0.0
            }
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

            let omega = 4.0 * e_2x
                + 4.0 * e_x * x
                + e_2x * x2
                + 2.0 * e_x * x2
                + 2.0 * x3
                + 4.0 * e_x
                + 4.0 * x
                + 6.0;
            let delta = 2.0 + 2.0 * e_x + e_2x;
            let raw = e_x * omega / (delta * delta);

            if raw.is_finite() {
                raw.max(0.0)
            } else {
                0.0
            }
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
            let pdf = (0.5 * x * (1.0 - tanh_inner * tanh_inner))
                * SQRT_2_OVER_PI
                * (1.0 + 3.0 * GELU_COEFF * x * x);

            let result = cdf + pdf;
            if result.is_finite() {
                result
            } else {
                0.0
            }
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
            if !d.is_finite() || d > 1000.0 {
                1000.0
            } else {
                d
            }
        }

        // f(x) = atan(x), f'(x) = 1 / (1 + x^2)
        SquashType::ArcTan => 1.0 / (1.0 + x * x),

        // f(x) = exp(-x^2), f'(x) = -2x * exp(-x^2)
        SquashType::Gaussian => {
            let result = -2.0 * x * (-x * x).exp();
            if result.is_finite() && result.abs() >= 1e-300 {
                result
            } else {
                0.0
            }
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
            if x.abs() < epsilon {
                0.01
            } else {
                0.0
            }
        }

        // f(x) = 1 - x, f'(x) = -1
        SquashType::Complement => -1.0,

        // f(x) = |x|, f'(x) = x > 0 ? 1 : (x < 0 ? -1 : 0)
        SquashType::Absolute => {
            if x > 0.0 {
                1.0
            } else if x < 0.0 {
                -1.0
            } else {
                0.0
            }
        }

        // f(x) = x^2, f'(x) = 2x
        SquashType::Square => {
            if x.is_finite() {
                2.0 * x
            } else {
                0.0
            }
        }

        // f(x) = x^3, f'(x) = 3x^2
        SquashType::Cube => 3.0 * x * x,

        // f(x) = sqrt(x) for x >= 0, f'(x) = 1 / (2 * sqrt(x)) for x > 0
        SquashType::Sqrt => {
            if x > 0.0 {
                1.0 / (2.0 * x.sqrt())
            } else {
                0.0
            }
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
            if raw < 1e-12 {
                0.0
            } else if raw > 50.0 {
                50.0
            } else {
                raw
            }
        }

        // f(x) = log(sigmoid(x)) = -log(1 + exp(-x))
        // f'(x) = 1 - sigmoid(x) = exp(-x) / (1 + exp(-x))
        SquashType::LogSigmoid => {
            // Handle overflow/underflow
            if x >= 709.0 {
                return 0.0;
            }
            if x <= -709.0 {
                return 1.0;
            }

            let exp_neg_x = (-x).exp();
            let value = exp_neg_x / (1.0 + exp_neg_x);

            // Clamp to safe float range
            value.clamp(1e-6, 1.0)
        }

        // f(x) = x / sqrt(1 + alpha * x^2), alpha = 1
        // f'(x) = (1 + x^2)^(-3/2)
        SquashType::Isru => {
            let x2 = x * x;
            let denom = 1.0 + x2;
            if denom < 1e-12 {
                0.0
            } else {
                denom.powf(-1.5)
            }
        }

        // Aggregate functions don't have traditional derivatives
        // Return 0 as a safe default
        SquashType::Minimum | SquashType::Maximum | SquashType::If => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            apply_derivative(SquashType::LeakyRelu, -1.0),
            LEAKY_RELU_ALPHA
        );
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
