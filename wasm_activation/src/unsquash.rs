//! Inverse squash (unsquash) functions for neural network activation functions.
//!
//! This module provides inverse implementations for all squash functions,
//! converting activation-space values back to value-space.
//! Issue #1139 - WASM Migration Phase 7.

use crate::derivative::apply_derivative;
use crate::squash::{apply_squash, SquashType, LEAKY_RELU_ALPHA, SELU_ALPHA, SELU_LAMBDA};

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
pub fn apply_unsquash(squash_type: SquashType, activation: f32, hint: f32) -> f32 {
    // Check for non-finite inputs
    if !activation.is_finite() {
        return if hint.is_finite() { hint } else { 0.0 };
    }

    match squash_type {
        // f(x) = x, f^(-1)(y) = y
        SquashType::Identity => activation,

        // f(x) = max(0, x), f^(-1)(y) = y for y > 0, else hint
        SquashType::Relu => {
            if activation > 0.0 {
                activation
            } else if hint.is_finite() {
                hint
            } else {
                0.0
            }
        }

        // f(x) = clamp(x, 0, 6), f^(-1)(y) = y for 0 < y < 6
        SquashType::Relu6 => {
            if activation > 0.0 && activation < 6.0 {
                activation
            } else if activation == 6.0 && hint.is_finite() {
                if hint > 6.0 {
                    hint
                } else {
                    6.0
                }
            } else if activation == 0.0 && hint.is_finite() {
                if hint < 0.0 {
                    hint
                } else {
                    0.0
                }
            } else {
                0.0
            }
        }

        // f(x) = x >= 0 ? x : 0.01*x, f^(-1)(y) = y >= 0 ? y : y/0.01
        SquashType::LeakyRelu => {
            if activation >= 0.0 {
                activation
            } else {
                activation / LEAKY_RELU_ALPHA
            }
        }

        // f(x) = lambda * (x >= 0 ? x : alpha * (exp(x) - 1))
        // f^(-1)(y) for y >= 0: y/lambda
        // f^(-1)(y) for y < 0: log(y/(lambda*alpha) + 1) if ratio > 0
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
        // f^(-1)(y) = y > 0 ? y : log(y + 1)
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
        // f^(-1)(y) = log(y / (1 - y)) (logit)
        SquashType::Logistic => {
            // Clamp to safe range to avoid log(0)
            let safe = activation.clamp(f32::EPSILON, 1.0 - f32::EPSILON);
            (safe / (1.0 - safe)).ln()
        }

        // f(x) = tanh(x)
        // f^(-1)(y) = 0.5 * log((1 + y) / (1 - y)) = atanh(y)
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
        // f^(-1)(y) = y (if squash(hint) == y, return hint)
        SquashType::HardTanh => {
            if hint.is_finite() && apply_squash(SquashType::HardTanh, hint) == activation {
                hint
            } else {
                activation
            }
        }

        // f(x) = x / (1 + |x|)
        // f^(-1)(y) = y / (1 - |y|)
        SquashType::Softsign => {
            let denom = 1.0 - activation.abs();
            if denom <= 1e-8 || !denom.is_finite() {
                return if hint.is_finite() { hint } else { 0.0 };
            }
            activation / denom
        }

        // f(x) = ln(1 + exp(x))
        // f^(-1)(y) = log(exp(y) - 1)
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
                let safe_dfx = if dfx.abs() > 1e-8 {
                    dfx
                } else {
                    dfx.signum() * 1e-8
                };
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
            guess = guess.clamp(-SAFE_LIMIT, SAFE_LIMIT);

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
                guess = guess.clamp(-SAFE_LIMIT, SAFE_LIMIT);
            }

            if guess.is_finite() {
                guess
            } else {
                0.0
            }
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

        // f(x) = sin(x), f^(-1)(y) = arcsin(y) adjusted by hint for periodicity
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

        // f(x) = cos(x), f^(-1)(y) = arccos(y) adjusted by hint for periodicity
        SquashType::Cosine => {
            let principal = activation.acos();
            let period = 2.0 * std::f32::consts::PI;
            let hint_finite = if hint.is_finite() { hint } else { 0.0 };
            let hint_periods = (hint_finite / period).round();

            // Collect valid solutions like JS does (exploring +/-4 periods)
            let mut solutions = Vec::new();
            for i in -4..=4 {
                let base = (hint_periods + i as f32) * period;
                let sol1 = principal + base;
                let sol2 = -principal + base;

                // Verify solutions are valid (cos(sol) approx activation)
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

        // f(x) = tan(x), f^(-1)(y) = atan(y) adjusted by hint for periodicity
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

        // f(x) = atan(x), f^(-1)(y) = tan(y)
        SquashType::ArcTan => {
            // Match the TypeScript implementation (ArcTan.EPSILON = 1e-5).
            // This ensures saturated activations map to +/-1e6 (or hint) rather than
            // a tan() result that is sensitive to f32 precision near +/-pi/2.
            const EPSILON: f32 = 1e-5;
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
                if hint.is_finite() {
                    hint
                } else {
                    0.0
                }
            } else {
                value
            }
        }

        // f(x) = exp(-x^2), f^(-1)(y) = +/-sqrt(-ln(y))
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
        // f^(-1)(y) = -log(2 / (y + 1) - 1)
        SquashType::BipolarSigmoid => {
            const EPSILON: f32 = 1e-10;
            // Match JS "prefer smallest-change" behaviour near saturation:
            // when activation is very close to +/-1 and we have a hint (current raw value),
            // keep the hint instead of returning a large inverse that can cause
            // instability and breaks roundtrip expectations (see test/propagate/ToValue.ts).
            const SAT_EPS: f32 = 1e-6;
            if hint.is_finite() && (activation >= 1.0 - SAT_EPS || activation <= -1.0 + SAT_EPS) {
                return hint;
            }
            let y = activation.clamp(-1.0 + EPSILON, 1.0 - EPSILON);
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
                    if x > 0.0 {
                        1
                    } else if x < 0.0 {
                        -1
                    } else {
                        0
                    }
                };
                if js_sign(hint) == js_sign(activation) {
                    return hint;
                }
                if hint.abs() < 1e-10 && activation < 0.0 {
                    return hint;
                }
            }
            if activation >= 0.0 {
                1.0
            } else {
                -1.0
            }
        }

        // f(x) = x > 0 ? 1 : 0
        // Not invertible, use hint
        SquashType::Step => {
            if (activation == 1.0 && hint.is_finite() && hint > 0.0)
                || (activation == 0.0 && hint.is_finite() && hint <= 0.0)
            {
                hint
            } else {
                activation
            }
        }

        // f(x) = 1 - x, f^(-1)(y) = 1 - y
        SquashType::Complement => 1.0 - activation,

        // f(x) = |x|, f^(-1)(y) = y or -y based on hint
        SquashType::Absolute => {
            if hint.is_finite() && hint < 0.0 {
                -activation
            } else {
                activation
            }
        }

        // f(x) = x^2, f^(-1)(y) = +/-sqrt(y) based on hint
        SquashType::Square => {
            let sign = if hint.is_finite() && hint < 0.0 {
                -1.0
            } else {
                1.0
            };
            sign * activation.max(0.0).sqrt()
        }

        // f(x) = x^3, f^(-1)(y) = cbrt(y)
        SquashType::Cube => activation.cbrt(),

        // f(x) = sqrt(x), f^(-1)(y) = y^2 with sign from hint
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

        // f(x) = 1/x (actually 1/(1+|x|) in JS), f^(-1)(y) = 1/y
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

        // f(x) = exp(x), f^(-1)(y) = ln(y)
        SquashType::Exponential => {
            if activation <= 0.0 || !activation.is_finite() {
                return if hint.is_finite() { hint } else { -20.0 };
            }
            activation.ln()
        }

        // f(x) = log(sigmoid(x)) = -log(1 + exp(-x))
        // f^(-1)(y) = log(exp(y) / (1 - exp(y)))
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
        // f^(-1)(y) = y / sqrt(1 - y^2)
        SquashType::Isru => {
            const MAX_ACTIVATION: f32 = 0.9999999;
            let safe = activation.clamp(-MAX_ACTIVATION + 1e-10, MAX_ACTIVATION - 1e-10);
            safe / (1.0 - safe * safe).sqrt()
        }

        // Aggregate functions - return hint or activation
        SquashType::Minimum | SquashType::Maximum | SquashType::If
        | SquashType::Hypotenuse | SquashType::HypotenuseV2 | SquashType::Mean => {
            if hint.is_finite() {
                hint
            } else {
                activation
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unsquash_identity() {
        // Identity: f^(-1)(y) = y
        assert_eq!(apply_unsquash(SquashType::Identity, 0.0, 0.0), 0.0);
        assert_eq!(apply_unsquash(SquashType::Identity, 5.0, 0.0), 5.0);
        assert_eq!(apply_unsquash(SquashType::Identity, -5.0, 0.0), -5.0);
    }

    #[test]
    fn test_unsquash_relu() {
        // ReLU: f^(-1)(y) = y for y > 0, else hint
        assert_eq!(apply_unsquash(SquashType::Relu, 5.0, 0.0), 5.0);
        assert_eq!(apply_unsquash(SquashType::Relu, 0.0, -3.0), -3.0);
        assert_eq!(apply_unsquash(SquashType::Relu, 0.0, f32::NAN), 0.0);
    }

    #[test]
    fn test_unsquash_leaky_relu() {
        // LeakyReLU: f^(-1)(y) = y >= 0 ? y : y / alpha
        assert_eq!(apply_unsquash(SquashType::LeakyRelu, 1.0, 0.0), 1.0);
        // For y = -0.01, x = -0.01 / 0.01 = -1.0
        let result = apply_unsquash(SquashType::LeakyRelu, -0.01, 0.0);
        assert!((result - (-1.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_logistic() {
        // Logistic: f^(-1)(y) = log(y / (1 - y))
        // At y = 0.5, x = log(0.5 / 0.5) = log(1) = 0
        let result = apply_unsquash(SquashType::Logistic, 0.5, 0.0);
        assert!(result.abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_tanh() {
        // TANH: f^(-1)(y) = 0.5 * log((1 + y) / (1 - y))
        // At y = 0, x = 0.5 * log(1/1) = 0
        let result = apply_unsquash(SquashType::Tanh, 0.0, 0.0);
        assert!(result.abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_complement() {
        // Complement: f^(-1)(y) = 1 - y
        assert_eq!(apply_unsquash(SquashType::Complement, 0.0, 0.0), 1.0);
        assert_eq!(apply_unsquash(SquashType::Complement, 0.5, 0.0), 0.5);
        assert_eq!(apply_unsquash(SquashType::Complement, 1.0, 0.0), 0.0);
    }

    #[test]
    fn test_unsquash_cube() {
        // Cube: f^(-1)(y) = cbrt(y)
        assert_eq!(apply_unsquash(SquashType::Cube, 0.0, 0.0), 0.0);
        let result = apply_unsquash(SquashType::Cube, 8.0, 0.0);
        assert!((result - 2.0).abs() < 1e-5);
        let result2 = apply_unsquash(SquashType::Cube, -8.0, 0.0);
        assert!((result2 - (-2.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_square() {
        // Square: f^(-1)(y) = +/-sqrt(y) based on hint
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
            assert!(
                (recovered - x).abs() < 1e-5,
                "Identity roundtrip failed for x={}",
                x
            );

            // LeakyReLU
            let activation = apply_squash(SquashType::LeakyRelu, x);
            let recovered = apply_unsquash(SquashType::LeakyRelu, activation, x);
            assert!(
                (recovered - x).abs() < 1e-4,
                "LeakyReLU roundtrip failed for x={}",
                x
            );

            // Complement
            let activation = apply_squash(SquashType::Complement, x);
            let recovered = apply_unsquash(SquashType::Complement, activation, x);
            assert!(
                (recovered - x).abs() < 1e-5,
                "Complement roundtrip failed for x={}",
                x
            );

            // Cube
            let activation = apply_squash(SquashType::Cube, x);
            let recovered = apply_unsquash(SquashType::Cube, activation, x);
            assert!(
                (recovered - x).abs() < 1e-5,
                "Cube roundtrip failed for x={}",
                x
            );
        }
    }

    #[test]
    fn test_unsquash_aggregate_functions() {
        // Aggregate functions return hint if provided
        assert_eq!(apply_unsquash(SquashType::Minimum, 1.0, 42.0), 42.0);
        assert_eq!(apply_unsquash(SquashType::Maximum, 1.0, 42.0), 42.0);
        assert_eq!(apply_unsquash(SquashType::If, 1.0, 42.0), 42.0);
    }
}
