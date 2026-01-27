//! Error calculation for backpropagation through activation functions.
//!
//! This module calculates the error in value-space given activation-space values.
//! Issue #1141 - WASM Migration Phase 9.

use crate::derivative::apply_derivative;
use crate::squash::SquashType;
use crate::unsquash::apply_unsquash;

/// Error epsilon - smallest meaningful difference between target and actual activation
/// Used to short-circuit calculateError() for near-zero error cases.
pub const ERROR_EPSILON: f32 = 1e-6;

/// Maximum error magnitude for clamping
/// Prevents exploding gradients during backpropagation.
pub const MAX_ERROR_MAGNITUDE: f32 = 100.0;

/// Clamps error to a maximum absolute magnitude.
/// Avoids NaN propagation and prevents weight explosion.
#[inline(always)]
pub fn clamp_error(error: f32) -> f32 {
    if !error.is_finite() {
        return 0.0;
    }
    error.clamp(-MAX_ERROR_MAGNITUDE, MAX_ERROR_MAGNITUDE)
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
pub fn apply_calculate_error(
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
        SquashType::Identity => clamp_error(raw_error),

        // COMPLEMENT: Always use derivative (slope = -1)
        SquashType::Complement => clamp_error(raw_error / -1.0),

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
            let target_value =
                apply_unsquash(SquashType::LeakyRelu, target_activation, current_value);
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
                apply_unsquash(SquashType::Logistic, target_activation, current_value)
                    - current_value
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
                apply_unsquash(SquashType::HardTanh, target_activation, current_value)
                    - current_value
            };
            clamp_error(error)
        }

        // Softsign: Use derivative with fallback
        SquashType::Softsign => {
            let slope = apply_derivative(SquashType::Softsign, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Softsign, target_activation, current_value)
                    - current_value
            };
            clamp_error(error)
        }

        // Softplus: Use derivative with fallback
        SquashType::Softplus => {
            let slope = apply_derivative(SquashType::Softplus, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::Softplus, target_activation, current_value)
                    - current_value
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
                apply_unsquash(SquashType::Gaussian, target_activation, current_value)
                    - current_value
            };
            clamp_error(error)
        }

        // BentIdentity: Use derivative with fallback
        SquashType::BentIdentity => {
            let slope = apply_derivative(SquashType::BentIdentity, current_value);
            let error = if slope.abs() > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::BentIdentity, target_activation, current_value)
                    - current_value
            };
            clamp_error(error)
        }

        // BipolarSigmoid: Use derivative with fallback
        SquashType::BipolarSigmoid => {
            let slope = apply_derivative(SquashType::BipolarSigmoid, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::BipolarSigmoid, target_activation, current_value)
                    - current_value
            };
            clamp_error(error)
        }

        // Bipolar: Non-differentiable, use unSquash fallback
        SquashType::Bipolar => {
            let target_value =
                apply_unsquash(SquashType::Bipolar, target_activation, current_value);
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
            let closest_target =
                if (current_value - neg_target).abs() < (current_value - pos_target).abs() {
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
                let safe_slope = slope.clamp(-50.0, 50.0);
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
                let safe_slope = slope.clamp(-50.0, 50.0);
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
                apply_unsquash(SquashType::StdInverse, target_activation, current_value)
                    - current_value
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
                apply_unsquash(SquashType::Exponential, target_activation, current_value)
                    - current_value
            };
            clamp_error(error)
        }

        // LogSigmoid: Use derivative with fallback
        SquashType::LogSigmoid => {
            let slope = apply_derivative(SquashType::LogSigmoid, current_value);
            let error = if slope > 1e-8 {
                raw_error / slope
            } else {
                apply_unsquash(SquashType::LogSigmoid, target_activation, current_value)
                    - current_value
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_error_identity() {
        // Identity: error = rawError (slope = 1)
        let error = apply_calculate_error(SquashType::Identity, 0.5, 0.8, 0.5);
        assert!(
            (error - 0.3).abs() < 1e-5,
            "Identity error should be 0.3, got {}",
            error
        );

        // Tiny error should return 0
        let tiny_error = apply_calculate_error(SquashType::Identity, 0.5, 0.5 + 1e-8, 0.5);
        assert_eq!(tiny_error, 0.0, "Tiny error should return 0");
    }

    #[test]
    fn test_calculate_error_complement() {
        // Complement: error = rawError / -1 = -rawError
        let error = apply_calculate_error(SquashType::Complement, 0.5, 0.8, 0.5);
        assert!(
            (error - (-0.3)).abs() < 1e-5,
            "Complement error should be -0.3, got {}",
            error
        );
    }

    #[test]
    fn test_calculate_error_relu() {
        // ReLU: use raw error when active
        let error = apply_calculate_error(SquashType::Relu, 2.0, 3.0, 2.0);
        assert!(
            (error - 1.0).abs() < 1e-5,
            "ReLU active error should be 1.0, got {}",
            error
        );

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
        assert!(
            (error - 0.5).abs() < 1e-4,
            "TANH error at x=0 should be ~0.5, got {}",
            error
        );
    }

    #[test]
    fn test_calculate_error_absolute() {
        // ABSOLUTE: uses closest target approach
        // currentValue = -2, activation = 2, target = 1
        // Options: -1 or +1 as targets
        // closest to -2 is -1, so error = -1 - (-2) = 1
        let error = apply_calculate_error(SquashType::Absolute, 2.0, 1.0, -2.0);
        assert!(
            (error - 1.0).abs() < 1e-5,
            "Absolute error should be 1.0, got {}",
            error
        );
    }

    #[test]
    fn test_calculate_error_clamping() {
        // Test that errors are clamped to +/-100
        let large_error = apply_calculate_error(SquashType::Identity, 0.0, 1000.0, 0.0);
        assert!(
            large_error.abs() <= 100.0,
            "Error should be clamped to +/-100, got {}",
            large_error
        );

        let neg_large_error = apply_calculate_error(SquashType::Identity, 1000.0, 0.0, 1000.0);
        assert!(
            neg_large_error.abs() <= 100.0,
            "Negative error should be clamped to +/-100, got {}",
            neg_large_error
        );
    }

    #[test]
    fn test_calculate_error_aggregate_functions() {
        // Aggregate functions should return 0
        assert_eq!(
            apply_calculate_error(SquashType::Minimum, 0.5, 0.8, 0.5),
            0.0
        );
        assert_eq!(
            apply_calculate_error(SquashType::Maximum, 0.5, 0.8, 0.5),
            0.0
        );
        assert_eq!(apply_calculate_error(SquashType::If, 0.5, 0.8, 0.5), 0.0);
    }
}
